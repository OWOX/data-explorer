import { LoaderCircle, Shield, ShieldAlert, ShieldBan, ShieldCheck, ShieldMinus, ShieldOff, ShieldX, type LucideIcon } from 'lucide-react';
import type { DqSummary } from '../model/types';

type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'error' | 'notice';

// Mirrors tmp/ref/apps_web_src_features_data-marts_shared_utils_data-quality-status.ts
export function dqVisual(s: DqSummary | undefined): { Icon: LucideIcon; label: string; tone: Tone } {
  if (!s) return { Icon: Shield, label: 'No data quality info', tone: 'neutral' };
  if (s.state === 'CANCELLED') return { Icon: ShieldBan, label: 'Cancelled', tone: 'neutral' };
  if ((s.totalChecks ?? 0) > 0 && s.notApplicableChecks === s.totalChecks) return { Icon: ShieldMinus, label: 'No applicable checks', tone: 'neutral' };
  switch (s.state) {
    case 'NEVER_RUN': return { Icon: Shield, label: 'Never run', tone: 'neutral' };
    case 'ALL_DISABLED': return { Icon: ShieldOff, label: 'All checks disabled', tone: 'neutral' };
    case 'QUEUED': return { Icon: LoaderCircle, label: 'Queued', tone: 'progress' };
    case 'RUNNING': return { Icon: LoaderCircle, label: 'Running', tone: 'progress' };
    case 'PASSED': return { Icon: ShieldCheck, label: 'Passed', tone: 'success' };
    case 'EXECUTION_FAILED': return { Icon: ShieldX, label: 'Run failed', tone: 'error' };
    case 'RESTRICTED': return { Icon: ShieldBan, label: 'Restricted', tone: 'warning' };
    case 'ISSUES': {
      const tone: Tone = (s.errorFindings ?? 0) > 0 || s.highestSeverity === 'error' ? 'error'
        : (s.warningFindings ?? 0) > 0 || s.highestSeverity === 'warning' ? 'warning'
        : (s.noticeFindings ?? 0) > 0 || s.highestSeverity === 'notice' ? 'notice' : 'warning';
      return { Icon: ShieldAlert, label: 'Issues found', tone };
    }
    default: return { Icon: Shield, label: s.state, tone: 'neutral' };
  }
}

const CARD_TONE: Record<Tone, string> = { neutral: 'unknown', progress: 'progress', success: 'ok', warning: 'warn', error: 'bad', notice: 'warn' };
/** The card's tone name, as in Data Flow: ok, warn, bad, progress or unknown. */
export function dqCardTone(s: DqSummary | undefined): string {
  return CARD_TONE[dqVisual(s).tone];
}
