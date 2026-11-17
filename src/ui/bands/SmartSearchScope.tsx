import { createContext, useContext, type ReactNode } from 'react';
import type { Model } from '../../model/types';
import { AiHint, SearchBox } from './SearchBox';
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
export function HeaderSearch() {
  return <SearchBox smart={useSmartSearchScope()} label="Search data marts" />;
}

/** The quiet line under the header that suggests plugging AI in. */
export function HeaderSearchHint() {
  const smart = useSmartSearchScope();
  return smart.hintVisible ? <div className="w-full"><AiHint onDismiss={smart.dismissHint} /></div> : null;
}
