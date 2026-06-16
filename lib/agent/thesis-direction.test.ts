/**
 * thesis-direction.test.ts — coverage for the seed primitive + the
 * direction-independence of the run-summary derivation.
 *
 * Post P1-24 contract, `Thesis.direction` is `LONG|SHORT|null` only and the
 * "passed" fact lives on `Thesis.status='PASSED'` (read directly via
 * `status === "PASSED"`; the old `isPassedThesis` dual-read helper was
 * removed when the legacy `direction='PASS'` encoding was contracted out).
 * `isUnresearchedSeed(direction)` is now a plain null-check.
 *
 * The bottom block proves the run-summary derivation (buildRunSummary) is
 * direction-INDEPENDENT — a passed thesis with direction=null buckets exactly
 * as before, because the summary keys on TradeDecision.decision /
 * ThesisUpdate.type, never on the stored direction string.
 */

import { isUnresearchedSeed } from "./thesis-direction";
import { buildRunSummary, type RunSummaryInput } from "@/lib/run-summary";

describe("isUnresearchedSeed (P1-24)", () => {
  it("null direction is an unresearched seed", () => {
    expect(isUnresearchedSeed(null)).toBe(true);
    expect(isUnresearchedSeed(undefined)).toBe(true);
  });

  it("a committed directional view is not a seed", () => {
    expect(isUnresearchedSeed("LONG")).toBe(false);
    expect(isUnresearchedSeed("SHORT")).toBe(false);
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
