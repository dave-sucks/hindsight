/**
 * "Stop watching if below $225" is its own action (STOP_WATCHING), on a
 * stock we only watch, and "Sell if" (EXIT) only on one we hold. Each says
 * what it does whatever the stock's state, and the other is refused with the
 * fix, never converted. Its timing is its own saved setting; nothing reads it
 * on the close at check time. A fire retires the thesis as dropped with one
 * Activity line (stopWatching); the evaluator's replay is
 * lib/inngest/functions/trigger-evaluator.watched-floor-replay.test.ts.
 */

import { actionProblem, allowedActions, SELL_ON_A_WATCH, sentenceOf, STOP_WATCHING_IS_THE_STOCKS, STOP_WATCHING_ON_A_HOLDING } from "./condition";
import { isPlanLevel, isPlanLevelOnList } from "./price-levels";
import { applyTriggerOps } from "./ops";
import { resolveLadder } from "./levels";
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

describe("each action says what it does, whatever the stock's state", () => {
  it("Stop watching is its own words, and its timing is the one it saved", () => {
    expect(sentenceOf(t(below(225), "STOP_WATCHING"))).toBe("Stop watching if below $225");
    expect(sentenceOf(t({ ...below(46.5), settings: { close: true } }, "STOP_WATCHING"))).toBe("Stop watching if below $46.50 · only on the close");
    expect(sentenceOf(t(below(225), "EXIT"))).toBe("Sell if below $225");
  });
});

describe("a sale is for a holding, Stop watching for a watch", () => {
  it("the other is refused with the fix", () => {
    expect(actionProblem("EXIT", { held: false })).toBe(SELL_ON_A_WATCH);
    expect(SELL_ON_A_WATCH).toContain("STOP_WATCHING");
    expect(actionProblem("STOP_WATCHING", { held: true })).toBe(STOP_WATCHING_ON_A_HOLDING);
    expect(actionProblem("STOP_WATCHING", { held: false, standing: true })).toBe(STOP_WATCHING_IS_THE_STOCKS);
    expect([actionProblem("EXIT", { held: true }), actionProblem("STOP_WATCHING", { held: false }), actionProblem("EXIT", { held: false, standing: true })]).toEqual([null, null, null]);
  });

  it("the form's action menu offers Stop watching on a watch and Sell on a holding", () => {
    expect(allowedActions(below(225), { held: false, standing: false })).toEqual(["ENTER", "STOP_WATCHING", "REVIEW"]);
    expect(allowedActions(below(225), { held: true, standing: false })).toEqual(["ADD", "TRIM", "EXIT", "REVIEW"]);
    expect(allowedActions(below(225), { held: false, standing: true })).not.toContain("STOP_WATCHING");
  });

  it("an agent's sale on a watch is refused by id with the fix, and the rest of the call lands", () => {
    const out = applyTriggerOps({
      stored: [],
      ops: [
        { op: "add", trigger: t(below(225), "EXIT", "sale") },
        { op: "add", trigger: t({ ...below(225), settings: { close: true } }, "STOP_WATCHING", "stop") },
      ],
      direction: "LONG",
      status: "WATCHING",
      actor: "AGENT",
      mintId: () => "minted",
    });
    expect(out.results.map((r) => [r.id, r.ok, r.reason ?? null])).toEqual([
      ["sale", false, SELL_ON_A_WATCH],
      ["stop", true, null],
    ]);
    expect(out.triggers.map((x) => [x.id, x.action])).toEqual([["stop", "STOP_WATCHING"]]);
  });

  it("an edit can't turn a watch's line into a sale", () => {
    const out = applyTriggerOps({
      stored: [t(below(225), "STOP_WATCHING", "stop")],
      ops: [{ op: "edit", id: "stop", action: "EXIT" }],
      direction: "LONG",
      status: "WATCHING",
      actor: "PRINCIPAL",
      mintId: () => "minted",
    });
    expect(out.results[0]).toMatchObject({ ok: false, reason: SELL_ON_A_WATCH });
  });

  it("a ladder reads a sale only on a holding and a Stop watching line only on a watch", () => {
    const list = [t(below(90), "EXIT", "sale"), t(below(90), "STOP_WATCHING", "stop")];
    expect(resolveLadder({ thesis: list, state: "HELD" }).map((x) => x.id)).toEqual(["sale"]);
    expect(resolveLadder({ thesis: list, state: "WATCHING" }).map((x) => x.id)).toEqual(["stop"]);
  });
});

describe("isPlanLevel — a buy, a sale or an upside review at a price", () => {
  it("counts the buy, the floor and an upside review", () => {
    expect(isPlanLevel(t(above(262), "ENTER"), "LONG")).toBe(true);
    expect(isPlanLevel(t(below(225), "EXIT"), "LONG")).toBe(true);
    expect(isPlanLevel(t(below(225), "STOP_WATCHING"), "LONG")).toBe(true);
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
    const floor = t(below(132), "STOP_WATCHING", "floor");
    expect(isPlanLevelOnList(wake, [wake, floor], "LONG")).toBe(false);
    expect(isPlanLevelOnList(floor, [wake, floor], "LONG")).toBe(true);
    // With a buy on the list, the same review counts.
    const buy = t(above(120), "ENTER", "buy");
    expect(isPlanLevelOnList(wake, [buy, wake], "LONG")).toBe(true);
  });
});
