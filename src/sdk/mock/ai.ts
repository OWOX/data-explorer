// A deterministic stand-in for the logical `ai` credential: no network, no randomness. It reads the one JSON document the plugin
// sends as the user message and answers from keywords, so the mock page and the e2e tests behave the same every time.
import type { AiCredential, AiModel, RelativeDatePreset } from '../types';

type Doc = Record<string, unknown> & { task?: string; query?: string };
type MockField = { name: string; category: string; type: string; filterOperators: string[]; aggregations: string[] };

const SYNONYMS: Record<string, string[]> = {
  customers: ['buyer', 'buyers', 'client', 'clients', 'shopper', 'shoppers', 'people', 'persons'],
  orders: ['purchase', 'purchases', 'sale', 'sales', 'transaction', 'transactions'],
  products: ['goods', 'item', 'items', 'catalogue', 'merchandise'],
  stores: ['shop', 'shops', 'branch', 'branches', 'outlet', 'outlets'],
  ad_spend: ['advertising', 'ads', 'ad', 'spending'],
};

const PRESETS: [RegExp, RelativeDatePreset][] = [
  [/\byesterday\b/, { kind: 'yesterday' }],
  [/\btoday\b/, { kind: 'today' }],
  [/\blast month\b/, { kind: 'last_month' }],
  [/\bthis month\b/, { kind: 'this_month' }],
  [/\blast week\b/, { kind: 'last_week' }],
  [/\bthis week\b/, { kind: 'this_week' }],
  [/\blast quarter\b/, { kind: 'last_quarter' }],
  [/\blast year\b/, { kind: 'last_n_months', n: 12 }],
];
const STATUS_WORDS = ['new', 'paid', 'shipped', 'delivered', 'cancelled'];

function discover(doc: Doc): unknown {
  const q = String(doc.query ?? '').toLowerCase();
  const marts = (doc.dataMarts as { id: string }[]) ?? [];
  const matched = marts.filter((m) => (SYNONYMS[m.id] ?? []).some((w) => new RegExp(`\\b${w}\\b`).test(q))).map((m) => m.id);
  // The search hits fit by construction, so they come first, as the prompt asks.
  const hits = ((doc.searchHits as { id: string }[]) ?? []).map((h) => h.id);
  return { ids: [...new Set([...hits, ...matched])] };
}

const SORT_WORDS = /\b(biggest|largest|highest|top|newest|latest|recent|oldest)\b/;

/** The amount a "biggest" question sorts by: a field named amount, else the first number that is not an ID. */
const amountField = (fields: MockField[]) => fields.find((f) => f.name === 'amount') ?? fields.find((f) => f.category === 'number' && !f.name.endsWith('id'));

/** Whether the question asks for filters: the answer of `filtersAnswer` has any. */
const asksForFilter = (doc: Doc): boolean => (filtersAnswer(doc) as { filters: unknown[] }).filters.length > 0;

function fieldsAnswer(doc: Doc): unknown {
  const q = String(doc.query ?? '').toLowerCase();
  const fields = (doc.fields as MockField[]) ?? [];
  if (!SORT_WORDS.test(q) && !asksForFilter(doc)) return { columns: [], aggregations: [], dateTrunc: [] };
  const columns = fields.filter((f) => !/^(.*_id)$/.test(f.name)).slice(0, 5).map((f) => f.name);
  const amount = amountField(fields);
  if (/\b(biggest|largest|highest|top)\b/.test(q) && amount && !columns.includes(amount.name)) columns.push(amount.name);
  return { columns, aggregations: [], dateTrunc: [] };
}

function filtersAnswer(doc: Doc): unknown {
  const q = String(doc.query ?? '').toLowerCase();
  const fields = (doc.fields as MockField[]) ?? [];
  const date = fields.find((f) => f.category === 'date');
  const filters: unknown[] = [];
  const sorts: unknown[] = [];

  if (date) {
    const hit = PRESETS.find(([re]) => re.test(q));
    const days = /\blast (\d{1,4}) days\b/.exec(q);
    if (hit) filters.push({ field: date.name, op: 'relative', value: hit[1] });
    else if (days) filters.push({ field: date.name, op: 'relative', value: { kind: 'last_n_days', n: Number(days[1]) } });
  }
  const status = STATUS_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(q));
  if (status && fields.some((f) => f.name === 'status')) filters.push({ field: 'status', op: 'eq', value: status });
  const amount = amountField(fields);
  if (/\b(biggest|largest|highest|top)\b/.test(q) && amount) sorts.push({ field: amount.name, direction: 'desc' });
  else if (/\b(newest|latest|recent)\b/.test(q) && date) sorts.push({ field: date.name, direction: 'desc' });
  else if (/\boldest\b/.test(q) && date) sorts.push({ field: date.name, direction: 'asc' });
  return { filters, sorts };
}

/** `ai.fast` is the handle itself, as in the SDK. */
export function createFakeAi(latencyMs = 0): AiCredential {
  const model: AiModel = {
    async doGenerate(options) {
      // A real model takes time; the mock page sets a latency only for realism. The page does not depend on it.
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const user = options.prompt.find((m) => m.role === 'user');
      const text = user && user.role === 'user' ? user.content.map((c) => c.text).join('') : '{}';
      let doc: Doc;
      try { doc = JSON.parse(text) as Doc; } catch { doc = {}; }
      const answer = doc.task === 'discover' ? discover(doc) : doc.task === 'fields' ? fieldsAnswer(doc) : doc.task === 'filters' ? filtersAnswer(doc) : {};
      return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
    },
  };
  return Object.assign({}, model, { fast: model });
}
