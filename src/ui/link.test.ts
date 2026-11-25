import { linkOf } from './link';

test.each([
  ['https://owox.com/blog?a=1#top', 'https://owox.com/blog?a=1#top'],
  ['  https://owox.com/a  ', 'https://owox.com/a'],
  ['HTTPS://OWOX.com/A', 'https://owox.com/A'],
  // The host opens https only.
  ['http://owox.com/a', 'https://owox.com/a'],
])('%s is a link to %s', (text, href) => expect(linkOf(text)).toBe(href));

test.each([
  '', 'owox.com', 'see https://owox.com', 'https://a.com, https://b.com', 'https://', 'javascript:alert(1)', 'data:text/html,x', 'ftp://owox.com/a',
  // No https server is expected behind an explicit http port, and a user part hides the real host.
  'http://owox.com:8080/a', 'https://google.com@evil.example/a',
])('"%s" is no link', (text) => expect(linkOf(text)).toBeNull());
