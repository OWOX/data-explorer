/** RE2 inline flags (`(?i)`, `(?is:...)`) are valid in the backend but not in JS: strip them before the syntax check. */
export function jsRegexSource(v: string): { source: string; flags: string } {
  let flags = '';
  let source = v;
  const lead = /^\(\?([imsU]+)\)/.exec(source);
  if (lead) { source = source.slice(lead[0].length); flags = lead[1]!.replace(/U/g, ''); }
  source = source.replace(/\(\?[imsU]+(?:-[imsU]+)?:/g, '(?:');
  return { source, flags: [...new Set(flags)].join('') };
}
