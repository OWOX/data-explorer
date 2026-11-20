import type { SchemaLoader } from '../api/schemas';
import type { Model } from '../model/types';
import type { Ctx } from '../sdk/types';
import type { GridState } from '../state/store';
import { defaultColumns } from '../ui/explorer/useMartRows';
import { AiUnavailable, createAiRun, pickModels } from './ai';
import { MAX_FOUND, type SearchHits } from './endpoint';
import { discoveryQuestion, fieldsQuestion, filtersQuestion } from './prompts';
import { mergeAiView, parseAiFields, parseAiFilters, type AiFields, type AiFilters } from './view';

/** none: no AI model is configured. used: the model was there (whether or not it helped). unavailable: it timed out or failed on this run. */
export type AiState = 'none' | 'used' | 'unavailable';

export type AdhocMart = { martId: string | null; ai: AiState };
export type AdhocView = { grid: GridState | null; ai: AiState };

/** The first accessible mart of the model that the answer names; null when it names none. */
function firstValidId(answer: Record<string, unknown>, model: Model): string | null {
  const raw = Array.isArray(answer.ids) ? answer.ids : [];
  for (const id of raw.slice(0, MAX_FOUND)) if (typeof id === 'string' && model.marts.get(id)?.accessible) return id;
  return null;
}

/** The marts the search found, then the marts of the reports it found, without repeats, as the model knows them. */
function hintsFrom(hits: SearchHits, model: Model): { id: string; title: string }[] {
  const ids = [...new Set([...hits.marts, ...hits.reports.map((r) => r.martId)])];
  return ids.flatMap((id) => { const m = model.marts.get(id); return m ? [{ id, title: m.title }] : []; });
}

/**
 * The mart the ad-hoc row opens. With a model, one question picks it from the catalogue, preferring what the search found; without
 * one, or when the model fails or names nothing usable, the first search hit is the answer. Nothing here reads rows.
 */
export async function findAdhocMart(deps: { ctx: Ctx; model: Model; signal: AbortSignal; timeoutMs?: number }, query: string, hits: SearchHits): Promise<AdhocMart> {
  const { ctx, model, signal } = deps;
  const fallback = hits.marts[0] ?? hits.reports[0]?.martId ?? null;
  const ai = pickModels(ctx);
  if (!ai) return { martId: fallback, ai: 'none' };
  if (signal.aborted) return { martId: fallback, ai: 'unavailable' };
  try {
    const hints = hintsFrom(hits, model);
    const q = discoveryQuestion(query, [...model.marts.values()], hints.length ? hints : undefined);
    const answer = await createAiRun(ai, signal, deps.timeoutMs).ask('discover', q.system, q.user);
    return { martId: firstValidId(answer, model) ?? fallback, ai: 'used' };
  } catch (e) {
    // A model that cannot help is not an error for the member; the search result stands.
    if (e instanceof AiUnavailable) return { martId: fallback, ai: 'unavailable' };
    console.warn('Picking the ad-hoc mart failed', e);
    return { martId: fallback, ai: 'used' };
  }
}

/**
 * The ad-hoc view of one mart, built after the member picked the ad-hoc row: one question for the columns, then one for the filters
 * and sorts, which gets the columns the first chose. When only the second fails, the columns still apply.
 */
export async function buildAdhocView(deps: { ctx: Ctx; model: Model; schemas: Pick<SchemaLoader, 'get'>; signal: AbortSignal; timeoutMs?: number }, query: string, martId: string): Promise<AdhocView> {
  const { ctx, model, schemas, signal } = deps;
  const ai = pickModels(ctx);
  if (!ai) return { grid: null, ai: 'none' };
  let fields: AiFields | null = null;
  let filters: AiFilters | null = null;
  let schema;
  try {
    const mart = model.marts.get(martId);
    schema = await schemas.get(martId);
    if (!mart || !schema.length) return { grid: null, ai: 'used' };
    const run = createAiRun(ai, signal, deps.timeoutMs);
    const f = fieldsQuestion(query, mart, schema);
    fields = parseAiFields(await run.ask('fields', f.system, f.user), schema);
    const shown = fields?.columns.length ? fields.columns : defaultColumns(schema);
    try {
      const q = filtersQuestion(query, mart, schema, shown);
      filters = parseAiFilters(await run.ask('filters', q.system, q.user), schema, shown);
    } catch (e) {
      if (!(e instanceof AiUnavailable) || !fields) throw e;
      return { grid: mergeAiView(schema, fields, null), ai: 'unavailable' };
    }
  } catch (e) {
    // A model that cannot help is not an error for the member; a schema that cannot be read leaves the mart as it is.
    if (e instanceof AiUnavailable) return { grid: null, ai: 'unavailable' };
    console.warn('Setting up the view failed', e);
    return { grid: null, ai: 'used' };
  }
  return { grid: mergeAiView(schema, fields, filters), ai: 'used' };
}
