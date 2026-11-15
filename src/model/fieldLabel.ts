import type { Field } from './types';

/** What a field is called on screen: its alias when it has one, else its technical name. */
export const fieldLabel = (f: Pick<Field, 'name' | 'alias'>): string => (typeof f.alias === 'string' && f.alias.trim() !== '' ? f.alias : f.name);

/** The technical name, but only when the label hides it (for a `title` attribute). */
export const fieldTitle = (f: Pick<Field, 'name' | 'alias'>): string | undefined => (fieldLabel(f) === f.name ? undefined : f.name);
