// The lines between the cards, and the highlight that reads them. Ported from Data Flow's wires.ts.
//
// One absolutely positioned SVG inside the canvas, holding one bezier per pair of boxes, redrawn
// from the live element boxes whenever the layout moves. Four invariants hold it together (Data
// Flow's AGENTS.md, "The wire layer, and what keeps breaking in it"):
//
// 1. One drawn path per pair of boxes, not per wire.
// 2. Every follower is mapped to the path that carries it, never dropped.
// 3. Light after measuring, never before: layout() ends by calling lightAgain.
// 4. What is lit outlives the effect that lit it: the lit paths live in a ref.
//
// `revision` appears in both effects' dependencies and is read in neither body. It is load-bearing:
// it rebuilds the paths when the visible set of cards changes.
import { useEffect, useRef, type RefObject } from 'react';

const NS = 'http://www.w3.org/2000/svg';

/** A small stable number for a string: it changes when the set of cards on the page does. */
export const revisionOf = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return h;
};

export type Wire = {
  id: string;
  /** Element id of the card the line leaves: `src-<key>` or `dm-<martId>`. */
  from: string;
  to: string;
  /** `source` is the blue cross-band line; `relationship` is the grey in-band line. */
  kind: 'source' | 'relationship';
  /** Said in the tooltip: lines pass under cards, so they have to say what they are. */
  title: string;
  /** What the relationship is called and means, when it has a custom name or a description: said first in the tooltip, and a dot on the line's middle says there is something to hover. Wires that share a line (the same two cards) are all said, one after another. */
  note?: string;
  /** A join that can be made but is not yet: drawn dashed, always, at full strength. Solid is a join in the report. */
  dashed?: boolean;
  /** A join in the report (the path): drawn solid, always, at full strength. */
  joined?: boolean;
  /** The closest line of a card in hand: drawn stronger. */
  strong?: boolean;
  /** Always leave the parent's right edge and enter the child's left edge at mid-height, whatever the boxes' vertical gap. */
  sideways?: boolean;
};

/** `also` are the selected joined marts: the line of each to the pinned card is raised like the pinned card's own. */
export type Selection = { pinned: string | null; hovered: string | null; also?: string[] };

export type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

type Direction = 'outbound' | 'inbound';

const NONE: ReadonlySet<string> = new Set();

const LIT_CLASSES = ['lit', 'aside', 'outbound', 'inbound'] as const;

