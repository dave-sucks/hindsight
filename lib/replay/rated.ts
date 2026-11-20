/**
 * A Writer decision saved before the Writer had to say what it expects of the
 * stock (2026-11-20), as the Writer sends it now: with an outlook and its
 * reason. One that already has them is left as it is.
 */
export function ratedNow<T>(decision: T): T {
  return { outlook: "BULLISH", outlook_reason: "Rated for this replay: the saved decision predates the outlook.", ...(decision as object) } as T;
}
