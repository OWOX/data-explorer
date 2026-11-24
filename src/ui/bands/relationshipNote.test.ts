import { expect, test } from 'vitest';
import type { Edge } from '../../model/types';
import type { JoinedSource } from '../../api/blendable';
import { aliasWords, customOutputAlias, edgeOutputAlias, edgeOf, isCustomAlias, relationshipNote } from './relationshipNote';

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

test('the Output Alias names the relationship as typed, over the technical alias', () => {
  expect(relationshipNote({ alias: 'session_entity_new_sql' }, 'Session', 'Last Session')).toBe('Last Session');
  expect(relationshipNote({ alias: 'first_session', description: 'How a visit starts' }, 'Session', 'First Session')).toBe('First Session: How a visit starts');
  expect(relationshipNote(undefined, 'Session', 'Last Session')).toBe('Last Session');
});

test('an Output Alias equal to the target title, or empty, falls back to the technical alias', () => {
  expect(relationshipNote({ alias: 'first_session' }, 'Session', '  session ')).toBe('First session');
  expect(relationshipNote({ alias: 'first_session' }, 'Session', '')).toBe('First session');
  expect(relationshipNote({ alias: 'first_session' }, 'Session', null)).toBe('First session');
  expect(relationshipNote({ alias: 'session' }, 'Session', 'Session')).toBeNull();
  expect(customOutputAlias(' Last Session ', 'Session')).toBe('Last Session');
  expect(customOutputAlias('SESSION', ' session')).toBe('');
});

const joined = (aliasPath: string, outputAlias?: string, relationshipId = 'e1') => ({ aliasPath, relationshipId, ...(outputAlias ? { outputAlias } : {}) }) as unknown as JoinedSource;

test('an edge line takes the Output Alias of the source under the card it leaves', () => {
  const sources = [joined('a.s', 'Alpha'), joined('b.s', 'Beta')];
  expect(edgeOutputAlias({ id: 'e1' }, 'S', sources, 'b', sources[0])).toBe('Beta');
  expect(edgeOutputAlias({ id: 'e1' }, 'S', sources, 'a', undefined)).toBe('Alpha');
  expect(edgeOutputAlias({ id: 'e1' }, 'S', sources, '', undefined)).toBeUndefined();
  // The source under the leaving card decides even with no Output Alias: the band source and agreement are not asked.
  const bare = [joined('a.s'), joined('b.s', 'Beta'), joined('c.s', 'Beta')];
  expect(edgeOutputAlias({ id: 'e1' }, 'S', bare, 'a', bare[1])).toBeUndefined();
  // A source of the main card hangs off the empty path.
  expect(edgeOutputAlias({ id: 'e1' }, 'S', [joined('s', 'Main'), joined('b.s', 'Beta')], '', undefined)).toBe('Main');
});

test('an edge line from a card outside the report takes the band ghost source when it is of this relationship', () => {
  const sources = [joined('a.s', 'Alpha'), joined('b.s', 'Beta')];
  expect(edgeOutputAlias({ id: 'e1' }, 'S', sources, undefined, sources[1])).toBe('Beta');
  expect(edgeOutputAlias({ id: 'e1' }, 'S', sources, undefined, joined('c.s', 'Gamma', 'other'))).toBeUndefined();
});

test('with neither, an edge line takes an Output Alias only when every source of the relationship agrees', () => {
  expect(edgeOutputAlias({ id: 'e1' }, 'S', [joined('a.s', 'Alpha'), joined('b.s', 'Alpha')], undefined, undefined)).toBe('Alpha');
  expect(edgeOutputAlias({ id: 'e1' }, 'S', [joined('a.s', 'Alpha'), joined('b.s', 'Beta')], undefined, undefined)).toBeUndefined();
  expect(edgeOutputAlias({ id: 'e1' }, 'S', [joined('a.s', 'Alpha'), joined('b.s')], undefined, undefined)).toBeUndefined();
  expect(edgeOutputAlias({ id: 'e1' }, 'S', [joined('a.s', 'Alpha'), joined('x.s', 'Zed', 'other')], undefined, undefined)).toBe('Alpha');
  expect(edgeOutputAlias({ id: 'e1' }, 'S', [], undefined, undefined)).toBeUndefined();
  // An alias equal to the target title is no alias: it disagrees with a real one.
  expect(edgeOutputAlias({ id: 'e1' }, 'S', [joined('a.s', 'Alpha'), joined('b.s', 'S')], undefined, undefined)).toBeUndefined();
});
