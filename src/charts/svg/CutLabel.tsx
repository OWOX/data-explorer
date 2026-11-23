import type { SVGProps } from 'react';
import { Tooltip } from '../../ui/Tooltip';

/**
 * A chart text cut to `shown`. When it was cut, the full text opens in the app tooltip on hover
 * and is the accessible name; a label that fits stays plain text.
 */
export function CutLabel({ full, shown, ...rest }: { full: string; shown: string } & SVGProps<SVGTextElement>) {
  if (shown === full) return <text {...rest}>{shown}</text>;
  return <Tooltip content={full}><text aria-label={full} {...rest}>{shown}</text></Tooltip>;
}
