import { blockOf, selectionTsv } from './copySelection';

const grid = [['a1', 'b1', 'c1'], ['a2', 'b2', 'c2'], ['a3', 'b3', 'c3']];
const read = { cell: (r: number, c: number) => grid[r]![c]!, header: (c: number) => `H${c}` };
const size = { rows: 3, cols: 3 };

test('a cell is its text alone', () => {
  expect(selectionTsv({ kind: 'cell', row: 1, col: 2 }, size, read)).toBe('c2');
});

test('a block is rows by newline and cells by tab, whichever corner it was dragged from', () => {
  expect(selectionTsv({ kind: 'cell', row: 0, col: 0, to: { row: 1, col: 1 } }, size, read)).toBe('a1\tb1\na2\tb2');
  expect(selectionTsv({ kind: 'cell', row: 2, col: 2, to: { row: 1, col: 0 } }, size, read)).toBe('a2\tb2\tc2\na3\tb3\tc3');
});

test('a whole column starts with its title; a range of columns too', () => {
  expect(selectionTsv({ kind: 'col', from: 1, to: 1 }, size, read)).toBe('H1\nb1\nb2\nb3');
  expect(selectionTsv({ kind: 'col', from: 2, to: 0 }, size, read)).toBe('H0\tH1\tH2\na1\tb1\tc1\na2\tb2\tc2\na3\tb3\tc3');
});

test('a whole row is that row\'s cells, with no title', () => {
  expect(selectionTsv({ kind: 'row', from: 1, to: 1 }, size, read)).toBe('a2\tb2\tc2');
  expect(selectionTsv({ kind: 'row', from: 0, to: 1 }, size, read)).toBe('a1\tb1\tc1\na2\tb2\tc2');
});

test('nothing to copy from an empty grid', () => {
  expect(blockOf({ kind: 'cell', row: 0, col: 0 }, 0, 3)).toBeNull();
  expect(selectionTsv({ kind: 'cell', row: 0, col: 0 }, { rows: 0, cols: 3 }, read)).toBeNull();
});

it('guards a cell a spreadsheet would run as a formula', () => {
  const tsv = selectionTsv({ kind: 'cell', row: 0, col: 0, to: { row: 0, col: 1 } }, { rows: 1, cols: 2 }, { cell: (_r, c) => ['=HYPERLINK("x")', '-12.5'][c]!, header: () => '' });
  expect(tsv).toBe(`"'=HYPERLINK(""x"")"\t-12.5`);
});

it('flattens a line break, as Copy as TSV does', () => {
  const tsv = selectionTsv({ kind: 'cell', row: 0, col: 0 }, { rows: 1, cols: 1 }, { cell: () => 'a\nb\tc', header: () => '' });
  expect(tsv).toBe('a b c');
});
