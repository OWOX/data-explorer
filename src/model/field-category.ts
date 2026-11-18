import type { FieldCategory } from './types';

const STRING = new Set(['STRING', 'VARCHAR', 'CHAR', 'CHARACTER', 'CHARACTER VARYING', 'NCHAR', 'NVARCHAR', 'NVARCHAR2', 'VARCHAR2', 'TEXT', 'BPCHAR', 'CITEXT', 'CLOB', 'UUID']);
const NUMBER = new Set([
  'INTEGER', 'INT', 'INT2', 'INT4', 'INT8', 'INT64', 'BIGINT', 'SMALLINT', 'TINYINT', 'BYTEINT', 'HUGEINT', 'LONG', 'SHORT', 'BYTE',
  'FLOAT', 'FLOAT4', 'FLOAT8', 'FLOAT64', 'REAL', 'DOUBLE', 'DOUBLE PRECISION',
  'NUMERIC', 'BIGNUMERIC', 'DECIMAL', 'DEC', 'NUMBER', 'BIGDECIMAL', 'SERIAL', 'BIGSERIAL', 'SMALLSERIAL', 'MONEY',
]);
const DATE = new Set([
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITHOUT TIME ZONE', 'TIMESTAMP WITH LOCAL TIME ZONE',
  'TIMESTAMPTZ', 'TIMESTAMP_NTZ', 'TIMESTAMP_LTZ', 'TIMESTAMP_TZ',
]);
const TIME = new Set(['TIME', 'TIME WITH TIME ZONE', 'TIME WITHOUT TIME ZONE', 'TIMETZ']);
const BOOL = new Set(['BOOLEAN', 'BOOL']);

/** A warehouse type in one spelling: trimmed, upper case, single spaces, with a trailing parameter list such as (10,2) or (255) removed. */
export function normalizeType(type: string): string {
  return type
    .trim()
    .toUpperCase()
    .replace(/\s*\([^()]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether the type is a calendar day without a time of day (DATE), as opposed to a moment. */
export const isDayType = (type: string): boolean => normalizeType(type) === 'DATE';

export function categorizeFieldType(type: string): FieldCategory {
  const t = normalizeType(type);
  if (NUMBER.has(t)) return 'number';
  if (STRING.has(t)) return 'string';
  if (DATE.has(t)) return 'date';
  if (TIME.has(t)) return 'time';
  if (BOOL.has(t)) return 'boolean';
  return 'other';
}
