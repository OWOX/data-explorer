import { categorizeFieldType } from '../model/field-category';
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, s: string) => `${Number(v.toFixed(1)).toString()}${s}`;
  if (abs >= 1e9) return fmt(n / 1e9, 'B');
  if (abs >= 1e6) return fmt(n / 1e6, 'M');
  if (abs >= 1e3) return fmt(n / 1e3, 'K');
  return String(n);
}

export function relativeTime(iso: string, now = new Date()): string {
  const s = Math.round((now.getTime() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  const units: [number, string][] = [[31_536_000, 'year'], [2_592_000, 'month'], [86_400, 'day'], [3_600, 'hour'], [60, 'minute']];
  for (const [sec, name] of units) {
    const v = Math.floor(s / sec);
    if (v >= 1) return `${v} ${name}${v > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

/** A whole number grouped by the reader's own locale. */
export const num = (n: number): string => n.toLocaleString();

/** "1 data mart", "3 data marts". */
export const count = (n: number, noun: string): string => `${num(n)} ${noun}${n === 1 ? '' : 's'}`;

/** "11.1K records", "1 record": the badge text for a row count already shortened by the caller. */
export const recordsLabel = (amount: string): string => `${amount} ${amount === '1' ? 'record' : 'records'}`;

/** "3 groups", "1 group": the badge text of a grouped grid, whose rows are groups. */
export const groupsLabel = (amount: string): string => `${amount} ${amount === '1' ? 'group' : 'groups'}`;

const DATE_ONLY = new Set(['DATE']);
// Wall-clock types carry no zone, so there is nothing to convert from.
const WALL_CLOCK = new Set(['DATETIME', 'TIMESTAMP_NTZ']);
const MOMENT = new Set(['TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ', 'TIMESTAMP_LTZ', 'TIMESTAMP_TZ', ...WALL_CLOCK]);

let cached: { day: Intl.DateTimeFormat; moment: Intl.DateTimeFormat } | undefined;
/** The viewer's locale and time zone, built once. The tests change the zone and reset it. */
export const resetFormats = () => { cached = undefined; };
function formats() {
  cached ??= {
    day: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }),
    moment: new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  };
  return cached;
}

/** A calendar day that exists: 2026-02-31 is not rolled into March, it is left raw. */
function realDay(y: string, mo: string, d: string): boolean {
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
}
const realTime = (t: string): boolean => { const [h, mi, s] = t.split(':'); return Number(h) < 24 && Number(mi) < 60 && (s === undefined || Number.parseFloat(s) < 60); };

const ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * A DATE, DATETIME or TIMESTAMP value in the viewer's locale and time zone, or null when the type
 * is not one of those or the value cannot be read (the caller then shows it raw).
 *
 * A DATE is a calendar day and is built from its own digits, so it never moves with the zone. A
 * TIMESTAMP is an instant and is converted; with no zone in the text it is read as UTC. A DATETIME is
 * a wall-clock time and is shown as written.
 */
export function formatTemporal(value: unknown, type: string): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const t = type.trim().toUpperCase();
  if (DATE_ONLY.has(t)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?![\d])/.exec(text);
    if (!m) return null;
    if (!realDay(m[1]!, m[2]!, m[3]!)) return null;
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(day.getTime()) ? null : formats().day.format(day);
  }
  if (!MOMENT.has(t)) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(.*)$/.exec(text);
  if (!m) return null;
  if (!realDay(...(m[1]!.split('-') as [string, string, string])) || !realTime(m[2]!)) return null;
  const zone = (m[3] ?? '').trim();
  if (zone && !ZONE.test(zone)) return null;
  // "+00" and "+0530" become "+00:00" and "+05:30"; no zone is UTC, except for a wall-clock type.
  const offset = /^[+-]\d{2}$/.test(zone) ? `${zone}:00` : /^[+-]\d{4}$/.test(zone) ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
  const date = new Date(`${m[1]}T${m[2]}${offset || (WALL_CLOCK.has(t) ? '' : 'Z')}`);
  return Number.isNaN(date.getTime()) ? null : formats().moment.format(date);
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  // A one-to-many joined field arrives as an array of its values: one cell, the values side by side.
  if (Array.isArray(v)) return v.map((x) => (x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export const isNumericType = (type?: string) => !!type && categorizeFieldType(type) === 'number';

/**
 * A number with thousands separators, as Google Sheets shows it: 1223 is "1,223", -1234567.5 is "-1,234,567.5". Works on the
 * value's own digits (a NUMERIC arrives as a string and may not fit a double), so nothing is rounded. Null when it is not a
 * plain number (an exponent, NaN, text): the value is then shown as it is.
 */
export function formatNumber(v: unknown): string | null {
  const text = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : null) : typeof v === 'string' ? v.trim() : null;
  const m = text ? /^([+-]?)(\d+)(\.\d+)?$/.exec(text) : null;
  if (!m) return null;
  return `${m[1] === '-' ? '-' : ''}${m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${m[3] ?? ''}`;
}

/**
 * The text a grid cell shows for a value of a warehouse type, whole (never clipped): the viewer's date format for a temporal value,
 * a number with thousands separators, else the value as stored. `group: false` keeps a number's plain digits: the clipboard uses it,
 * because a pasted "1,223" reads as 1.223 in a spreadsheet set to a comma-decimal locale (uk-UA, de-DE).
 */
export const displayText = (v: unknown, type?: string, { group = true }: { group?: boolean } = {}): string =>
  (type ? formatTemporal(v, type) ?? (group && isNumericType(type) ? formatNumber(v) : null) : null) ?? formatValue(v);
