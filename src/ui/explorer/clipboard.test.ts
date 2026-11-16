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
