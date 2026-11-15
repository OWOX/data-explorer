import { Box, Building2, ShoppingCart, ArrowDownAZ, Receipt, Tags } from 'lucide-react';
import { dqVisual, resolveIcon } from './icons';

test.each([
  [{ state: 'PASSED' }, 'Passed', 'success'],
  [{ state: 'ISSUES', warningFindings: 2 }, 'Issues found', 'warning'],
  [{ state: 'ISSUES', errorFindings: 1 }, 'Issues found', 'error'],
  [{ state: 'EXECUTION_FAILED' }, 'Run failed', 'error'],
  [{ state: 'NEVER_RUN' }, 'Never run', 'neutral'],
  [undefined, 'No data quality info', 'neutral'],
])('%o → %s', (s, label, tone) => {
  expect(dqVisual(s as never)).toMatchObject({ label, tone });
});

test('resolveIcon', () => {
  expect(resolveIcon('orders', Box)).toBe(Receipt);
  expect(resolveIcon('lucide:shopping-cart', Box)).toBe(ShoppingCart);
  expect(resolveIcon('lucide:building-2', Box)).toBe(Building2);
  expect(resolveIcon('lucide:arrow-down-az', Box)).toBe(ArrowDownAZ);
  expect(resolveIcon('lucide:no-such-icon', Box)).toBe(Box);
  expect(resolveIcon(null, Tags)).toBe(Tags);
});
