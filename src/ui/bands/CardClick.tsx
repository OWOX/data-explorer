import { createContext } from 'react';
import type { ClickOptions } from './useCardClick';

/** What a click on a data mart card does, shared with the grid so a group's remove button takes the same path (serialised with the card clicks). */
export const CardClickContext = createContext<(id: string, options?: ClickOptions) => Promise<void>>(() => Promise.resolve());
