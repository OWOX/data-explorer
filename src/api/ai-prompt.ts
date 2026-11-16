import { presetName } from '../filters/catalogue';
import type { ColumnFilter } from '../filters/build';
import type { SortKey } from '../model/sort';
import type { Schema } from '../model/types';
import type { RelativeDatePreset } from '../sdk/types';

const WORDS: Record<string, string> = {
  contains: 'contains', not_contains: 'does not contain', eq: 'equals', neq: 'does not equal', starts_with: 'starts with', ends_with: 'ends with',
  gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
  on: 'is on', before: 'is before', after: 'is after',
  is_true: 'is true', is_false: 'is false', is_blank: 'is blank', is_not_blank: 'is not blank',
};

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** One filter as a plain sentence over the field's technical name: "created_at is in the last 30 days". */
export function describeFilter(f: ColumnFilter): string {
  if (f.op === 'between') {
    const r = (f.value ?? {}) as { from?: unknown; to?: unknown };
    return `${f.field} is between ${String(r.from)} and ${String(r.to)}`;
  }
  if (f.op === 'relative') {
    const rule = f.value as RelativeDatePreset;
    if (rule.kind === 'today') return `${f.field} is today`;
    if (rule.kind === 'yesterday') return `${f.field} is yesterday`;
    const name = lowerFirst(presetName(rule));
    return `${f.field} is in ${name.startsWith('last') ? 'the ' : ''}${name}`;
  }
  const word = WORDS[f.op] ?? f.op;
  return f.value === undefined ? `${f.field} ${word}` : `${f.field} ${word} ${String(f.value)}`;
}

export type AiPromptInput = {
  projectId: string;
  /** The project's name when it is known; the id stands in otherwise. */
  projectTitle?: string;
  martId: string;
  martTitle: string;
  schema: Schema;
  visible: string[];
  filters: ColumnFilter[];
  sorts: SortKey[];
};

/** The prompt that asks an AI assistant, through the OWOX Data Marts connector, for what the grid shows. Plain text, nothing is written to OWOX. */
export function buildAiPrompt(p: AiPromptInput): string {
  const fields = p.schema.map((f) => f.name).filter((n) => p.visible.includes(n));
  const sorts = p.sorts.map((s) => `${s.field} ${s.direction === 'desc' ? 'descending' : 'ascending'}`);
  return [
    `Using the OWOX Data Marts connector, in the OWOX project ${p.projectTitle?.trim() || p.projectId} (project id ${p.projectId}):`,
    `Query the data mart "${p.martTitle}" (id ${p.martId}).`,
    `Fields: ${fields.join(', ')}.`,
    `Filters: ${p.filters.length ? p.filters.map(describeFilter).join('; ') : 'none'}.`,
    `Sort: ${sorts.length ? sorts.join(', then ') : 'none'}.`,
    'Show the result as a table, and say if rows were truncated.',
  ].join('\n');
}
