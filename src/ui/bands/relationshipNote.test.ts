import { expect, test } from 'vitest';
import type { Edge } from '../../model/types';
import type { JoinedSource } from '../../api/blendable';
import { customOutputAlias, edgeOutputAlias, edgeOf, relationshipNote } from './relationshipNote';

test('a line is named by its Output Alias, else the target title, and is marked only for a set alias or a description', () => {
  expect(relationshipNote(undefined, 'Customers')).toEqual({ name: 'Customers', marked: false });
  expect(relationshipNote({ description: 'Who bought' }, 'Customers')).toEqual({ name: 'Customers', about: 'Who bought', marked: true });
  expect(relationshipNote({ description: 'How a visit starts' }, 'Session', 'First Session')).toEqual({ name: 'First Session', about: 'How a visit starts', marked: true });
  expect(relationshipNote(undefined, 'Session', 'Last Session')).toEqual({ name: 'Last Session', marked: true });
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

test('an Output Alias equal to the target title, or empty, is not a set alias: the line says the title', () => {
  expect(relationshipNote(undefined, 'Session', '  session ')).toEqual({ name: 'Session', marked: false });
  expect(relationshipNote(undefined, 'Session', '')).toEqual({ name: 'Session', marked: false });
  expect(relationshipNote(undefined, 'Session', null)).toEqual({ name: 'Session', marked: false });
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
