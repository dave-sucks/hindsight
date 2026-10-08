/**
 * The situations module (lib/agent/situations): the lead a stock shows is
 * today's needsAction, a stock can be in several situations, and every rule
 * is today's computation.
 */
import { computeNeedsAction, type NeedsActionInput } from "@/lib/agent/needs-action";
import type { Trigger } from "@/lib/agent/triggers/types";
import { SITUATIONS, situationsFor } from "./index";
import type { BookInput, StockInput } from "./types";

const NOW = new Date("2026-05-09T21:00:00Z"); // a Saturday: no session, the last price is a close
const T0 = new Date("2026-04-01T00:00:00Z");

const trig = (id: string, action: string, predicate: unknown, extra: Record<string, unknown> = {}): Trigger =>
  ({ id, action, predicate, rationale: "r", cooldownDays: 0, ...extra }) as unknown as Trigger;
const below = (v: number) => ({ watch: "price", is: "below", value: v });
const above = (v: number) => ({ watch: "price", is: "above", value: v });
const fire = (triggerId: string, hoursAgo = 2) => ({
  type: "TRIGGER_FIRED",
  timestamp: new Date(NOW.getTime() - hoursAgo * 3_600_000),
  triggerId,
  runId: null,
});

function stock(over: { thesis?: Partial<NeedsActionInput["thesis"]>; work?: Partial<NeedsActionInput> } & Omit<Partial<StockInput>, "work"> = {}): StockInput {
  const { thesis, work, ...rest } = over;
  return {
    ticker: "TEST",
    // No setup to name unless a test asks for the ask.
    setupId: "NONE",
    work: {
      thesis: { id: "t1", direction: "LONG", status: "HOLDING", triggers: [], createdAt: T0, lastReviewedAt: NOW, ...thesis },
      latestQuote: { price: 100, changePct: 0 },
      now: NOW,
      ...work,
    },
    ...rest,
  };
}
const codes = (s: StockInput, book: BookInput = {}) => situationsFor(s, book, NOW).map((x) => x.code);

// A holding whose floor ($80) loses 20% of a $100k account: FLOOR_TOO_FAR.
const heldWithWideFloor = { avgCost: 100, quantity: 1000 };
const FLOOR = trig("floor", "EXIT", below(80));

describe("the lead is today's needsAction, even where today's order is a cycle", () => {
  it("a floor too far leads over a fired review", () => {
    const s = stock({
      thesis: { ...heldWithWideFloor, triggers: [FLOOR, trig("rev", "REVIEW", below(95))] },
      work: { activity: [fire("rev")], equity: 100_000 },
    });
    const list = situationsFor(s, {}, NOW);
    expect(computeNeedsAction(s.work)?.kind).toBe("FLOOR_TOO_FAR");
    expect(list[0].code).toBe("PROTECTION");
    expect(list[0].data.flag).toEqual(computeNeedsAction(s.work));
    expect(list.map((x) => x.code)).toContain("REVIEW_DUE");
  });

  it("a fired review leads over a sale true now", () => {
    const s = stock({
      thesis: { ...heldWithWideFloor, triggers: [FLOOR, trig("rev", "REVIEW", { watch: "repeat", value: 400 })] },
      work: { activity: [fire("rev")], latestQuote: { price: 75, changePct: 0 } },
    });
    const list = situationsFor(s, {}, NOW);
    expect(computeNeedsAction(s.work)?.kind).toBe("TRIGGER_FIRED");
    expect(list.map((x) => x.code)).toEqual(["REVIEW_DUE", "PROTECTIVE_SALE"]);
    expect(list[0].data.flag).toEqual(computeNeedsAction(s.work));
  });

  it("a sale true now leads over a floor too far", () => {
    const s = stock({
      thesis: { ...heldWithWideFloor, triggers: [FLOOR] },
      work: { latestQuote: { price: 75, changePct: 0 }, equity: 100_000 },
    });
    const list = situationsFor(s, {}, NOW);
    expect(computeNeedsAction(s.work)?.kind).toBe("TRIGGER_MATCHING_NOW");
    expect(list.map((x) => x.code)).toEqual(["PROTECTIVE_SALE", "PROTECTION"]);
    expect(list[0].data.flag).toEqual(computeNeedsAction(s.work));
  });

  it("among triggers true now, the first in the ladder leads: a review listed before a sale", () => {
    const s = stock({
      thesis: { triggers: [trig("rev", "REVIEW", below(90)), FLOOR] },
      work: { latestQuote: { price: 75, changePct: 0 } },
    });
    expect(codes(s)).toEqual(["REVIEW_DUE", "PROTECTIVE_SALE"]);
  });
});

