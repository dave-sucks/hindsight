/**
 * thesis-direction.ts — the single source of truth for "is this thesis an
 * unresearched watchlist seed?" during the P1-24 status-taxonomy migration.
 *
 * Per docs/plans/STATUS_TAXONOMY.md, `Thesis.direction` is migrating to
 * `LONG | SHORT | null`, where `null` = "on the watchlist, not yet
 * researched" (the seed sentinel). Before PR B4 that sentinel was the
 * string `'PENDING'`.
 *
 * DUAL-READ WINDOW: until the backfill runs (and PR E contracts the old
 * value), an unresearched seed can be EITHER `null` (new writers) OR
 * `'PENDING'` (legacy rows). Every reader that used to branch on
 * `direction === 'PENDING'` MUST treat `null` identically, or a
 * null-direction seed slips through a gate it should have hit. The most
 * dangerous instance is place_trade's Guardrail 0 — a missed null there
 * makes an unresearched seed trade-eligible.
 *
 * Use `isUnresearchedSeed()` for the denylist/equality sites (the ones that
 * must catch the seed). The allowlist sites (`direction === 'LONG' ||
 * direction === 'SHORT'`) are already safe by omission and need no change.
 */

/**
 * True when the thesis carries no committed directional view — i.e. it is an
 * unresearched user/builder/editor watchlist seed. Matches both the new
 * sentinel (`null`/`undefined`) and the legacy one (`'PENDING'`).
 */
export function isUnresearchedSeed(
  direction: string | null | undefined,
): boolean {
  return direction == null || direction === "PENDING";
}
