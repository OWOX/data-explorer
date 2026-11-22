import type { Field } from './types';

/** What a field is called on screen: its alias when it has one, else its technical name. */
export const fieldLabel = (f: Pick<Field, 'name' | 'alias'>): string => (typeof f.alias === 'string' && f.alias.trim() !== '' ? f.alias : f.name);

/** What a column is called in a header and in a control's name: a joined field leads with its data mart ("Customers · Email"). */
export const columnTitle = (f: Pick<Field, 'name' | 'alias' | 'joined'>): string => (f.joined ? `${f.joined.label} · ${fieldLabel(f)}` : fieldLabel(f));