describe("where a fire belongs", () => {
  it("a review watching a report is EARNINGS only", () => {
    const s = stock({ thesis: { triggers: [trig("er", "REVIEW", { watch: "report", value: 3 })] }, work: { activity: [fire("er")] } });
    expect(codes(s)).toEqual(["EARNINGS"]);
  });

  it("a sale watching a surprise is both the sale and EARNINGS, the sale first", () => {
    const s = stock({ thesis: { triggers: [trig("miss", "EXIT", { watch: "surprise", is: "miss", value: 0 })] }, work: { activity: [fire("miss")] } });
    expect(codes(s)).toEqual(["PROTECTIVE_SALE", "EARNINGS"]);
  });

  it("a review watching a filing is FILING", () => {
    const s = stock({ thesis: { triggers: [trig("8k", "REVIEW", { watch: "filing", value: "tier:MATERIAL" })] }, work: { activity: [fire("8k")] } });
    expect(codes(s)).toEqual(["FILING"]);
  });

  it("a review on a watch with no direction and no clock of its own is a quiet watch waking", () => {
    const s = stock({ thesis: { status: "WATCHING", direction: null, triggers: [trig("wake", "REVIEW", below(50))] }, work: { activity: [fire("wake")] } });
    expect(codes(s)).toEqual(["QUIET_WATCH_WOKE"]);
  });

  it("the same wake on a watch with its own review clock is a review", () => {
    const s = stock({
      thesis: { status: "WATCHING", direction: null, triggers: [trig("wake", "REVIEW", below(50)), trig("clock", "REVIEW", { watch: "repeat", value: 30 })] },
      work: { activity: [fire("wake")] },
    });
    expect(codes(s)).toEqual(["REVIEW_DUE"]);
  });

  it("a sale fire on a stock we don't hold has no home of its own: REVIEW_DUE carries it", () => {
    const s = stock({ thesis: { status: "WATCHING", triggers: [trig("wf", "EXIT", below(80))] }, work: { activity: [fire("wf")] } });
    const list = situationsFor(s, {}, NOW);
    expect(list.map((x) => x.code)).toEqual(["REVIEW_DUE"]);
    expect(list[0].data.flag).toEqual(computeNeedsAction(s.work));
  });

  it("a buy on a watch arrives; the same buy into a full analyst is blocked instead", () => {
    const buy = trig("buy", "ENTER", above(95), { lastFiredAt: new Date(NOW.getTime() - 3_600_000).toISOString() });
    const s = stock({ thesis: { status: "WATCHING", triggers: [buy] }, work: { activity: [fire("buy")] }, ownTriggers: [buy] });
    expect(codes(s)).toEqual(["BUY_ARRIVES"]);
    const full: BookInput = { capacity: { open: 4, max: 4, held: ["A", "B", "C", "D"] } };
    expect(codes(s, full)).toEqual(["BUY_BLOCKED_FULL"]);
  });

  it("a buy with a proposal already waiting is left out, as today", () => {
    const s = stock({ thesis: { status: "WATCHING", triggers: [trig("buy", "ENTER", above(95))] }, work: { activity: [fire("buy")], hasPendingEntryProposal: true } });
    expect(codes(s)).toEqual([]);
  });

  it("an add on a holding, and a holding three quarters of the way to its target", () => {
    const s = stock({ thesis: { triggers: [trig("add", "ADD", above(95))] }, work: { activity: [fire("add")] } });
    expect(codes(s)).toEqual(["ADD_OR_WINNER"]);
    const near = stock({ resolved: { planSanity: null, actionability: "ACTIVE_HOLD", floorRisk: null, progressToTarget: 0.8, triggerDetail: null } });
    expect(codes(near)).toEqual(["ADD_OR_WINNER"]);
    expect(situationsFor(near, {}, NOW)[0].data.flag).toBeUndefined();
  });
});

