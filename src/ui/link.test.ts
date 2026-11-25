import { linkOf } from './link';

test.each([
  ['https://owox.com/blog?a=1#top', 'https://owox.com/blog?a=1#top'],
  ['  https://owox.com/a  ', 'https://owox.com/a'],
  ['HTTPS://OWOX.com/A', 'https://owox.com/A'],
  // The host opens https only.
  ['http://owox.com/a', 'https://owox.com/a'],
  // A redirect URL is one link; hosts that are real names, addresses or IDN stay links.
  ['https://a.com/?u=https://b.com', 'https://a.com/?u=https://b.com'],
  // A list of URLs inside one query value is that parameter's own business.
  ['https://a.com/x?urls=https://b.com,https://c.com', 'https://a.com/x?urls=https://b.com,https://c.com'],
  ['https://a.com/x?v=1&urls=https://b.com,https://c.com', 'https://a.com/x?v=1&urls=https://b.com,https://c.com'],
  ['https://a.com/x?u=https://b.com/?x=1', 'https://a.com/x?u=https://b.com/?x=1'],
  ['https://a.com/x?u=https://b.com;https://c.com&v=1#top', 'https://a.com/x?u=https://b.com;https://c.com&v=1#top'],
  ['https://localhost:3000/a', 'https://localhost:3000/a'],
  ['https://127.0.0.1/a', 'https://127.0.0.1/a'],
  ['https://[::1]/a', 'https://[::1]/a'],
  ['https://münchen.de/a', 'https://xn--mnchen-3ya.de/a'],
  ['https://owox.com./a', 'https://owox.com./a'],
  ['https://a_b.owox.com/', 'https://a_b.owox.com/'],
  ['https://a.com/{x}?q={y}', 'https://a.com/%7Bx%7D?q={y}'],
])('%s is a link to %s', (text, href) => expect(linkOf(text)).toBe(href));

test.each([
  '', 'owox.com', 'see https://owox.com', 'https://a.com, https://b.com', 'https://', 'javascript:alert(1)', 'data:text/html,x', 'ftp://owox.com/a',
  // No https server is expected behind an explicit http port, and a user part hides the real host.
  'http://owox.com:8080/a', 'https://google.com@evil.example/a',
  // Two URLs joined without a space; the `^` keeps a scheme from hiding behind another URL.
  'https://a.com/x,https://b.com/y', 'https://a.com/x;https://b.com/y', 'https://a.com/x|https://b.com/y', 'javascript:alert(1)//https://x', 'javascript://a.com/https://x',
  // The first URL's own query is no URL, and a URL in a query value does not excuse a joined pair outside it.
  'https://a.com/x?y=1,https://b.com/z', 'https://a.com/x,https://b.com/y?u=https://c.com',
  // A value with its own `?` or `&` is not cut, so the list in it still shows; so does an `&` with no `?` before it.
  'https://a.com/login?next=https://a.com/home,https://a.com/logout?next=https://a.com', 'https://a.com/x&u=https://b.com,https://c.com',
  'https://a.com/x?u=https://b.com&v=1,https://c.com', 'https://a.com/#f?u=https://b.com,https://c.com',
  // The text before a cut value can hold the joined URL: cutting the name too would hide it. Nor does a cut reach into the fragment.
  'https://a.com/x?x,https://b.com/y=https://c.com', 'https://a.com/x?k=1&x,https://b.com/y=https://c.com', 'https://a.com/?a=1#x&u=https://b.com,https://c.com',
  // A template or broken host.
  'https://{domain}/x', 'https://*.owox.com/', 'https://...', 'https://.a.com/', 'https://a..com/',
])('"%s" is no link', (text) => expect(linkOf(text)).toBeNull());

test('a very long text is checked in linear time', () => {
  for (const t of ['https://a.com/' + '?'.repeat(200_000), 'https://a.com/?' + '&a'.repeat(100_000), 'https://a.com/?' + 'a'.repeat(200_000), 'https://a.com/?u=' + 'https://b.com,'.repeat(15_000)]) {
    const start = performance.now();
    linkOf(t);
    expect(performance.now() - start).toBeLessThan(500);
  }
});
