import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Schema } from '../model/types';
import { perCtx } from '../sdk/per-ctx';
import type { Ctx } from '../sdk/types';
import { useServices } from '../state/store';
import { pickFormats } from './ai-pick';
import { AUTO, isValidFormat, type Format } from './formats';
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
  // What each live hook instance offers; the AI is asked about the union of their eligible columns.
  const offers = new Set<{ schema: Schema; title: string }>();
  const merged = (): { schema: Schema; title: string } | null => {
    const first = offers.values().next().value;
    if (!first) return null;
    const byName = new Map<string, Schema[number]>();
    for (const o of offers) for (const f of o.schema) if (!byName.has(f.name)) byName.set(f.name, f);
    const schema = [...byName.values()];
    return { schema, title: first.title };
  };
  const signature = (schema: Schema) => schema.map((f) => f.name).sort().join('\0');
  let loadFailed = false;
  // The ask in flight and the columns it was made for; others are asked about once it finishes.
  let run: { ctl: AbortController; sig: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: Formats) => { formats = next; listeners.forEach((l) => l()); };

  const schedule = () => {
    clearTimeout(timer);
    if (!ready || offers.size === 0 || run || subscribers === 0) return;
    timer = setTimeout(start, PICK_SETTLE_MS);
  };
  const start = () => {
    const latest = merged();
    if (!latest || run || subscribers === 0) return;
    const { schema, title } = latest;
    const mine = { ctl: new AbortController(), sig: signature(schema) };
    run = mine;
    void pickFormats(ctx, store, martId, title, schema, formats.project, mine.ctl.signal).then((picks) => {
      if (run !== mine) return; // aborted and detached
      run = null;
      if (Object.keys(picks).length) set({ member: formats.member, project: { ...picks, ...formats.project } });
      const now = merged();
      if (now && signature(now.schema) !== mine.sig) schedule();
    });
  };

  const load = () => {
    started = true;
    void store.load(martId).then((stored) => {
      const member = Object.fromEntries(Object.entries(stored.member).filter(([c]) => !removed.has(c)));
      loadFailed = stored.failed === true;
      // An unreadable document is not an empty one: nothing is asked, and the next subscribe after a full teardown reads again.
      ready = !loadFailed;
      // The teardown has already run (everyone left during the read): nobody will reset the failure later, so it is reset here.
      if (loadFailed && subscribers === 0) { started = false; loadFailed = false; }
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
        // A view that remounts (another row of the same mart) unsubscribes and subscribes in one commit: tear down only if nobody came back.
        setTimeout(() => {
          if (subscribers > 0) return;
          clearTimeout(timer);
          run?.ctl.abort();
          run = null;
          if (loadFailed) { started = false; loadFailed = false; }
        }, 0);
      };
    },
    /** The schema and title the AI is asked about; a change never cancels or repeats a running ask. */
    offer(schema: Schema, title: string) {
      const mine = { schema, title };
      offers.add(mine);
      schedule();
      return () => { offers.delete(mine); };
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

const entriesOf = perCtx(() => new Map<string, Entry>());
function entryFor(ctx: Ctx, martId: string): Entry {
  const byMart = entriesOf(ctx);
  let e = byMart.get(martId);
  if (!e) byMart.set(martId, (e = createEntry(ctx, martId)));
  return e;
}

/** A mart's column formats: the member's choice, else the project's pick, else `auto`. Shared by every view of the mart. */
export function useColumnFormats(martId: string, schema: Schema = NO_SCHEMA, martTitle = martId): { formatOf(column: string, type: string): Format; /** The member's own format for the column, if any (an AI pick is not one). */ memberFormat(column: string): Format | undefined; setMember(column: string, f: Format | null): void } {
  const { ctx } = useServices();
  const entry = useMemo(() => entryFor(ctx, martId), [ctx, martId]);
  const formats = useSyncExternalStore(entry.subscribe, entry.get);
  useEffect(() => entry.offer(schema, martTitle), [entry, schema, martTitle]);
  const formatOf = useCallback((column: string, type: string): Format => {
    const f = formats.member[column] ?? formats.project[column] ?? AUTO;
    return isValidFormat(f, type) ? f : AUTO;
  }, [formats]);
  const setMember = useCallback((column: string, f: Format | null) => entry.setMember(column, f), [entry]);
  const memberFormat = useCallback((column: string) => formats.member[column], [formats]);
  return { formatOf, memberFormat, setMember };
}
