import { createContext } from 'react';
/** The header element the Charts list menu portals into: next to the Table / Charts switch. Null outside the Data band. */
export const ChartsMenuSlot = createContext<HTMLElement | null>(null);
