/**
 * For tests written against the kinds: the old kind name a condition is, read
 * through the translator. Test-only; nothing in the app names a kind.
 */

import { shapeOf, toLegacy } from "../legacy";

export function kindOf(p: unknown): string | undefined {
  const w = shapeOf(p);
  return w ? toLegacy(w)?.kind : undefined;
}
