import type { HTMLAttributes, KeyboardEvent } from 'react';

// The host iframe has no allow-forms, so the browser drops a form submit before the event fires.
// This container runs the action itself: Enter in a field, or a type="button" Apply calling the same function.
const TEXTUAL = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password', 'date', 'datetime-local', 'time', 'month', 'week']);

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onKeyDown'> & { onAction: () => void };

export function ActionForm({ onAction, children, ...rest }: Props) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || e.nativeEvent.isComposing) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !TEXTUAL.has(t.type)) return;
    e.preventDefault();
    onAction();
  };
  return <div {...rest} onKeyDown={onKeyDown}>{children}</div>;
}
