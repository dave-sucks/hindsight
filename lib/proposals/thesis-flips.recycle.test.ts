/**
 * thesis-flips.recycle.test.ts — sold-name continuity, Half A (GAPS P1-35,
 * docs/plans/SOLD_NAME_CONTINUITY.md §1).
 *
 * The rule these tests pin: a closed position's thesis goes back to WATCHING
 * (re-entry radar) on TWO roads, and dies on every other one.
 *
 *   1. closeReason TARGET            — profit-take, unchanged since PR5
 *   2. beliefSurvived === true       — the closing agent attested the belief
 *                                      survived a protective exit (P1-35)
 *
 * Why (2) exists: measured on the live book 2026-08-16, 28 of 29 theses
 * retired-as-SOLD since June 1 went terminal via a NON-target close. The old
 * rule was inverted for the risk that matters — a TARGET exit (sold into
 * strength, low "did we sell the dip?" risk) recycled, while a STOP exit (sold
 * into weakness, the HIGHEST such risk) went dark forever. ARQT (+$845), VRDN
 * (+$445) and XENE (+$966) were all green protective exits that vanished.
 *
 * `shouldRecycleToWatching` is the pure fork; testing it directly keeps these
 * assertions free of prisma mocking, exactly like isProfitTakeReentry was.
 */

// Both functions under test are pure, but the module imports prisma at load
// time (jest can't parse the generated client's import.meta). Mock it away.
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  isProfitTakeReentry,
  shouldRecycleToWatching,
} from "./thesis-flips";

describe("isProfitTakeReentry — unchanged profit-take road", () => {
  it("recognizes TARGET, case/whitespace insensitively", () => {
    expect(isProfitTakeReentry("TARGET")).toBe(true);
    expect(isProfitTakeReentry(" target ")).toBe(true);
  });

  it("does not recognize protective or free-text reasons", () => {
    for (const r of ["STOP", "TIME", "MANUAL", "trailing give-back"]) {
      expect(isProfitTakeReentry(r)).toBe(false);
    }
  });
});

describe("shouldRecycleToWatching — the P1-35 belief-attested road", () => {
  it("recycles a profit-take regardless of attestation (road 1)", () => {
    expect(shouldRecycleToWatching("TARGET")).toBe(true);
    expect(shouldRecycleToWatching("TARGET", true)).toBe(true);
    // A TARGET exit always keeps the name on watch — the attestation is moot.
    expect(shouldRecycleToWatching("TARGET", false)).toBe(true);
  });

  it("recycles a protective exit the agent attested (the ARQT/VRDN/XENE case)", () => {
    expect(shouldRecycleToWatching("STOP", true)).toBe(true);
    expect(shouldRecycleToWatching("MANUAL", true)).toBe(true);
    expect(shouldRecycleToWatching("TIME", true)).toBe(true);
  });

  it("retires a protective exit when the agent says the belief broke", () => {
    expect(shouldRecycleToWatching("STOP", false)).toBe(false);
    expect(shouldRecycleToWatching("MANUAL", false)).toBe(false);
  });

  it("retires when there is NO attestation — the safe default", () => {
    // Every non-agent path lands here: the price-monitor cron, DIRECT-mode
    // trigger fires, manual UI closes, promotion force-closes. Unchanged
    // behavior, so this PR can't alter a close nobody attested.
    expect(shouldRecycleToWatching("STOP")).toBe(false);
    expect(shouldRecycleToWatching("STOP", undefined)).toBe(false);
    expect(shouldRecycleToWatching("STOP", null)).toBe(false);
  });

  it("never resurrects a structurally-invalidated thesis, even if attested", () => {
    // "the setup broke structurally" and "the belief survived" are
    // contradictory. close_position collapses THESIS_INVALIDATED → MANUAL
    // before it reaches here (and forces beliefSurvived=false), but a
    // free-text reason can still carry the word, so guard on the text too.
    expect(shouldRecycleToWatching("THESIS_INVALIDATED", true)).toBe(false);
    expect(shouldRecycleToWatching("invalidated — catalyst failed", true)).toBe(
      false,
    );
  });

  it("treats only a literal true as an attestation (no truthy coercion)", () => {
    // Guards against a stray string/number from a JSON round-trip flipping a
    // dead thesis back onto the watchlist.
    const notTrue = ["true", 1, {}] as unknown as boolean[];
    for (const v of notTrue) {
      expect(shouldRecycleToWatching("STOP", v)).toBe(false);
    }
  });
});
