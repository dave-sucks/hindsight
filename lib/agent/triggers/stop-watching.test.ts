/**
 * A sale line on a stock we only watch: "Stop watching if below $225". It
 * reads the close, never a dip (DAV-337), and a fire retires the thesis as
 * dropped with one Activity line (stopWatching). The evaluator's own replay
 * is lib/inngest/functions/trigger-evaluator.watched-floor-replay.test.ts.
 */

import { watchedFloorOnClose } from "./types";
import { sentenceOf } from "./condition";
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

describe("a sale line reads by whether we own the stock", () => {
  it("on a watch it stops watching; on a holding it sells, with the same condition", () => {
    expect(sentenceOf(t(below(225), "EXIT"), false)).toBe("Stop watching if below $225");
    expect(sentenceOf(t(below(225), "EXIT"), true)).toBe("Sell if below $225");
    // A judgment exit on a watch says the same: there is nothing to sell.
    expect(sentenceOf(t({ watch: "surprise", is: "miss", value: 0 }, "EXIT"), false)).toMatch(/^Stop watching if/);
  });
});

describe("watchedFloorOnClose — a watch ends on a close, never a dip (DAV-337)", () => {
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

describe("isPlanLevel — a buy, a sale or an upside review at a price", () => {
  it("counts the buy, the floor and an upside review", () => {
    expect(isPlanLevel(t(above(262), "ENTER"), "LONG")).toBe(true);
    expect(isPlanLevel(t(below(225), "EXIT"), "LONG")).toBe(true);
    expect(isPlanLevel(t(above(320), "REVIEW"), "LONG")).toBe(true);
  });

  it("does not count a clock, a move or an average", () => {
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

  it("does not count a downside review — support watching", () => {
    expect(isPlanLevel(t(below(240), "REVIEW"), "LONG")).toBe(false);
  });

  it("does not count an upside review when the list has no buy — that is a wake", () => {
    const wake = t(above(146), "REVIEW", "wake");
    const floor = t(below(132), "EXIT", "floor");
    expect(isPlanLevelOnList(wake, [wake, floor], "LONG")).toBe(false);
    expect(isPlanLevelOnList(floor, [wake, floor], "LONG")).toBe(true);
    // With a buy on the list, the same review counts.
    const buy = t(above(120), "ENTER", "buy");
    expect(isPlanLevelOnList(wake, [buy, wake], "LONG")).toBe(true);
  });
});
