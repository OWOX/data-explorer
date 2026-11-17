import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Schema } from '../model/types';
import type { Ctx } from '../sdk/types';
import { useServices } from '../state/store';
import { pickFormats } from './ai-pick';
import { AUTO, isValidFormat, resolveFormat, type Format } from './formats';
import { formatStore, type Formats } from './store';

const NONE: Formats = { member: {}, project: {} };
const NO_SCHEMA: Schema = [];
/** The AI pick waits this long after the formats load or the schema changes, so a join that adds columns costs one call. */
export const PICK_SETTLE_MS = 250;

/**
 * One mart's formats, shared by every hook instance on that mart: it loads once, the AI is asked once, and a member's choice
 * made in one view repaints the others. It works while at least one instance is subscribed.
 */
function createEntry(ctx: Ctx, martId: string) {
  const store = formatStore(ctx);
  let formats: Formats = NONE;
  let ready = false;
  let started = false;
  let subscribers = 0;
  const listeners = new Set<() => void>();
  // Columns whose member choice was removed here: a stored choice that is still on its way must not bring them back.
  const removed = new Set<string>();
  let latest: { schema: Schema; title: string } | null = null;
  // The ask in flight and the schema it was made for; a later schema is asked about once it finishes.
  let run: { ctl: AbortController; schema: Schema } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: Formats) => { formats = next; listeners.forEach((l) => l()); };

  const schedule = () => {
    clearTimeout(timer);
    if (!ready || !latest || run || subscribers === 0) return;
    timer = setTimeout(start, PICK_SETTLE_MS);
  };
  const start = () => {
    if (!latest || run || subscribers === 0) return;
    const { schema, title } = latest;
    const mine = { ctl: new AbortController(), schema };
    run = mine;
    void pickFormats(ctx, store, martId, title, schema, formats.project, mine.ctl.signal).then((picks) => {
      if (run !== mine) return; // aborted and detached
      run = null;
      if (Object.keys(picks).length) set({ member: formats.member, project: { ...picks, ...formats.project } });
      if (latest && latest.schema !== schema) schedule();
    });
  };

  const load = () => {
    started = true;
    void store.load(martId).then((stored) => {
      const member = Object.fromEntries(Object.entries(stored.member).filter(([c]) => !removed.has(c)));
      ready = true;
      set({ member: { ...member, ...formats.member }, project: stored.project });
      schedule();
    });
  };

  return {
    get: () => formats,
    subscribe(listener: () => void) {
      listeners.add(listener);
      subscribers++;
      if (!started) load(); else schedule();
      return () => {
        listeners.delete(listener);
        if (--subscribers > 0) return;
        clearTimeout(timer);
        run?.ctl.abort();
        run = null;
      };
    },
    /** The schema and title the AI is asked about; a change never cancels or repeats a running ask. */
    offer(schema: Schema, title: string) {
      latest = { schema, title };
      schedule();
    },
    setMember(column: string, f: Format | null) {
      if (f) removed.delete(column); else removed.add(column);
      const member = { ...formats.member };
      if (f) member[column] = f; else delete member[column];
      set({ member, project: formats.project });
      void store.setMember(martId, column, f);
    },
  };
}
type Entry = ReturnType<typeof createEntry>;

const entries = new WeakMap<Ctx, Map<string, Entry>>();
function entryFor(ctx: Ctx, martId: string): Entry {
  let byMart = entries.get(ctx);
  if (!byMart) entries.set(ctx, (byMart = new Map()));
  let e = byMart.get(martId);
  if (!e) byMart.set(martId, (e = createEntry(ctx, martId)));
  return e;
}

/** A mart's column formats: the member's choice, else the project's pick, else `auto`. Shared by every view of the mart. */
export function useColumnFormats(martId: string, schema: Schema = NO_SCHEMA, martTitle = martId): { formatOf(column: string, type: string): Format; /** Whether the project (an AI pick) has a format for the column other than `auto`. */ hasProjectPick(column: string): boolean; setMember(column: string, f: Format | null): void } {
  const { ctx } = useServices();
  const entry = useMemo(() => entryFor(ctx, martId), [ctx, martId]);
  const formats = useSyncExternalStore(entry.subscribe, entry.get);
  useEffect(() => { entry.offer(schema, martTitle); }, [entry, schema, martTitle]);
  const formatOf = useCallback((column: string, type: string): Format => {
    const f = resolveFormat(formats.member[column], formats.project[column]);
    return isValidFormat(f, type) ? f : AUTO;
  }, [formats]);
  const setMember = useCallback((column: string, f: Format | null) => entry.setMember(column, f), [entry]);
  const hasProjectPick = useCallback((column: string) => { const f = formats.project[column]; return !!f && f.kind !== 'auto'; }, [formats]);
  return { formatOf, hasProjectPick, setMember };
}
