import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { Hint } from '../Tooltip';

/**
 * What a field is called on screen: its alias when it has one (never the technical name beside it), and a (?) with its
 * description when it has one. The (?) sits 4px after the label, centred on the label's first line, and shows only while
 * the row it is in (`dm-reveal-host`) is hovered or holds focus.
 */
export function FieldLabel({ field, wrap = false }: { field: Pick<Field, 'name' | 'alias' | 'description'>; wrap?: boolean }) {
  const description = field.description?.trim();
  return (
    <span className="dm-fieldlabel">
      <span className={wrap ? 'break-words' : 'truncate'}>{fieldLabel(field)}</span>
      {description && <span className="dm-hint-slot"><Hint kind="help" text={description} label={`About ${fieldLabel(field)}`} /></span>}
    </span>
  );
}
