// src/state/join-tree.test.ts
import { expect, test } from 'vitest';
import type { JoinedSource } from '../api/blendable';
import type { Field } from '../model/types';
import { buildJoinTree, chainAfterHover, ghostLevels, joinableUnder, rejoinTargets, subtreePaths } from './join-tree';

const field = (path: string, own: string): Field => ({ name: `${path.replaceAll('.', '__')}__${own}`, alias: own, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: path.split('.').at(-1)!, label: path, aliasPath: path, originalName: own } });
const src = (path: string, martId = path.split('.').at(-1)!): JoinedSource => ({ aliasPath: path, martId, label: martId, depth: path.split('.').length, fields: [field(path, 'name'), field(path, 'n')], uniqueCount: true, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' });
const col = (path: string, own = 'name') => `${path.replaceAll('.', '__')}__${own}`;

// main joins a and b; both join c; c joins d (only under a); b also joins x.
const sources = [src('a'), src('b'), src('a.c'), src('b.c'), src('a.c.d'), src('b.x')].sort((p, q) => p.depth - q.depth);

test('builds the tree from the columns in use, children in column order', () => {
  const t = buildJoinTree('main', ['id', col('b'), col('a'), col('a.c')], sources);
  expect(t.nodes.get('')).toMatchObject({ martId: 'main', parent: null, children: ['b', 'a'] });
  expect(t.nodes.get('a')).toMatchObject({ martId: 'a', parent: '', children: ['a.c'] });
  expect(t.nodes.get('a.c')).toMatchObject({ martId: 'c', parent: 'a', children: [] });
});

test('the marts a path passes through with no column of their own are bare nodes, so the chain shows', () => {
  const t = buildJoinTree('main', ['id', col('a.c.d')], sources);
  expect(t.nodes.get('a')).toMatchObject({ martId: 'a', parent: '', children: ['a.c'], bare: true });
  expect(t.nodes.get('a.c')).toMatchObject({ martId: 'c', parent: 'a', children: ['a.c.d'], bare: true });
  expect(t.nodes.get('a.c.d')).toMatchObject({ parent: 'a.c' });
  expect(t.nodes.get('a.c.d')!.bare).toBeUndefined();
  expect(t.nodes.get('')!.children).toEqual(['a']);
});

test('a middle path the source list does not have is skipped: the path hangs from the deepest ancestor that is a node', () => {
  const t = buildJoinTree('main', ['id', col('a.c.d')], [src('a'), src('a.c.d')]);
  expect(t.nodes.get('a.c.d')).toMatchObject({ parent: 'a' });
  expect(t.nodes.has('a.c')).toBe(false);
});

test('a middle mart with columns is not bare, and keeps its leaf under it', () => {
  const t = buildJoinTree('main', ['id', col('a.c'), col('a.c.d')], sources);
  expect(t.nodes.get('a')).toMatchObject({ bare: true });
  expect(t.nodes.get('a.c')!.bare).toBeUndefined();
  expect(t.nodes.get('a.c')!.children).toEqual(['a.c.d']);
});

test('a mart reached by two in-use paths is a node on each path', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('b.c'), col('a.c')], sources);
  expect([...t.nodes.values()].filter((n) => n.martId === 'c').map((n) => n.path).sort()).toEqual(['a.c', 'b.c']);
  expect(t.nodes.get('a.c')).toMatchObject({ parent: 'a' });
  expect(t.nodes.get('b.c')).toMatchObject({ parent: 'b' });
});

test('subtreePaths lists the node and everything under it', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('a.c'), col('a.c.d'), col('b')], sources);
  expect(subtreePaths(t, 'a')).toEqual(['a', 'a.c', 'a.c.d']);
});

