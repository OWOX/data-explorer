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
/** One word per event: `over a+`, `focus ~c+`, `blur` (`blur ~c`), `plus a`, `ghostPlus c`, `card a`, `select a`, `clear`, `lose b`, `dim` for the deadline. */
function event(s: GhostState, text: string): GhostEvent {
  const [what, arg = ''] = text.split(' ');
  switch (what) {
    case 'over': return { type: 'over', over: place(arg) };
    case 'focus': return { type: 'focus', over: place(arg) };
    case 'blur': return { type: 'blur', to: arg === '' ? null : place(arg) };
    case 'plus': case 'card': case 'ghostPlus': case 'select': return { type: what, path: PATHS[arg]!, main };
    case 'clear': return { type: 'clear' };
    case 'lose': return { type: 'tree', main, has: (p) => p !== PATHS[arg] };
    case 'main': return { type: 'tree', main: 'other', has: () => true };
    case 'dim': return { type: 'atDue', due: s.atDue ?? -1 };
    default: throw new Error(`no event ${text}`);
  }
}
const run = (events: string[], from = IDLE) => events.reduce((s, e) => ghostStep(s, event(s, e)), from);
const NAMES = Object.fromEntries(Object.entries(PATHS).map(([k, v]) => [v, k]));
/** `a>c` for A's ghosts and the level of ghost C. */
const show = (s: GhostState) => {
  const x = shownOf(s);
  return x === null ? 'nothing' : [x.anchor, ...x.chain].map((p) => NAMES[p]).join('>');
};
const picked = (s: GhostState) => (s.selected === null ? 'nothing' : NAMES[s.selected.path]!);
const dims = (s: GhostState) => (s.at === null ? 'nothing' : s.at.card !== null ? NAMES[s.at.card]! : `~${NAMES[s.at.ghost!]}`) + (s.atDue === null ? '' : '...');

const cases = (name: string, rows: [events: string, shown: string][]) =>
  test.each(rows)(`${name}: %s -> %s`, (events, shown) => { expect(show(run(events.split(', ')))).toBe(shown); });

cases('hover and focus open nothing, only a click on a (+) does', [
  ['over a', 'nothing'],
  ['over a+', 'nothing'],
  ['focus a+', 'nothing'],
  ['over a+, over ~c+', 'nothing'],
  ['card a', 'nothing'],
  ['select a', 'nothing'],
  ['plus a', 'a'],
  ['over a+, plus a', 'a'],
]);

cases('open ghosts stay wherever the pointer and focus go', [
  ['plus a, over -', 'a'],
  ['plus a, over b', 'a'],
  ['plus a, over b+', 'a'],
  ['plus a, focus b+, blur', 'a'],
  ['plus a, over ~c+, over -', 'a'],
  ['plus a, card b', 'a'],
  ['plus a, select b', 'a'],
]);

cases('a second click closes, another card\'s (+) moves them', [
  ['plus a, plus a', 'nothing'],
  ['plus a, plus a, over a+', 'nothing'],
  ['plus a, plus b', 'b'],
  ['plus a, plus b, plus b', 'nothing'],
  ['plus a, clear', 'nothing'],
]);

cases('the (+) of a ghost adds the next level and closes it again', [
  ['plus a, ghostPlus c', 'a>c'],
  ['plus a, ghostPlus c, ghostPlus e', 'a>c>e'],
  ['plus a, ghostPlus c, ghostPlus s', 'a>s'],
  ['plus a, ghostPlus c, ghostPlus e, ghostPlus c', 'a'],
  ['plus a, ghostPlus c, ghostPlus e, ghostPlus e', 'a>c'],
  ['plus a, ghostPlus d', 'a'],
  ['ghostPlus c', 'nothing'],
  ['plus a, ghostPlus c, plus a', 'nothing'],
]);

cases('what left the tree counts as none', [
  ['plus a, lose a', 'nothing'],
  ['plus a, lose b', 'a'],
  ['plus a, main', 'nothing'],
  ['plus a, ghostPlus c, lose a', 'nothing'],
]);

test.each([
  ['card a', 'a'],
  ['card a, card a', 'nothing'],
  ['card a, card b', 'b'],
  ['select c', 'c'],
  ['card a, plus b', 'a'],
  ['card a, plus a, plus a', 'a'],
  ['card a, clear', 'nothing'],
  ['card a, lose a', 'nothing'],
  ['card a, main', 'nothing'],
  ['over a+', 'nothing'],
])('the selected card: %s -> %s', (events, sel) => { expect(picked(run(events.split(', ')))).toBe(sel); });

test.each([
  ['over a', 'a'],
  ['over a, over -', 'a...'],
  ['over a, over -, over -', 'a...'],
  ['over a, over -, dim', 'nothing'],
  ['over a, over -, over b', 'b'],
  ['over a, over -, focus ~c', '~c'],
  ['plus b, over a, over -, over b', 'b'],
  ['focus a+', 'a'],
  ['focus a+, over -', 'a'],
  ['focus a+, blur', 'a...'],
  ['focus a+, over b, blur', 'b'],
  ['over b, focus a+, blur', 'b'],
  ['focus a+, blur b', 'a'],
  ['plus a, over ~c, plus a', 'nothing'],
  ['plus a, ghostPlus c, over ~e, ghostPlus c', 'nothing'],
  ['over a, card a, over -, card a', 'a...'],
  ['over a+, plus a, plus a', 'a'],
  ['over a, clear', 'nothing'],
  ['over b, lose b', 'nothing'],
])('the dimming: %s -> %s', (events, at) => { expect(dims(run(events.split(', ')))).toBe(at); });

test('a deadline that runs is not moved, and every new one is another', () => {
  const left = run(['over a', 'over -']);
  expect(left.atDue).not.toBeNull();
  for (const more of ['over -', 'blur']) expect(run([more], left).atDue).toBe(left.atDue);
  const again = run(['over a', 'over -'], left);
  expect(again.atDue).not.toBe(left.atDue);
  // The first one's timer, had it fired late, does nothing.
  expect(dims(ghostStep(again, { type: 'atDue', due: left.atDue! }))).toBe('a...');
});

test('an event that changes nothing keeps the state object', () => {
  const s = run(['plus a', 'over a']);
  expect(run(['over a'], s)).toBe(s);
  expect(run(['dim', 'lose b', 'ghostPlus d'], s)).toBe(s);
});

test('after any few events, once the pointer and focus are away and the deadline has passed, hover and focus have changed no ghosts and nothing is dimmed', () => {
  const words = ['over a', 'over a+', 'over b+', 'over ~c', 'over ~c+', 'over -', 'focus a+', 'focus b+', 'focus ~c+', 'blur', 'plus a', 'plus b', 'ghostPlus c', 'card b', 'select c', 'clear', 'lose b'];
  const clicks = new Set(['plus a', 'plus b', 'ghostPlus c', 'clear', 'lose b']);
  const walk = (s: GhostState, left: number, trail: string[]) => {
    const end = run(['over -', 'blur', 'dim'], s);
    if (end.pin !== s.pin || end.at !== null || end.atDue !== null) throw new Error(`stuck after ${trail.join(', ')}: ${show(end)}, dims ${dims(end)}`);
    if (left > 0) for (const w of words) {
      const next = run([w], s);
      if (!clicks.has(w) && next.pin !== s.pin) throw new Error(`${w} after ${trail.join(', ')} changed the ghosts`);
      walk(next, left - 1, [...trail, w]);
    }
  };
  walk(IDLE, 4, []);
});
