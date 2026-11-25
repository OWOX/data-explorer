import { createContext } from 'react';
/** The header element the config menu portals into: next to the Table / Charts switch. Null outside the Data band. */
export const ConfigMenuSlot = createContext<HTMLElement | null>(null);