describe("the other sources", () => {
  const resolved = (over: Record<string, unknown>) => ({ planSanity: null, actionability: "WAIT_FOR_TRIGGER" as const, floorRisk: null, progressToTarget: null, triggerDetail: null, ...over });

  it("every plan check rides on PLAN_PROBLEM with its text; STALE_PAST_CATALYST joins it", () => {
    const flags = [
      { kind: "ENTRY_FAR_FROM_PRICE" as const, text: "far" },
      { kind: "NO_BUY_LEVEL" as const, text: "none" },
    ];
    const s = stock({ thesis: { status: "WATCHING" }, resolved: resolved({ planSanity: flags, actionability: "STALE_PAST_CATALYST" }) });
    const list = situationsFor(s, {}, NOW);
    expect(list.map((x) => x.code)).toEqual(["PLAN_PROBLEM"]);
    expect(list[0].data).toEqual({ codes: [...flags, { kind: "STALE_PAST_CATALYST", text: null }] });
  });

  it("a level the resolver reads as reached is a buy arriving, with no flag to paint", () => {
    const s = stock({ thesis: { status: "WATCHING" }, resolved: resolved({ actionability: "ENTER_NOW", triggerDetail: "above $95" }) });
    const list = situationsFor(s, {}, NOW);
    expect(list.map((x) => x.code)).toEqual(["BUY_ARRIVES"]);
    expect(list[0].data).toEqual({ flag: undefined, fires: [], levelReached: { triggerDetail: "above $95" } });
  });

  it("a seed due its first research, a review due, stale research, a promoted stock", () => {
    const clock = trig("clock", "REVIEW", { watch: "repeat", value: 7 });
    expect(codes(stock({ thesis: { status: "WATCHING", direction: null, triggers: [clock], lastReviewedAt: null } }))).toEqual(["FIRST_RESEARCH"]);
    expect(codes(stock({ thesis: { triggers: [clock], lastReviewedAt: T0 } }))).toEqual(["REVIEW_DUE"]);
    const old = new Date(NOW.getTime() - 400 * 86_400_000);
    expect(codes(stock({ thesis: { researchUpdatedAt: old, horizon: "TRADE" } }))).toEqual(["STALE_RESEARCH"]);
    expect(codes(stock({ thesis: { status: "PROMOTED" } }))).toEqual(["PROMOTED_AWAITING"]);
  });

  it("stale research a review clock outranks today is still on the list, second", () => {
    const old = new Date(NOW.getTime() - 400 * 86_400_000);
    const s = stock({
      thesis: { researchUpdatedAt: old, horizon: "TRADE", triggers: [trig("clock", "REVIEW", { watch: "repeat", value: 7 })], lastReviewedAt: T0 },
    });
    expect(computeNeedsAction(s.work)?.kind).toBe("REVIEW_DUE");
    expect(codes(s)).toEqual(["REVIEW_DUE", "STALE_RESEARCH"]);
  });

  it("the principal's word, a sold stock's one look, a setup to name", () => {
    expect(codes(stock({ unansweredDecision: { at: NOW, line: "Note: hold through the print", wantsAnswer: true } }))).toEqual(["YOUR_WORD_UNANSWERED"]);
    const sold = stock({
      thesis: { status: "RETIRED", triggers: [] },
      sold: { ticker: "TEST", status: "RETIRED", retiredReason: "SOLD", closedAt: new Date(NOW.getTime() - 86_400_000), closeReason: "STOP", exitPrice: 10, realizedPnl: 5, realizedPnlPct: 1, beliefSurvived: null, catalystDate: null, answered: false },
    });
    expect(codes(sold)).toEqual(["SOLD_ONE_REVIEW"]);
    expect(codes(stock({ setupId: null, setupChoices: null }))).toEqual(["NO_SETUP_NAMED"]);
  });

  it("a declined sale is the protective sale, and leads", () => {
    const s = stock({
      thesis: { triggers: [FLOOR] },
      work: { latestQuote: { price: 75, changePct: 0 }, declinedSale: { declineCount: 2, lastDeclinedAt: NOW.toISOString(), rejectMessage: "hold", floorPrice: 80, recentLow: 74 } },
    });
    const list = situationsFor(s, {}, NOW);
    expect(list.map((x) => x.code)).toEqual(["PROTECTIVE_SALE"]);
    expect(list[0].data.flag?.kind).toBe("SALE_DECLINED");
  });
});

// ─── Over a generated book ───────────────────────────────────────────────────

let seed = 4242;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];

