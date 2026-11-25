import { vi } from 'vitest';
import { copyText } from './clipboard';

const setClipboard = (writeText: unknown) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
const setExec = (fn: unknown) => Object.defineProperty(document, 'execCommand', { configurable: true, value: fn });
afterEach(() => { setClipboard(undefined); setExec(undefined); });

test('the async clipboard is tried first', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  setClipboard(writeText);
  expect(await copyText('hello')).toBe(true);
  expect(writeText).toHaveBeenCalledWith('hello');
});

test('when it is blocked a hidden textarea and execCommand copy it', async () => {
  setClipboard(vi.fn().mockRejectedValue(new Error('blocked')));
  const exec = vi.fn(() => (document.activeElement as HTMLTextAreaElement).value === 'hello');
  setExec(exec);
  expect(await copyText('hello')).toBe(true);
  expect(exec).toHaveBeenCalledWith('copy');
  expect(document.querySelector('textarea')).toBeNull();
});

test('when both fail the answer is false and nothing is left in the page', async () => {
  setClipboard(vi.fn().mockRejectedValue(new Error('blocked')));
  setExec(vi.fn(() => false));
  expect(await copyText('x')).toBe(false);
  setExec(vi.fn(() => { throw new Error('denied'); }));
  expect(await copyText('x')).toBe(false);
  expect(document.querySelector('textarea')).toBeNull();
});

test('the fallback gives focus back to the element that had it', async () => {
  const button = document.createElement('button');
  document.body.appendChild(button);
  button.focus();
  setClipboard(undefined);
  setExec(vi.fn(() => true));
  await copyText('x');
  expect(document.activeElement).toBe(button);
  button.remove();
});

test('the fallback gives focus back to an SVG element too', async () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('tabindex', '0');
  svg.appendChild(rect);
  document.body.appendChild(svg);
  rect.focus();
  expect(document.activeElement).toBe(rect);
  setClipboard(undefined);
  setExec(vi.fn(() => true));
  await copyText('x');
  expect(document.activeElement).toBe(rect);
  svg.remove();
});

test('the fallback focuses without scrolling, the textarea and the element it gives focus back to', async () => {
  const button = document.createElement('button');
  document.body.appendChild(button);
  button.focus();
  const calls: unknown[][] = [];
  const focus = HTMLElement.prototype.focus;
  const spy = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, ...args: [FocusOptions?]) { calls.push([this.tagName, ...args]); return focus.apply(this, args); });
  setClipboard(undefined);
  setExec(vi.fn(() => true));
  await copyText('x');
  spy.mockRestore();
  expect(calls).toEqual([['TEXTAREA', { preventScroll: true }], ['BUTTON', { preventScroll: true }]]);
  button.remove();
});
