/** Lower-case words of two or more letters or digits, in any script. */
export const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

/** How many distinct words of `a` appear among the words of `b`. */
export function overlap(a: string, b: string): number {
  const inB = new Set(words(b));
  return new Set(words(a).filter((w) => inB.has(w))).size;
}
