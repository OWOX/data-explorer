import { useCallback, useEffect, useRef, useState } from 'react';
import { withJoined } from '../api/blendable';
import { VIEW_LINK_WAIT_MS } from '../config';
import type { Model, Schema } from '../model/types';
import { useServices, useStore } from '../state/store';
import { decodeViewLink, encodeViewLink, MAX_ROUTE_LENGTH, type DecodedView } from '../state/view-link';
import { resolveView, skippedMessage } from '../state/view-link-resolve';

const MAYBE_LINK = /^\/v(\?|$)/;
const TOO_LARGE = 'This view is too large to link. Remove some columns or filters and try again.';
const COPY_FAILED = "The link couldn't be copied.";

/**
 * Opens the view a link names. The link is decoded once on mount and resolved once the model is loaded;
 * `pending` holds the page's first-load pick back until then. Nothing here writes to saved preferences.
 */
export function useViewLink(model: Model | null, currentFolds: DecodedView['folded']) {
  const { ctx, schemas, blendable } = useServices();
  const [state, dispatch] = useStore();
  const route = ctx.route;
  const [decoded, setDecoded] = useState<DecodedView | 'none' | null>(() => (route && MAYBE_LINK.test(route) ? null : 'none'));
  const [notice, setNotice] = useState<string | null>(null);
  const [folded, setFolded] = useState<DecodedView['folded'] | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (decoded !== null) return;
    let live = true;
    decodeViewLink(route).then((r) => {
      if (!live) return;
      if (r === 'unreadable') setNotice("This link couldn't be read. Showing the default view.");
      setDecoded(typeof r === 'string' ? 'none' : r);
    }, () => { if (live) setDecoded('none'); });
    return () => { live = false; };
  }, [decoded, route]);

  useEffect(() => {
    if (!model || !decoded || decoded === 'none' || started.current) return;
    started.current = true;
    const readGrid = async (martId: string): Promise<Schema | null> => {
      const read = async (): Promise<Schema | null> => {
        const [native, sources] = await Promise.all([schemas.get(martId), blendable.get(martId)]);
        return withJoined(native, sources);
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const wait = new Promise<null>((r) => { timer = setTimeout(() => r(null), VIEW_LINK_WAIT_MS); });
      return Promise.race([read().catch(() => null), wait]).finally(() => clearTimeout(timer));
    };
    (async () => {
      try {
        const { apply, skipped } = await resolveView(decoded, model, readGrid);
        dispatch({ type: 'applyView', selection: apply.selection, grid: apply.grid, search: apply.search, contextIds: apply.contextIds, storageIds: apply.storageIds });
        setFolded(apply.folded);
        const message = skippedMessage(skipped);
        if (message) setNotice(message);
      } catch {
        // Apply nothing: the page opens as it would without a link.
      }
      setDecoded('none');
    })();
  }, [model, decoded, schemas, blendable, dispatch]);

  const copy = useCallback(async () => {
    const { selection, grids } = state;
    try {
      const path = await encodeViewLink({
        sourceKey: selection.sourceKey,
        martId: selection.martId,
        record: selection.record?.pk ?? null,
        search: state.search,
        contextIds: state.contextIds,
        storageIds: state.storageIds,
        folded: currentFolds,
        grid: selection.martId ? grids[selection.martId] ?? null : null,
      });
      if (path.length > MAX_ROUTE_LENGTH) { setNotice(TOO_LARGE); return; }
      await ctx.ui.copyLink!(path);
      setNotice(null);
    } catch {
      setNotice(COPY_FAILED);
    }
  }, [state, currentFolds, ctx]);

  return { pending: decoded !== 'none', folded, notice, dismiss: () => setNotice(null), copy };
}
