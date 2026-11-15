import type { ConnectorDto } from '../sdk/types';
import type { Mart, Source } from './types';

// Same rule as OWOX's raw-base64-icon: a remote URL in an <img> would beacon every viewer to the connector author's host.
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,[\s\S]+$/i;

export function groupSources(marts: Iterable<Mart>, connectors: ConnectorDto[]): Source[] {
  const byKey = new Map<string, string[]>();
  for (const m of marts) {
    if (!m.accessible || m.sourceKey === null) continue;
    const ids = byKey.get(m.sourceKey);
    if (ids) ids.push(m.id);
    else byKey.set(m.sourceKey, [m.id]);
  }
  const info = new Map(connectors.map((c) => [c.name, c]));
  return [...byKey].map(([key, martIds]) => {
    const c = info.get(key);
    return { key, name: c?.title || key, logo: typeof c?.logo === 'string' && DATA_IMAGE.test(c.logo) ? c.logo : null, martIds };
  }).sort((a, b) => b.martIds.length - a.martIds.length || a.name.localeCompare(b.name));
}
