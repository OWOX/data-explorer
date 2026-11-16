// The bar a band shows in place of its body while the page reads: it fills as steps finish, and turns pale green when full.

export function LoadBar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <div className={`dm-loadbar${pct >= 100 ? ' dm-loadbar-done' : ''}`} role="progressbar" aria-label="Reading the project" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
