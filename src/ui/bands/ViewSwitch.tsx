import { House, type LucideIcon } from 'lucide-react';
import { useRef } from 'react';

export type SwitchOption<T extends string> = { value: T; label: string; icon: LucideIcon };

/** A choice between views in a band header; a radio group, so the arrow keys move between the options. */
export function ViewSwitch<T extends string>({ label, options, value, onChange }: { label: string; options: SwitchOption<T>[]; value: T; onChange: (v: T) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    // A click on the group's own border would otherwise reach the band header, which folds the band.
    <div role="radiogroup" aria-label={label} className="dm-seg" onClick={(e) => e.stopPropagation()}>
      {options.map(({ value: v, label: text, icon: Icon }, i) => (
        // Roving tabindex: only the checked radio is a tab stop.
        <button key={v} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === v} tabIndex={value === v ? 0 : -1} onClick={() => onChange(v)} onKeyDown={(e) => move(e, i)}>
          <Icon size={14} />{text}
        </button>
      ))}
    </div>
  );
}

/** Makes the selected card the main data mart. Sits beside the Grid / Graph switch; the caller shows it only when the selected card can be made main. */
export function MakeMainButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="dm-make-main" onClick={onClick}>
      <House size={14} aria-hidden />Make it main
    </button>
  );
}
