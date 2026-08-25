/**
 * DEMOTE (L5) — what a price level means on a thesis we don't own.
 *
 * The two cases these tests encode came from production: KLAC (buy $262,
 * floor $225, price $184 — floor breached in June, nothing happened) and
 * NTNX (buy $47.12, target $60.87, price $67.64 — sailed past the target,
 * never bought).
 */

import { effectiveTriggerAction } from "./types";
import { isPlanLevel } from "./price-levels";
import type { Trigger, TriggerAction, TriggerPredicate } from "./types";

const below = (level: number) => ({ kind: "PRICE_BELOW" as const, level });
const above = (level: number) => ({ kind: "PRICE_ABOVE" as const, level });

function t(
  predicate: TriggerPredicate,
  action: TriggerAction,
  id = "x",
): Trigger {
  return { id, predicate, action, rationale: "test" };
}

const HELD = { status: "HOLDING", direction: "LONG" };
const WATCH = { status: "WATCHING", direction: "LONG" };
const WATCH_SHORT = { status: "WATCHING", direction: "SHORT" };

describe("effectiveTriggerAction", () => {
  it("leaves a held thesis's actions exactly as authored", () => {
    expect(effectiveTriggerAction(t(below(225), "EXIT"), HELD)).toBe("EXIT");
    expect(effectiveTriggerAction(t(above(360), "REVIEW"), HELD)).toBe("REVIEW");
    expect(effectiveTriggerAction(t(above(400), "TRIM"), HELD)).toBe("TRIM");
  });

  it("turns a breached floor on a watch item into DEMOTE — the KLAC case", () => {
    expect(effectiveTriggerAction(t(below(225), "EXIT"), WATCH)).toBe("DEMOTE");
  });

  it("turns a target reached before we bought into DEMOTE — the NTNX case", () => {
    expect(effectiveTriggerAction(t(above(60.87), "REVIEW"), WATCH)).toBe(
      "DEMOTE",
    );
  });

  it("leaves the buy level alone — that one still means buy", () => {
    expect(effectiveTriggerAction(t(above(262), "ENTER"), WATCH)).toBe("ENTER");
  });

  it("does not demote housekeeping reviews", () => {
    // Review cadence, earnings, news — these still just want a look.
    expect(
      effectiveTriggerAction(
        t({ kind: "TIME_ELAPSED", days: 30 }, "REVIEW"),
        WATCH,
      ),
    ).toBe("REVIEW");
    expect(
      effectiveTriggerAction(
        t({ kind: "SIGNAL_TYPE", signalType: "NEWS" }, "REVIEW"),
        WATCH,
      ),
    ).toBe("REVIEW");
  });

  it("does not demote a downside review — that's a watching instruction", () => {
    // "Price dropped to support — better entry, or thesis weakening?" is a
    // reason to look, not a reason to throw the plan away.
    expect(effectiveTriggerAction(t(below(240), "REVIEW"), WATCH)).toBe("REVIEW");
  });

  it("inverts the favourable side on a short", () => {
    expect(effectiveTriggerAction(t(below(40), "REVIEW"), WATCH_SHORT)).toBe(
      "DEMOTE",
    );
    expect(effectiveTriggerAction(t(above(80), "REVIEW"), WATCH_SHORT)).toBe(
      "REVIEW",
    );
  });

  it("demotes a judgment exit on a watch item too", () => {
    // "Sell on an earnings miss" is equally meaningless with nothing to sell.
    expect(
      effectiveTriggerAction(t({ kind: "EARNINGS_MISS" }, "EXIT"), WATCH),
    ).toBe("DEMOTE");
  });
});

describe("isPlanLevel — what demotion actually removes", () => {
  it("removes the buy level, the floor and the target", () => {
    expect(isPlanLevel(t(above(262), "ENTER"), "LONG")).toBe(true);
    expect(isPlanLevel(t(below(225), "EXIT"), "LONG")).toBe(true);
    expect(isPlanLevel(t(above(320), "REVIEW"), "LONG")).toBe(true);
  });

  it("keeps everything that makes it still a watch", () => {
    // The whole point is that the item survives — only the numbers go.
    expect(isPlanLevel(t({ kind: "TIME_ELAPSED", days: 30 }, "REVIEW"), "LONG")).toBe(
      false,
    );
    expect(
      isPlanLevel(t({ kind: "SIGNAL_TYPE", signalType: "NEWS" }, "REVIEW"), "LONG"),
    ).toBe(false);
    expect(
      isPlanLevel(
        t({ kind: "PRICE_MOVE_PCT", pct: 7, direction: "UP", window: "1D" }, "REVIEW"),
        "LONG",
      ),
    ).toBe(false);
  });

  it("keeps a downside review — support watching, not a plan level", () => {
    expect(isPlanLevel(t(below(240), "REVIEW"), "LONG")).toBe(false);
  });
});
