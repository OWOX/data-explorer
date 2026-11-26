/**
 * The address a cell's text opens, or null when the text is not one whole http(s) URL. The OWOX host opens https only, so an http URL
 * opens as https; one with its own port is left as text, since no https server is expected there. A URL with a user part
 * (`https://google.com@other.example`) is left as text too: it hides the real host. So are two URLs joined by `,`, `;` or `|` with no
 * space, unless they sit inside one query value that starts with a URL (`?urls=https://b.com,https://c.com`), and a host that is no name or address (a `{domain}` template, a `*` wildcard, empty labels).
 */
export function linkOf(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t) || !URL.canParse(t)) return null;
  if (/[,;|]https?:\/\//i.test(withoutUrlValues(t))) return null;
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

/**
 * The text with each query value that starts with a URL cut out, so a list of URLs inside one value is not taken for two joined URLs. Only a real query
 * counts (a `?` before any `#`, and the cut stays before the next `#`), and only a value with no `?` of its own and ending at `&`, `#` or the end. `[^=&#?]` keeps each scan to one parameter, so it is linear.
 */
function withoutUrlValues(t: string): string {
  const q = t.indexOf('?');
  const hash = t.indexOf('#');
  // A `#` before the first `?` makes it part of the fragment, not a query.
  if (q < 0 || (hash >= 0 && hash < q)) return t;
  const end = hash < 0 ? t.length : hash;
  return t.slice(0, q + 1) + t.slice(q + 1, end).replace(/(^|&)([^=&?]*=)https?:\/\/[^&?]*(?=&|$)/gi, '$1$2') + t.slice(end);
}
