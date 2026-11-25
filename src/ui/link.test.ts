import { linkOf } from './link';

test.each([
  ['https://owox.com/blog?a=1#top', 'https://owox.com/blog?a=1#top'],
  ['  https://owox.com/a  ', 'https://owox.com/a'],
  ['HTTPS://OWOX.com/A', 'https://owox.com/A'],
  // The host opens https only.
  ['http://owox.com/a', 'https://owox.com/a'],
  // A redirect URL is one link; hosts that are real names, addresses or IDN stay links.
  ['https://a.com/?u=https://b.com', 'https://a.com/?u=https://b.com'],
  ['https://localhost:3000/a', 'https://localhost:3000/a'],
  ['https://127.0.0.1/a', 'https://127.0.0.1/a'],
  ['https://[::1]/a', 'https://[::1]/a'],
  ['https://münchen.de/a', 'https://xn--mnchen-3ya.de/a'],
  ['https://a_b.owox.com/', 'https://a_b.owox.com/'],
  ['https://a.com/{x}?q={y}', 'https://a.com/%7Bx%7D?q={y}'],
])('%s is a link to %s', (text, href) => expect(linkOf(text)).toBe(href));

test.each([
  '', 'owox.com', 'see https://owox.com', 'https://a.com, https://b.com', 'https://', 'javascript:alert(1)', 'data:text/html,x', 'ftp://owox.com/a',
  // No https server is expected behind an explicit http port, and a user part hides the real host.
  'http://owox.com:8080/a', 'https://google.com@evil.example/a',
  // Two URLs joined without a space; the `^` keeps a scheme from hiding behind another URL.
  'https://a.com/x,https://b.com/y', 'https://a.com/x;https://b.com/y', 'https://a.com/x|https://b.com/y', 'javascript:alert(1)//https://x', 'javascript://a.com/https://x',
  // A template or broken host.
  'https://{domain}/x', 'https://*.owox.com/', 'https://...', 'https://.a.com/', 'https://a..com/',
])('"%s" is no link', (text) => expect(linkOf(text)).toBeNull());
