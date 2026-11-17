// A deterministic stand-in for the logical `ai` credential: no network, no randomness. It reads the one JSON document the plugin
// sends as the user message and answers from keywords, so the mock page and the e2e tests behave the same every time.
import type { AiCredential, AiModel } from '../types';

type Doc = Record<string, unknown> & { task?: string; query?: string };
type MockField = { name: string; category: string; type: string; filterOperators: string[]; aggregations: string[] };

const SYNONYMS: Record<string, string[]> = {
  customers: ['buyer', 'buyers', 'client', 'clients', 'shopper', 'shoppers', 'people', 'persons'],
  orders: ['purchase', 'purchases', 'sale', 'sales', 'transaction', 'transactions'],
  products: ['goods', 'item', 'items', 'catalogue', 'merchandise'],
  stores: ['shop', 'shops', 'branch', 'branches', 'outlet', 'outlets'],
  ad_spend: ['advertising', 'ads', 'ad', 'spending'],
};

const PRESETS: [RegExp, unknown][] = [
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
  const ids = marts.filter((m) => (SYNONYMS[m.id] ?? []).some((w) => new RegExp(`\\b${w}\\b`).test(q))).map((m) => m.id);
  return { ids };
}

function view(doc: Doc): unknown {
  const q = String(doc.query ?? '').toLowerCase();
  const fields = (doc.fields as MockField[]) ?? [];
  const has = (name: string) => fields.some((f) => f.name === name);
  const date = fields.find((f) => f.category === 'date');
  const filters: unknown[] = [];
  const sorts: unknown[] = [];
  const columns = fields.filter((f) => !/^(.*_id)$/.test(f.name)).slice(0, 5).map((f) => f.name);

  if (date) {
    const hit = PRESETS.find(([re]) => re.test(q));
    const days = /\blast (\d{1,4}) days\b/.exec(q);
    if (hit) filters.push({ field: date.name, op: 'relative', value: hit[1] });
    else if (days) filters.push({ field: date.name, op: 'relative', value: { kind: 'last_n_days', n: Number(days[1]) } });
  }
  const status = STATUS_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(q));
  if (status && has('status')) filters.push({ field: 'status', op: 'eq', value: status });
  const amount = fields.find((f) => f.name === 'amount') ?? fields.find((f) => f.category === 'number' && !f.name.endsWith('id'));
  if (/\b(biggest|largest|highest|top)\b/.test(q) && amount) {
    if (!columns.includes(amount.name)) columns.push(amount.name);
    sorts.push({ field: amount.name, direction: 'desc' });
  } else if (/\b(newest|latest|recent)\b/.test(q) && date) sorts.push({ field: date.name, direction: 'desc' });
  else if (/\boldest\b/.test(q) && date) sorts.push({ field: date.name, direction: 'asc' });
  if (!/\b(biggest|largest|highest|top|newest|latest|recent|oldest)\b/.test(q) && !filters.length) return { columns: [], filters: [], sorts: [] };
  return { columns, filters, sorts };
}

/** `fast` and `reasoning` are the same fake model; `ai.fast` is the handle itself, as in the SDK. */
export function createFakeAi(): AiCredential {
  const model: AiModel = {
    async doGenerate(options) {
      const user = options.prompt.find((m) => m.role === 'user');
      const text = user && user.role === 'user' ? user.content.map((c) => c.text).join('') : '{}';
      let doc: Doc;
      try { doc = JSON.parse(text) as Doc; } catch { doc = {}; }
      const answer = doc.task === 'discover' ? discover(doc) : doc.task === 'view' ? view(doc) : {};
      return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
    },
  };
  return Object.assign({}, model, { fast: model, reasoning: model });
}
