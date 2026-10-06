/**
 * DEMOTE (L5) — what a price level means on a thesis we don't own.
 *
 * The two cases these tests encode came from production: KLAC (buy $262,
 * floor $225, price $184 — floor breached in June, nothing happened) and
 * NTNX (buy $47.12, target $60.87, price $67.64 — sailed past the target,
 * never bought).
 */

import { effectiveTriggerAction, watchedFloorOnClose } from "./types";
import { isPlanLevel, isPlanLevelOnList } from "./price-levels";
import type { Trigger, TriggerAction } from "./types";
import type { Condition, When } from "@/lib/agent/triggers/condition";

const below = (level: number): Condition => ({ watch: "price", is: "below", value: level });
const above = (level: number): Condition => ({ watch: "price", is: "above", value: level });

function t(
  predicate: When,
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
        t({ watch: "repeat", value: 30 }, "REVIEW"),
        WATCH,
      ),
    ).toBe("REVIEW");
    expect(
      effectiveTriggerAction(
        t({ watch: "move", is: "near", value: 2, variable: "sma50" }, "REVIEW"),
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

  it("with no buy, an upside review is a wake — it fires as a review (QB ruling 2026-09-29)", () => {
    // VST: "review above $145" on a stock with no buy. There is no priced
    // plan for the move to have left behind.
    expect(effectiveTriggerAction(t(above(145), "REVIEW"), { ...WATCH, hasBuy: false })).toBe("REVIEW");
    expect(effectiveTriggerAction(t(below(40), "REVIEW"), { ...WATCH_SHORT, hasBuy: false })).toBe("REVIEW");
    // A sale at a price still sets the plan down, buy or no buy.
    expect(effectiveTriggerAction(t(below(132), "EXIT"), { ...WATCH, hasBuy: false })).toBe("DEMOTE");
  });

  it("demotes a judgment exit on a watch item too", () => {
    // "Sell on an earnings miss" is equally meaningless with nothing to sell.
    expect(
      effectiveTriggerAction(t({ watch: "surprise", is: "miss", value: 0 }, "EXIT"), WATCH),
    ).toBe("DEMOTE");
  });
});

describe("watchedFloorOnClose — a watched plan comes down on a close, never a dip (DAV-337)", () => {
  // TRV 2026-09-29: floor $359.87, opened $359.51, back to $363.83 that
  // morning. The five-minute check reads this; the evaluator replay is
  // lib/inngest/functions/trigger-evaluator.watched-floor-replay.test.ts.
  const floor = t(below(359.87), "EXIT", "floor");

  it("a watched stock's floor reads the day's close", () => {
    expect(watchedFloorOnClose(floor, WATCH)).toEqual({ ...floor, predicate: { ...below(359.87), settings: { close: true } } });
    expect(watchedFloorOnClose(t(above(80), "EXIT"), WATCH_SHORT).predicate).toEqual({ ...above(80), settings: { close: true } });
  });

  it("a held stock's floor is a sale and keeps its own timing", () => {
    expect(watchedFloorOnClose(floor, HELD)).toBe(floor);
  });

  it("the buy, the target and the reviews keep their timing", () => {
    for (const x of [t(above(372.51), "ENTER"), t(above(425), "REVIEW"), t(below(340), "REVIEW")]) {
      expect(watchedFloorOnClose(x, WATCH)).toBe(x);
    }
  });

  it("a two-condition sell reads its price condition on the close; the other condition is untouched", () => {
    const both = t({ match: "all", conditions: [below(359.87), { watch: "volume", value: 1.5 }] }, "EXIT");
    expect(watchedFloorOnClose(both, WATCH).predicate).toEqual({
      match: "all",
      conditions: [{ ...below(359.87), settings: { close: true } }, { watch: "volume", value: 1.5 }],
    });
  });

  it("a floor already on the close is returned as it is", () => {
    const onClose = t({ ...below(359.87), settings: { close: true } }, "EXIT");
    expect(watchedFloorOnClose(onClose, WATCH)).toBe(onClose);
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
    expect(isPlanLevel(t({ watch: "repeat", value: 30 }, "REVIEW"), "LONG")).toBe(
      false,
    );
    expect(
      isPlanLevel(t({ watch: "move", is: "near", value: 2, variable: "sma50" }, "REVIEW"), "LONG"),
    ).toBe(false);
    expect(
      isPlanLevel(
        t({ watch: "move", is: "above", value: 7, variable: "prev_close" }, "REVIEW"),
        "LONG",
      ),
    ).toBe(false);
  });

  it("keeps a downside review — support watching, not a plan level", () => {
    expect(isPlanLevel(t(below(240), "REVIEW"), "LONG")).toBe(false);
  });

  it("keeps an upside review when the list has no buy — that is a wake", () => {
    const wake = t(above(146), "REVIEW", "wake");
    const floor = t(below(132), "EXIT", "floor");
    expect(isPlanLevelOnList(wake, [wake, floor], "LONG")).toBe(false);
    expect(isPlanLevelOnList(floor, [wake, floor], "LONG")).toBe(true);
    // With a buy on the list, the same review is the target and goes with the plan.
    const buy = t(above(120), "ENTER", "buy");
    expect(isPlanLevelOnList(wake, [buy, wake], "LONG")).toBe(true);
  });
});