function generated(): { s: StockInput; book: BookInput } {
  const now = pick([NOW, new Date("2026-05-11T15:00:00Z")]);
  const triggers = Array.from({ length: Math.floor(rnd() * 5) }, (_, i) => {
    const action = pick(["ENTER", "EXIT", "TRIM", "ADD", "REVIEW"]);
    const kind = pick(["above", "below", "repeat", "report", "filing"]);
    const predicate =
      kind === "repeat" ? { watch: "repeat", value: pick([1, 7, 30]) } :
      kind === "report" ? { watch: "surprise", is: "beat", value: 0 } :
      kind === "filing" ? { watch: "filing", value: "tier:MATERIAL" } :
      { watch: "price", is: kind, value: pick([80, 95, 100, 105, 120]) };
    return trig(`t${i}`, action, predicate, {
      cooldownDays: pick([0, 1, 7]),
      ...(rnd() < 0.3 ? { lastFiredAt: new Date(now.getTime() - pick([1, 3, 10]) * 86_400_000).toISOString() } : {}),
      ...(rnd() < 0.3 ? { level: "ACCOUNT" } : {}),
    });
  });
  const status = pick(["HOLDING", "WATCHING", "PROMOTED"]);
  const watching = status === "WATCHING";
  const activity = Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({
    type: pick(["TRIGGER_FIRED", "TRIGGER_FIRED", "UPDATED", "NOTE"]),
    timestamp: new Date(now.getTime() - (i + 1) * 3_600_000 * pick([1, 5, 30])),
    triggerId: pick([...triggers.map((t) => t.id), "gone"]),
    runId: rnd() < 0.5 ? "run1" : null,
    summary: "s",
  }));
  const s: StockInput = {
    ticker: "GEN",
    work: {
      thesis: {
        // A holding has a direction; only a watch can be a seed or a quiet watch.
        id: "g", direction: watching ? pick(["LONG", "SHORT", null]) : pick(["LONG", "SHORT"]), status, triggers, createdAt: T0,
        lastReviewedAt: rnd() < 0.5 ? null : new Date(now.getTime() - pick([1, 10, 40]) * 86_400_000),
        researchUpdatedAt: rnd() < 0.2 ? undefined : rnd() < 0.3 ? null : new Date(now.getTime() - pick([2, 20, 90]) * 86_400_000),
        horizon: pick([null, "CATALYST", "COMPOUNDER", "TRADE"]),
        avgCost: rnd() < 0.7 ? pick([80, 90, 100]) : null,
        peakPrice: rnd() < 0.5 ? pick([110, 130]) : null,
        quantity: rnd() < 0.7 ? pick([10, 100, 1000]) : null,
      },
      activity,
      latestQuote: rnd() < 0.85 ? { price: pick([70, 85, 92, 100, 104, 110, 125]), changePct: 1 } : null,
      now,
      hasPendingEntryProposal: rnd() < 0.2,
      declinedSale: status === "HOLDING" && rnd() < 0.1 ? { declineCount: 2, lastDeclinedAt: now.toISOString(), rejectMessage: "no", floorPrice: 90, recentLow: 85 } : null,
      recentUpdates: rnd() < 0.5 ? activity.map((a) => ({ ...a, fieldChanges: null })) : undefined,
      equity: rnd() < 0.6 ? pick([10_000, 100_000]) : null,
    },
    setupId: pick([null, "PEAD", "NONE"]),
    entryPrice: pick([null, 95]),
    ownTriggers: triggers,
    // As the resolver gives them: plan checks and the watch labels on a watch only.
    resolved: rnd() < 0.7
      ? {
          planSanity: watching && rnd() < 0.3 ? [{ kind: "ENTRY_FAR_FROM_PRICE", text: "far" }] : null,
          actionability: watching ? pick(["ENTER_NOW", "WAIT_FOR_TRIGGER", "STALE_PAST_CATALYST"] as const) : status === "HOLDING" ? ("ACTIVE_HOLD" as const) : ("PROMOTED_DECIDE_TODAY" as const),
          floorRisk: null,
          progressToTarget: status === "HOLDING" && rnd() < 0.3 ? pick([0.5, 0.8, 1.2]) : null,
          triggerDetail: null,
        }
      : null,
    unansweredDecision: rnd() < 0.1 ? { at: now, line: "Note: x", wantsAnswer: true } : null,
  };
  const book: BookInput = rnd() < 0.3 ? { capacity: { open: 4, max: 4, held: ["A"] } } : {};
  return { s, book };
}

describe("over 20,000 generated stocks", () => {
  it("the first situation carries today's needsAction, unchanged; with none, no situation carries a flag", () => {
    let led = 0;
    for (let n = 0; n < 20_000; n++) {
      const { s, book } = generated();
      const lead = computeNeedsAction(s.work);
      const list = situationsFor(s, book, s.work.now);
      if (lead) {
        led++;
        expect(list[0]?.data.flag).toEqual(lead);
      } else {
        expect(list.every((x) => x.data.flag === undefined)).toBe(true);
      }
    }
    expect(led).toBeGreaterThan(10_000);
  });

  it("a situation for holdings never lands on a watched stock, and one for watched stocks never on a holding", () => {
    for (let n = 0; n < 5_000; n++) {
      const { s, book } = generated();
      for (const x of situationsFor(s, book, s.work.now)) {
        const def = SITUATIONS.find((d) => d.code === x.code)!;
        if (def.appliesTo === "held") expect(s.work.thesis.status).not.toBe("WATCHING");
        if (def.appliesTo === "watched") expect(s.work.thesis.status).not.toBe("HOLDING");
      }
    }
  });
});

describe("the definitions", () => {
  it("sixteen, each with its own order and an entry", () => {
    expect(SITUATIONS).toHaveLength(16);
    expect(new Set(SITUATIONS.map((d) => d.order)).size).toBe(16);
    for (const d of SITUATIONS) expect(["line", "row", "full"]).toContain(d.entry);
  });
});
