import { ghostStep, IDLE, shownOf, type GhostEvent, type GhostState, type Over } from './ghost-chain';

const NOWHERE: Over = { card: null, ghost: null, plus: false };
const main = 'm';
// Each place as a short word: `a` is the card, `a+` its (+), `~c` the ghost, `~c+` its (+), `-` nothing. C joins under A, E under C, D under B.
const PATHS: Record<string, string> = { a: 'a', b: 'b', c: 'a.c', s: 'a.s', e: 'a.c.e', d: 'b.d' };
const place = (w: string): Over => {
  if (w === '-') return NOWHERE;
  const plus = w.endsWith('+');
  const bare = plus ? w.slice(0, -1) : w;
  return bare.startsWith('~') ? { card: null, ghost: PATHS[bare.slice(1)]!, plus } : { card: PATHS[bare]!, ghost: null, plus };
};
/** One word per event: `over a+`, `focus ~c+`, `blur` (`blur ~c`), `plus a`, `ghostPlus c`, `card a`, `pin a`, `clear`, `lose b`, `ghosts` and `dim` for the two deadlines. */
function event(s: GhostState, text: string): GhostEvent {
  const [what, arg = ''] = text.split(' ');
  switch (what) {
    case 'over': return { type: 'over', over: place(arg) };
    case 'focus': return { type: 'focus', over: place(arg) };
    case 'blur': return { type: 'blur', to: arg === '' ? null : place(arg) };
    case 'plus': case 'card': case 'ghostPlus': case 'pin': return { type: what, path: PATHS[arg]!, main };
    case 'clear': return { type: 'clear' };
    case 'lose': return { type: 'tree', main, has: (p) => p !== PATHS[arg] };
    case 'main': return { type: 'tree', main: 'other', has: () => true };
    case 'ghosts': return { type: 'ghostsDue', due: s.ghostsDue ?? -1 };
    case 'dim': return { type: 'atDue', due: s.atDue ?? -1 };
    default: throw new Error(`no event ${text}`);
  }
}
const run = (events: string[], from = IDLE) => events.reduce((s, e) => ghostStep(s, event(s, e)), from);
const NAMES = Object.fromEntries(Object.entries(PATHS).map(([k, v]) => [v, k]));
/** `a>c` for A's ghosts and the level of ghost C, `...` after it while the deadline runs. */
const show = (s: GhostState) => {
  const x = shownOf(s);
  return (x === null ? 'nothing' : [x.anchor, ...x.chain].map((p) => NAMES[p]).join('>')) + (s.ghostsDue === null ? '' : '...');
};
const dims = (s: GhostState) => (s.at === null ? 'nothing' : s.at.card !== null ? NAMES[s.at.card]! : `~${NAMES[s.at.ghost!]}`) + (s.atDue === null ? '' : '...');

const cases = (name: string, rows: [events: string, shown: string][]) =>
  test.each(rows)(`${name}: %s -> %s`, (events, shown) => { expect(show(run(events.split(', ')))).toBe(shown); });

cases('only a (+) shows ghosts', [
  ['over a', 'nothing'],
  ['over a+', 'a'],
  ['focus a+', 'a'],
  ['over a+, over b+', 'b'],
]);

cases('the ghosts stay on the anchor card and on a ghost, and wait elsewhere', [
  ['over a+, over a', 'a'],
  ['over a+, over ~c', 'a'],
  ['over a+, over b', 'a...'],
  ['over a+, over -', 'a...'],
  ['over a+, over -, over ~c', 'a'],
  ['over a+, over -, over a', 'a'],
  ['over a+, over -, ghosts', 'nothing'],
]);

cases('the (+) of a ghost adds the next level, the ghost does not', [
  ['over a+, over ~c+', 'a>c'],
  ['over a+, over ~c+, over ~e', 'a>c'],
  ['over a+, over ~c+, over ~s+', 'a>s'],
  ['over a+, over ~c+, over a', 'a>c'],
  ['over a+, over ~c+, over a+', 'a'],
  ['over a+, over ~d+', 'a...'],
  ['focus a+, focus ~c+', 'a>c'],
  ['over a+, focus ~c+, blur', 'a'],
]);

cases('a pin stays under what is hovered or focused', [
  ['plus a, over ~c', 'a'],
  ['plus a, over ~c+', 'a>c'],
  ['plus a, over ~c+, over -', 'a>c...'],
  ['plus a, over ~c+, over -, ghosts', 'a'],
  ['plus a, over ~c+, over b', 'a>c...'],
  ['plus a, focus ~c+', 'a>c'],
  ['plus a, focus ~c+, blur, ghosts', 'a'],
  ['plus a, over b', 'a'],
  ['plus a, over b+', 'b'],
  ['plus a, over b+, over a', 'b...'],
  ['plus a, over b+, over -, ghosts', 'a'],
  ['plus a, over b+, plus b, over -', 'b'],
  ['plus a, card b', 'b'],
]);

cases('a pinned chain stays', [
  ['over a+, over ~c+, ghostPlus c, over -', 'a>c'],
  ['over a+, ghostPlus c, over -', 'a>c'],
  ['plus a, ghostPlus c, over a+', 'a>c'],
  ['plus a, ghostPlus c, ghostPlus e, over ~c+', 'a>c>e'],
  ['plus a, ghostPlus c, over ~e+', 'a>c>e'],
  ['plus a, ghostPlus c, over ~e+, over -, ghosts', 'a>c'],
  ['plus a, ghostPlus c, ghostPlus e, ghostPlus c', 'a'],
  ['plus a, over b+, ghostPlus d, over -', 'b>d'],
]);

