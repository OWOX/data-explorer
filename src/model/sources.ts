import type { ConnectorDto, ConnectorSummaryDto } from '../sdk/types';
import { strings } from './guards';
import type { Mart, Source } from './types';

// Same rule as OWOX's raw-base64-icon: a remote URL in an <img> would beacon every viewer to the connector author's host.
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,[\s\S]+$/i;

const AUTH_LABELS = new Set(['oauth', 'oauth2', 'auth', 'accounts', 'login', 'sso', 'token']);
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'co.nz', 'co.jp', 'co.in', 'com.br', 'com.mx',
  'co.za', 'com.tr', 'com.ua', 'com.sg', 'com.hk',
]);
/** Domains many unrelated services share, where the registered domain says nothing about whose it is. */
const SHARED_DOMAINS = new Set([
  'googleapis.com', 'amazonaws.com', 'azurewebsites.net', 'windows.net', 'appspot.com',
  'cloudfunctions.net', 'run.app', 'herokuapp.com', 'vercel.app', 'netlify.app', 'workers.dev',
  'firebaseio.com',
]);

/** The registered domain of a host, or the whole host on a shared cloud domain. */
function registeredDomain(input: string): string {
  // A manifest host may carry a scheme, port, path or a trailing dot.
  const host = input.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0]!;
  // IP literals have no registered domain to shorten to.
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1 || undefined);
  const bare = host.replace(/:\d+$/, '').replace(/\.+$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return bare;
  const labels = bare.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const two = labels.slice(-2).join('.');
  if (TWO_LEVEL_SUFFIXES.has(two)) return labels.slice(-3).join('.');
  return SHARED_DOMAINS.has(two) ? labels.join('.') : two;
}

/** The registered domain a set of API hosts agrees on; undefined with no usable host. */
function serviceDomain(hosts: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const raw of hosts) {
    const host = raw.trim().toLowerCase();
    if (!host || AUTH_LABELS.has(host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('.')[0]!)) continue;
    const domain = registeredDomain(host);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  let best: string | undefined;
  // A tie goes to the host that came first.
  for (const [domain, n] of counts) if (!best || n > counts.get(best)!) best = domain;
  return best;
}

/** What a custom connector is a connector *of*: connectors that call the same service share a key. The prefix keeps it from ever equalling a bundled connector name. */
export function serviceKey(hosts: string[], fallback: string): string {
  const domain = serviceDomain(hosts);
  return domain ? `service:${domain}` : fallback;
}

/** A summary row as the model can use it, or nothing: an odd row costs its own card, never the page. */
export function cleanSummary(row: unknown): ConnectorSummaryDto[] {
  const r = (row ?? {}) as Partial<Record<keyof ConnectorSummaryDto, unknown>>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.id || !r.name) return [];
  return [{
    id: r.id,
    name: r.name,
    title: typeof r.title === 'string' && r.title ? r.title : r.name,
    logo: typeof r.logo === 'string' ? r.logo : null,
    hosts: strings(r.hosts),
  }];
}

/** A custom connector's logo is shown only when it is an inline image. */
export const customLogo = (logo: unknown): string | null => (typeof logo === 'string' && DATA_IMAGE.test(logo) ? logo : null);

/** The longest leading run of whole words every title shares, without trailing punctuation. */
function commonTitle(titles: string[]): string {
  const words = titles.map((t) => t.trim().split(/\s+/));
  const shared: string[] = [];
  for (let i = 0; i < words[0]!.length; i++) {
    if (words.every((w) => w[i] !== undefined && w[i]!.toLowerCase() === words[0]![i]!.toLowerCase())) shared.push(words[0]![i]!);
    else break;
  }
  return shared.join(' ').replace(/[\s\-\u2013\u2014:;,.()[\]{}|/]+$/u, '').trim();
}

/** Finds the custom connector a mart's connector name stands for. A bundled name of the same case wins; otherwise case is ignored. */
function customLookup(bundled: ConnectorDto[], custom: ConnectorSummaryDto[]) {
  const bundledNames = new Set(bundled.map((c) => c.name));
  const byLower = new Map(custom.map((c) => [c.name.toLowerCase(), c]));
  return (name: string) => (bundledNames.has(name) ? undefined : byLower.get(name.toLowerCase()));
}

/** The one place a mart's connector name becomes the key of its source card. */
export function sourceKeyFor(name: string, bundled: ConnectorDto[], custom: ConnectorSummaryDto[]): string {
  const summary = customLookup(bundled, custom)(name);
  return summary ? serviceKey(summary.hosts, summary.name) : name;
}

type Member = { title: string; logo: string | null; summary?: ConnectorSummaryDto };

/** One source per key. A mart's `connectorName` (the raw name, when `sourceKey` is a service key) says which connector it came from. */
export function groupSources(marts: Iterable<Mart>, connectors: ConnectorDto[], custom: ConnectorSummaryDto[] = []): Source[] {
  const byKey = new Map<string, { martIds: string[]; members: Map<string, Member> }>();
  const info = new Map(connectors.map((c) => [c.name, c]));
  const customFor = customLookup(connectors, custom);
  for (const m of marts) {
    if (!m.accessible || m.sourceKey === null) continue;
    const entry = byKey.get(m.sourceKey) ?? { martIds: [], members: new Map<string, Member>() };
    byKey.set(m.sourceKey, entry);
    entry.martIds.push(m.id);
    const name = m.connectorName ?? m.sourceKey;
    const summary = customFor(name);
    // Two spellings of one custom connector are one member.
    const memberKey = summary?.id ?? name;
    if (entry.members.has(memberKey)) continue;
    const bundled = info.get(name);
    entry.members.set(memberKey, summary
      ? { title: summary.title, logo: customLogo(summary.logo), summary }
      : { title: bundled?.title || name, logo: customLogo(bundled?.logo) });
  }
  return [...byKey].map(([key, { martIds, members }]) => {
    const list = [...members.values()];
    let name: string;
    if (list.length === 1) name = list[0]!.title;
    else {
      const domain = serviceDomain(list.flatMap((x) => x.summary?.hosts ?? []));
      const label = domain?.split('.')[0] ?? '';
      name = commonTitle(list.map((x) => x.title)) || (label ? label[0]!.toUpperCase() + label.slice(1) : list[0]!.title);
    }
    return { key, name, logo: list.find((x) => x.logo)?.logo ?? null, martIds };
  }).sort((a, b) => b.martIds.length - a.martIds.length || a.name.localeCompare(b.name));
}
