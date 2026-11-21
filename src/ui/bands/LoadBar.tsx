// The bar a band shows in place of its body while the page reads. The reads finish in a few big steps, so the
// real fraction alone would freeze between them and then jump; the bar's drawn width is its own animation instead:
// it catches up to a finished step quickly, creeps toward CREEP_TO while it waits for the next (never stalling, never
// moving back), and runs out to the end once the read is done. The width is written straight to the element each
// frame, so a React re-render cannot reset it, and the drawn value lives outside the component, so the bar that
// replaces the loading shell's one carries on from where it was.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLatest } from '../useLatest';

/** Where the bar heads while a step is pending. */
export const CREEP_TO = 0.9;
/** Time constants (ms) of the ease-outs: waiting, catching up to a finished step, running out to the end. */
const TAU_CREEP = 4000;
const TAU_CATCH = 160;
const TAU_FINISH = 90;

const drawn = { value: 0, at: 0 };

/** The bar's drawn fraction at `now`, given the real fraction of reads done. Never lower than before; one step per frame however many bars ask. */
export function advance(now: number, fraction: number): number {
  const dt = drawn.at === 0 ? 0 : now - drawn.at;
  drawn.at = now;
  if (dt <= 0) return drawn.value;
  const [target, tau] = fraction >= 1 ? [1, TAU_FINISH] : drawn.value < fraction - 0.002 ? [fraction, TAU_CATCH] : [CREEP_TO, TAU_CREEP];
  const next = drawn.value + (target - drawn.value) * (1 - Math.exp(-dt / tau));
  drawn.value = Math.min(1, Math.max(drawn.value, next));
  return drawn.value;
}

/** Forgets the drawn value; for tests. */
export function resetLoadBar() { drawn.value = 0; drawn.at = 0; }

export function LoadBar({ fraction }: { fraction: number }) {
  const real = Math.min(1, Math.max(0, fraction));
  const pct = Math.round(real * 100);
  const fill = useRef<HTMLSpanElement>(null);
  const latest = useLatest(real);
  const paint = () => { if (fill.current) fill.current.style.width = `${(drawn.value * 100).toFixed(2)}%`; };
  useLayoutEffect(paint);
  useEffect(() => {
    let frame = 0;
    const step = (now: number) => {
      advance(now, latest.current);
      paint();
      if (!(latest.current >= 1 && drawn.value >= 0.9995)) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [latest]);
  return (
    <div className={`dm-loadbar${pct >= 100 ? ' dm-loadbar-done' : ''}`} role="progressbar" aria-label="Reading the project" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span ref={fill} />
    </div>
  );
}
