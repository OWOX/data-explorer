// The test runner drops CSS files from the module graph, so the stylesheet is read from disk; the project has no Node types.
// @ts-expect-error TS2591: no @types/node
import { readFileSync } from 'node:fs';

const read = readFileSync as (path: string, enc: 'utf8') => string;
const css = read('src/ui/bands/bands.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (selector: RegExp) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => selector.test(m[1]!.trim())).map((m) => m[2]!);

test('hover and pressed no longer draw a 2px overlay on a card', () => {
  expect(css).not.toMatch(/\.dm-node::after/);
  expect(css).not.toMatch(/\.dm-node:hover::after/);
});

test('only the selected card has a 2px border, and it keeps its size', () => {
  const sel = rules(/^\.dm-node\[data-focused\],/).join(' ');
  expect(sel).toContain('border-width: 2px');
  expect(sel).toContain('padding: calc(0.75rem - 1px)');
  expect(rules(/^\.dm-node:hover/).join(' ')).not.toContain('border-width');
});

test('a selected card shows its border instead of the keyboard ring', () => {
  expect(rules(/^\.dm-node\[data-focused\]:focus-visible/).join(' ')).toContain('box-shadow: none');
  expect(rules(/^\.dm-node:focus-visible$/).join(' ')).toContain('box-shadow');
});

test('full screen keeps the band corners of the normal mode', () => {
  const full = rules(/^\.dm-full #band-data$/).join(' ');
  expect(full).toContain('position: fixed');
  expect(full).not.toContain('border-radius');
});

test('the context badges sit at the right end of the card foot', () => {
  expect(rules(/^\.dm-contexts$/).join(' ')).toContain('justify-content: flex-end');
});

test('the filter menu is drawn as Data Flow\'s: its frame, a boxed checkbox, a hairline under the header', () => {
  const menu = rules(/^\.dm-filter-menu$/).join(' ');
  expect(menu).toContain('min-width: 12rem');
  expect(menu).toContain('max-height: 18rem');
  expect(rules(/^\.dm-filter-menu \.dm-checklist-check$/).join(' ')).toContain('border-radius: 0.25rem');
  expect(rules(/^\.dm-filter-menu \.dm-checklist-top$/).join(' ')).toContain('border-bottom: 1px solid var(--border)');
  // Not the Sheets blue.
  expect(rules(/^\.dm-filter-menu \.dm-checklist-link$/).join(' ')).not.toContain('sheet-link');
});
