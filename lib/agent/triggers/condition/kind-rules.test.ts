/**
 * Every rule that used to read the predicate kinds, called where the app
 * calls it, against the kinds' answers frozen in ./__fixtures__/kind-rules.ts:
 * each stored condition (and the ones the book lacks) under every action,
 * both directions and none, and positions with and without the numbers a
 * line needs. A disagreement is a change in how a trigger behaves.
 *
 * (The cooldown, the slot, direct sales, close labels and what a trigger does
 * on a stock we don't hold are in condition.test.ts; what the five-minute
 * pass loads is in trigger-evaluator.selectors.test.ts.)
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import stored from "./__fixtures__/stored-triggers.json";
import { UNSTORED } from "./__fixtures__/unstored-triggers";
import * as kinds from "./__fixtures__/kind-rules";
import { carriesNumber, fromPosition, isProtectiveLine, loosens, readsTheTape, reviewClockDays, shapeOf, tightness } from ".";
import { resolveLadder } from "../levels";
import { canonicalLevels, isPlanLevel, levelSlotOf } from "../price-levels";
import { decideBuyRearm } from "../rearm";
import { agentWatchDays } from "../agent-watch";
import { spentBuyCrossing } from "@/lib/agent/buy-crossing";
import { declineReplanAllows, replanFloorBound } from "@/lib/agent/declined-sale";
import { protectiveRatchetViolations } from "../ratchet";
import type { Trigger, TriggerAction, TriggerPredicate } from "../types";

const ACTIONS: TriggerAction[] = ["ENTER", "ADD", "TRIM", "EXIT", "REVIEW", "MOVE_STOP", "DEMOTE"];
const DIRECTIONS = ["LONG", "SHORT", null];
const all = [...(stored as { rows: { predicate: TriggerPredicate }[] }).rows.map((r) => r.predicate), ...UNSTORED].filter(
  (p) => shapeOf(p) != null,
);
const trigger = (predicate: TriggerPredicate, action: TriggerAction, id = "t"): Trigger => ({ id, predicate, action, rationale: "" });
/** A price the predicate is about, so a grid lands on both sides of it. */
const anchor = (p: TriggerPredicate): number => kinds.priceOf(p) ?? 100;

function disagree<C>(cases: C[], then: (c: C) => unknown, now: (c: C) => unknown) {
  const out = cases.flatMap((c) => {
    const was = JSON.stringify(then(c));
    const is = JSON.stringify(now(c));
    return was === is ? [] : [{ case: c, was, is }];
  });
  return { count: out.length, first: out.slice(0, 5) };
}
const agree = { count: 0, first: [] };
const answers = <C,>(cases: C[], then: (c: C) => unknown) => new Set(cases.map((c) => JSON.stringify(then(c)))).size;

