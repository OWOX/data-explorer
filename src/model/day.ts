const DAY_PART = /^(\d{4})-(\d{2})-(\d{2})/;

/** The year, month and day a value starts with (`YYYY-MM-DD`, with or without a time after it); null when it starts with anything else. */
export const ymd = (v: unknown): [y: number, m: number, d: number] | null => {
  const m = DAY_PART.exec(String(v));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** The calendar day `n` days after `day` (`YYYY-MM-DD`), computed in UTC so the local zone never shifts it. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = ymd(day)!;
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
