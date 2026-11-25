/**
 * The address a cell's text opens, or null when the text is not one whole http(s) URL. The OWOX host opens https only, so an http URL
 * opens as https; one with its own port is left as text, since no https server is expected there. A URL with a user part
 * (`https://google.com@other.example`) is left as text too: it hides the real host. So are two URLs joined by `,`, `;` or `|` with no
 * space, unless they sit inside one query value that starts with a URL (`?urls=https://b.com,https://c.com`), and a host that is no name or address (a `{domain}` template, a `*` wildcard, empty labels).
 */
export function linkOf(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t) || !URL.canParse(t)) return null;
  // Query values that start with a URL are cut out first. `[^=&#?]` keeps each scan to one parameter, so the check stays linear.
  if (/[,;|]https?:\/\//i.test(t.replace(/([?&][^=&#?]*=)https?:\/\/[^&#]*/gi, '$1'))) return null;
  const url = new URL(t);
  // The parser leaves `{`, `*` and empty labels in a host; it has lowercased it and turned an IDN into punycode.
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?)$/.test(url.hostname)) return null;
  if (url.username || url.password) return null;
  if (url.protocol === 'http:') {
    if (url.port) return null;
    url.protocol = 'https:';
  }
  return url.href;
}
