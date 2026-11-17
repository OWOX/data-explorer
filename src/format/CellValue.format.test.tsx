import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '../ui/Tooltip';
import { CellValue } from '../ui/explorer/CellValue';

test('a chosen format changes the cell text; auto and no format keep the default', () => {
  const row = { n: 1223, r: 0.5 };
  const w = (ui: React.ReactElement) => <TooltipProvider>{ui}</TooltipProvider>;
  const { rerender } = render(w(<CellValue row={row} field="n" type="INTEGER" />));
  expect(screen.getByText('1,223')).toBeInTheDocument();
  rerender(w(<CellValue row={row} field="n" type="INTEGER" format={{ kind: 'auto' }} />));
  expect(screen.getByText('1,223')).toBeInTheDocument();
  rerender(w(<CellValue row={row} field="n" type="INTEGER" format={{ kind: 'plain' }} />));
  expect(screen.getByText('1223')).toBeInTheDocument();
  rerender(w(<CellValue row={row} field="r" type="FLOAT" format={{ kind: 'percent' }} />));
  expect(screen.getByText(new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(0.5))).toBeInTheDocument();
});

test('the auto path renders what the cell rendered before formats existed', () => {
  const row = { n: 1223456, d: '2024-03-05T10:20:30Z', s: 'text' };
  const w = (ui: React.ReactElement) => <TooltipProvider>{ui}</TooltipProvider>;
  const cells = [['n', 'INTEGER'], ['d', 'TIMESTAMP'], ['s', 'STRING']] as const;
  for (const [field, type] of cells) {
    const bare = render(w(<CellValue row={row} field={field} type={type} />)).container.innerHTML;
    const auto = render(w(<CellValue row={row} field={field} type={type} format={{ kind: 'auto' }} />)).container.innerHTML;
    expect(auto).toBe(bare);
  }
  expect(render(w(<CellValue row={row} field="n" type="INTEGER" />)).container.textContent).toBe('1,223,456');
});
