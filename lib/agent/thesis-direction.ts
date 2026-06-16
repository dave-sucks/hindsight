/**
 * thesis-direction.ts — the single source of truth for "is this thesis an
 * unresearched watchlist seed?"
 *
 * Post P1-24 contract, `Thesis.direction` is `LONG | SHORT | null` only:
 *   - `null` = "on the watchlist, not yet researched" (the seed sentinel).
 *   - LONG/SHORT = committed directional view.
 * A researched-and-declined PASS is `status='PASSED'` (with `direction=null`);
 * read it directly via `status === 'PASSED'` (the old `isPassedThesis`
 * dual-read helper was removed when the legacy `direction='PASS'` encoding was
 * contracted out of the data).
 *
 * The most dangerous seed site is place_trade's Guardrail 0 — a missed null
 * there would make an unresearched seed trade-eligible. The allowlist sites
 * (`direction === 'LONG' || direction === 'SHORT'`) are safe by omission.
 */

/**
 * True when the thesis carries no committed directional view — i.e. it is an
 * unresearched user/builder/editor watchlist seed (`direction` is null).
 */
export function isUnresearchedSeed(
  direction: string | null | undefined,
): boolean {
  return direction == null;
}
