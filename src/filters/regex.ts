/** One leading inline-flag group of i, m and s (`(?i)`), valid in RE2, Java and Postgres, is stripped and turned into JS flags. Everything else is plain JS syntax. */
export function jsRegexSource(v: string): { source: string; flags: string } {
  const lead = /^\(\?([ims]+)\)/.exec(v);
  if (!lead) return { source: v, flags: '' };
  return { source: v.slice(lead[0].length), flags: [...new Set(lead[1])].join('') };
}
