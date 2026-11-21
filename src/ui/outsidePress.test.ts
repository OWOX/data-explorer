import { swallowPress } from './outsidePress';

function press() {
  const seen = vi.fn();
  window.addEventListener('click', seen);
  const down = new Event('pointerdown', { bubbles: true });
  window.dispatchEvent(down);
  swallowPress(down);
  return { seen, off: () => window.removeEventListener('click', seen) };
}
const click = (detail = 1) => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('a click shortly after the release is still swallowed', () => {
  const p = press();
  window.dispatchEvent(new Event('pointerup'));
  vi.advanceTimersByTime(100);
  click();
  expect(p.seen).not.toHaveBeenCalled();
  p.off();
});

test('a click long after the release is not swallowed', () => {
  const p = press();
  window.dispatchEvent(new Event('pointerup'));
  vi.advanceTimersByTime(500);
  click();
  expect(p.seen).toHaveBeenCalledTimes(1);
  p.off();
});

test('a click with no pointer behind it (detail 0) passes', () => {
  const p = press();
  click(0);
  expect(p.seen).toHaveBeenCalledTimes(1);
  click();
  expect(p.seen).toHaveBeenCalledTimes(1);
  p.off();
});
