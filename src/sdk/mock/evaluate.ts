import type { RelativeDatePreset, Row, TraverseFilter } from '../types';

const day = 86_400_000;
const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function relativeRange(p: RelativeDatePreset, now: Date): [number, number] {
  const today = startOfDay(now);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const weekStart = today - ((now.getUTCDay() + 6) % 7) * day;
  const q = Math.floor(m / 3) * 3;
  switch (p.kind) {
    case 'today': return [today, today + day];
    case 'yesterday': return [today - day, today];
    case 'this_week': return [weekStart, weekStart + 7 * day];
    case 'last_week': return [weekStart - 7 * day, weekStart];
    case 'this_month': return [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1)];
    case 'last_month': return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
    case 'this_quarter': return [Date.UTC(y, q, 1), Date.UTC(y, q + 3, 1)];
    case 'last_quarter': return [Date.UTC(y, q - 3, 1), Date.UTC(y, q, 1)];
    case 'this_year': return [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)];
    case 'last_n_days': return [today - p.n * day, today + day];
    case 'last_n_months': return [Date.UTC(y, m - p.n, 1), today + day];
  }
}

const cmp = (a: unknown, b: unknown) => (typeof b === 'number' ? Number(a) - b : String(a).localeCompare(String(b)));

export function matchesFilter(row: Row, f: TraverseFilter, now = new Date()): boolean {
  const v = row[f.column];
  const s = v == null ? '' : String(v);
  switch (f.operator) {
    case 'eq': return cmp(v, f.value) === 0;
    case 'neq': return cmp(v, f.value) !== 0;
    case 'contains': return s.toLowerCase().includes(String(f.value).toLowerCase());
    case 'not_contains': return !s.toLowerCase().includes(String(f.value).toLowerCase());
    case 'starts_with': return s.startsWith(String(f.value));
    case 'ends_with': return s.endsWith(String(f.value));
    case 'gt': return v != null && cmp(v, f.value) > 0;
    case 'gte': return v != null && cmp(v, f.value) >= 0;
    case 'lt': return v != null && cmp(v, f.value) < 0;
    case 'lte': return v != null && cmp(v, f.value) <= 0;
    case 'between': return v != null && cmp(v, f.value.from) >= 0 && cmp(v, f.value.to) <= 0;
    case 'in': return (f.value as unknown[]).some((x) => cmp(v, x) === 0);
    case 'not_in': return !(f.value as unknown[]).some((x) => cmp(v, x) === 0);
    case 'is_blank': return s.trim() === '';
    case 'is_not_blank': return s.trim() !== '';
    case 'is_true': return v === true;
    case 'is_false': return v === false;
    case 'relative_date': {
      if (v == null) return false;
      const t = Date.parse(s);
      const [from, to] = relativeRange(f.value, now);
      return t >= from && t < to;
    }
  }
}
