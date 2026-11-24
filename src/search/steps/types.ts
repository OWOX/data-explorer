import type { Decide } from '../decide';
import type { Intent } from '../intent';
import type { SearchHits } from '../endpoint';
import type { Model } from '../../model/types';
import type { SchemaLoader } from '../../api/schemas';
import type { BlendableLoader } from '../../api/blendable';
import type { AiModel, Ctx } from '../../sdk/types';

/** What every step reads. */
export type StepInput = { query: string; intent: Intent; hits: SearchHits; model: Model };
/** What every step may call. */
export type StepDeps = {
  ctx: Ctx; decide: Decide; fast: AiModel; signal: AbortSignal;
  schemas: Pick<SchemaLoader, 'get'>; blendable: Pick<BlendableLoader, 'get'>;
};
/** A step's questions and the state they are about; null when there is nothing to ask. */
export type Asked = { questions: Record<string, import('../decide').Question>; state: Record<string, unknown> } | null;
