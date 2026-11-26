export type Theme = 'light' | 'dark';

/** The OS preference. The host's default theme follows it, so it is the best guess before the handshake. */
export function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Puts the theme on `<html>`: the `.dark` class switches the colour tokens and the declared `color-scheme`.
 * Anything other than 'light' or 'dark' (a host that sends no theme) falls back to the OS preference.
 */
export function applyTheme(theme?: unknown): Theme {
  const t: Theme = theme === 'dark' || theme === 'light' ? theme : systemTheme();
  document.documentElement.classList.toggle('dark', t === 'dark');
  return t;
}
