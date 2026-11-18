import type { ConnectorDto, ContextDto, DestinationDto, DqSummaryDto, EdgeDto, Row, SchemaFieldDto, StorageDto } from '../types';

export type MockMart = {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  storageId: string;
  contexts: string[];
  accessible: boolean;
  definitionType: string;
  connectorSourceName: string | null;
  dataLastUpdatedAt: string | null;
  fields: SchemaFieldDto[];
  rows: Row[];
  dq: DqSummaryDto | null;
};

export type Fixtures = {
  storages: StorageDto[];
  contexts: ContextDto[];
  marts: MockMart[];
  edges: EdgeDto[];
  connectors: ConnectorDto[];
  destinations: DestinationDto[];
};

// Fixed reference instant so the data is deterministic.
const NOW = Date.parse('2026-11-14T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

const FIRST = ['Anna', 'Ivan', 'Maria', 'Oleg', 'Sofia', 'Taras', 'Elena', 'Peter', 'Nina', 'Victor'];
const LAST = ['Koval', 'Shevchenko', 'Bondar', 'Melnyk', 'Tkachenko', 'Kravets', 'Boyko', 'Moroz', 'Savchenko', 'Lysenko'];
const COUNTRIES: [string, string][] = [
  ['UA', 'Ukraine'], ['PL', 'Poland'], ['DE', 'Germany'], ['US', 'America'],
  ['GB', 'Britain'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'],
];
const STATUSES = ['new', 'paid', 'shipped', 'delivered', 'cancelled'];
const CITIES: Record<string, string[]> = {
  UA: ['Kyiv', 'Lviv', 'Odesa'], PL: ['Warsaw', 'Krakow', 'Gdansk'], DE: ['Berlin', 'Hamburg', 'Munich'], US: ['Austin', 'Denver', 'Boston'],
  GB: ['London', 'Leeds', 'Bristol'], FR: ['Paris', 'Lyon', 'Nantes'], ES: ['Madrid', 'Valencia', 'Seville'], IT: ['Milan', 'Turin', 'Naples'],
};
const PRODUCT_NAMES = [
  'Merino Wool Sweater', 'Canvas Weekender Bag', 'Ceramic Pour-Over Set', 'Trail Running Shoes', 'Oak Standing Desk', 'Insulated Water Bottle', 'Linen Duvet Cover', 'Noise-Cancelling Headphones',
  'Cast Iron Skillet', 'Waxed Cotton Jacket', 'Bamboo Cutting Board', 'Leather Card Holder', 'Cold Brew Coffee Kit', 'Yoga Mat Pro', 'Desk Lamp Arc', 'Stainless Steel Kettle',
  'Wireless Charging Pad', 'Hiking Backpack 40L', 'Beeswax Candle Trio', 'Knitted Beanie', 'Mechanical Keyboard', 'Travel Pillow Memory', 'Sketchbook A5 Set', 'Copper Mug Pair',
  'Polarized Sunglasses', 'Walnut Phone Stand', 'Organic Cotton Tee', 'French Press 1L', 'Slim Wallet RFID', 'Wool Throw Blanket', 'Fountain Pen Classic', 'Herb Garden Starter',
  'Rain Shell Jacket', 'Ceramic Plant Pot', 'Bluetooth Speaker Mini', 'Cashmere Scarf', 'Chef Knife 20cm', 'Foam Roller Firm', 'Glass Storage Set', 'Pocket Notebook 3-Pack',
];
const STORE_NAMES = ['Flagship', 'Mitte', 'Old Town', 'Riverside', 'Central Station', 'Harbour', 'Market Hall', 'Airport Terminal', 'University', 'Park Avenue'];
const SESSION_SOURCES = ['google-organic-search', 'facebook-paid-social', 'newsletter-autumn-campaign', 'direct-none', 'referral-partner-blog'];

const f = (name: string, type: string, extra: Partial<SchemaFieldDto> = {}): SchemaFieldDto => ({ name, type, ...extra });
const pk = (name = 'id', type = 'INT64') => f(name, type, { isPrimaryKey: true });
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

type Spec = {
  id: string;
  description: string | null;
  fields: SchemaFieldDto[];
  count: number;
  row: (i: number, r: () => number) => Row;
  icon?: string;
  accessible?: boolean;
  connectorSourceName?: string;
};

const pick = (r: () => number, n: number) => Math.floor(r() * n) + 1;
const iso = (ms: number) => new Date(ms).toISOString();
const titleCase = (id: string) =>
  id.split('_').map((w) => (w === 'kpis' ? 'KPIs' : w[0]!.toUpperCase() + w.slice(1))).join(' ');

const specs: Spec[] = [
  {
    id: 'orders', connectorSourceName: 'Shopify', icon: 'orders', count: 450,
    description: 'Customer orders with status, amount and creation time.',
    fields: [pk(), f('customer_id', 'INT64', { alias: 'Customer', description: 'Who placed the order.' }), f('product_id', 'INT64', { alias: 'Product' }), f('store_id', 'INT64', { alias: 'Store' }), f('status', 'STRING'), f('amount', 'NUMERIC', { alias: 'Amount' }), f('created_at', 'TIMESTAMP'), f('is_gift', 'BOOL'), f('acquisition_session_id', 'STRING', { alias: 'Acquisition Session ID', description: 'The web session that brought the buyer.' }), f('net_revenue', 'NUMERIC', { alias: 'Net Revenue', allowedAggregations: ['SUM', 'AVG', 'MIN', 'MAX', 'ANY_VALUE', 'P25', 'P50', 'P75', 'P95'] })],
    row: (i, r) => ({
      id: i,
      customer_id: i === 7 || i === 150 || i === 300 ? null : pick(r, 60),
      product_id: pick(r, 40),
      store_id: pick(r, 30),
      status: STATUSES[pick(r, STATUSES.length) - 1],
      amount: Math.round(r() * 50_000) / 100,
      // Newest first by id: the grid opens newest date first, so the first rows are the lowest ids.
      created_at: iso(NOW - Math.floor((i - 1 + r() * 0.9) * (90 * DAY / 450))),
      is_gift: r() < 0.15,
      acquisition_session_id: `ga4.${1_700_000_000 + i * 1_913}.${1_690_000_000 + i * 7_717}/${SESSION_SOURCES[i % SESSION_SOURCES.length]}/landing-collection-autumn-sale-2026`,
      net_revenue: Math.round(r() * 45_000) / 100,
    }),
  },
  {
    id: 'customers', connectorSourceName: 'Shopify', icon: 'customers', count: 60,
    description: 'People who placed orders, with their home country.',
    fields: [pk(), f('name', 'STRING', { description: 'Full name as given at checkout.' }), f('email', 'STRING'), f('city', 'STRING'), f('country_code', 'STRING', { alias: 'Country' }), f('internal_flag', 'STRING', { isHiddenForReporting: true })],
    row: (i) => {
      const first = FIRST[i % FIRST.length]!;
      const last = LAST[Math.floor(i / FIRST.length) % LAST.length]!;
      const country = COUNTRIES[i % COUNTRIES.length]![0]!;
      return { id: i, name: `${first} ${last}`, email: `${first}.${last}${i}@example.com`.toLowerCase(), city: CITIES[country]![i % 3], country_code: country, internal_flag: i % 7 === 0 ? 'review' : null };
    },
  },
  {
    id: 'products', icon: 'products', count: 40,
    description: 'Catalog of products on sale.',
    fields: [pk(), f('sku', 'STRING', { alias: 'SKU' }), f('title', 'STRING', { alias: 'Name' }), f('category_id', 'INT64', { alias: 'Category' }), f('price', 'NUMERIC')],
    row: (i, r) => ({ id: i, sku: `SKU-${String(1000 + i * 17).padStart(5, '0')}`, title: PRODUCT_NAMES[(i - 1) % PRODUCT_NAMES.length], category_id: pick(r, 30), price: Math.round(r() * 20_000) / 100 }),
  },
  {
    id: 'stores', icon: undefined, count: 30,
    description: null,
    fields: [pk(), f('name', 'STRING'), f('city', 'STRING'), f('country_code', 'STRING', { alias: 'Country' })],
    row: (i) => {
      const country = COUNTRIES[i % COUNTRIES.length]![0]!;
      const city = CITIES[country]![i % 3]!;
      return { id: i, name: `${city} ${STORE_NAMES[i % STORE_NAMES.length]}`, city, country_code: country };
    },
  },
  {
    id: 'order_items', count: 30,
    description: 'Line items belonging to orders.',
    fields: [pk(), f('order_id', 'INT64', { alias: 'Order' }), f('product_id', 'INT64', { alias: 'Product' }), f('quantity', 'INT64'), f('name', 'STRING')],
    row: (i, r) => ({ id: i, order_id: pick(r, 450), product_id: pick(r, 40), quantity: pick(r, 5), name: `Item ${i}` }),
  },
  {
    id: 'returns', connectorSourceName: 'Shopify', count: 30,
    description: 'Returned orders and the reason given.',
    fields: [pk(), f('order_id', 'INT64', { alias: 'Order' }), f('name', 'STRING'), f('reason', 'STRING')],
    row: (i, r) => ({ id: i, order_id: pick(r, 450), name: `Return ${i}`, reason: ['damaged', 'wrong item', 'changed mind'][pick(r, 3) - 1] }),
  },
  {
    id: 'payments', connectorSourceName: 'Shopify', count: 30,
    description: 'Payments received for orders.',
    fields: [pk(), f('order_id', 'INT64', { alias: 'Order' }), f('amount', 'NUMERIC')],
    row: (i, r) => ({ id: i, order_id: pick(r, 450), amount: Math.round(r() * 50_000) / 100 }),
  },
  {
    id: 'shipments', connectorSourceName: 'Shopify', count: 30,
    description: 'Shipments dispatched for orders.',
    fields: [pk(), f('order_id', 'INT64', { alias: 'Order' }), f('name', 'STRING'), f('carrier', 'STRING')],
    row: (i, r) => ({ id: i, order_id: pick(r, 450), name: `Shipment ${i}`, carrier: ['dhl', 'ups', 'novaposhta'][pick(r, 3) - 1] }),
  },
  {
    id: 'countries', icon: 'countries', count: 8,
    description: 'Countries where customers and stores are located.',
    fields: [pk('code', 'STRING'), f('name', 'STRING')],
    row: (i) => ({ code: COUNTRIES[i - 1]![0], name: COUNTRIES[i - 1]![1] }),
  },
  {
    id: 'categories', count: 30,
    description: 'Product categories.',
    fields: [pk(), f('label', 'STRING', { alias: 'Name' })],
    row: (i) => ({ id: i, label: `Category ${i}` }),
  },
  {
    id: 'sessions', connectorSourceName: 'GoogleAnalytics4', icon: 'sessions', count: 30,
    description: 'Website sessions attributed to campaigns.',
    fields: [pk(), f('customer_id', 'INT64', { alias: 'Customer' }), f('campaign_id', 'INT64', { alias: 'Campaign' }), f('name', 'STRING')],
    row: (i, r) => ({ id: i, customer_id: pick(r, 60), campaign_id: pick(r, 30), name: `Session ${i}` }),
  },
  {
    id: 'campaigns', connectorSourceName: 'GoogleAnalytics4', icon: 'campaigns', count: 30,
    description: 'Marketing campaigns.',
    fields: [pk(), f('name', 'STRING')],
    row: (i) => ({ id: i, name: `Campaign ${i}` }),
  },
  {
    id: 'ad_spend', connectorSourceName: 'FacebookAds', icon: 'ad-spend', count: 30,
    description: 'Daily advertising spend per campaign.',
    fields: [pk(), f('campaign_id', 'INT64', { alias: 'Campaign' }), f('name', 'STRING'), f('spend', 'NUMERIC')],
    row: (i, r) => ({ id: i, campaign_id: pick(r, 30), name: `Ad spend ${i}`, spend: Math.round(r() * 100_000) / 100 }),
  },
  {
    id: 'reviews', connectorSourceName: 'FacebookAds', count: 30,
    description: 'Customer reviews of products.',
    fields: [pk(), f('product_id', 'INT64', { alias: 'Product' }), f('title', 'STRING'), f('rating', 'INT64')],
    row: (i, r) => ({ id: i, product_id: pick(r, 40), title: `review ${i}`, rating: pick(r, 5) }),
  },
  {
    id: 'daily_kpis', count: 30,
    description: 'Daily revenue and order totals.',
    fields: [f('day', 'DATE'), f('revenue', 'NUMERIC'), f('orders', 'INT64')],
    row: (i, r) => ({
      day: iso(NOW - (30 - i) * DAY).slice(0, 10),
      revenue: Math.round(r() * 1_000_000) / 100,
      orders: pick(r, 40),
    }),
  },
  {
    id: 'secret_ledger', accessible: false, count: 30,
    description: 'Restricted ledger.',
    fields: [pk(), f('name', 'STRING'), f('note', 'STRING')],
    row: (i) => ({ id: i, name: `Entry ${i}`, note: `entry ${i}` }),
  },
];

const link = (source: string, target: string, sf: string, tf: string): EdgeDto => ({
  id: `e-${source}-${target}`,
  sourceDataMartId: source,
  targetDataMartId: target,
  joinConditions: [{ sourceFieldName: sf, targetFieldName: tf }],
});

const edges: EdgeDto[] = [
  link('orders', 'customers', 'customer_id', 'id'),
  link('orders', 'products', 'product_id', 'id'),
  link('orders', 'stores', 'store_id', 'id'),
  link('order_items', 'orders', 'order_id', 'id'),
  link('order_items', 'products', 'product_id', 'id'),
  link('returns', 'orders', 'order_id', 'id'),
  link('payments', 'orders', 'order_id', 'id'),
  link('shipments', 'orders', 'order_id', 'id'),
  link('customers', 'countries', 'country_code', 'code'),
  link('products', 'categories', 'category_id', 'id'),
  link('stores', 'countries', 'country_code', 'code'),
  link('sessions', 'customers', 'customer_id', 'id'),
  link('sessions', 'campaigns', 'campaign_id', 'id'),
  link('ad_spend', 'campaigns', 'campaign_id', 'id'),
  link('reviews', 'products', 'product_id', 'id'),
];

const contexts: ContextDto[] = [
  { id: 'c-sales', name: 'Sales', description: null, icon: 'revenue' },
  { id: 'c-catalog', name: 'Catalog', description: null, icon: 'products' },
  { id: 'c-marketing', name: 'Marketing', description: null, icon: 'lucide:megaphone' },
];
const contextOf: Record<string, string> = {
  orders: 'c-sales', order_items: 'c-sales', payments: 'c-sales', returns: 'c-sales', daily_kpis: 'c-sales',
  products: 'c-catalog', categories: 'c-catalog', reviews: 'c-catalog',
  sessions: 'c-marketing', campaigns: 'c-marketing', ad_spend: 'c-marketing',
};

const connectors: ConnectorDto[] = [
  { name: 'Shopify', title: 'Shopify' },
  { name: 'GoogleAnalytics4', title: 'Google Analytics 4' },
  { name: 'FacebookAds', title: 'Facebook Ads' },
];

const dqOf: Record<string, DqSummaryDto> = {
  orders: { state: 'PASSED' },
  customers: { state: 'ISSUES', warningFindings: 2 },
  payments: { state: 'EXECUTION_FAILED' },
};
const updatedOf: Record<string, string> = {
  orders: iso(NOW - 2 * HOUR),
  customers: iso(NOW - 3 * DAY),
};

/** The marts that live in the second storage, so the storage filter has something to filter. */
const salesLake = new Set(['payments', 'returns', 'shipments', 'daily_kpis']);

const DESTINATIONS: DestinationDto[] = [
  { id: 'd-sheets-team', title: 'Team Sheets', type: 'GOOGLE_SHEETS', availableForUse: true },
  { id: 'd-sheets-finance', title: 'Finance Sheets', type: 'GOOGLE_SHEETS', availableForUse: true },
  { id: 'd-looker', title: 'Looker Studio', type: 'LOOKER_STUDIO', availableForUse: true },
];

/** `sheets` is how many Google Sheets destinations the project has (the Looker Studio one is always there). */
export function demoFixtures(opts: { sheets?: 0 | 1 | 2 } = {}): Fixtures {
  const sheets = opts.sheets ?? 2;
  const marts: MockMart[] = specs.map((s, idx) => {
    const r = rng(1000 + idx * 97);
    return {
      id: s.id,
      title: titleCase(s.id),
      description: s.description,
      icon: s.icon ?? null,
      storageId: salesLake.has(s.id) ? 's2' : 's1',
      contexts: contextOf[s.id] ? [contextOf[s.id]!] : [],
      accessible: s.accessible ?? true,
      definitionType: s.connectorSourceName ? 'CONNECTOR' : 'SQL',
      connectorSourceName: s.connectorSourceName ?? null,
      dataLastUpdatedAt: updatedOf[s.id] ?? null,
      fields: s.fields,
      rows: range(s.count).map((i) => s.row(i, r)),
      dq: dqOf[s.id] ?? { state: 'NEVER_RUN' },
    };
  });
  return { storages: [{ id: 's1', title: 'Demo Warehouse', type: 'GOOGLE_BIGQUERY' }, { id: 's2', title: 'Sales Lake', type: 'AWS_ATHENA' }], contexts, marts, edges, connectors, destinations: [...DESTINATIONS.slice(0, sheets), DESTINATIONS[2]!] };
}
