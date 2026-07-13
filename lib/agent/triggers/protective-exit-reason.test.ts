/**
 * protective-exit-reason.test.ts — pins protectiveExitCloseReason(), the
 * single-source mapping from a protective/price EXIT predicate to the
 * STOP/TARGET close tag it must carry (GAPS P1-28).
 *
 * Why it matters: a price-level protective exit (trail-from-high give-back,
 * gain-from-entry lock, absolute stop/target, daily-% move) is a MATERIAL risk
 * event, not a discretionary re-pitch. The unapproved-exit cooldown in
 * lib/proposals/maybe-await-approval.ts exempts STOP/TARGET closes so a
 * rejected gain-lock re-fires when price re-crosses the level. Both close
 * paths depend on this mapping being deterministic (never LLM-chosen):
 *   • DIRECT fire → tactical-run.ts directExitReason() delegates here.
 *   • agent (TACTICAL) fire → the reason is precomputed here and threaded into
 *     ToolContext.protectiveExitReason; close_position uses it.
 *
 * Non-protective predicates (earnings, signals, RSI, time, composites) return
 * null so the agent keeps its own tag and a discretionary MANUAL close stays
 * on cooldown — the anti-nag protection is preserved.
 */

import {
  protectiveExitCloseReason,
  type TriggerPredicate,
} from "./types";

describe("protectiveExitCloseReason — protective/price EXIT → STOP/TARGET tag", () => {
  it("tags a TRAILING_FROM_HIGH give-back exit STOP (the ARQT gain-lock)", () => {
    const p: TriggerPredicate = { kind: "TRAILING_FROM_HIGH", pct: 8 };
    expect(protectiveExitCloseReason(p, "LONG")).toBe("STOP");
    expect(protectiveExitCloseReason(p, "SHORT")).toBe("STOP");
  });

  it("tags a GAIN_FROM_ENTRY gain-lock exit STOP", () => {
    const p: TriggerPredicate = { kind: "GAIN_FROM_ENTRY", pct: 21, direction: "UP" };
    expect(protectiveExitCloseReason(p, "LONG")).toBe("STOP");
  });

  it("maps absolute price levels by side (LONG floor = STOP, LONG ceiling = TARGET)", () => {
    const below: TriggerPredicate = { kind: "PRICE_BELOW", level: 26.5 };
    const above: TriggerPredicate = { kind: "PRICE_ABOVE", level: 40 };
    // LONG: a break below the floor is adverse (STOP); a break above is the target.
    expect(protectiveExitCloseReason(below, "LONG")).toBe("STOP");
    expect(protectiveExitCloseReason(above, "LONG")).toBe("TARGET");
    // SHORT inverts.
    expect(protectiveExitCloseReason(below, "SHORT")).toBe("TARGET");
    expect(protectiveExitCloseReason(above, "SHORT")).toBe("STOP");
  });

  it("maps a daily PRICE_MOVE_PCT by whether the move is with the position", () => {
    const up: TriggerPredicate = { kind: "PRICE_MOVE_PCT", pct: 5, direction: "UP", window: "1D" };
    const down: TriggerPredicate = { kind: "PRICE_MOVE_PCT", pct: 5, direction: "DOWN", window: "1D" };
    // LONG: up move = favorable (TARGET), down move = adverse (STOP).
    expect(protectiveExitCloseReason(up, "LONG")).toBe("TARGET");
    expect(protectiveExitCloseReason(down, "LONG")).toBe("STOP");
    // SHORT inverts.
    expect(protectiveExitCloseReason(up, "SHORT")).toBe("STOP");
    expect(protectiveExitCloseReason(down, "SHORT")).toBe("TARGET");
  });

  it("treats null/unknown direction as LONG", () => {
    const below: TriggerPredicate = { kind: "PRICE_BELOW", level: 10 };
    expect(protectiveExitCloseReason(below, null)).toBe("STOP");
  });

  it("returns null for judgment predicates (they keep the LLM's tag → cooldown applies)", () => {
    const judgment: TriggerPredicate[] = [
      { kind: "SIGNAL_TYPE", signalType: "NEWS" },
      { kind: "EARNINGS_MISS" },
      { kind: "RSI", threshold: 70, direction: "ABOVE" },
      { kind: "TIME_ELAPSED", days: 30 },
      { kind: "REVIEW_DATE_HIT" },
    ];
    for (const p of judgment) {
      expect(protectiveExitCloseReason(p, "LONG")).toBeNull();
    }
  });
});
