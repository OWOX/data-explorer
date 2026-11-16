export type FieldCategory = 'string' | 'number' | 'date' | 'time' | 'boolean' | 'other';

export interface Field {
  name: string;
  alias: string | null;
  type: string;
  category: FieldCategory;
  description: string | null;
  isPrimaryKey: boolean;
  isCalculated?: boolean;
  /** Set on a field of a joined data mart: `name` is the blended name a query takes, `alias` the field's label. */
  joined?: { martId: string; /** What the joined mart is called in a column header and in the picker. */ label: string; aliasPath: string; /** The field's name in the joined mart itself (the blended `name` minus the join path). */ originalName?: string };
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
  /** Connector name when the mart is a CONNECTOR mart, else null. */
  sourceKey: string | null;
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
