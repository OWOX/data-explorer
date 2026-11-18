import { Tooltip } from '../../ui/Tooltip';

export type Slice = { name: string; value: number; valueText: string; color: string };

const SIZE = 180;
const R = SIZE / 2 - 2;
const C = SIZE / 2;

/** Slice angles are ratios of the slices' sum, for drawing only; the shown text is each slice's `valueText`. */
export function PieChart({ slices, ariaLabel }: { slices: Slice[]; ariaLabel: string }) {
  const drawn = slices.filter((s) => s.value > 0);
  const total = drawn.reduce((sum, s) => sum + s.value, 0);
  // Each slice starts where the previous one ended.
  const starts = drawn.map((_, i) => -Math.PI / 2 + (drawn.slice(0, i).reduce((sum, d) => sum + d.value, 0) / total) * 2 * Math.PI);
  const marks = drawn.map((s, i) => {
    const share = `${Math.round((s.value / total) * 100)}%`;
    const content = `${s.name}: ${s.valueText} (${share})`;
    const common = { 'data-slice': s.name, fill: s.color, className: 'dm-pie-slice' };
    if (drawn.length === 1) return <Tooltip key={s.name} content={content}><circle {...common} cx={C} cy={C} r={R} /></Tooltip>;
    const start = starts[i]!;
    const end = start + (s.value / total) * 2 * Math.PI;
    const pt = (a: number) => `${(C + R * Math.cos(a)).toFixed(2)} ${(C + R * Math.sin(a)).toFixed(2)}`;
    const large = end - start > Math.PI ? 1 : 0;
    return <Tooltip key={s.name} content={content}><path {...common} d={`M${C} ${C} L${pt(start)} A${R} ${R} 0 ${large} 1 ${pt(end)} Z`} /></Tooltip>;
  });
  return (
    <div className="dm-pie">
      <svg role="img" aria-label={ariaLabel} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>{marks}</svg>
      <ul className="dm-chart-legend">
        {slices.map((s) => <li key={s.name}><span className="dm-chart-swatch" style={{ background: s.color }} />{s.name}</li>)}
      </ul>
      <table className="sr-only">
        <tbody>{slices.map((s) => <tr key={s.name}><th scope="row">{s.name}</th><td>{s.valueText}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
