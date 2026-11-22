import { expect, test } from 'vitest';
import { aliasWords, isCustomAlias, relationshipNote } from './relationshipNote';

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
