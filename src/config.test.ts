import { martAppUrl, PAGE_SIZE } from './config';

describe('martAppUrl', () => {
  const ui = (link: (p: string) => { href: string } | undefined) => ({ link }) as never;
  it('uses the host origin when the host knows it', () => {
    expect(martAppUrl({ projectId: 'p 1', ui: ui((p) => ({ href: `https://self.example${p}` })) }, 'm/1')).toBe('https://self.example/ui/p%201/data-marts/m%2F1/overview');
  });
  it('falls back to app.owox.com when the host origin is unknown', () => {
    expect(martAppUrl({ projectId: 'p', ui: ui(() => undefined) }, 'm')).toBe('https://app.owox.com/ui/p/data-marts/m/overview');
  });
});

test('the page size matches the spec', () => {
  expect(PAGE_SIZE).toBe(200);
});
