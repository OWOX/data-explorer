// Value-axis ticks shared by every chart: a "nice" step (1, 2 or 5 times a power of ten), so a count never reads 24.33 or 48.67.
type Ticks = { ticks: number[]; /** The axis top: the last tick, a whole number of steps at or above the data's end. */ top: number };

const TARGET = 4;

/** Nice ticks from `lo` (default 0) over data reaching `hi`. A whole-number measure gets whole-number steps, never below 1. */
export function niceTicks(hi: number, { lo = 0, integer = false }: { lo?: number; integer?: boolean } = {}): Ticks {
  const span = hi - lo;
  if (!(span > 0)) return { ticks: [lo, lo + 1], top: lo + 1 };
  const raw = span / TARGET;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  if (integer) step = Math.max(1, step);
  const first = Math.floor(lo / step) * step;
  const count = Math.ceil(round((hi - first) / step));
  const ticks = Array.from({ length: count + 1 }, (_, i) => round(first + i * step));
  return { ticks, top: ticks.at(-1)! };
}

// Float noise (0.1 * 3 = 0.30000000000000004) must not leak into a tick's text or its count.
const round = (n: number): number => Number(n.toPrecision(12));
