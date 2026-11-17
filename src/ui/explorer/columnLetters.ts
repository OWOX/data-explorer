/** A spreadsheet column letter: 0 is A, 25 is Z, 26 is AA, 27 is AB, 701 is ZZ, 702 is AAA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
