import { cleanText } from '../../api/ai-prompt';
import type { JoinedSource } from '../../api/blendable';
import { MAX_QUESTIONS, scoreQ, type Answers } from '../decide';
import { intentTerms } from '../intent';
import { overlap } from '../words';
import type { Asked, StepDeps, StepInput } from './types';

export type PathCandidate = { qid: string; source: JoinedSource; relationship: string; relationshipDescription: string; via: string[]; words: number };
export const PATH_DEPTH = 4;
export const PATH_KEEP = 5;
const LEVELS = ['Not related to the query.', 'Useful context for the query.', 'Needed to answer the query.'];
const INSTRUCTIONS = 'Rate how much joining this data mart, through this relationship, helps answer the query about the main data mart.';

const parentPaths = (path: string): string[] => { const parts = path.split('.'); return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('.')); };

export function pathCandidates(sources: JoinedSource[], input: StepInput): PathCandidate[] {
  const terms = intentTerms(input.intent, input.query);
  const byPath = new Map(sources.map((s) => [s.aliasPath, s]));
  /** One candidate per mart and final relationship: the same mart through a different relationship means something else. */
  const best = new Map<string, { s: JoinedSource; i: number }>();
  sources.forEach((s, i) => {
    if (s.depth > PATH_DEPTH) return;
    const key = `${s.martId}|${s.relationshipId ?? ''}`, cur = best.get(key);
    const safe = s.mainGrainMultiplication === 'none', curSafe = cur?.s.mainGrainMultiplication === 'none';
    if (!cur || (safe && !curSafe) || (safe === curSafe && s.depth < cur.s.depth)) best.set(key, { s, i });
  });
  return [...best.values()]
    .map(({ s, i }) => {
      const mart = input.model.marts.get(s.martId);
      const edge = s.relationshipId ? input.model.edges.find((e) => e.id === s.relationshipId) : undefined;
      const via = parentPaths(s.aliasPath).map((p) => { const v = byPath.get(p); return input.model.marts.get(v?.martId ?? '')?.title ?? v?.label ?? p; });
      return { i, s, edge, via, words: overlap(terms, `${mart?.title ?? ''} ${mart?.description ?? ''} ${s.label} ${edge?.alias ?? ''}`) };
    })
    .sort((a, b) => b.words - a.words || a.s.depth - b.s.depth || a.i - b.i)
    .slice(0, MAX_QUESTIONS)
    .map((x, n) => ({ qid: `p${n}`, source: x.s, relationship: x.edge?.alias ?? x.s.label, relationshipDescription: x.edge?.description ?? '', via: x.via, words: x.words }));
}

export function buildPathQuestions(input: StepInput, mainTitle: string, cands: PathCandidate[]): Asked {
  if (!cands.length) return null;
  return {
    questions: Object.fromEntries(cands.map((c) => [c.qid, scoreQ(INSTRUCTIONS, LEVELS)])),
    state: {
      query: cleanText(input.query, 256), intent: input.intent, mainDataMart: cleanText(mainTitle, 120),
      candidates: cands.map((c) => {
        const m = input.model.marts.get(c.source.martId);
        return {
          id: c.qid, dataMart: cleanText(m?.title ?? c.source.label, 120), description: cleanText(m?.description, 160),
          relationship: cleanText(c.relationship, 120), relationshipDescription: cleanText(c.relationshipDescription, 160),
          via: c.via.map((v) => cleanText(v, 120)), depth: c.source.depth,
          multipliesMainRows: c.source.mainGrainMultiplication !== 'none',
        };
      }),
    },
  };
}

const unsafe = (s: JoinedSource): boolean => s.mainGrainMultiplication !== 'none';

export function applyPath(answers: Answers, cands: PathCandidate[]): JoinedSource[] {
  return cands
    .flatMap((c, i) => { const a = answers[c.qid]; return a?.type === 'score' && a.level >= 1 ? [{ c, i, level: a.level }] : []; })
    .sort((a, b) => b.level - a.level || Number(unsafe(a.c.source)) - Number(unsafe(b.c.source)) || a.c.source.depth - b.c.source.depth || a.i - b.i)
    .filter((x, _, all) => !unsafe(x.c.source) || !all.some((y) => y.c.source.martId === x.c.source.martId && !unsafe(y.c.source)))
    .slice(0, PATH_KEEP)
    .map((x) => x.c.source);
}

/** Step 2: the main mart's joined sources, scored, best 5 kept. A failure joins nothing. */
export async function runPath(input: StepInput, deps: StepDeps, mainId: string): Promise<{ sources: JoinedSource[]; all: JoinedSource[]; failed: boolean }> {
  let all: JoinedSource[];
  try { all = await deps.blendable.get(mainId); } catch { return { sources: [], all: [], failed: true }; }
  const cands = pathCandidates(all, input);
  const asked = buildPathQuestions(input, input.model.marts.get(mainId)?.title ?? mainId, cands);
  if (!asked) return { sources: [], all, failed: false };
  try {
    return { sources: applyPath(await deps.decide(asked.questions, asked.state, deps.signal), cands), all, failed: false };
  } catch {
    return { sources: [], all, failed: true };
  }
}
