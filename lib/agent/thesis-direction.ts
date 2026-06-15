/**
 * thesis-direction.ts — the single source of truth for the two "what does
 * this thesis's direction/status mean?" questions that the P1-24
 * status-taxonomy migration makes ambiguous during its dual-read window.
 *
 * Per docs/plans/STATUS_TAXONOMY.md, `Thesis.direction` is migrating to
 * `LONG | SHORT | null` only:
 *   - `null`  = "on the watchlist, not yet researched" (the seed sentinel).
 *               Before PR B4 that sentinel was the string `'PENDING'`.
 *   - PASS    = researched-and-declined. The pass fact moved OFF `direction`
 *               onto `status='PASSED'` (set since B1); the PASS-off-direction
 *               PR stores `direction=null` on a pass too. Before that PR a
 *               pass was identified by `direction='PASS'`.
 *
 * DUAL-READ WINDOW: until each backfill runs (and PR E contracts the old
 * values), readers must accept BOTH the new and legacy encodings:
 *   - unresearched seed = `null` (new) OR `'PENDING'` (legacy)
 *   - pass              = `status='PASSED'` (new) OR `direction='PASS'` (legacy)
 *
 * Every reader that used to branch on `direction === 'PENDING'` /
 * `direction === 'PASS'` MUST treat the new encoding identically, or a
 * migrated row slips through a gate it should have hit. The most dangerous
 * instance is place_trade's Guardrail 0 — a missed null there makes an
 * unresearched seed trade-eligible.
 *
 * Use `isUnresearchedSeed()` / `isPassedThesis()` for the denylist/equality
 * sites (the ones that must catch the seed / the pass). The allowlist sites
 * (`direction === 'LONG' || direction === 'SHORT'`) are already safe by
 * omission and need no change.
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

/**
 * True when the thesis is a researched-and-declined PASS. Keys on the new
 * encoding (`status === 'PASSED'`, set since B1) first, and falls back to the
 * legacy encoding (`direction === 'PASS'`) for rows not yet backfilled.
 *
 * Pass both fields when you have them — `status` is authoritative. The
 * `direction`-only fallback covers display readers that don't carry status in
 * scope; once the backfill nulls every `direction='PASS'` row that fallback
 * stops mattering, and it's removed in the contract PR.
 *
 * NOTE: this is for reading STORED data. The agent's *input* vocabulary is
 * unchanged — `record_thesis` / `update_thesis` still accept `direction:'PASS'`
 * as the call signal (that's a separate agent-vocab PR). Sites that branch on
 * the agent's input intent keep checking `args.direction === 'PASS'`.
 */
export function isPassedThesis(
  direction: string | null | undefined,
  status?: string | null | undefined,
): boolean {
  return status === "PASSED" || direction === "PASS";
}
