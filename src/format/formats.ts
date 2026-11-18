import { categorizeFieldType, isDayType } from '../model/field-category';
import { displayText, formatTemporal } from '../ui/format';

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

/** The format kinds a warehouse type offers; empty when it offers none (text, boolean, time of day, anything else). */
export function formatsFor(type: string): Format['kind'][] {
  const category = categorizeFieldType(type);
  if (category === 'number') return ['auto', 'plain', 'percent', 'money'];
  if (category === 'date') return isDayType(type) ? ['auto', 'date'] : ['auto', 'date', 'datetime', 'time'];
  return [];
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

/** The member's own choice, then the project pick, then `auto`. */
export function resolveFormat(member?: Format, project?: Format): Format {
  return member ?? project ?? AUTO;
}

const currencies = new Map<string, Intl.NumberFormat | null>();
function moneyFormat(currency: string): Intl.NumberFormat | null {
  if (!currencies.has(currency)) {
    try { currencies.set(currency, new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })); } catch { currencies.set(currency, null); }
  }
  return currencies.get(currency)!;
}
let percent: Intl.NumberFormat | undefined;

/** A finite number from a number or a numeric string; null for anything else. */
function toNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * The text a cell shows for a value in a chosen format. `auto`, a format the type does not offer, and a value the
 * format cannot read all give `displayText`, so the cell never shows less than it did before.
 */
export function formatValue(v: unknown, type: string, f: Format): string {
  const fallback = () => displayText(v, type);
  if (f.kind === 'auto' || !formatsFor(type).includes(f.kind)) return fallback();
  switch (f.kind) {
    case 'plain': return toNumber(v) === null ? fallback() : displayText(v, type, { group: false });
    case 'percent': {
      const n = toNumber(v);
      if (n === null) return fallback();
      percent ??= new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 });
      return percent.format(n);
    }
    case 'money': {
      const n = toNumber(v);
      const fmt = moneyFormat(f.currency);
      return n === null || !fmt ? fallback() : fmt.format(n);
    }
    case 'date': case 'datetime': case 'time':
      return formatTemporal(v, type, f.kind) ?? fallback();
  }
}
