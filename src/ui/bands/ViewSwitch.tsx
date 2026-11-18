import { ChartColumn, Table2 } from 'lucide-react';
import { useRef } from 'react';

type Mode = 'table' | 'charts';
const OPTIONS: { value: Mode; label: string; icon: typeof Table2 }[] = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'charts', label: 'Charts', icon: ChartColumn },
];

/** Table or charts for the Data band; a radio group, so the arrow keys move between the two. */
export function ViewSwitch({ value, onChange }: { value: Mode; onChange: (v: Mode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + OPTIONS.length) % OPTIONS.length;
    onChange(OPTIONS[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Show data as" className="dm-seg">
      {OPTIONS.map(({ value: v, label, icon: Icon }, i) => (
        // Roving tabindex: only the checked radio is a tab stop.
        <button key={v} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={value === v} tabIndex={value === v ? 0 : -1} onClick={() => onChange(v)} onKeyDown={(e) => move(e, i)}>
          <Icon size={14} />{label}
        </button>
      ))}
    </div>
  );
}
