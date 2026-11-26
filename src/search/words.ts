/** Lower-case words of two or more letters or digits, in any script. */
export const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);

const singular = (w: string): string => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

/** How many distinct words of `a` appear among the words of `b`; a trailing plural "s" is ignored on either side. */
export function overlap(a: string, b: string): number {
  const inB = new Set(words(b).flatMap((w) => [w, singular(w)]));
  return new Set(words(a).filter((w) => inB.has(w) || inB.has(singular(w)))).size;
}
