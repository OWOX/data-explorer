export type FieldCategory = 'string' | 'number' | 'date' | 'time' | 'boolean' | 'other';

export interface Field {
  name: string;
  alias: string | null;
  type: string;
  category: FieldCategory;
  description: string | null;
  isPrimaryKey: boolean;
  isCalculated?: boolean;
  /** Aggregation governance from the schema: the functions a report may apply to the field (absent: the type's defaults). */
  allowedAggregations?: import('./aggregation').AggFn[];
  /** A joined field only: the functions the join's analyst allows after the join (absent: the type's defaults; [] means none). */
  postJoinAggregations?: import('./aggregation').AggFn[];
  /** Set on a field of a joined data mart: `name` is the blended name a query takes, `alias` the field's label. */
  joined?: { martId: string; /** What the joined mart is called in a column header and in the picker. */ label: string; aliasPath: string; /** The field's name in the joined mart itself (the blended `name` minus the join path). */ originalName?: string; /** The field's type in the joined mart itself; `type` is the type after a pre-join aggregation. */ sourceType?: string; /** The join-level roll-up OWOX applies to this field before the join (SUM, MAX, STRING_AGG ...). */ aggregateFunction?: string };
}

export interface Context { id: string; name: string; icon: string | null }

export interface Mart {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  storageId: string;
  contextIds: string[];
  dataLastUpdatedAt: string | null;
  accessible: boolean;
  /** The key of the source card the mart feeds: a bundled connector's name, or `service:<domain>` for a custom one. Null when the mart is not a CONNECTOR mart. */
  sourceKey: string | null;
  /** The mart's own connector name, set for every connector mart (the source key may stand for a service instead). */
  connectorName?: string;
}

export interface JoinCondition { sourceField: string; targetField: string }
export interface Edge { id: string; source: string; target: string; joins: JoinCondition[] }

export interface Source { key: string; name: string; logo: string | null; martIds: string[] }

export interface Model {
  marts: Map<string, Mart>;
  sources: Source[];
  edges: Edge[];
  contexts: Context[];
  /** Every storage the project lists, whether or not it loaded. */
  storages: { id: string; title: string; type: string }[];
  failedStorages: { id: string; title: string; message: string }[];
}

export interface DqSummary {
  state: string;
  totalChecks?: number;
  notApplicableChecks?: number;
  noticeFindings?: number;
  warningFindings?: number;
  errorFindings?: number;
  highestSeverity?: 'notice' | 'warning' | 'error' | null;
  lastRunAt?: string | null;
}

export type Schema = Field[]; // reporting-visible fields only (hidden ones are dropped), in schema order
