import type { Ctx } from '../sdk/types';
import { isFormat, type Format } from './formats';

const PROJECT_FORMATS_COLLECTION = 'column-formats-project';
const MEMBER_FORMATS_COLLECTION = 'column-formats-member';
export type FormatDoc = Record<string, Format>;
export type Formats = { member: FormatDoc; project: FormatDoc };

const clean = (raw: unknown): FormatDoc =>
  typeof raw !== 'object' || raw === null || Array.isArray(raw) ? {} : Object.fromEntries(Object.entries(raw).filter(([, f]) => isFormat(f)));

export interface FormatStore {
  /** Both documents of a mart; an empty one when absent, malformed or unreadable. `failed` is set when a read threw, so an unreadable document is told from an empty one. */
  load(martId: string): Promise<Formats & { failed?: true }>;
  /** Saves the member's format for a column; null removes the choice. Never throws. */
  setMember(martId: string, column: string, f: Format | null): Promise<void>;
  /** Merges project picks into the mart's document; a column already picked keeps its pick. Never throws. */
  setProject(martId: string, picks: FormatDoc): Promise<void>;
}

export function formatStore(ctx: Ctx): FormatStore {
  const member = ctx.collections<FormatDoc>(MEMBER_FORMATS_COLLECTION);
  const project = ctx.collections<FormatDoc>(PROJECT_FORMATS_COLLECTION);
  type Col = typeof member;
  const read = async (col: Col, martId: string): Promise<{ doc: FormatDoc; failed: boolean }> => {
    try { return { doc: clean((await col.get(martId))?.document), failed: false }; } catch (e) { console.warn('Reading the column formats failed', e); return { doc: {}, failed: true }; }
  };
  // A write is read-modify-write on the stored document; writes to one document run one after another.
  const queue = new Map<string, Promise<void>>();
  const write = (col: Col, key: string, martId: string, change: (doc: FormatDoc) => FormatDoc): Promise<void> => {
    const run = (queue.get(key) ?? Promise.resolve()).then(async () => {
      try {
        // A document that cannot be read is not overwritten: the throw skips the put.
        const doc = clean((await col.get(martId))?.document);
        await col.put(martId, change(doc));
      } catch (e) { console.warn('Saving the column formats failed', e); }
    });
    queue.set(key, run);
    return run;
  };
  return {
    async load(martId) {
      const [m, p] = await Promise.all([read(member, martId), read(project, martId)]);
      return { member: m.doc, project: p.doc, ...(m.failed || p.failed ? { failed: true as const } : {}) };
    },
    setMember: (martId, column, f) => write(member, `m/${martId}`, martId, (doc) => {
      const next = { ...doc };
      if (f) next[column] = f; else delete next[column];
      return next;
    }),
    setProject: (martId, picks) => write(project, `p/${martId}`, martId, (doc) => ({ ...clean(picks), ...doc })),
  };
}
