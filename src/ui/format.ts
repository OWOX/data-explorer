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
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(day.getTime()) ? null : formats().day.format(day);
  }
  if (!MOMENT.has(t)) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(.*)$/.exec(text);
  if (!m) return null;
  const zone = (m[3] ?? '').trim();
  if (zone && !ZONE.test(zone)) return null;
  // "+00" and "+0530" become "+00:00" and "+05:30"; no zone is UTC, except for a wall-clock type.
  const offset = /^[+-]\d{2}$/.test(zone) ? `${zone}:00` : /^[+-]\d{4}$/.test(zone) ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
  const date = new Date(`${m[1]}T${m[2]}${offset || (WALL_CLOCK.has(t) ? '' : 'Z')}`);
  return Number.isNaN(date.getTime()) ? null : formats().moment.format(date);
}
