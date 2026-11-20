import type { SchemaLoader } from '../api/schemas';
import type { Model } from '../model/types';
import type { Ctx } from '../sdk/types';
import type { GridState } from '../state/store';
import { AiUnavailable, createAiRun, pickModels } from './ai';
import { MAX_FOUND, searchEndpoint } from './endpoint';
import { discoveryQuestion, viewQuestion } from './prompts';
import { parseAiView } from './view';

export type SearchOutcome = {
  /** The data marts found, best first; empty when nothing matched. */
  ids: string[];
  /** The best mart's view, when the model made one. */
  grid: GridState | null;
  /** none: no AI model is configured. used: the model was there (whether or not it helped). unavailable: it timed out or failed on this run. */
  ai: 'none' | 'used' | 'unavailable';
};

export type SearchDeps = { ctx: Ctx; model: Model; schemas: Pick<SchemaLoader, 'get'>; signal: AbortSignal; timeoutMs?: number };

/** The ids a model named, kept when they are accessible marts of the model, in its order, without repeats, at most five. */
function validIds(answer: Record<string, unknown>, model: Model): string[] {
  const raw = Array.isArray(answer.ids) ? answer.ids : [];
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id === 'string' && model.marts.get(id)?.accessible && !out.includes(id)) out.push(id);
    if (out.length === MAX_FOUND) break;
  }
  return out;
}

/**
 * The smart search: OWOX's search engine first; when it finds nothing and a model is configured, the model picks marts from the
 * catalogue; when a model is configured and a mart was found, it sets up that mart's view. Nothing here reads rows (no traverseData),
 * and a model that fails or is too slow only means the run goes on without it.
 */
export async function smartSearch(deps: SearchDeps, query: string): Promise<SearchOutcome> {
  const { ctx, model, schemas, signal } = deps;
  const ai = pickModels(ctx);
  let ids = (await searchEndpoint(ctx, query, model, signal)).marts;
  if (!ai) return { ids, grid: null, ai: 'none' };
  const run = createAiRun(ai, signal, deps.timeoutMs);
  let grid: GridState | null = null;
  try {
    if (ids.length === 0) {
      const q = discoveryQuestion(query, [...model.marts.values()]);
      ids = validIds(await run.ask('discover', q.system, q.user), model);
    }
    const best = ids[0] ? model.marts.get(ids[0]) : undefined;
    if (best) {
      const schema = await schemas.get(best.id);
      if (schema.length) {
        const q = viewQuestion(query, best, schema);
        grid = parseAiView(await run.ask('view', q.system, q.user), schema);
      }
    }
  } catch (e) {
    // A model that cannot help is not an error for the member; a schema that cannot be read leaves the mart as it is.
    if (e instanceof AiUnavailable) return { ids, grid: null, ai: 'unavailable' };
    console.warn('Setting up the view failed', e);
  }
  return { ids, grid, ai: 'used' };
}
