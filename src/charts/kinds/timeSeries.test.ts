import { AUTO } from '../../format/formats';
import { tickText } from '../compact';

test('a plain measure reads short from 10,000 and rounded below', () => {
  expect(tickText(10240, 'INTEGER', AUTO)).toBe('10.2K');
  expect(tickText(5124.456, 'FLOAT', AUTO)).toBe('5,124.46');
  expect(tickText(0, 'INTEGER', AUTO)).toBe('0');
});

test('a money measure keeps its unit on the axis', () => {
  const usd = { kind: 'money', currency: 'USD' } as const;
  expect(tickText(10240, 'FLOAT', usd)).toMatch(/10\.2K/);
  expect(tickText(10240, 'FLOAT', usd)).toMatch(/\$|US/);
  expect(tickText(5124.456, 'FLOAT', usd)).toMatch(/5,124\.46/);
  expect(tickText(5124.456, 'FLOAT', usd)).toMatch(/\$|US/);
});

test('a percent axis keeps the precision the format shows', () => {
  expect(tickText(0.0347 / 3, 'FLOAT', { kind: 'percent' })).toBe('1.16%');
  expect(tickText(0.004, 'FLOAT', { kind: 'percent' })).toBe('0.4%');
});
