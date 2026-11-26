import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { Model } from '../../model/types';
import { AiHint, SearchAlternatives, SearchBox, SearchNotice, SearchProgress } from './SearchBox';
import { useSmartSearch, type SmartSearch } from './useSmartSearch';

const Ctx = createContext<SmartSearch | null>(null);

/** The one smart search of the page: the header holds its box, the Data Marts band shows what it found. */
export function SmartSearchScope({ model, children }: { model: Model; children: ReactNode }) {
  return <Ctx.Provider value={useSmartSearch(model)}>{children}</Ctx.Provider>;
}

export function useSmartSearchScope(): SmartSearch {
  const smart = useContext(Ctx);
  if (!smart) throw new Error('useSmartSearchScope needs a SmartSearchScope');
  return smart;
}

/** The search icon (or the box it opens) for the page header's actions. */
export function HeaderSearch({ autoOpen = false }: { autoOpen?: boolean }) {
  const smart = useSmartSearchScope();
  // Opens the box once when a first visit starts, so it is not reopened after the member closes it.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    smart.openBox();
  });
  return <SearchBox smart={smart} label="Search data marts" />;
}

/** The quiet lines under the header: what the last pick left out, and the suggestion to plug AI in. */
export function HeaderSearchHint() {
  const smart = useSmartSearchScope();
  if (!smart.hintVisible && !smart.notice && !smart.progress && !smart.alternatives.length) return null;
  return (
    <div className="w-full">
      {smart.progress && <SearchProgress step={smart.progress} />}
      {smart.alternatives.length > 0 && <SearchAlternatives ids={smart.alternatives} model={smart.model} onPick={smart.chooseAlternative} />}
      {smart.notice && <SearchNotice text={smart.notice} onDismiss={smart.dismissNotice} />}
      {smart.hintVisible && <AiHint onDismiss={smart.dismissHint} />}
    </div>
  );
}
