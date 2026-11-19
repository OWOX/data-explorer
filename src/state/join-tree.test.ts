// src/state/join-tree.test.ts
import { expect, test } from 'vitest';
import type { JoinedSource } from '../api/blendable';
import type { Field } from '../model/types';
import { buildJoinTree, ghostSources, rejoinTargets, subtreePaths } from './join-tree';

const field = (path: string, own: string): Field => ({ name: `${path.replaceAll('.', '__')}__${own}`, alias: own, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: path.split('.').at(-1)!, label: path, aliasPath: path, originalName: own } });
const src = (path: string, martId = path.split('.').at(-1)!): JoinedSource => ({ aliasPath: path, martId, label: martId, depth: path.split('.').length, fields: [field(path, 'name'), field(path, 'n')], uniqueCount: true });
const col = (path: string, own = 'name') => `${path.replaceAll('.', '__')}__${own}`;

// main joins a and b; both join c; c joins d (only under a); b also joins x.
const sources = [src('a'), src('b'), src('a.c'), src('b.c'), src('a.c.d'), src('b.x')].sort((p, q) => p.depth - q.depth);

test('builds the tree from the columns in use, children in column order', () => {
  const t = buildJoinTree('main', ['id', col('b'), col('a'), col('a.c')], sources);
  expect(t.nodes.get('')).toMatchObject({ martId: 'main', parent: null, children: ['b', 'a'] });
  expect(t.nodes.get('a')).toMatchObject({ martId: 'a', parent: '', children: ['a.c'] });
  expect(t.nodes.get('a.c')).toMatchObject({ martId: 'c', parent: 'a', children: [] });
});

test('a path whose parent is not in use hangs from the deepest in-use ancestor, else the main mart', () => {
  const t = buildJoinTree('main', ['id', col('a.c.d')], sources);
  expect(t.nodes.get('a.c.d')).toMatchObject({ parent: '' });
  expect(t.nodes.get('')!.children).toEqual(['a.c.d']);
});

test('a mart reached by two in-use paths is placed once: the shallowest, ties to the first in column order', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('b.c'), col('a.c')], sources);
  expect([...t.nodes.values()].filter((n) => n.martId === 'c').map((n) => n.path)).toEqual(['b.c']);
});

test('subtreePaths lists the node and everything under it', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('a.c'), col('a.c.d'), col('b')], sources);
  expect(subtreePaths(t, 'a')).toEqual(['a', 'a.c', 'a.c.d']);
});

test('ghosts are the sources one hop under a path whose mart is not in the report', () => {
  const t = buildJoinTree('main', ['id', col('a')], sources);
  expect(ghostSources(t, sources, '').map((s) => s.aliasPath)).toEqual(['b']);
  expect(ghostSources(t, sources, 'a').map((s) => s.aliasPath)).toEqual(['a.c']);
  expect(ghostSources(t, sources, 'zzz')).toEqual([]);
});

test('rejoin: c under a can move under b; not onto a (its parent), c itself or main (no depth-1 c)', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('a.c')], sources);
  const r = rejoinTargets(t, sources, 'a.c');
  expect(r.map((x) => x.target)).toEqual(['b']);
  expect([...r[0]!.moves]).toEqual([['a.c', 'b.c']]);
});

test('rejoin: the subtree must follow; with a.c.d in use, b is no target because b.c.d does not exist', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('a.c'), col('a.c.d')], sources);
  expect(rejoinTargets(t, sources, 'a.c')).toEqual([]);
});

test('rejoin: a node under the dragged one is never a target', () => {
  const s2 = [...sources, src('a.c.b', 'b2')];
  const t = buildJoinTree('main', ['id', col('a'), col('a.c'), col('a.c.b')], s2);
  expect(rejoinTargets(t, s2, 'a').map((x) => x.target)).toEqual([]);
});

test('rejoin: the main mart is a target when the mart has a depth-1 source', () => {
  const s3 = [...sources, src('c')].sort((p, q) => p.depth - q.depth);
  const t = buildJoinTree('main', ['id', col('a'), col('a.c')], s3);
  expect(rejoinTargets(t, s3, 'a.c').map((x) => x.target)).toEqual(['']);
});

test('the main mart cannot be dragged', () => {
  const t = buildJoinTree('main', ['id', col('a')], sources);
  expect(rejoinTargets(t, sources, '')).toEqual([]);
});
