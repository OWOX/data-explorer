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
  expect(screen.getByText(/50/)).toBeInTheDocument();
});
