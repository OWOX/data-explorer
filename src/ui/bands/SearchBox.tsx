import { Search } from 'lucide-react';

/** The text box in a band's toolbar, ported from Data Flow. */
export function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="dm-search">
      <Search size={14} />
      <input type="search" value={value} placeholder={label} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
