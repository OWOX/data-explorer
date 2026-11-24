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