cases('what a click or Escape closed stays closed for the same hover', [
  ['over a+, plus a, plus a', 'nothing'],
  ['over a+, plus a, plus a, over a+', 'nothing'],
  ['over a+, plus a, plus a, focus b+, blur, ghosts', 'nothing'],
  ['over a+, plus a, plus a, focus b+, blur, ghosts, over a+', 'nothing'],
  ['over a+, plus a, plus a, focus a+, blur, ghosts', 'nothing'],
  ['over a+, plus a, plus a, over a, over a+', 'a'],
  ['over a+, plus a, plus a, plus a', 'a'],
  ['over a+, clear', 'nothing'],
  ['over a+, clear, over a+', 'nothing'],
  ['over a+, plus a, clear, over a+', 'nothing'],
  ['over a+, clear, focus b+, blur, ghosts, over a+', 'nothing'],
  ['over a+, clear, over -, over a+', 'a'],
  ['plus a, over ~c+, ghostPlus c, ghostPlus c', 'a'],
  ['plus a, over ~c+, ghostPlus c, ghostPlus c, over ~c+', 'a'],
  ['plus a, over ~c+, ghostPlus c, ghostPlus c, over ~c, over ~c+', 'a>c'],
  ['over b+, focus a+, plus a, plus a, over b+', 'nothing'],
]);

cases('a blur lets go of what focus showed and of nothing the pointer holds', [
  ['focus a+, blur', 'a...'],
  ['focus a+, blur, ghosts', 'nothing'],
  ['focus a+, blur ~c', 'a'],
  ['focus a+, blur a', 'a'],
  ['focus a+, blur b+, focus b+', 'b'],
  ['focus a+, over b', 'a'],
  ['over a, focus a+, blur', 'a'],
  ['focus a+, over ~c, blur', 'a'],
  ['focus a+, over ~c, blur, over -', 'a...'],
  ['over b+, focus a+, blur', 'b'],
  ['over b+, over b, focus a+, blur', 'b'],
  ['over b+, focus a+, over -, blur, ghosts', 'nothing'],
  ['over a+, focus b+, over b+, blur', 'b'],
  ['over a+, over -, focus ~c', 'a'],
  ['focus a+, plus a, plus a, blur, focus a+', 'a'],
  // The pointer was on the ghosts and left: focus, which a press on the (+) moved there, does not hold them.
  ['over a+, focus a+, over -', 'a...'],
  ['focus a+, over ~c, over -', 'a...'],
]);

cases('what left the tree counts as none', [
  ['plus a, lose a', 'nothing'],
  ['plus a, over b+, lose b', 'a'],
  ['plus a, focus b+, lose b', 'a'],
  ['plus a, over b+, lose b, over ~c+', 'a>c'],
  ['plus a, main', 'nothing'],
  ['plus a, over ~c+, lose a', 'nothing'],
]);

test('a deadline that runs is not moved, and every new one is another', () => {
  const left = run(['over a+', 'over -']);
  expect(left.ghostsDue).not.toBeNull();
  for (const more of ['over b', 'over -', 'over b']) expect(run([more], left).ghostsDue).toBe(left.ghostsDue);
  const again = run(['over a+', 'over -'], left);
  expect(again.ghostsDue).not.toBe(left.ghostsDue);
  // The first one's timer, had it fired late, does nothing.
  expect(show(ghostStep(again, { type: 'ghostsDue', due: left.ghostsDue! }))).toBe('a...');
});

test.each([
  ['over a', 'a'],
  ['over a, over -', 'a...'],
  ['over a, over -, over -', 'a...'],
  ['over a, over -, dim', 'nothing'],
  ['over a, over -, over b', 'b'],
  ['over a, over -, focus ~c', '~c'],
  ['plus b, over a, over -, over b', 'b'],
  ['over a+, over b, over -, ghosts', 'b...'],
  ['focus a+', 'a'],
  ['focus a+, over -', 'a'],
  ['focus a+, blur', 'a...'],
  ['focus a+, over b, blur', 'b'],
  ['over b, focus a+, blur', 'b'],
  ['over a+, focus a+, plus a, over -', 'a...'],
  ['over a, card a, over -, card a', 'nothing'],
  ['focus a+, plus a, plus a', 'nothing'],
  ['over a+, plus a, over -, plus a', 'nothing'],
  ['over a+, plus a, plus a', 'a'],
  ['over a, clear', 'nothing'],
  ['over b, lose b', 'nothing'],
])('the dimming: %s -> %s', (events, at) => { expect(dims(run(events.split(', ')))).toBe(at); });

test('an event that changes nothing keeps the state object', () => {
  const s = run(['over a+', 'over a']);
  expect(run(['over a'], s)).toBe(s);
  expect(run(['ghosts', 'dim', 'lose b'], s)).toBe(s);
});

test('after any few events, once the pointer and focus are away and the deadlines have passed only the pin shows and nothing is dimmed', () => {
  const words = ['over a', 'over a+', 'over b+', 'over ~c', 'over ~c+', 'over -', 'focus a+', 'focus b+', 'focus ~c+', 'blur', 'plus a', 'ghostPlus c', 'card b', 'clear', 'lose b', 'ghosts'];
  const walk = (s: GhostState, left: number, trail: string[]) => {
    const end = run(['over -', 'blur', 'ghosts', 'dim'], s);
    if (shownOf(end) !== end.pin || end.at !== null || end.ghostsDue !== null || end.atDue !== null) throw new Error(`stuck after ${trail.join(', ')}: ${show(end)}, dims ${dims(end)}`);
    if (left > 0) for (const w of words) walk(run([w], s), left - 1, [...trail, w]);
  };
  walk(IDLE, 4, []);
});
