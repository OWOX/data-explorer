// The text of an "is any of" / "is none of" list: values split at commas, a value with a comma or quote wrapped in double quotes.
// Ported from the OWOX Google Sheets extension (ReportColumnPicker/filter-value-utils.ts) so both tools read the same text the same way.

/**
 * One value as list text. A value that contains a comma, a double quote, a newline, or edge whitespace is wrapped in double quotes,
 * `""` standing for a quote inside, so the text reads back as the same value.
 */
export function formatListValue(value: string | number): string {
  const s = String(value);
  return /[",\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The values as list text: each as `formatListValue` says, joined by ", ". */
export function formatListText(values: readonly (string | number)[]): string {
  return values.map(formatListValue).join(', ');
}

/**
 * The values of a list text. Text inside double quotes keeps commas, newlines and edge spaces (`""` is a quote); text outside is split at
 * commas and newlines and trimmed. Spaces around a quoted value (` "a" `) are dropped, spaces inside it (`" a "`) are kept. Empty pieces are dropped.
 */
export function parseListText(text: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let sawQuoted = false;
  // The length of the run of unquoted spaces at the end of the current value.
  let trailingWs = 0;
  const append = (ch: string, quoted: boolean) => {
    current += ch;
    trailingWs = !quoted && (ch === ' ' || ch === '\t') ? trailingWs + 1 : 0;
  };
  const push = () => {
    const token = sawQuoted ? current.slice(0, current.length - trailingWs) : current.trim();
    if (token !== '') values.push(token);
    current = '';
    sawQuoted = false;
    trailingWs = 0;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { append('"', true); i++; } else inQuotes = false;
      } else append(ch, true);
    } else if (ch === '"') {
      inQuotes = true;
      sawQuoted = true;
    } else if (ch === ',' || ch === '\n') push();
    else if (current === '' && (ch === ' ' || ch === '\t')) {
      // Spaces before a value starts.
    } else append(ch, false);
  }
  push();
  return values;
}

/**
 * The text cut at its separators (a comma or newline outside quotes). Every piece but the last ended at a separator; the last is what follows the final one
 * (empty when the text ends with a separator). A quote toggles quoting, so a `""` escape toggles twice and leaves it as it was.
 */
export function listPieces(text: string): { raw: string; ended: boolean }[] {
  const pieces: { raw: string; ended: boolean }[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === ',' || ch === '\n')) { pieces.push({ raw: text.slice(start, i), ended: true }); start = i + 1; }
  }
  pieces.push({ raw: text.slice(start), ended: false });
  return pieces;
}
