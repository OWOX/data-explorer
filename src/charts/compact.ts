// Scorecard numbers in short form (1.6M, $117K): the exact value stays one hover away.
import { formatsFor, formatValue, type Format } from '../format/formats';
import { categorizeFieldType } from '../model/field-category';
import { toNumber } from '../model/number';

// en-US like the full number text (formatNumber writes 1,234.5 in every locale), so short and exact agree on separators.
// Money stays in the viewer's locale, as its full text does.
const plain = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
/** Below this a number is short enough already, and 2026 must not read "2K". */
const COMPACT_FROM = 10_000;
const money = new Map<string, Intl.NumberFormat | null>();
function moneyCompact(currency: string): Intl.NumberFormat | null {
  if (!money.has(currency)) {
    try { money.set(currency, new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })); } catch { money.set(currency, null); }
  }
  return money.get(currency)!;
}

/**
 * The short form of a number of at least 10,000 in an automatic, plain or money format; null when the full text is short
 * already, or the value or its type is not a number, or its format is one compact notation would misstate (a percent).
 */
export function compactValue(v: unknown, type: string, f: Format): string | null {
  const n = toNumber(v);
  if (n === null || Math.abs(n) < COMPACT_FROM || categorizeFieldType(type) !== 'number') return null;
  if (f.kind === 'money' && formatsFor(type).includes('money')) return moneyCompact(f.currency)?.format(n) ?? null;
  if (f.kind === 'auto' || f.kind === 'plain' || !formatsFor(type).includes(f.kind)) return plain.format(n);
  return null;
}

/** An axis tick in the measure's format: short ($10.2K) when it has a short form, else the value rounded to 2 decimals unless the format scales or rounds it itself. */
export const tickText = (n: number, type: string, format: Format): string => compactValue(n, type, format) ?? formatValue(format.kind === 'percent' || format.kind === 'money' ? n : Number(n.toFixed(2)), type, format);
