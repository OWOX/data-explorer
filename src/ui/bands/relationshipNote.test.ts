import { expect, test } from 'vitest';
import type { Edge } from '../../model/types';
import { aliasWords, edgeOf, isCustomAlias, relationshipNote } from './relationshipNote';

test('an alias is said in words, keeping known acronyms upper-case', () => {
  expect(aliasWords('first_session')).toBe('First session');
  expect(aliasWords('last_session_before_mql')).toBe('Last session before MQL');
  expect(aliasWords('billing_org_id')).toBe('Billing org ID');
  expect(aliasWords('__x__')).toBe('X');
  expect(aliasWords('')).toBe('');
});

test('an alias is custom when it is not the target mart title as an alias', () => {
  expect(isCustomAlias('customers', 'Customers')).toBe(false);
  expect(isCustomAlias('sessions_data', 'Sessions Data')).toBe(false);
  expect(isCustomAlias('first_session', 'Sessions')).toBe(true);
  expect(isCustomAlias(undefined, 'Sessions')).toBe(false);
  expect(isCustomAlias('  ', 'Sessions')).toBe(false);
});

test('a note exists for a custom name or a description, and says the name in words', () => {
  expect(relationshipNote({ alias: 'customers' }, 'Customers')).toBeNull();
  expect(relationshipNote(undefined, 'Customers')).toBeNull();
  expect(relationshipNote({ alias: 'first_session' }, 'Sessions')).toBe('First session');
  expect(relationshipNote({ alias: 'customers', description: 'Who bought' }, 'Customers')).toBe('Who bought');
  expect(relationshipNote({ alias: 'first_session', description: 'How a visit starts' }, 'Sessions')).toBe('First session: How a visit starts');
});

test('the relationship of a line: the one the source names, else the one whose alias ends the path, else the only one', () => {
  const e = (id: string, alias?: string): Edge => ({ id, source: 'c', target: 's', joins: [], ...(alias ? { alias } : {}) });
  const three = [e('r1', 'first_session'), e('r2', 'last_session'), e('r3', 'last_session_before_mql')];
  expect(edgeOf(three, 'c', 's', 'x', 'r2')?.id).toBe('r2');
  expect(edgeOf(three, 'c', 's', 'a.last_session_before_mql')?.id).toBe('r3');
  expect(edgeOf(three, 'c', 's', 'nothing')).toBeUndefined();
  expect(edgeOf([e('only')], 'c', 's', 'whatever')?.id).toBe('only');
  expect(edgeOf(three, 's', 'c', 'first_session')).toBeUndefined();
});
