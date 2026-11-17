import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test } from 'vitest';
import { TooltipProvider } from '../Tooltip';
import { Band } from './Band';

function Harness({ grid }: { grid: boolean }) {
  const [folded, setFolded] = useState(false);
  return (
    <Band id="b" icon={<i />} title="Things" total={3} hint="About" toolbar={<input aria-label="find" />} folded={folded} onFold={() => setFolded((f) => !f)} grid={grid}>
      <p>body</p>
    </Band>
  );
}

const shape = (root: HTMLElement) => {
  const head = root.querySelector('.dm-band-head') as HTMLElement;
  return [head, head.querySelector('.dm-band-titlegroup'), head.querySelector('.dm-band-icon'), head.querySelector('.dm-band-title'), head.querySelector('.dm-band-count'), head.querySelector('.dm-band-fold')]
    .map((el) => `${el!.tagName}.${el!.className}|${el!.getAttribute('style') ?? ''}`);
};

test.each([true, false])('the header has the same classes and styles folded and open (grid=%s)', async (grid) => {
  const { container } = render(<TooltipProvider><Harness grid={grid} /></TooltipProvider>);
  const open = shape(container);
  await userEvent.click(screen.getByRole('button', { name: 'Hide Things' }));
  expect(screen.getByRole('button', { name: 'Show Things' })).toBeInTheDocument();
  const folded = shape(container);
  // Only the chevron's own turn differs, and that lives on the svg inside the button.
  expect(folded).toEqual(open);
  expect(container.querySelector('.dm-band')).toHaveClass('folded');
  await userEvent.click(screen.getByRole('button', { name: 'Show Things' }));
  expect(shape(container)).toEqual(open);
});
