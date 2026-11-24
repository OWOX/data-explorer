// A deterministic stand-in for the logical `ai` credential: no network, no randomness. It reads the one JSON document the plugin
// sends as the user message and answers from keywords, so the mock page and the e2e tests behave the same every time.
import type { AiCredential, AiModel, DecisionModel, RelativeDatePreset } from '../types';

type Doc = Record<string, unknown> & { task?: string; query?: string };

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

function intentAnswer(doc: Doc): unknown {
  const q = String(doc.query ?? '').toLowerCase();
  const subjects = Object.entries(SYNONYMS).filter(([id, ws]) => q.includes(id) || ws.some((w) => new RegExp(`\\b${w}\\b`).test(q))).map(([id]) => id);
  const preset = PRESETS.find(([re]) => re.test(q));
  const time = preset ? q.match(preset[0])![0] : null;
  const status = STATUS_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(q));
  const by = /\bby (\w+)/.exec(q);
  return {
    subjects, measures: /\b(amount|revenue|spend|total)\b/.test(q) ? ['amount'] : [], breakdowns: by ? [by[1]] : [], time,
    values: status ? [{ text: status, op: 'eq' }] : [],
    ranking: /\b(biggest|largest|highest|top)\b/.test(q) ? { direction: 'desc' } : null,
    chartHint: /\btrend\b/.test(q) ? 'trend' : null,
  };
}

function fakeDecision(latencyMs: number): DecisionModel {
  return {
    specificationVersion: 'v4', provider: 'mock', modelId: 'mock-decision', supportedQuestionTypes: ['choice', 'score', 'boolean'],
    async doDecide({ state, questions }) {
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const text = state.map((p) => (p.type === 'text' ? p.text : '')).join('');
      let doc: Doc; try { doc = JSON.parse(text) as Doc; } catch { doc = {}; }
      const q = String(doc.query ?? '').toLowerCase();
      const mentions = (opt: string) => q.includes(opt.toLowerCase()) || (SYNONYMS[opt] ?? []).some((w) => q.includes(w));
      const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
        if (question.type === 'choice') {
          const keys = Object.keys(question.criteria);
          const pick = keys.find(mentions) ?? keys.find((k) => k !== 'none') ?? keys[0]!;
          return [id, { type: 'choice', choice: pick }];
        }
        if (question.type === 'score') return [id, { type: 'score', score: question.criteria.length - 1 }];
        return [id, { type: 'boolean', probability: 0.5 }];
      }));
      return { answers, warnings: [] };
    },
  } as DecisionModel;
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
      const answer = doc.task === 'intent' ? intentAnswer(doc) : doc.task === 'shortlist' ? { names: ((doc.fields as { name: string }[]) ?? []).slice(0, 64).map((f) => f.name) } : {};
      return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
    },
  };
  return Object.assign({}, model, { fast: model, decision: fakeDecision(latencyMs) });
}