test('ghosts are the sources one hop under a path whose mart is not in the report', () => {
  const t = buildJoinTree('main', ['id', col('a')], sources);
  expect(joinableUnder(t, sources, '').map((s) => s.aliasPath)).toEqual(['b']);
  expect(joinableUnder(t, sources, 'a').map((s) => s.aliasPath)).toEqual(['a.c']);
  expect(joinableUnder(t, sources, 'zzz')).toEqual([]);
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

test('rejoin: a leaf under bare middle marts can move up to the main mart', () => {
  const s4 = [...sources, src('d')].sort((p, q) => p.depth - q.depth);
  const t = buildJoinTree('main', ['id', col('a.c.d')], s4);
  expect(t.nodes.get('a.c.d')).toMatchObject({ parent: 'a.c' });
  expect(rejoinTargets(t, s4, 'a.c.d').map((x) => x.target)).toEqual(['']);
});

test('rejoin: a target with two relations to the mart takes the one the subtree can follow', () => {
  const s5 = [...sources, src('b.c2', 'c'), src('b.c2.d', 'd')].sort((p, q) => p.depth - q.depth);
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('a.c'), col('a.c.d')], s5);
  const r = rejoinTargets(t, s5, 'a.c');
  expect(r.map((x) => x.target)).toEqual(['b']);
  expect([...r[0]!.moves]).toEqual([['a.c', 'b.c2'], ['a.c.d', 'b.c2.d']]);
});

test('ghosts: a mart already in the report on another path is still offered on this path', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('b.c')], sources);
  expect(joinableUnder(t, sources, 'a').map((s) => s.aliasPath)).toEqual(['a.c']);
  expect(joinableUnder(t, sources, 'b').map((s) => s.aliasPath)).toEqual(['b.x']);
});

test('ghosts: a path that is already a node is not offered, and a path is offered once', () => {
  const dup = [...sources, src('a.c')];
  const t = buildJoinTree('main', ['id', col('a')], dup);
  expect(joinableUnder(t, dup, 'a').map((s) => s.aliasPath)).toEqual(['a.c']);
  const t2 = buildJoinTree('main', ['id', col('a'), col('a.c')], dup);
  expect(joinableUnder(t2, dup, 'a')).toEqual([]);
});

test('rejoin: no target when the new path is already a node outside the subtree', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('a.c'), col('b.c')], sources);
  expect(rejoinTargets(t, sources, 'a.c')).toEqual([]);
});

test('rejoin: no target when a rewritten subtree path is already a node outside the subtree', () => {
  const s6 = [...sources, src('b.c.d')].sort((p, q) => p.depth - q.depth);
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('a.c'), col('a.c.d'), col('b.c.d')], s6);
  expect(rejoinTargets(t, s6, 'a.c')).toEqual([]);
});

test('ghost levels follow the chain: each link adds its own joinable marts, and a link that is not offered ends it', () => {
  const t = buildJoinTree('main', ['id'], sources);
  const paths = (chain: string[]) => ghostLevels(t, sources, '', chain).levels.map((l) => [l.from, l.ghosts.map((g) => g.aliasPath)]);
  expect(paths([])).toEqual([['', ['a', 'b']]]);
  expect(paths(['a'])).toEqual([['', ['a', 'b']], ['a', ['a.c']]]);
  expect(paths(['a', 'a.c'])).toEqual([['', ['a', 'b']], ['a', ['a.c']], ['a.c', ['a.c.d']]]);
  expect(ghostLevels(t, sources, '', ['a', 'b.c']).chain).toEqual(['a']);
  expect(ghostLevels(t, sources, 'zzz', ['a'])).toEqual({ levels: [], chain: [] });
  expect(ghostLevels(t, sources, null, [])).toEqual({ levels: [], chain: [] });
});

test('a link that joined the tree drops out of the chain', () => {
  const t = buildJoinTree('main', ['id', col('a')], sources);
  expect(ghostLevels(t, sources, '', ['a']).chain).toEqual([]);
});

test('hovering a ghost makes it the last link of the chain; going back to an earlier level trims what follows', () => {
  expect(chainAfterHover('', [], 'a')).toEqual(['a']);
  expect(chainAfterHover('', ['a'], 'a.c')).toEqual(['a', 'a.c']);
  expect(chainAfterHover('', ['a', 'a.c'], 'b')).toEqual(['b']);
  expect(chainAfterHover('', ['a', 'a.c'], 'a.c.d')).toEqual(['a', 'a.c', 'a.c.d']);
  expect(chainAfterHover('', ['a'], 'zz.q')).toEqual(['a']);
});
