import { categorizeFieldType, isDayType } from '../model/field-category';
import { toNumber } from '../model/number';
import { displayText, formatNumber, formatTemporal, isNumericType } from '../ui/format';

export type Format =
  | { kind: 'auto' }
  | { kind: 'plain' }
  | { kind: 'percent' }
  | { kind: 'money'; currency: string }
  | { kind: 'date' }
  | { kind: 'datetime' }
  | { kind: 'time' };

export const AUTO: Format = { kind: 'auto' };
const KINDS = ['auto', 'plain', 'percent', 'money', 'date', 'datetime', 'time'] as const;
const CURRENCY = /^[A-Z]{3}$/;

// Shared, so a cell render allocates nothing. Callers read them and never change them.
const NUMBER_KINDS: readonly Format['kind'][] = ['auto', 'plain', 'percent', 'money'];
const DAY_KINDS: readonly Format['kind'][] = ['auto', 'date'];
const MOMENT_KINDS: readonly Format['kind'][] = ['auto', 'date', 'datetime', 'time'];
const NO_KINDS: readonly Format['kind'][] = [];

/** The format kinds a warehouse type offers; empty when it offers none (text, boolean, time of day, anything else). */
export function formatsFor(type: string): readonly Format['kind'][] {
  const category = categorizeFieldType(type);
  if (category === 'number') return NUMBER_KINDS;
  if (category === 'date') return isDayType(type) ? DAY_KINDS : MOMENT_KINDS;
  return NO_KINDS;
}

/** Whether an aggregated output still has the column's unit: a count or a combined text does not, so it gets no column format. */
export function keepsUnit(fn: string | undefined): boolean {
  return fn !== 'COUNT' && fn !== 'COUNT_DISTINCT' && fn !== 'STRING_AGG';
}

/** Whether a value read from storage or an AI answer is a well-formed format, whatever column it is for. */
export function isFormat(f: unknown): f is Format {
  if (typeof f !== 'object' || f === null) return false;
  const { kind, currency } = f as { kind?: unknown; currency?: unknown };
  if (!(KINDS as readonly unknown[]).includes(kind)) return false;
  return kind === 'money' ? typeof currency === 'string' && CURRENCY.test(currency) : true;
}

/** A well-formed format that the column's type offers. */
export function isValidFormat(f: unknown, type: string): f is Format {
  return isFormat(f) && formatsFor(type).includes(f.kind);
}

const currencies = new Map<string, Intl.NumberFormat | null>();
function moneyFormat(currency: string): Intl.NumberFormat | null {
  if (!currencies.has(currency)) {
    try { currencies.set(currency, new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })); } catch { currencies.set(currency, null); }
  }
  return currencies.get(currency)!;
}
const wholeCurrencies = new Map<string, Intl.NumberFormat | null>();
function wholeMoneyFormat(currency: string): Intl.NumberFormat | null {
  if (!wholeCurrencies.has(currency)) {
    try { wholeCurrencies.set(currency, new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })); } catch { wholeCurrencies.set(currency, null); }
  }
  return wholeCurrencies.get(currency)!;
}
let percent: Intl.NumberFormat | undefined;
let wholePercent: Intl.NumberFormat | undefined;

/** Options for `formatValue`; all default off, so the grid, scorecards and exports are untouched. */
export type FormatOptions = {
  /** A number above 10 in absolute value, as shown, drops its fraction (rounded half away from zero): 9,298.69 is 9,299, 12.34% is 12%, $9,298.69 is $9,299. 10 and below keep theirs. */
  whole?: boolean;
};
const WHOLE_ABOVE = 10;
const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/** The value's own digits when it is a plain decimal (a NUMERIC arrives as a string and may not fit a double), else the double's text, else null. */
function plainDecimal(v: unknown): RegExpExecArray | null {
  const text = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : null) : typeof v === 'string' ? v.trim() : null;
  return text ? DECIMAL.exec(text) : null;
}

/** A plain decimal rounded to a whole number on its digits, half away from zero: no float noise on a long one. */
function roundWhole(m: RegExpExecArray): string {
  const [, sign, int, frac] = m as unknown as [string, string, string, string | undefined];
  const digits = frac && frac[0]! >= '5' ? (BigInt(int) + 1n).toString() : int;
  const zero = /^0+$/.test(digits);
  return `${sign === '-' && !zero ? '-' : ''}${digits}`;
}

/** Whether the number the format shows, rounded to the digits it would show, is above 10 in absolute value. */
const aboveTen = (shown: number): boolean => Math.abs(shown) > WHOLE_ABOVE;

/**
 * The text a cell shows for a value in a chosen format. `auto`, a format the type does not offer, and a value the
 * format cannot read all give `displayText`, so the cell never shows less than it did before.
 */
export function formatValue(v: unknown, type: string, f: Format, options?: FormatOptions): string {
  const fallback = () => displayText(v, type);
  const whole = options?.whole === true;
  if (f.kind === 'auto' || !formatsFor(type).includes(f.kind)) {
    // Auto keeps a number's own digits; with `whole`, a plain decimal above 10 loses its fraction.
    const m = whole && f.kind === 'auto' && isNumericType(type) ? plainDecimal(v) : null;
    return m && aboveTen(Number(m[0])) ? (formatNumber(roundWhole(m)) ?? fallback()) : fallback();
  }
  switch (f.kind) {
    case 'plain': {
      if (toNumber(v) === null) return fallback();
      const m = whole ? plainDecimal(v) : null;
      return m && aboveTen(Number(m[0])) ? roundWhole(m) : displayText(v, type, { group: false });
    }
    case 'percent': {
      const n = toNumber(v);
      if (n === null) return fallback();
      if (whole && aboveTen(Number((n * 100).toFixed(2)))) {
        wholePercent ??= new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
        return wholePercent.format(n);
      }
      percent ??= new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 });
      return percent.format(n);
    }
    case 'money': {
      const n = toNumber(v);
      const fmt = moneyFormat(f.currency);
      if (n === null || !fmt) return fallback();
      if (whole && aboveTen(Number(n.toFixed(2)))) {
        const fmt0 = wholeMoneyFormat(f.currency);
        // A numeric string goes in as its own digits, so a long one is not rounded through a double.
        const m = plainDecimal(v);
        if (fmt0) return fmt0.format(m && typeof v === 'string' ? (v.trim() as unknown as number) : n);
      }
      return fmt.format(n);
    }
    case 'date': case 'datetime': case 'time':
      return formatTemporal(v, type, f.kind) ?? fallback();
  }
}
