import { unfoldExtra } from './badgeReserve';

describe('unfoldExtra', () => {
  test('no badges reserve nothing', () => expect(unfoldExtra([])).toBe(0));
  test('the widest unfolded badge sets the room: its label and x, less the icon it hides', () => {
    expect(unfoldExtra([{ label: 50, x: true }, { label: 30, x: true }])).toBe(50 + 15 - 12);
    // A lone main mart's "N columns" has no x.
    expect(unfoldExtra([{ label: 50, x: false }])).toBe(50 - 12);
  });
  test('never negative', () => expect(unfoldExtra([{ label: 4, x: false }])).toBe(0));
});
