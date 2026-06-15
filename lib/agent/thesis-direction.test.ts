/**
 * thesis-direction.test.ts — coverage for the P1-24 dual-read primitives.
 *
 * Pure functions; no DB, no fetches. The PASS-off-direction PR moves the
 * "passed" fact off `Thesis.direction` (now LONG|SHORT|null only) onto
 * `Thesis.status='PASSED'`. `isPassedThesis` is the dual-read primitive every
 * reader now keys on, and the value the supersession queries' `status.in`
 * list mirrors. These tests pin the two shapes that must stay equivalent:
 *
 *   NEW:    status='PASSED', direction=null
 *   LEGACY: direction='PASS'  (pre-backfill; any status)
 *
 * The bottom block proves the run-summary derivation (buildRunSummary) is
 * direction-INDEPENDENT — a passed thesis with direction=null buckets exactly
 * as before, because the summary keys on TradeDecision.decision /
 * ThesisUpdate.type, never on the stored direction string.
 */

import { isPassedThesis, isUnresearchedSeed } from "./thesis-direction";
import { buildRunSummary, type RunSummaryInput } from "@/lib/run-summary";

describe("isPassedThesis (P1-24 dual-read)", () => {
  // ── NEW shape: status=PASSED, direction nulled ─────────────────────────
  it("NEW shape: status='PASSED' + direction=null is a pass", () => {
    expect(isPassedThesis(null, "PASSED")).toBe(true);
  });

  it("NEW shape: status='PASSED' is a pass regardless of direction value", () => {
    // Defensive: even if a stale direction lingers pre-backfill, PASSED wins.
    expect(isPassedThesis(undefined, "PASSED")).toBe(true);
    expect(isPassedThesis("LONG", "PASSED")).toBe(true);
  });

  // ── LEGACY shape: direction='PASS' (not yet backfilled) ────────────────
  it("LEGACY shape: direction='PASS' is a pass even when status is absent", () => {
    expect(isPassedThesis("PASS")).toBe(true);
    expect(isPassedThesis("PASS", undefined)).toBe(true);
  });

  it("LEGACY shape: direction='PASS' is a pass when status is the old ARCHIVED", () => {
    // Pre-B1 rows: PASS-at-write landed status='ARCHIVED'. Still a pass.
    expect(isPassedThesis("PASS", "ARCHIVED")).toBe(true);
  });

  // ── NOT a pass ─────────────────────────────────────────────────────────
  it("directional rows are not passes", () => {
    expect(isPassedThesis("LONG", "HOLDING")).toBe(false);
    expect(isPassedThesis("SHORT", "WATCHING")).toBe(false);
    expect(isPassedThesis("LONG", "ACTIVE")).toBe(false);
  });

  it("an unresearched WATCHING seed (direction=null, status=WATCHING) is NOT a pass", () => {
    // The critical non-misfire: post-B4 a seed is direction=null. Keying a
    // pass-check on direction alone would have been ambiguous — isPassedThesis
    // requires status='PASSED' (or legacy direction='PASS'), so a seed is safe.
    expect(isPassedThesis(null, "WATCHING")).toBe(false);
    expect(isPassedThesis(undefined, "WATCHING")).toBe(false);
  });

  it("a terminal RETIRED row is NOT classified as a pass by this helper", () => {
    // RETIRED (sold/dropped/invalidated/replaced) is its own resting state.
    // The supersession query catches it via the status.in list directly; it
    // is not a 'pass' for display purposes.
    expect(isPassedThesis(null, "RETIRED")).toBe(false);
  });

  it("a fully-empty row (no direction, no status) is not a pass", () => {
    expect(isPassedThesis(null, null)).toBe(false);
    expect(isPassedThesis(undefined, undefined)).toBe(false);
  });

  // ── seed vs pass are distinct primitives ───────────────────────────────
  it("isUnresearchedSeed and isPassedThesis don't overlap on a null-direction pass", () => {
    // A PASSED row has direction=null but is NOT a seed — status disambiguates.
    expect(isPassedThesis(null, "PASSED")).toBe(true);
    expect(isUnresearchedSeed(null)).toBe(true); // direction-only seed check
    // The point: callers that have status must use isPassedThesis (which reads
    // status) to tell a passed row from an unresearched seed — both are
    // direction=null, only status='PASSED' marks the pass.
  });
});

describe("buildRunSummary is direction-independent for passes (P1-24)", () => {
  // A passed ticker reaches the summary as a TradeDecision(PASS) and/or a
  // CREATED ThesisUpdate. The stored direction (now null) is never read by
  // the bucket derivation. These tests pin that: a pass produces NO action
  // segment and never double-bills, exactly as before the direction→null
  // change.

  function baseInput(over: Partial<RunSummaryInput>): RunSummaryInput {
    return {
      status: "COMPLETE",
      theses: [],
      decisions: [],
      managementActions: [],
      thesisUpdates: [],
      ...over,
    };
  }

  it("a PASS TradeDecision produces no action segment (HOLD/PASS/REMOVE_WATCH are absence)", () => {
    const summary = buildRunSummary(
      baseInput({
        decisions: [
          { symbol: "ZS", decision: "PASS", position: null },
        ],
      }),
    );
    // No bucket claims a passed ticker.
    expect(summary.actions.bought).toEqual([]);
    expect(summary.actions.watching).toEqual([]);
    expect(summary.actions.invalidated).toEqual([]);
    expect(summary.actions.updated).toEqual([]);
    // Not failed, not double-billed.
    expect(summary.isFailed).toBe(false);
  });

  it("a CREATED ThesisUpdate for a PASSED thesis (status=PASSED) does not land in 'watching'", () => {
    // The CREATED branch only routes status='WATCHING' rows to the watching
    // bucket. A PASSED creation (the researched-declined mint) is correctly
    // ignored — it's institutional memory, not coverage. direction is null
    // and never consulted.
    const summary = buildRunSummary(
      baseInput({
        thesisUpdates: [
          { type: "CREATED", thesis: { ticker: "MRVL", status: "PASSED" } },
        ],
      }),
    );
    expect(summary.actions.watching).toEqual([]);
    expect(summary.actions.updated).toEqual([]);
    expect(summary.counts.walked).toBe(0);
  });

  it("a WATCHING creation still lands in 'watching' (coexistence sanity)", () => {
    const summary = buildRunSummary(
      baseInput({
        thesisUpdates: [
          { type: "CREATED", thesis: { ticker: "NVDA", status: "WATCHING" } },
        ],
      }),
    );
    expect(summary.actions.watching).toEqual(["NVDA"]);
  });
});
