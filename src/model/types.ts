export type FieldCategory = 'string' | 'number' | 'date' | 'time' | 'boolean' | 'other';

export interface Field {
  name: string;
  alias: string | null;
  type: string;
  category: FieldCategory;
  description: string | null;
  isPrimaryKey: boolean;
  isCalculated?: boolean;
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

export type Schema = Field[]; // reporting-visible fields only, in schema order
