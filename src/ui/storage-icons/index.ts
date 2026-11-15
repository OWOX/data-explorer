// Storage marks, vendored verbatim from owox-data-marts/apps/web/src/shared/icons (as in Data Flow),
// so the filter shows the same glyphs the host does. Self-contained SVGs: nothing to keep in sync.
import { Database } from 'lucide-react';
import { AwsAthenaIcon } from './aws-athena-icon';
import { AwsRedshiftIcon } from './aws-redshift-icon';
import { AzureSynapseIcon } from './azure-synapse-icon';
import { DatabricksIcon } from './databricks-icon';
import { GoogleBigQueryIcon } from './google-bigquery-icon';
import { LegacyGoogleBigQueryIcon } from './legacy-google-bigquery-icon';
import { SnowflakeIcon } from './snowflake-icon';

/** Everything in a menu row is drawn at one size, so `size` is all a mark has to accept. */
export type Mark = (props: { size?: number; className?: string }) => React.ReactNode;

const STORAGE: Record<string, Mark> = {
  GOOGLE_BIGQUERY: GoogleBigQueryIcon,
  LEGACY_GOOGLE_BIGQUERY: LegacyGoogleBigQueryIcon,
  AWS_ATHENA: AwsAthenaIcon,
  AWS_REDSHIFT: AwsRedshiftIcon,
  SNOWFLAKE: SnowflakeIcon,
  DATABRICKS: DatabricksIcon,
  AZURE_SYNAPSE: AzureSynapseIcon,
};

/** The mark of a storage type; a type this plugin does not know gets the generic database glyph. */
export const storageMark = (type: string): Mark => STORAGE[type] ?? Database;
