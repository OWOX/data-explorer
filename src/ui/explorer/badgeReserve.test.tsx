import { unfoldExtra } from './badgeReserve';

describe('unfoldExtra', () => {
  test('no badges reserve nothing', () => expect(unfoldExtra([])).toBe(0));
  test('the widest unfolded badge sets the room: its label and padding less the room at rest', () => {
    expect(unfoldExtra([50, 30])).toBe(50 - 8);
  });
  test('never negative', () => expect(unfoldExtra([4])).toBe(0));
});
