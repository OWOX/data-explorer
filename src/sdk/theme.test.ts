import { afterEach, expect, test, vi } from 'vitest';
import { applyTheme } from './theme';

const prefer = (dark: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark') }) as MediaQueryList);
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.className = ''; });

test('the host theme wins over the OS preference', () => {
  prefer(true);
  expect(applyTheme('light')).toBe('light');
  expect(document.documentElement).not.toHaveClass('dark');
  prefer(false);
  expect(applyTheme('dark')).toBe('dark');
  expect(document.documentElement).toHaveClass('dark');
});

test('no theme, or an unknown one, follows the OS preference', () => {
  prefer(true);
  expect(applyTheme()).toBe('dark');
  expect(document.documentElement).toHaveClass('dark');
  prefer(false);
  expect(applyTheme('system')).toBe('light');
  expect(document.documentElement).not.toHaveClass('dark');
});