/** Leave each box from the side that faces the other one: down/up across bands, sideways within one. */
function curve(a: Box, b: Box, sideways = false) {
  if (!sideways && (b.top - a.bottom > 8 || a.top - b.bottom > 8)) {
    const down = b.top > a.bottom;
    const x1 = a.left + a.width / 2;
    const y1 = down ? a.bottom : a.top;
    const x2 = b.left + b.width / 2;
    const y2 = down ? b.top : b.bottom;
    const pull = Math.min(70, Math.abs(y2 - y1) / 2 + 12);
    return `M${x1} ${y1} C${x1} ${down ? y1 + pull : y1 - pull} ${x2} ${down ? y2 - pull : y2 + pull} ${x2} ${y2}`;
  }
  const right = sideways || b.left + b.width / 2 > a.left + a.width / 2;
  const x1 = right ? a.right : a.left;
  const x2 = right ? b.left : b.right;
  const y1 = a.top + a.height / 2;
  const y2 = b.top + b.height / 2;
  const pull = Math.max(30, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${right ? x1 + pull : x1 - pull} ${y1} ${right ? x2 - pull : x2 + pull} ${y2} ${x2} ${y2}`;
}

/**
 * Which wire carries which line. `d[i]` is the path data wire i draws, or null when it draws
 * nothing; `lead[i]` is the index of the wire whose path stands for wire i (itself when it draws),
 * or -1 when an end is not on the page. Direction matters: the arrowhead is on one end.
 */
export function planLines(wires: Wire[], boxes: ReadonlyMap<string, Box>) {
  const d: (string | null)[] = [];
  const lead: number[] = [];
  const carrier = new Map<string, number>();
  wires.forEach((wire, i) => {
    const a = boxes.get(wire.from);
    const b = boxes.get(wire.to);
    // An end off the page, or a self-join (a loop on one box): nothing to draw.
    if (!a || !b || wire.from === wire.to) {
      d.push(null);
      lead.push(-1);
      return;
    }
    const key = `${wire.from}>${wire.to}`;
    const held = carrier.get(key);
    if (held !== undefined) {
      d.push(null);
      lead.push(held);
    } else {
      d.push(curve(a, b, wire.sideways));
      lead.push(i);
      carrier.set(key, i);
    }
  });
  return { d, lead };
}

/** The id itself and the other end of each of its wires: what a card in hand lights. */
export function litIds(wires: Wire[], id: string) {
  const lit = new Set([id]);
  for (const wire of wires) {
    if (wire.from === id) lit.add(wire.to);
    else if (wire.to === id) lit.add(wire.from);
  }
  return lit;
}

/**
 * What each wire looks like for a selection, by wire index.
 *
 * A pinned card keeps its lines whatever the pointer does; the hovered card adds its own beside
 * them, faded only while something is pinned. Direction is read from the card in hand: leaving it
 * against arriving at it. The pinned card paints first, so a shared line keeps its reading.
 */
export function paintPlan(wires: Wire[], { pinned, hovered, also = [] }: Selection) {
  const plan = new Map<number, { aside: boolean; direction: Direction }>();
  const paint = (id: string | null, aside: boolean) => {
    if (id === null) return;
    wires.forEach((wire, i) => {
      if (plan.has(i)) return;
      if (wire.from === id) plan.set(i, { aside, direction: 'outbound' });
      else if (wire.to === id) plan.set(i, { aside, direction: 'inbound' });
    });
  };
  paint(pinned, false);
  // A selected joined mart raises only its own line to the pinned (main) mart, not everything it touches.
  for (const id of also) {
    wires.forEach((wire, i) => {
      if (plan.has(i)) return;
      if (wire.from === id && wire.to === pinned) plan.set(i, { aside: false, direction: 'outbound' });
      else if (wire.to === id && wire.from === pinned) plan.set(i, { aside: false, direction: 'inbound' });
    });
  }
  paint(hovered && hovered !== pinned ? hovered : null, pinned !== null);
  return plan;
}

/** The layer: the canvas can render its own; otherwise one is made under `layerId`, with the arrowhead. */
function ensureLayer(canvas: HTMLElement, layerId: string) {
  const existing = canvas.querySelector<SVGSVGElement>(`:scope > #${layerId}`);
  if (existing) return { svg: existing, made: false };
  const svg = document.createElementNS(NS, 'svg');
  svg.id = layerId;
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    `<defs><marker id="arrowhead-${layerId}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0.5 L7 4 L0 7.5 z" fill="context-stroke"/></marker></defs>`;
  canvas.prepend(svg);
  return { svg, made: true };
}

/**
 * @param wires must be referentially stable (memoised): a new array rebuilds every path.
 * @param revision changes whenever the visible set of cards does: the paths are rebuilt and
 *   re-measured from scratch, so a line from a card that has just gone does not hang in mid-air.
 */
export function useWires(
  canvasRef: RefObject<HTMLElement | null>,
  wires: Wire[],
  selection: Selection,
  revision: number,
  layerId = 'wires',
  /** The canvas is drawn with a CSS scale: measured client boxes are divided by it to get the canvas's own pixels. */
  scale = 1,
  /** Element ids of the cards drawn faded: a line arriving at one dims with it. */
  faded: ReadonlySet<string> = NONE,
) {
  /** The drawn lines, kept across a selection change: building belongs to the cards, lighting to the selection. */
  const drawn = useRef<SVGPathElement[]>([]);
  /** The dot of each wire that has a note, by wire index; it sits on the middle of the line that carries the wire. */
  const dots = useRef<(SVGCircleElement | undefined)[]>([]);
  /** Which wire's path carries each wire's line (invariants 1 and 2). */
  const leads = useRef<number[]>([]);
  /** Light again, now that the lines have moved (invariant 3). */
  const lightAgain = useRef(() => {});
  /** The paths currently carrying classes, so putting them out costs their own number (invariant 4). */
  const alight = useRef<SVGPathElement[]>([]);
  const { pinned, hovered } = selection;
  const alsoKey = (selection.also ?? []).join('|');
  const fadedKey = [...faded].sort().join('|');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { svg, made } = ensureLayer(canvas, layerId);

    // Wires between the same two cards share one line (invariant 1): what its relationships are called is told by that line, all of them together.
    const notesOf = new Map<string, string[]>();
    for (const wire of wires) if (wire.note) { const k = `${wire.from}>${wire.to}`; const list = notesOf.get(k) ?? []; if (!list.includes(wire.note)) list.push(wire.note); notesOf.set(k, list); }
    const tipOf = (wire: Wire) => { const notes = notesOf.get(`${wire.from}>${wire.to}`); return notes ? `${notes.join('; ')} · ${wire.title}` : wire.title; };
    const firstOf = new Set<number>();
    const seen = new Set<string>();
    wires.forEach((wire, i) => { const k = `${wire.from}>${wire.to}`; if (!seen.has(k)) { seen.add(k); firstOf.add(i); } });
    const paths = (drawn.current = wires.map((wire) => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', [wire.kind, wire.dashed ? 'ghost' : '', wire.joined ? 'joined' : '', wire.strong ? 'closest' : ''].filter(Boolean).join(' '));
      path.setAttribute('marker-end', `url(#arrowhead-${layerId})`);
      path.dataset.from = wire.from;
      path.dataset.to = wire.to;
      // Read by the canvas, which says it in the shared bubble: a native <title> would be a second tooltip style.
      path.dataset.tip = tipOf(wire);
      svg.append(path);
      return path;
    }));
    // The dot follows its line's opacity (the sibling rules in bands.css) and is the only part of a line that takes the pointer while it is faint.
    const marks = (dots.current = wires.map((wire, i) => {
      if (!firstOf.has(i) || !notesOf.has(`${wire.from}>${wire.to}`)) return undefined;
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('class', 'dm-wire-dot');
      dot.setAttribute('r', '4');
      dot.setAttribute('display', 'none');
      dot.dataset.tip = tipOf(wire);
      paths[i]!.after(dot);
      return dot;
    }));
    alight.current = [];
    leads.current = [];

    const layout = () => {
      const origin = canvas.getBoundingClientRect();
      const boxes = new Map<string, Box>();
      for (const wire of wires) {
        for (const id of [wire.from, wire.to]) {
          if (boxes.has(id)) continue;
          const el = document.getElementById(id);
          // A card in a folded band is hidden, not gone: it has no box to draw to.
          if (!el || !canvas.contains(el) || el.closest('[hidden]')) continue;
          const r = el.getBoundingClientRect();
          boxes.set(id, {
            left: (r.left - origin.left) / scale,
            right: (r.right - origin.left) / scale,
            top: (r.top - origin.top) / scale,
            bottom: (r.bottom - origin.top) / scale,
            width: r.width / scale,
            height: r.height / scale,
          });
        }
      }
      const { d, lead } = planLines(wires, boxes);
      leads.current = lead;
      paths.forEach((path, i) => {
        const data = d[i];
        if (data) path.setAttribute('d', data);
        else {
          path.removeAttribute('d');
          path.classList.remove(...LIT_CLASSES);
        }
        const dot = marks[i];
        if (!dot) return;
        if (data && typeof path.getTotalLength === 'function') {
          const mid = path.getPointAtLength(path.getTotalLength() / 2);
          dot.setAttribute('cx', String(mid.x));
          dot.setAttribute('cy', String(mid.y));
          dot.removeAttribute('display');
        } else {
          // A line with no box has no middle: the dot is not drawn (an unplaced circle would sit at the canvas corner).
          dot.removeAttribute('cx');
          dot.removeAttribute('cy');
          dot.setAttribute('display', 'none');
        }
      });
      watch();
      lightAgain.current();
    };

    // Fires on first paint, on resize, when the webfont lands, and when a band folds (the canvas
    // and the band change height). Grids come and go with a fold, so what is watched is refreshed.
    const observer = new ResizeObserver(layout);
    const watched = new Set<Element>();
    const watch = () => {
      for (const el of [canvas, ...canvas.querySelectorAll('[data-band], .dm-band-grid')]) {
        if (watched.has(el)) continue;
        watched.add(el);
        observer.observe(el);
      }
    };
    watch();

    // A card growing back out of a point (.dm-entering, .dm-turning) is transformed, which
    // getBoundingClientRect reports and ResizeObserver never does: one pass after the last
    // animation ends, folded into a frame so many endings cost one. A cut-short one counts too:
    // transitions.ts takes the class off on a timer as long as the turn itself, so the turn is
    // often cancelled and only animationcancel fires. Without it a line kept the turn's first-frame
    // box, where perspective lifts the card's top edge, and stopped short of the card.
    let queued = 0;
    const settle = () => {
      queued ||= requestAnimationFrame(() => {
        queued = 0;
        layout();
      });
    };
    canvas.addEventListener('animationend', settle);
    canvas.addEventListener('animationcancel', settle);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(queued);
      canvas.removeEventListener('animationend', settle);
      canvas.removeEventListener('animationcancel', settle);
      for (const path of paths) path.remove();
      for (const dot of marks) dot?.remove();
      if (made) svg.remove();
    };
  }, [canvasRef, wires, revision, layerId, scale]);

  /**
   * Lighting, over the lines the effect above drew. `revision` is in the dependencies and read
   * nowhere in the body: `drawn.current` is captured here, and the effect above replaces it
   * whenever `revision` changes.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paths = drawn.current;

    const focus = () => {
      // The carrier path's target is the card it dims with; a follower has no path of its own to dim.
      const dim = new Set(fadedKey ? fadedKey.split('|') : []);
      wires.forEach((wire, i) => paths[i]?.classList.toggle('faded', dim.has(wire.to)));
      for (const path of alight.current) path.classList.remove(...LIT_CLASSES);
      alight.current = [];
      const on = new Set<SVGPathElement>();
      for (const [i, look] of paintPlan(wires, { pinned, hovered, also: alsoKey ? alsoKey.split('|') : [] })) {
        const line = paths[leads.current[i] ?? -1];
        if (!line || on.has(line)) continue;
        on.add(line);
        line.classList.add('lit', look.direction);
        if (look.aside) line.classList.add('aside');
        alight.current.push(line);
      }
    };
    lightAgain.current = focus;
    focus();

    return () => {
      lightAgain.current = () => {};
    };
  }, [canvasRef, wires, revision, pinned, hovered, alsoKey, fadedKey]);
}
