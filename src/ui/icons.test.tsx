import { dqVisual } from './icons';

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