describe("the rules that read the kinds, against the kinds' answers", () => {
  it("a level on the chart: its price, side and whether it moves", () => {
    const positions = [
      {},
      { avgCost: 100 },
      { avgCost: 100, peakPrice: 140 },
      { avgCost: 100, peakPrice: 140, atr14: 9 },
      { avgCost: 100, peakPrice: 104 },
    ];
    const cases = all.flatMap((p) => DIRECTIONS.flatMap((direction) => positions.map((pos) => ({ p, direction, ...pos }))));
    const then = (c: (typeof cases)[number]) => kinds.chartLevel(c.p, c);
    const now = (c: (typeof cases)[number]) => {
      const t = { ...trigger(c.p, "EXIT"), level: "THESIS" as const, inherited: false };
      const l = canonicalLevels({ triggers: [t], direction: c.direction, avgCost: c.avgCost, peakPrice: c.peakPrice, atr14: c.atr14 }).all[0];
      return l ? { price: l.price, side: l.side, projected: l.projected } : null;
    };
    expect(disagree(cases, then, now)).toEqual(agree);
    expect(answers(cases, then)).toBeGreaterThan(50);
  });

  it("which plan slot a trigger fills, and whether it is part of the priced plan", () => {
    const cases = all.flatMap((p) => ACTIONS.flatMap((action) => DIRECTIONS.map((direction) => ({ t: trigger(p, action), direction }))));
    expect(disagree(cases, (c) => kinds.levelSlotOf(c.t, c.direction), (c) => levelSlotOf(c.t, c.direction))).toEqual(agree);
    expect(disagree(cases, (c) => kinds.isPlanLevel(c.t, c.direction), (c) => isPlanLevel(c.t, c.direction))).toEqual(agree);
    expect(answers(cases, (c) => kinds.levelSlotOf(c.t, c.direction))).toBe(4);
  });

  it("the cascade drops what a watched stock can't use: rules off a position, and the inherited review clock", () => {
    // resolveLadder on a watched stock, one inherited rule at a time: does it survive?
    const cases = all.flatMap((p) => ["ENTER", "EXIT", "REVIEW"].map((action) => trigger(p, action as TriggerAction)));
    const then = (t: Trigger) => !kinds.isPositionScoped(t.predicate) && !kinds.isInheritedClock(t.predicate);
    const now = (t: Trigger) =>
      resolveLadder({ thesis: [], analyst: [t], account: [], state: "WATCHING" }).length === 1;
    expect(disagree(cases, then, now)).toEqual(agree);
    expect(answers(cases, then)).toBe(2);
    // The two rules on their own, over every condition.
    expect(disagree(all, kinds.isPositionScoped, (p) => fromPosition(shapeOf(p)!))).toEqual(agree);
    expect(disagree(all, kinds.isInheritedClock, (p) => reviewClockDays(shapeOf(p)!) != null)).toEqual(agree);
  });

  it("two floors in one slot: the tighter one is kept", () => {
    const cases = all.flatMap((p) => DIRECTIONS.map((direction) => ({ t: trigger(p, "EXIT"), direction })));
    const then = (c: (typeof cases)[number]) => kinds.protectiveRank(c.t, c.direction);
    const now = (c: (typeof cases)[number]) =>
      kinds.protectiveRank(c.t, c.direction) == null ? null : tightness(shapeOf(c.t.predicate)!, c.direction !== "SHORT");
    expect(disagree(cases, then, now)).toEqual(agree);
    // And at the entry point: a looser twin listed first loses to the tighter one.
    const pairs = all.flatMap((p) =>
      DIRECTIONS.map((direction) => {
        const looser = kinds.priceOf(p) != null ? { ...p, level: (p as { level: number }).level * (direction === "SHORT" ? 1.1 : 0.9) } : { ...p, pct: ((p as { pct?: number }).pct ?? 5) * 2 };
        return { p, looser: looser as TriggerPredicate, direction };
      }),
    );
    const kept = (c: (typeof pairs)[number]) =>
      resolveLadder({ thesis: [trigger(c.looser, "EXIT", "loose"), trigger(c.p, "EXIT", "tight")], analyst: [], account: [], direction: c.direction })[0]?.id;
    const expected = (c: (typeof pairs)[number]) => {
      const a = kinds.protectiveRank(trigger(c.looser, "EXIT"), c.direction);
      const b = kinds.protectiveRank(trigger(c.p, "EXIT"), c.direction);
      return a == null || b == null || a <= b ? "loose" : "tight";
    };
    expect(disagree(pairs, expected, kept)).toEqual(agree);
  });

  it("an edit that loosens a stop on a stock we own is refused", () => {
    // Each protective rule against itself moved both ways, waiting for the close, and its trail options raised.
    const variants = (p: TriggerPredicate): TriggerPredicate[] => {
      const q = p as Record<string, unknown>;
      const out: Record<string, unknown>[] = [];
      for (const k of ["level", "pct"]) if (typeof q[k] === "number") out.push({ ...q, [k]: (q[k] as number) * 1.1 }, { ...q, [k]: (q[k] as number) * 0.9 });
      out.push({ ...q, basis: "close" }, { ...q, armAtGainPct: 30 }, { ...q, atrMultiple: 4 }, { ...q, skipIfPeakGainPct: 40 });
      return out as TriggerPredicate[];
    };
    const cases = all.flatMap((p) => variants(p).flatMap((next) => DIRECTIONS.map((direction) => ({ prev: p, next, direction }))));
    const then = (c: (typeof cases)[number]) => kinds.weakens(c.prev, c.next);
    expect(disagree(cases, then, (c) => loosens(shapeOf(c.prev)!, shapeOf(c.next)!))).toEqual(agree);
    expect(answers(cases, then)).toBe(2);
    // At the entry point: the ratchet refuses exactly the loosened protective stops.
    const refused = (c: (typeof cases)[number]) =>
      protectiveRatchetViolations({ direction: c.direction, before: [trigger(c.prev, "EXIT")], after: [trigger(c.next, "EXIT")], inherited: [] }).some(
        (v) => v.reason === "LOWERED",
      );
    const expected = (c: (typeof cases)[number]) =>
      kinds.protectiveExitCloseReason(c.prev, c.direction) === "STOP" &&
      kinds.triggerBucket(trigger(c.prev, "EXIT")) === kinds.triggerBucket(trigger(c.next, "EXIT")) &&
      kinds.weakens(c.prev, c.next);
    expect(disagree(cases, expected, refused)).toEqual(agree);
  });

  it("read off the quote and the snapshot alone (the live check and the morning flags)", () => {
    expect(disagree(all, kinds.isPriceOrTimePredicate, (p) => readsTheTape(shapeOf(p)!))).toEqual(agree);
    expect(answers(all, kinds.isPriceOrTimePredicate)).toBe(2);
  });

  it("a buy on an intraday price stays armed when the price slipped back past it", () => {
    const now = new Date("2026-10-05T15:00:00Z");
    const cases = all.flatMap((p) =>
      ["ENTER", "REVIEW"].flatMap((action) => [0.97, 1.03].map((m) => ({ t: trigger(p, action as TriggerAction), price: anchor(p) * m }))),
    );
    const then = (c: (typeof cases)[number]) => {
      if (!kinds.isIntradayPriceBuy(c.t)) return { rearm: false, why: "not-an-intraday-price-buy" };
      return kinds.levelStillHeld(c.t.predicate, c.price) ? { rearm: false, why: "level-still-held" } : { rearm: true, level: kinds.priceOf(c.t.predicate) };
    };
    const decide = (c: (typeof cases)[number]) => {
      const d = decideBuyRearm({ trigger: c.t, status: "WATCHING", closeOut: { triggerId: "t", priceAtTime: c.price }, triedToBuy: false, rearmedAt: [], now });
      return d.rearm ? { rearm: true, level: d.level } : { rearm: false, why: d.why };
    };
    expect(disagree(cases, then, decide)).toEqual(agree);
    expect(answers(cases, then)).toBeGreaterThan(3);
  });

  it("a fired buy the price has run past", () => {
    const now = new Date("2026-10-05T15:00:00Z");
    const cases = all.flatMap((p) => ["LONG", "SHORT"].flatMap((direction) => [0.9, 1.1].map((m) => ({ p, direction, price: anchor(p) * m }))));
    const then = (c: (typeof cases)[number]) => {
      const at = kinds.crossingLevel(c.p);
      if (!at) return false;
      return at.crossing === "ABOVE" ? c.price > at.level : c.price < at.level;
    };
    const spent = (c: (typeof cases)[number]) =>
      spentBuyCrossing({
        status: "WATCHING",
        direction: c.direction,
        currentPrice: c.price,
        enter: { predicate: c.p, lastFiredAt: "2026-10-04T15:00:00Z" },
        chaseLimitPct: null,
        updates: [],
        now,
      }) != null;
    expect(disagree(cases, then, spent)).toEqual(agree);
    expect(answers(cases, then)).toBe(2);
  });

  it("a declined sale lets the floor be re-planned only to a real floor near it", () => {
    const cases = all.flatMap((p) =>
      DIRECTIONS.flatMap((direction) => [0.95, 1, 1.05].map((m) => ({ p, direction, declinedFloor: anchor(p) * m }))),
    );
    const then = (c: (typeof cases)[number]) => {
      const level = kinds.protectedFloor(c.p, c.direction);
      if (level == null) return false;
      const bound = replanFloorBound(c.declinedFloor, c.direction);
      return c.direction !== "SHORT" ? level >= bound : level <= bound;
    };
    const allows = (c: (typeof cases)[number]) =>
      declineReplanAllows({ reason: "LOWERED", afterPredicate: c.p, declinedFloor: c.declinedFloor, direction: c.direction });
    expect(disagree(cases, then, allows)).toEqual(agree);
    expect(answers(cases, then)).toBe(2);
  });

  it("the small readers of a typed price: a set-down's floor and price, complete_run's protective rung, Agent Watch", () => {
    const cases = all.flatMap((p) => DIRECTIONS.map((direction) => ({ p, direction })));
    // The set-down's floor (trigger-evaluator.ts) and the price it records (demote.ts) both come from levelOf.
    const { levelOf } = jest.requireActual(".") as typeof import(".");
    expect(
      disagree(cases, (c) => kinds.demoteFloor(c.p, c.direction), (c) => {
        const l = levelOf(shapeOf(c.p)!);
        return l != null && l.above === (c.direction === "SHORT") ? l.value : null;
      }),
    ).toEqual(agree);
    expect(disagree(all, (p) => kinds.priceOf(p) ?? 0, (p) => levelOf(shapeOf(p)!)?.value ?? 0)).toEqual(agree);
    expect(disagree(all, kinds.isProtectiveExitKind, (p) => isProtectiveLine(shapeOf(p)!))).toEqual(agree);
    expect(disagree(all, kinds.scheduleDays, (p) => agentWatchDays([{ predicate: p }]))).toEqual(agree);
    expect(answers(all, kinds.scheduleDays)).toBeGreaterThan(3);
  });

  it("the reject dialog lists the stock's own triggers with a number to adjust", () => {
    // One difference, on purpose: "N days after the report" has one number in the condition shape (two in its old kind).
    const differ = all.filter((p) => kinds.hadEditableNumber(p) !== carriesNumber(shapeOf(p)!));
    expect([...new Set(differ.map((p) => p.kind))]).toEqual(["EARNINGS_SINCE"]);
    expect(differ.every((p) => carriesNumber(shapeOf(p)!))).toBe(true);
    expect(answers(all, kinds.hadEditableNumber)).toBe(2);
  });
});
