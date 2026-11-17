import type { Schema } from '../model/types';
import { AiUnavailable, createAiRun, pickModels } from '../search/ai';
import type { Ctx } from '../sdk/types';
import { formatsFor, isValidFormat, type Format } from './formats';
import type { FormatDoc, FormatStore } from './store';

/** The columns of each mart the AI has been asked about in this session (an aborted ask is taken back, so it is asked again). */
const asked = new Map<string, Set<string>>();
export const resetAiPickSession = () => asked.clear();

const SYSTEM = [
  'You choose how a data mart\'s number and date columns are displayed in a grid.',
  'You get a JSON object with the data mart title and a list of columns. Each column has an "id", a "name", an optional "alias" and "description", and "kinds": the display kinds allowed for it.',
  'Answer with strict JSON only: {"<id>": {"kind": "<one of that column\'s kinds>", "currency": "USD"}}. "currency" is an ISO 4217 code and only goes with "money".',
  'Kinds: "auto" is the default look; "plain" is a number without thousands separators (ids, years, codes); "percent" is a ratio stored as a fraction between 0 and 1 (0.125 shows as 12.5%); "money" is a monetary amount; "date", "datetime", "time" show the date part, both, or the time part of a timestamp.',
  'Use "money" only for monetary amounts and "percent" only for ratios stored as fractions (0..1). Answer "auto", or leave the column out, when you are unsure.',
].join('\n');

const validCurrency = (code: string): boolean => {
  try { new Intl.NumberFormat(undefined, { style: 'currency', currency: code }); return true; } catch { return false; }
};

/** The model's answer reduced to the picks that are well-formed, offered by the column's type, */
export function validPicks(answer: Record<string, unknown>, types: Map<string, string>): FormatDoc {
  const out: FormatDoc = {};
  for (const [column, raw] of Object.entries(answer)) {
    const type = types.get(column);
    if (type === undefined || typeof raw !== 'object' || raw === null) continue;
    const { kind, currency } = raw as { kind?: unknown; currency?: unknown };
    const f: unknown = kind === 'money' ? { kind, currency: typeof currency === 'string' ? currency.trim().toUpperCase() : currency } : { kind };
    if (!isValidFormat(f, type)) continue;
    if (f.kind === 'money' && !validCurrency(f.currency)) continue;
    out[column] = f;
  }
  return out;
}

/**
 * Asks the model, once per column per mart per session, how number and date columns should look (an `auto` answer is saved too, so later sessions do not ask again), and saves the valid answers as project
 * picks. Returns the picks that were saved ({} for no AI, nothing to ask, a failure or an abort; never throws). A column that
 * already has a project pick is not asked about and never overwritten.
 */
export async function pickFormats(ctx: Ctx, store: FormatStore, martId: string, martTitle: string, schema: Schema, project: FormatDoc, signal: AbortSignal): Promise<FormatDoc> {
  const models = pickModels(ctx);
  if (!models) return {};
  const done = asked.get(martId) ?? new Set<string>();
  const eligible = schema.filter((f) => formatsFor(f.type).length > 0 && !(f.name in project) && !done.has(f.name));
  if (!eligible.length) return {};
  asked.set(martId, done);
  for (const f of eligible) done.add(f.name);
  try {
    const types = new Map(eligible.map((f) => [f.name, f.type]));
    const columns = eligible.map((f) => ({
      id: f.name,
      name: f.joined?.originalName ?? f.name,
      ...(f.alias ? { alias: f.alias } : {}),
      ...(f.description ? { description: f.description } : {}),
      ...(f.joined ? { dataMart: f.joined.label } : {}),
      kinds: formatsFor(f.type),
    }));
    const answer = await createAiRun(models, signal).ask('view', SYSTEM, JSON.stringify({ dataMart: martTitle, columns }));
    // A pick that arrived while the model was thinking wins over its answer.
    const fresh = (await store.load(martId)).project;
    const picks: FormatDoc = {};
    for (const [column, f] of Object.entries(validPicks(answer, types))) if (!(column in fresh)) picks[column] = f as Format;
    if (signal.aborted) throw new AiUnavailable('aborted');
    if (!Object.keys(picks).length) return {};
    await store.setProject(martId, picks, { keep: true });
    return picks;
  } catch (e) {
    if (signal.aborted) for (const f of eligible) done.delete(f.name);
    else if (!(e instanceof AiUnavailable)) console.warn('Picking the column formats failed', e);
    return {};
  }
}
