/**
 * The address a cell's text opens, or null when the text is not one whole http(s) URL. The OWOX host opens https only, so an http URL
 * opens as https; one with its own port is left as text, since no https server is expected there. A URL with a user part
 * (`https://google.com@other.example`) is left as text too: it hides the real host.
 */
export function linkOf(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t) || !URL.canParse(t)) return null;
  const url = new URL(t);
  if (url.username || url.password) return null;
  if (url.protocol === 'http:') {
    if (url.port) return null;
    url.protocol = 'https:';
  }
  return url.href;
}
