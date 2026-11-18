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
  /** Group the rows: a column with a function becomes `"<column> | <TOKEN>"`, every other listed column is a group key. Needs `column`. */
  aggregation?: { column: string; function: 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'COUNT' | 'COUNT_DISTINCT' | 'STRING_AGG' | 'ANY_VALUE' | 'P25' | 'P50' | 'P75' | 'P95' }[];
  dateTrunc?: { column: string; unit: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR'; timeZone?: string }[];
  uniqueCount?: string[];
  limit?: number;
};

export type Row = Record<string, unknown>;

export interface Traversal {
  rowChunks(): AsyncIterable<Row[]>;
  cancel(): Promise<void>;
  /** The run OWOX recorded for this read (`x-owox-run-id`); absent on a host that does not send it. */
  readonly runId?: string;
}

export type StorageDto = { id: string; title: string; type: string };
export type DataMartListItemDto = {
  id: string;
  title: string;
  description: string | null;
  contexts: { id: string; name: string; icon?: string | null }[];
  availableForReporting: boolean;
  definitionType?: string | null;
  connectorSourceName?: string | null;
};
export type ConnectorDto = { name: string; title?: string | null; logo?: unknown };
export type ModelCanvasNodeDto = {
  id: string;
  title: string;
  description: string | null;
  icon?: string | null;
  fieldCount: number;
  status?: string;
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
  status?: string;
  mode?: string;
  calculated?: unknown;
  allowedAggregations?: string[];
};
export type DataMartDetailDto = { id: string; schema?: { fields?: SchemaFieldDto[] } | null };
/** The part of GET /api/data-marts/:id/blendable-schema the plugin reads: the fields of joined data marts and which joins may be offered. */
export type BlendedFieldDto = {
  name: string;
  sourceDataMartId: string;
  sourceDataMartTitle?: string;
  originalFieldName: string;
  type: string;
  /** The raw source type: an array type here makes the field array-valued whatever `type` says. */
  sourceFieldType?: string;
  alias?: string | null;
  description?: string | null;
  isHidden?: boolean;
  isCalculated?: boolean;
  allowedAggregations?: string[];
  /** The functions the join's analyst allows on this field after the join; [] means none. */
  postJoinAggregations?: string[];
  aliasPath: string;
  outputPrefix?: string | null;
  transitiveDepth?: number;
};
export type AvailableSourceDto = {
  aliasPath: string;
  title: string;
  defaultAlias?: string | null;
  depth: number;
  dataMartId: string;
  relationshipId?: string;
  isIncluded: boolean;
  isAccessibleForReporting: boolean;
  /** Whether a uniqueCount on this alias path works: 'available', else why not ('no-primary-key', 'disconnected-primary-key', ...). */
  uniqueCountAvailability?: string;
  mainGrainMultiplication?: 'none' | 'multiplies' | 'unknown';
};
export type BlendableSchemaDto = { blendedFields?: BlendedFieldDto[]; availableSources?: AvailableSourceDto[]; hiddenFieldNames?: string[] };
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

/** A data destination as the list endpoint returns it (the fields the plugin reads). */
export type DestinationDto = { id: string; title: string; type: string; availableForUse?: boolean };

/** The one call the plugin makes on a language model. The SDK's LanguageModelV4 satisfies it structurally. */
export interface AiModel {
  doGenerate(options: {
    prompt: ({ role: 'system'; content: string } | { role: 'user'; content: { type: 'text'; text: string }[] })[];
    responseFormat?: { type: 'json' };
    temperature?: number;
    maxOutputTokens?: number;
    abortSignal?: AbortSignal;
  }): PromiseLike<{ content: { type: string; text?: string }[] }>;
}
/** The logical `ai` credential: the handle itself is the fast model, `reasoning` is there when declared. Absent when no AI is configured. */
export type AiCredential = AiModel & { readonly fast?: AiModel; readonly reasoning?: AiModel };

export interface CollectionLike<T> {
  get(id: string): Promise<{ document: T } | null>;
  put(id: string, document: T): Promise<unknown>;
}

export interface Ctx {
  readonly projectId: string;
  readonly theme: string;
  readonly signal: AbortSignal;
  /** The route the host opened the plugin with; undefined when the host has no page links. */
  readonly route?: string;
  readonly ui: { openExternal(url: string): Promise<void>; copyLink?(path?: string): Promise<void>; setRoute?(path: string): void };
  /** Declared, installation-bound credentials (SDK 0.43); undefined on a host without them. `ai` is absent until the project maintainer configures it. */
  readonly credentials?: { readonly ai?: AiCredential };
  collections<T>(name: string): CollectionLike<T>;
  readonly owox: {
    storages: { list(): Promise<StorageDto[]> };
    models: { getEdges(storageId: string): Promise<EdgeDto[]> };
    dataMarts: {
      list(): Promise<DataMartListItemDto[]>;
      traverseData(id: string, options: TraverseOptions): Promise<Traversal>;
    };
    destinations: { list(): Promise<DestinationDto[]> };
    getJson<T>(path: string, query?: Record<string, string>): Promise<T>;
    postJson<T>(path: string, body: unknown): Promise<T>;
    putJson<T>(path: string, body: unknown): Promise<T>;
  };
}
