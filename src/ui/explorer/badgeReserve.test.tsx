import { unfoldExtra } from './badgeReserve';

describe('unfoldExtra', () => {
  test('no badges reserve nothing', () => expect(unfoldExtra([])).toBe(0));
  test('the widest unfolded badge sets the room: its label less the icon it hides', () => {
    expect(unfoldExtra([50, 30])).toBe(50 - 12);
  });
  test('never negative', () => expect(unfoldExtra([4])).toBe(0));
});
