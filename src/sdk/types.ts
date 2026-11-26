// Narrow view of @owox/plugin-sdk's PluginContext. The real context satisfies it structurally.
// Traverse types are copied from @owox/api-client (node_modules/@owox/api-client/dist/data-marts.d.ts).

import type { Experimental_DecisionModel } from 'ai';
import type { AggFn, AggregationRule, DateTruncRule } from '../model/aggregation';

export type RelativeDatePreset =
  | { kind: 'today' } | { kind: 'yesterday' }
  | { kind: 'this_week' } | { kind: 'last_week' }
  | { kind: 'this_month' } | { kind: 'last_month' }
  | { kind: 'this_quarter' } | { kind: 'last_quarter' }
  | { kind: 'this_year' }
  | { kind: 'last_n_days'; n: number } | { kind: 'last_n_months'; n: number };

/** A filter rule of traverseData. A `pre-join` rule narrows a joined mart before the join (a slice); a rule with `function` filters that aggregate after grouping (HAVING). */
export type TraverseFilter = TraverseFilterRule & ({ placement: 'pre-join'; function?: never } | { placement?: 'post-join'; function?: AggFn });

export type TraverseFilterRule =
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
  aggregation?: AggregationRule[];
  dateTrunc?: DateTruncRule[];
  uniqueCount?: string[];
  limit?: number;
  /** Ask OWOX for the row count of the read without its limit; it costs one more warehouse query. */
  includeTotalRowCount?: boolean;
};

export type Row = Record<string, unknown>;

export interface Traversal {
  rowChunks(): AsyncIterable<Row[]>;
  cancel(): Promise<void>;
  /** The run OWOX recorded for this read (`x-owox-run-id`); absent on a host that does not send it. */
  readonly runId?: string;
  /** The row count without the limit; present only when the read asked for it and OWOX could count it. */
  readonly totalRowCount?: number;
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
/** One custom connector from `/api/connectors/custom/summaries`: its API hosts say which service it is a connector of. */
export type ConnectorSummaryDto = { id: string; name: string; title: string; logo: string | null; hosts: string[] };
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
/** The part of a storage's relationships the plugin reads: what a relationship is called and what it means. */
export type RelationshipDto = { id: string; targetAlias?: string | null; description?: string | null };
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
  /** Present on a calculated field. `level` is `metric` (the formula aggregates) or `column` (row-level); a missing or unknown one counts as `metric`, as the backend does. */
  calculated?: { level?: string } | null;
  allowedAggregations?: string[];
  /** The nested fields of a struct field. */
  fields?: SchemaFieldDto[];
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
  /** The join-level roll-up OWOX applies to this field before the join (SUM, MAX, STRING_AGG ...). */
  aggregateFunction?: string;
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
  /** One-to-many: 'none' when every hop is keyed by its parent's primary key, else 'multiplies' or 'unknown'. */
  mainGrainMultiplication?: 'none' | 'multiplies' | 'unknown';
  /** Lookup: 'none' when every hop is keyed by its target's primary key (a main row matches at most one joined row), else 'collapses'. A backend that does not send it means 'collapses'. */
  mainGrainCollapse?: 'none' | 'collapses';
};
export type BlendableSchemaDto = { blendedFields?: BlendedFieldDto[]; availableSources?: AvailableSourceDto[] };
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
/** A report as `GET /api/reports/:id` and the create call return it: the parts the explorer reads, each optional but the id. */
export type ReportDto = {
  id: string; title?: string;
  dataMart?: { id?: string };
  columnConfig?: string[] | null;
  filterConfig?: unknown[] | null;
  sortConfig?: { column: string; direction: 'asc' | 'desc' }[] | null;
  aggregationConfig?: { column: string; function: string }[] | null;
  dateTruncConfig?: { column: string; unit: string; timeZone?: string }[] | null;
  uniqueCountConfig?: boolean | string[] | null;
  dataDestinationAccess?: { id?: string };
  destinationConfig?: { spreadsheetId?: unknown; sheetId?: unknown };
  lastRunAt?: string | null;
  lastRunStatus?: string | null;
  lastRunError?: string | null;
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
/** A decision model handle: answers typed choice, score and boolean questions about one state. */
export type DecisionModel = Exclude<Experimental_DecisionModel, string>;
/** The logical `ai` credential: the handle itself is the fast model, `decision` is there when declared. Absent when no AI is configured. */
export type AiCredential = AiModel & { readonly fast?: AiModel; readonly decision?: DecisionModel };

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
  readonly ui: { openExternal(url: string): Promise<void>; copyLink(path?: string): Promise<void>; setRoute(path: string): void; link(path: string): { href: string } | undefined };
  /** Declared, installation-bound credentials. `ai` is absent until the project maintainer configures it. */
  readonly credentials: { readonly ai?: AiCredential };
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
    deleteJson<T>(path: string): Promise<T>;
  };
}
