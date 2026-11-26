import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { TooltipProvider } from '../../ui/Tooltip';
import { Sankey } from './Sankey';

vi.mock('../useWidth', () => ({ useWidth: () => ({ ref: { current: null }, width: 0 }) }));

test('before the width is measured nothing is drawn', () => {
  const { container } = render(<TooltipProvider><Sankey titles={['A', 'B']} columns={[]} fit={false} flows={[[{ source: 'a', target: 'x', value: 1 }]]} ariaLabel="S" text={String} /></TooltipProvider>);
  expect(container.querySelector('svg')).toBeNull();
  expect(container.querySelector('table')).toBeNull();
});
