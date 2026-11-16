import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';

/** A native select drawn like our other inputs: no browser arrow, our own chevron inside the right padding. */
export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="dm-select relative inline-flex min-w-0 flex-1">
      <select {...rest} className={`dm-input h-8 w-full min-w-0 cursor-pointer appearance-none rounded-md border bg-background pl-2 pr-7 text-sm ${className}`}>{children}</select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}
