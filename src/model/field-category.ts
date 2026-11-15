import type { FieldCategory } from './types';

const STRING = new Set(['STRING', 'VARCHAR', 'CHAR', 'TEXT', 'BPCHAR']);
const NUMBER = new Set(['INTEGER', 'INT', 'INT64', 'BIGINT', 'SMALLINT', 'TINYINT', 'FLOAT', 'FLOAT64', 'REAL', 'DOUBLE', 'DOUBLE PRECISION', 'NUMERIC', 'BIGNUMERIC', 'DECIMAL']);
const DATE = new Set(['DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ', 'TIMESTAMP_NTZ']);
const TIME = new Set(['TIME', 'TIME WITH TIME ZONE', 'TIMETZ']);
const BOOL = new Set(['BOOLEAN', 'BOOL']);

export function categorizeFieldType(type: string): FieldCategory {
  const t = type.trim().toUpperCase();
  if (NUMBER.has(t)) return 'number';
  if (STRING.has(t)) return 'string';
  if (DATE.has(t)) return 'date';
  if (TIME.has(t)) return 'time';
  if (BOOL.has(t)) return 'boolean';
  return 'other';
}
