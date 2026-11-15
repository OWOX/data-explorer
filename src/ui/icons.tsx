import {
  Activity,
  BadgeCheck,
  BadgeDollarSign,
  BellRing,
  Blocks,
  Box,
  Braces,
  Building2,
  Calendar,
  ChartColumn,
  ChartNoAxesCombined,
  ChartPie,
  Cloud,
  Coins,
  CreditCard,
  Database,
  DatabaseZap,
  Eye,
  FileCode,
  FileSpreadsheet,
  FileText,
  Filter,
  Fingerprint,
  Flag,
  FlaskConical,
  Gauge,
  Globe,
  Goal,
  Handshake,
  History,
  Image,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  LoaderCircle,
  Mail,
  MapPin,
  Megaphone,
  Merge,
  MessageCircle,
  MousePointerClick,
  Newspaper,
  Package,
  Phone,
  PiggyBank,
  Radio,
  Receipt,
  Repeat,
  Route,
  ScanEye,
  ScrollText,
  Search,
  Server,
  Sheet,
  Shield,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  ShieldMinus,
  ShieldOff,
  ShieldX,
  ShoppingBag,
  ShoppingCart,
  Sigma,
  Smartphone,
  Star,
  Store,
  Table,
  Tag,
  Tags,
  Target,
  TicketPercent,
  TrendingUp,
  Truck,
  Undo2,
  User,
  UserPlus,
  Users,
  Video,
  Wallet,
  Warehouse,
  Webhook,
  Workflow,
  icons,
  type LucideIcon,
} from 'lucide-react';
import * as lucide from 'lucide-react';
import { createElement } from 'react';
import type { DqSummary } from '../model/types';
import { relativeTime } from './format';
import { Tooltip } from './Tooltip';

// Key table copied from DATA_MART_ICON_OPTIONS in the OWOX web app.
const KEYED: Record<string, LucideIcon> = {
  'purchases': ShoppingCart,
  'orders': Receipt,
  'products': Package,
  'inventory': Warehouse,
  'revenue': TrendingUp,
  'finance': Wallet,
  'ad-spend': BadgeDollarSign,
  'campaigns': Target,
  'traffic-sources': Megaphone,
  'sessions': MousePointerClick,
  'pageviews': Eye,
  'events': Activity,
  'conversions': Flag,
  'customers': Users,
  'users': User,
  'leads': UserPlus,
  'countries': MapPin,
  'devices': Smartphone,
  'email': Mail,
  'keywords': Search,
  'social': MessageCircle,
  'subscriptions': Repeat,
  'calendar': Calendar,
  'support': LifeBuoy,
  'database': Database,
  'table': Table,
  'payments': CreditCard,
  'invoices': FileText,
  'refunds': Undo2,
  'carts': ShoppingBag,
  'shipping': Truck,
  'promotions': TicketPercent,
  'stores': Store,
  'exchange-rates': Coins,
  'creatives': Image,
  'video': Video,
  'websites': Globe,
  'landing-pages': LayoutTemplate,
  'content': Newspaper,
  'deals': Handshake,
  'companies': Building2,
  'calls': Phone,
  'reviews': Star,
  'funnels': Filter,
  'segments': ChartPie,
  'experiments': FlaskConical,
  'kpis': Gauge,
  'forecasts': ChartNoAxesCombined,
  'data-sources': DatabaseZap,
  'pipelines': Workflow,
  'sql': FileCode,
  'api': Webhook,
  'cloud': Cloud,
  'servers': Server,
  'reports': FileSpreadsheet,
  'spreadsheets': Sheet,
  'dashboards': LayoutDashboard,
  'charts': ChartColumn,
  'joins': Merge,
  'schemas': Braces,
  'dimensions': Layers,
  'metrics': Sigma,
  'data-quality': BadgeCheck,
  'history': ScrollText,
  'utm': Tag,
  'attribution': Route,
  'channels': Radio,
  'budgets': PiggyBank,
  'goals': Goal,
  'identities': Fingerprint,
  'cohorts': Blocks,
  'alerts': BellRing,
  'impressions': ScanEye,
};

// Mirrors the host's toLucideIconName (lucide-icon-name.ts).
function toLucideIconName(componentName: string): string {
  return componentName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/(?<![0-9])([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase();
}

// Mirrors the host's lucide-icon-catalog.ts: current names from `icons`, plus alias exports
// of the same components, so values saved under an old name still resolve.
const LUCIDE = new Map<string, LucideIcon>();
for (const [name, icon] of Object.entries(icons)) LUCIDE.set(`lucide:${toLucideIconName(name)}`, icon as LucideIcon);
const CURRENT = new Set<unknown>(LUCIDE.values());
for (const [exportName, component] of Object.entries(lucide)) {
  if (!CURRENT.has(component)) continue;
  if (exportName.startsWith('Lucide') || exportName.endsWith('Icon')) continue;
  const value = `lucide:${toLucideIconName(exportName)}`;
  if (!LUCIDE.has(value)) LUCIDE.set(value, component as LucideIcon);
}

export function resolveIcon(value: string | null, fallback: LucideIcon): LucideIcon {
  if (!value) return fallback;
  if (value.startsWith('lucide:')) return LUCIDE.get(value) ?? fallback;
  return KEYED[value] ?? fallback;
}

export function MartIcon({ icon, className = 'size-4' }: { icon: string | null; className?: string }) {
  return createElement(resolveIcon(icon, Box), { className, 'aria-hidden': true });
}

export function ContextIcon({ icon, className = 'size-3' }: { icon: string | null; className?: string }) {
  return createElement(resolveIcon(icon, Tags), { className, 'aria-hidden': true });
}

type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'error' | 'notice';
const TONE: Record<Tone, string> = { neutral: 'text-muted-foreground', progress: 'text-primary', success: 'text-success', warning: 'text-warning', error: 'text-destructive', notice: 'text-notice' };

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

export function DqIcon({ summary, toned = false }: { summary: DqSummary | undefined; toned?: boolean }) {
  const { Icon, label, tone } = dqVisual(summary);
  return (
    <Tooltip content={`Data quality: ${label}`}>
      <span aria-label={`Data quality: ${label}`} className={toned ? 'text-(--tone)' : TONE[tone]}><Icon className={`size-3.5 ${tone === 'progress' ? 'animate-spin' : ''}`} /></span>
    </Tooltip>
  );
}

/** Nothing when the update time is unknown: an unknown freshness is not worth an icon. */
export function FreshnessIcon({ at }: { at: string | null }) {
  if (!at) return null;
  const text = `Data updated ${relativeTime(at)}`;
  return (
    <Tooltip content={text}>
      <span aria-label={text} className="text-muted-foreground"><History className="size-3.5" /></span>
    </Tooltip>
  );
}
