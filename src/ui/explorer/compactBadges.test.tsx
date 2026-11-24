import { render, screen } from '@testing-library/react';
import { badgesCompact, TitleRow } from './compactBadges';

describe('badgesCompact', () => {
  test('full text without a measurement', () => {
    expect(badgesCompact(0, 0, false)).toBe(false);
    expect(badgesCompact(0, 200, false)).toBe(false);
    expect(badgesCompact(300, 0, true)).toBe(false);
  });
  test('compact below the width the full layout needs, full at or above it', () => {
    expect(badgesCompact(199, 200, false)).toBe(true);
    expect(badgesCompact(200, 200, false)).toBe(false);
    expect(badgesCompact(500, 200, false)).toBe(false);
  });
  test('once compact it needs a little more room to come back', () => {
    expect(badgesCompact(204, 200, true)).toBe(true);
    expect(badgesCompact(208, 200, true)).toBe(false);
  });
});

test('a title row with no layout shows the full labels', () => {
  render(<TitleRow>{(compact) => <span data-title-text>{compact ? 'icons' : 'text'}</span>}</TitleRow>);
  expect(screen.getByText('text')).toBeVisible();
});

test('a short title asks for its own width, not the minimum, so a narrow cell stays in the full layout', () => {
  const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(90);
  const offset = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(60);
  const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-title-text') ? 20 : 0; });
  try {
    render(<TitleRow>{(compact) => <><span data-title-text>Ads</span><span>{compact ? 'icons' : 'text'}</span></>}</TitleRow>);
    // Needed: badge 60 + title 20 (not 40) = 80, which the 90px row has.
    expect(screen.getByText('text')).toBeVisible();
  } finally { clientWidth.mockRestore(); offset.mockRestore(); scroll.mockRestore(); }
});
