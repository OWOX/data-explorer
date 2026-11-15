import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { Hint } from '../Tooltip';

/** What a field is called on screen: its alias when it has one (never the technical name beside it), and a (?) with its description when it has one. */
export function FieldLabel({ field, wrap = false }: { field: Pick<Field, 'name' | 'alias' | 'description'>; wrap?: boolean }) {
  const description = field.description?.trim();
  return (
    <>
      <span className={wrap ? 'break-words' : 'truncate'}>{fieldLabel(field)}</span>
      {description && <span className="ml-1 inline-flex shrink-0 items-center"><Hint kind="help" text={description} label={`About ${fieldLabel(field)}`} /></span>}
    </>
  );
}
