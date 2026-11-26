import type { JoinedSource } from '../../api/blendable';
import type { Model } from '../../model/types';
import { parentPath, shortestSource } from '../../state/join-plan';
import type { JoinTree } from '../../state/join-tree';
import { martElementId, sourceElementId } from './cards';
import { edgeOf, edgeOutputAlias, joinAlias, noteFields, relationshipNote } from './relationshipNote';
import type { Wire } from './wires';

/** What the lines between the cards are drawn from. */
type BandWiresInput = {
  idsKey: string;
  model: Model;
  canvasTree: JoinTree | null;
  view: string;
  focusGhosts: JoinedSource[];
  joinSources: JoinedSource[] | null | undefined;
  own: (martId: string, path: string) => string | undefined;
  focus: string | null;
  joinableAt: Map<string, JoinedSource>;
};

/** The lines between the cards: each mart to its source, the report's joins, the focused card's dashed offers, and the other edges between marts. */
export function bandWires({ idsKey, model, canvasTree, view, focusGhosts, joinSources, own, focus, joinableAt }: BandWiresInput): Wire[] {
  const ids = idsKey ? idsKey.split('|') : [];
  const shown = new Set(ids);
  const known = new Set(model.sources.map((s) => s.key));
  const out: Wire[] = [];
  const nodes = canvasTree ? [...canvasTree.nodes.values()] : [];
  const inReport = new Set(nodes.map((n) => n.martId));
  const targets = view === 'canvas' ? nodes.map((n) => ({ id: n.martId, path: n.path })) : [
    ...nodes.filter((n) => shown.has(n.martId)).map((n) => ({ id: n.martId, path: n.path })),
    ...ids.filter((id) => !inReport.has(id)).map((id) => ({ id, path: '' })),
    ...focusGhosts.map((s) => ({ id: s.martId, path: s.aliasPath })),
  ];
  for (const { id, path } of targets) {
    const mart = model.marts.get(id);
    if (mart?.sourceKey && known.has(mart.sourceKey)) {
      out.push({ id: `source:${mart.sourceKey}>${id}${path ? `@${path}` : ''}`, from: sourceElementId(mart.sourceKey), to: martElementId(id, path || undefined), kind: 'source', title: `${model.sources.find((s) => s.key === mart.sourceKey)?.name ?? mart.sourceKey} → ${mart.title}` });
    }
  }
  if (view === 'canvas') return out;
  // Report cards are joined parent to child along the paths in use; the other edges stay between the marts.
  for (const n of nodes) {
    if (n.parent === null || !shown.has(n.martId)) continue;
    const parent = canvasTree!.nodes.get(n.parent)!;
    if (!shown.has(parent.martId)) continue;
    const src = joinSources?.find((x) => x.aliasPath === n.path);
    const edge = edgeOf(model.edges, parent.martId, n.martId, n.path, src?.relationshipId);
    const note = relationshipNote(edge, model.marts.get(n.martId)?.title ?? '', joinAlias(src?.outputAlias, model.marts.get(n.martId)?.title ?? '', parent.martId, parent.path, n.path, own));
    out.push({ id: `tree:${n.path}`, from: martElementId(parent.martId, parent.path || undefined), to: martElementId(n.martId, n.path), kind: 'relationship', ...noteFields(note), joined: true });
  }
  // The relationships a dashed line already stands for, per pair of cards: the plain edge between the same two cards would name one a second time.
  const claimed = new Set<string>();
  const claimKey = (edgeId: string, from: string, to: string) => `${edgeId}|${from}|${to}`;
  const claim = (edge: { id: string } | undefined, from: string, to: string) => { if (edge) claimed.add(claimKey(edge.id, from, to)); };
  // The focused card offers the marts it can take: a dashed line to each, the band cards and the ghosts alike.
  const focusNode = focus === null ? undefined : canvasTree?.nodes.get(focus);
  if (focusNode && shown.has(focusNode.martId)) {
    const from = martElementId(focusNode.martId, focusNode.path || undefined);
    const name = (id: string) => model.marts.get(id)?.title ?? id;
    // A dashed line names its relationship like a solid one, so the second relationship to a mart gets its own dot.
    const noteOfGhost = (parentId: string, source: JoinedSource, to: string) => {
      const edge = edgeOf(model.edges, parentId, source.martId, source.aliasPath, source.relationshipId);
      claim(edge, from, to);
      return relationshipNote(edge, name(source.martId), joinAlias(source.outputAlias, name(source.martId), parentId, focusNode.path, source.aliasPath, own));
    };
    for (const [id, source] of joinableAt) { const note = noteOfGhost(focusNode.martId, source, martElementId(id)); out.push({ id: `ghost:${id}@${source.aliasPath}`, from, to: martElementId(id), kind: 'relationship', ...noteFields(note), dashed: true }); }
    for (const source of focusGhosts) { const note = noteOfGhost(focusNode.martId, source, martElementId(source.martId, source.aliasPath)); out.push({ id: `ghost:${source.aliasPath}`, from, to: martElementId(source.martId, source.aliasPath), kind: 'relationship', ...noteFields(note), dashed: true }); }
  }
  // A report mart's own card: the main one, or the first path it is joined at.
  const cardOf = (id: string) => { const n = nodes.find((x) => x.martId === id); return n ? martElementId(id, n.path || undefined) : martElementId(id); };
  // Every shown mart outside the report gets one dashed line, drawn at once: from the last hop of its shortest chain to the report,
  // which is a card of the report or another outside mart. A band card the focused card can take has its line from that card instead.
  if (joinSources) {
    const inUse = new Set(nodes.map((n) => n.path));
    const outside = (path: string) => { const id = joinSources.find((x) => x.aliasPath === path)?.martId; return id !== undefined && shown.has(id) && !inReport.has(id) ? id : null; };
    const hopCard = (path: string): string => {
      for (let p = path; ; p = parentPath(p)) {
        const node = canvasTree!.nodes.get(p);
        if (node) return martElementId(node.martId, node.path || undefined);
        const id = p === '' ? null : outside(p);
        if (id !== null) return martElementId(id);
        if (p === '') return martElementId(canvasTree!.nodes.get('')!.martId);
      }
    };
    const name = (id: string) => model.marts.get(id)?.title ?? id;
    for (const id of ids) {
      if (inReport.has(id) || (focus !== null && joinableAt.has(id)) || !model.marts.get(id)?.accessible) continue;
      const source = shortestSource(joinSources, id, inUse);
      if (!source) continue;
      const parent = parentPath(source.aliasPath);
      const parentMart = canvasTree!.nodes.get(parent)?.martId ?? joinSources.find((x) => x.aliasPath === parent)?.martId;
      // These lines are drawn for every band card at once, so they say the main mart's alias (or the title) and read no other mart's settings.
      const edge = parentMart ? edgeOf(model.edges, parentMart, id, source.aliasPath, source.relationshipId) : undefined;
      const from = hopCard(parent);
      claim(edge, from, martElementId(id));
      const note = relationshipNote(edge, name(id), source.outputAlias);
      out.push({ id: `ghost:${source.aliasPath}@band`, from, to: martElementId(id), kind: 'relationship', ...noteFields(note), dashed: true });
    }
  }
  // The other edges between marts stay plain: dashed, and drawn when a card on one is lit.
  for (const e of model.edges) {
    if (!shown.has(e.source) || !shown.has(e.target) || (inReport.has(e.source) && inReport.has(e.target))) continue;
    if (claimed.has(claimKey(e.id, cardOf(e.source), cardOf(e.target)))) continue;
    const fromPath = inReport.has(e.source) ? nodes.find((x) => x.martId === e.source)?.path : undefined;
    // A band card has no path of its own: the line follows the dashed line to the target, which uses the shortest source.
    const band = fromPath === undefined && !inReport.has(e.target) && joinSources ? shortestSource(joinSources, e.target, new Set(nodes.map((n) => n.path))) : undefined;
    const outputAlias = edgeOutputAlias(e, model.marts.get(e.target)?.title ?? '', joinSources ?? [], fromPath, band);
    const note = relationshipNote(e, model.marts.get(e.target)?.title ?? '', outputAlias);
    out.push({ id: `edge:${e.id}`, from: cardOf(e.source), to: cardOf(e.target), kind: 'relationship', ...noteFields(note) });
  }
  return out;
}
