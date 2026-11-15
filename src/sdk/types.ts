// Narrow view of @owox/plugin-sdk's PluginContext. The real context satisfies it structurally.
// Traverse types are copied from @owox/api-client (tmp/ref/packages_api-client_src_data-marts.ts).

export type RelativeDatePreset =
  | { kind: 'today' } | { kind: 'yesterday' }
  | { kind: 'this_week' } | { kind: 'last_week' }
  | { kind: 'this_month' } | { kind: 'last_month' }
  | { kind: 'this_quarter' } | { kind: 'last_quarter' }
  | { kind: 'this_year' }
  | { kind: 'last_n_days'; n: number } | { kind: 'last_n_months'; n: number };

export type TraverseFilter =
  | { column: string; operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'gt' | 'lt' | 'gte' | 'lte'; value: string | number }
  | { column: string; operator: 'is_blank' | 'is_not_blank' | 'is_true' | 'is_false' }
  | { column: string; operator: 'in' | 'not_in'; value: string[] | number[] }
  | { column: string; operator: 'between'; value: { from: string; to: string } | { from: number; to: number } }
  | { column: string; operator: 'relative_date'; value: RelativeDatePreset };

export type TraverseOptions = {
  columns?: '*';
  column?: string[];
  filter?: TraverseFilter[];
  sort?: { column: string; direction: 'asc' | 'desc' }[];
  aggregation?: { column: string; function: 'COUNT' }[];
  uniqueCount?: string[];
  limit?: number;
};

export type Row = Record<string, unknown>;

export interface Traversal {
  rowChunks(): AsyncIterable<Row[]>;
  cancel(): Promise<void>;
}

export type StorageDto = { id: string; title: string; type: string };
export type DataMartListItemDto = {
  id: string;
  title: string;
  description: string | null;
  contexts: { id: string; name: string; icon?: string | null }[];
  availableForReporting: boolean;
};
export type ModelCanvasNodeDto = {
  id: string;
  title: string;
  description: string | null;
  icon?: string | null;
  fieldCount: number;
  dataLastUpdated?: { dataLastUpdatedAt: string | null; computedAt: string } | null;
};
export type ModelCanvasPageDto = { items: ModelCanvasNodeDto[]; total: number; nextOffset: number | null };
export type EdgeDto = {
  id: string;
  sourceDataMartId: string;
  targetDataMartId: string;
  joinConditions: { sourceFieldName: string; targetFieldName: string }[];
};
export type ContextDto = { id: string; name: string; description: string | null; icon?: string | null };
export type SchemaFieldDto = {
  name: string;
  type: string;
  alias?: string | null;
  description?: string | null;
  isPrimaryKey?: boolean;
  isHiddenForReporting?: boolean;
};
export type DataMartDetailDto = { id: string; schema?: { fields?: SchemaFieldDto[] } | null };
export type DqSummaryDto = {
  state: string;
  totalChecks?: number;
  notApplicableChecks?: number;
  noticeFindings?: number;
  warningFindings?: number;
  errorFindings?: number;
  highestSeverity?: 'notice' | 'warning' | 'error' | null;
  lastRunAt?: string | null;
};
export type DqSummariesResponseDto = { items: { dataMartId: string; summary: DqSummaryDto }[] };

export interface CollectionLike<T> {
  get(id: string): Promise<{ document: T } | null>;
  put(id: string, document: T): Promise<unknown>;
}

export interface Ctx {
  readonly projectId: string;
  readonly theme: string;
  readonly signal: AbortSignal;
  readonly ui: { openExternal(url: string): Promise<void> };
  collections<T>(name: string): CollectionLike<T>;
  readonly owox: {
    storages: { list(): Promise<StorageDto[]> };
    models: { getEdges(storageId: string): Promise<EdgeDto[]> };
    dataMarts: {
      list(): Promise<DataMartListItemDto[]>;
      traverseData(id: string, options: TraverseOptions): Promise<Traversal>;
    };
    getJson<T>(path: string, query?: Record<string, string>): Promise<T>;
    postJson<T>(path: string, body: unknown): Promise<T>;
  };
}
