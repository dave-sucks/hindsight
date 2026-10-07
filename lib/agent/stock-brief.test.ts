/**
 * stock-brief.test.ts — the one way an agent reads a stock.
 *
 * The rows below are shaped like get_theses's recorded rows: a live row
 * (stored triggers, the resolver's envelope) and a row saved before the
 * brief (worded triggers, no position or score date).
 */
import { planLine, priceLine, scoreLine, stockBrief, stockLine, type StockRow } from "@/lib/agent/stock-brief";

const floor = { id: "t_floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 287.3 }, rationale: "Under the reclaimed 200-day.", cooldownDays: 1, lastFiredAt: "2026-10-01T14:00:00Z", source: "AGENT" };
const target = { id: "t_target", action: "REVIEW", predicate: { watch: "price", is: "above", value: 360 }, rationale: "The target.", source: "PRINCIPAL" };
const trail = { id: "a_trail", level: "ANALYST", action: "EXIT", predicate: { watch: "move", is: "below", value: 25, variable: "peak" }, rationale: "The analyst's only automatic sale." };

/** A held stock as get_theses records it live. */
function held(over: Partial<StockRow> = {}): StockRow {
  return {
    id: "t_ceg",
    ticker: "CEG",
    status: "HOLDING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    coreBelief: "CEG compounds to $360.",
    keyAssumptions: ["The PPA starts in 2027."],
    invalidationConds: ["The PPA is cancelled."],
    entryPrice: 282.01,
    targetPrice: 360,
    stopLoss: 287.3,
    catalystDate: null,
    conviction: "HIGH",
    convictionRationale: "Long reasons nobody reads.",
    variantView: "Consensus sees a utility.",
    scoring: { composite: 8, trendStrength: { score: 3, note: "a" }, relativeStrength: { score: 2, note: "b" }, entryQuality: { score: 1, note: "c" }, catalystFreshness: { score: 2, note: "d" } },
    snapshot: { text: "CEG trades at $299.05 [STRUCTURED:quote_current] after the deal [WEB:https://example.com/a].", citations: ["x"] },
    bullCase: { bullets: [{ text: "Contracted revenue [WEB:https://example.com/b].", citation: "y" }] },
    bearCase: { bullets: [{ text: "Revenue lags to 2027." }] },
    triggers: [floor, target],
    inheritedTriggers: [trail],
    context: "WHAT'S BEEN SAID ON $CEG\nLast look: trigger run, 10-06 09:30 at $296.85 — \"Adding.\"\nNothing since.",
    needsAction: null,
    resolved: {
      currentPrice: 296.7,
      quoteAgeMs: 60_000,
      resolvedAt: "2026-10-07T12:00:00.000Z",
      unrealizedGainPct: 5.2071,
      progressToTarget: 0.1883,
      ladderHealth: { summary: "+5.2% from entry; floor locks +1.9%; trail on", gainPct: 5.2 },
      planSanity: null,
      floorRisk: null,
      triggerState: "NONE",
      triggerDetail: null,
      actionability: "ACTIVE_HOLD",
      supersededBy: null,
      staleness: "FRESH",
      entryQualityScore: 1,
    },
    setup: { id: "COMPOUNDER_ACCUMULATION", name: "Compounder accumulation", confirm: ["Thesis intact"], chaseLimitPct: null, failureSigns: ["Guidance cut"], manage: "No automatic sale under 25%.", time: "60 days.", partialAtR: null, beatAndFadeReview: false },
    nameTheSetup: null,
    buyBlockedByFull: null,
    researchAge: { daysOld: 28, freshness: "fresh", horizonThreshold: 90 },
    researchUpdatedAt: "2026-09-09T12:00:00.000Z",
    researchPriceThen: 299.05,
    scoredAt: { at: "2026-09-20T14:00:00.000Z", price: 301.5 },
    unapprovedExitCount: 1,
    heldThroughFloor: null,
    position: { quantity: 51, avgCost: 282.01, openedAt: "2026-08-13T14:00:00.000Z", peakPrice: 308.07 },
    history: [{ id: "u1" }],
    triggerCount: 3,
    createdAt: "2026-08-01T00:00:00.000Z",
    sourceKind: "WRITER",
    ...over,
  };
}

describe("stockBrief — a stock in full", () => {
  it("reads in the plan's order: who and the price, why it is listed, what's been said, the plan, the triggers, the belief, the score, the setup, the research", () => {
    const b = stockBrief(held({ needsAction: { kind: "UNPROTECTED_GAIN", unrealizedGainPct: 22 } }), { named: false });
    expect(Object.keys(b)).toEqual([
      "id", "ticker", "status", "direction", "horizon", "price",
      "playbooks", "needsAction",
      "context",
      "plan", "position", "unrealizedGainPct", "progressToTarget", "ladderHealth", "unapprovedExitCount",
      "triggers",
      "coreBelief", "keyAssumptions", "invalidationConds",
      "score", "conviction", "variantView",
      "setup",
      "research", "snapshot", "bullCase", "bearCase",
    ]);
  });

  it("is deterministic: the same facts give the same bytes", () => {
    expect(JSON.stringify(stockBrief(held(), { named: true }))).toBe(JSON.stringify(stockBrief(held(), { named: true })));
  });

  it("sends none of the bookkeeping, the per-call timestamps, the score notes or the conviction rationale", () => {
    const b = stockBrief(held(), { named: false });
    for (const k of ["resolved", "triggerCount", "createdAt", "sourceKind", "scoring", "convictionRationale", "researchUpdatedAt", "researchPriceThen", "scoredAt", "inheritedTriggers", "history", "nameTheSetup", "buyBlockedByFull", "heldThroughFloor"]) {
      expect(b).not.toHaveProperty(k);
    }
    expect(JSON.stringify(b)).not.toContain("resolvedAt");
    expect(JSON.stringify(b)).not.toContain("ACTIVE_HOLD");
  });

  it("writes the price with when it printed, the plan against it, the position, and the score with its date and price", () => {
    const b = stockBrief(held(), { named: false });
    expect(b.price).toBe("$296.70 (10-07 07:59)");
    expect(b.plan).toBe("buy $282.01 (5.0% under the price) · target $360.00 (21.3% over the price) · floor $287.30 (3.2% under the price)");
    expect(b.position).toBe("51 shares at $282.01, bought 2026-08-13; tracked high $308.07");
    expect(b.unrealizedGainPct).toBe(5.2);
    expect(b.progressToTarget).toBe(0.19);
    expect(b.ladderHealth).toBe("+5.2% from entry; floor locks +1.9%; trail on");
    expect(b.score).toBe("8/10 — trend 3/3, relative strength 2/3, entry 1/2, catalyst 2/2; scored 2026-09-20 at $301.50");
    expect(b.research).toBe("Written 2026-09-09 at $299.05, 28 days ago.");
  });

  it("words each trigger with its id; keeps the reason it was set, and says so when the principal set it", () => {
    const b = stockBrief(held(), { named: false });
    expect(b.triggers).toEqual([
      { id: "t_floor", says: "Sell if below $287.30", rationale: "Under the reclaimed 200-day." },
      { id: "t_target", says: "Review if above $360", rationale: "The target.", setBy: "PRINCIPAL" },
    ]);
  });

  it("ABT 10-07: the review the principal added by hand keeps its marker, as main's read carried it", () => {
    const fromRead = { id: "4503a4f5-f854-41df-aed3-3913027d5650", says: "Review if above $10", rationale: "Review if above $10. You set this.", cooldownDays: 1, setBy: "PRINCIPAL" };
    const b = stockBrief({ id: "cmspld5md000504l72u7ft9ve", ticker: "ABT", status: "WATCHING", direction: "LONG", triggers: [fromRead] }, { named: false });
    expect(b.triggers).toEqual([
      { id: "4503a4f5-f854-41df-aed3-3913027d5650", says: "Review if above $10", rationale: "Review if above $10. You set this.", setBy: "PRINCIPAL" },
    ]);
  });

  it("adds the analyst's and the account's triggers only when a reader asks (the trigger run's one stock)", () => {
    const b = stockBrief(held(), { named: true, inherited: true });
    expect((b.triggers as Array<{ id: string; setOn?: string; rationale?: string }>).find((t) => t.id === "a_trail")).toEqual({
      id: "a_trail",
      says: "Sell if below 25% from the high since we bought",
      setOn: "analyst",
    });
  });

  it("strips the writer's source markers and citations from the research text; the screen keeps them", () => {
    const b = stockBrief(held(), { named: false });
    expect(b.snapshot).toBe("CEG trades at $299.05 after the deal.");
    expect(b.bullCase).toEqual(["Contracted revenue."]);
    expect(b.bearCase).toEqual(["Revenue lags to 2027."]);
  });

  it("keeps the setup's checklist without its empty parts", () => {
    expect(stockBrief(held(), { named: false }).setup).toEqual({
      id: "COMPOUNDER_ACCUMULATION",
      name: "Compounder accumulation",
      confirm: ["Thesis intact"],
      failureSigns: ["Guidance cut"],
      manage: "No automatic sale under 25%.",
      time: "60 days.",
    });
  });

  it("history only on a read of named stocks; the score's notes only when the research is asked for", () => {
    expect(stockBrief(held(), { named: true }).history).toEqual([{ id: "u1" }]);
    expect(stockBrief(held(), { named: false, research: true }).scoreNotes).toEqual({ trend: "a", "relative strength": "b", entry: "c", catalyst: "d" });
  });
});

describe("stockBrief — why the stock is on the list, gathered in the code's order", () => {
  it("a fired sale leads; the floor's risk follows it, since the run answers both", () => {
    const b = stockBrief(
      held({
        needsAction: { kind: "TRIGGER_FIRED", triggerId: "t_floor", action: "EXIT", summary: "price < $287.30", firedAt: "2026-10-06T19:55:00.000Z" },
        resolved: { ...held().resolved, floorRisk: { line: "Floor $250 loses 1.8% of the account." } },
      }),
      { named: false },
    );
    expect(Object.keys(b).slice(6, 9)).toEqual(["playbooks", "needsAction", "floorRisk"]);
    expect(b.playbooks).toEqual(["protective-sale", "protection"]);
    // The flag's trigger reads as the trigger list words it, and its time in Eastern.
    expect(b.needsAction).toEqual({ kind: "TRIGGER_FIRED", triggerId: "t_floor", action: "EXIT", summary: "Sell if below $287.30", firedAt: "10-06 15:55" });
    expect(b.floorRisk).toBe("Floor $250 loses 1.8% of the account.");
  });

  it("a flag that only repeats the lead is left out", () => {
    const b = stockBrief(
      held({
        needsAction: { kind: "FLOOR_TOO_FAR", line: "Floor $250 loses 1.8% of the account." },
        resolved: { ...held().resolved, floorRisk: { line: "Floor $250 loses 1.8% of the account." } },
        heldThroughFloor: { floorPrice: 287.3, heldThroughCount: 2 },
      }),
      { named: false },
    );
    expect(b).not.toHaveProperty("floorRisk");
    expect(b.heldThroughFloor).toEqual({ floorPrice: 287.3, heldThroughCount: 2 });
    const declined = stockBrief(held({ needsAction: { kind: "SALE_DECLINED", declineCount: 2 }, heldThroughFloor: { floorPrice: 287.3 } }), { named: false });
    expect(declined).not.toHaveProperty("heldThroughFloor");
  });

  it("plan flags, the full-analyst ask, the setup ask, old research and the resolver's telling labels ride with them", () => {
    const b = stockBrief(
      held({
        status: "WATCHING",
        position: null,
        needsAction: { kind: "REVIEW_DUE", daysOverdue: 0 },
        resolved: { ...held().resolved, actionability: "STALE_PAST_CATALYST", planSanity: [{ kind: "ENTRY_FAR_FROM_PRICE", text: "The buy level is 17% above the price." }] },
        buyBlockedByFull: "This analyst is full.",
        nameTheSetup: { ask: "Name the setup.", choose: [] },
        researchAge: { daysOld: 120, freshness: "stale", horizonThreshold: 90 },
      }),
      { named: false },
    );
    expect(Object.keys(b).slice(6, 14)).toEqual(["playbooks", "needsAction", "planSanity", "buyBlockedByFull", "nameTheSetup", "researchAge", "actionability", "context"]);
    expect(b.playbooks).toEqual(["stale-research", "plan-problems", "default-review"]);
    expect(b.researchAge).toEqual({ daysOld: 120, threshold: 90, freshness: "stale" });
    expect(b.actionability).toBe("STALE_PAST_CATALYST");
    // Not held: no position numbers.
    expect(b).not.toHaveProperty("position");
    expect(b).not.toHaveProperty("unrealizedGainPct");
  });

  it("a reader that carries its playbooks another way gets no row keys (the trigger run's kickoff)", () => {
    const stale = held({ needsAction: { kind: "RESEARCH_STALE", daysOld: 120, threshold: 90 }, researchAge: { daysOld: 120, freshness: "stale", horizonThreshold: 90 } });
    expect(stockBrief(stale, { named: true }).playbooks).toEqual(["stale-research"]);
    expect(stockBrief(stale, { named: true, inherited: true, playbooks: false })).not.toHaveProperty("playbooks");
  });

  it("stale research is said once: not again when it is the lead", () => {
    const b = stockBrief(held({ needsAction: { kind: "RESEARCH_STALE", daysOld: 120, threshold: 90, freshness: "stale" }, researchAge: { daysOld: 120, freshness: "stale", horizonThreshold: 90 } }), { named: false });
    expect(b).not.toHaveProperty("researchAge");
  });
});

describe("stockBrief — a row saved before the brief", () => {
  it("reads its worded triggers as they were, and leaves out what it lacks", () => {
    const old: StockRow = {
      id: "t_iot",
      ticker: "IOT",
      status: "WATCHING",
      direction: "LONG",
      entryPrice: 39,
      triggers: [{ id: "x", says: "Buy if below $39", rationale: "Pullback.", cooldownDays: 1, lastFiredAt: "2026-10-01", setBy: "AGENT" }],
      resolved: { currentPrice: null },
      researchAge: { daysOld: 18, freshness: "fresh" },
    };
    const b = stockBrief(old, { named: false });
    expect(b.triggers).toEqual([{ id: "x", says: "Buy if below $39", rationale: "Pullback." }]);
    expect(b.price).toBe("no live price");
    expect(b.plan).toBe("buy $39.00");
    expect(b.research).toBe("Written 18 days ago.");
    expect(b).not.toHaveProperty("score");
  });
});

describe("stockBrief — a thesis that ended", () => {
  it("says when and why, on a read of retired or passed stocks only", () => {
    const ended = stockBrief(held({ status: "RETIRED", closedAt: "2026-09-30T19:00:00Z", closeReason: "STOP", invalidReason: null }), { named: true });
    expect(ended.closedAt).toBe("2026-09-30");
    expect(ended.closeReason).toBe("STOP");
    expect(ended).not.toHaveProperty("invalidReason");
    expect(stockBrief(held({ closedAt: "2026-09-30T19:00:00Z", closeReason: "STOP" }), { named: true })).not.toHaveProperty("closeReason");
  });
});

describe("the line pieces", () => {
  it("a price without its print time is the price alone", () => {
    expect(priceLine({ currentPrice: 12.5 })).toBe("$12.50");
  });
  it("a short plan pays from the buy the other way", () => {
    expect(planLine({ direction: "SHORT", entryPrice: 100, targetPrice: 80, stopLoss: 110 }, 100)).toBe(
      "buy $100.00 (0.0% over the price) · target $80.00 (20.0% under the price) · floor $110.00 (10.0% over the price); pays 2.0:1 from the buy",
    );
  });
  it("a score with no date of its own takes the research's", () => {
    expect(scoreLine({ scoring: { composite: 5 }, researchUpdatedAt: "2026-09-02T12:00:00Z", researchPriceThen: 369.41 })).toBe("5/10; scored 2026-09-02 at $369.41");
  });
});

describe("stockLine — one stock, one line", () => {
  it("who it is, the plan against the price, the score, the belief, when it is next looked at", () => {
    expect(
      stockLine({
        id: "t_ndaq", ticker: "NDAQ", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", conviction: "MEDIUM", composite: 7,
        coreBelief: "Compounds.", entryPrice: 80, targetPrice: null, stopLoss: null, currentPrice: 88, reviewDueAt: "2026-10-20T12:00:00Z",
        catalystDate: null, triggerCount: 2, researchAge: { daysOld: 12, freshness: "fresh" }, resolvedActionability: "WAIT_FOR_TRIGGER", needsAction: null,
      }),
    ).toEqual({
      id: "t_ndaq", ticker: "NDAQ", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", price: "$88.00",
      plan: "buy $80.00 (9.1% under the price)", score: "7/10", conviction: "MEDIUM", coreBelief: "Compounds.", reviewDue: "2026-10-20", research: "12 days old",
    });
  });
});

describe("standingRules — the analyst's and the account's rules, once for a read", () => {
  it("each as its sentence and id, where it is set, and which stocks it reaches when not all", () => {
    const { standingRules } = jest.requireActual("@/lib/agent/stock-brief") as typeof import("@/lib/agent/stock-brief");
    const rules = standingRules([
      { trigger: { id: "a1", level: "ANALYST", action: "EXIT", predicate: { watch: "move", is: "below", value: 25, variable: "peak" }, rationale: "The only automatic sale." }, appliesTo: "held" },
      { trigger: { id: "c1", level: "ACCOUNT", action: "REVIEW", predicate: { watch: "report", is: "before", value: 5 } } },
    ]);
    expect(rules).toEqual([
      { id: "a1", says: "Sell if below 25% from the high since we bought", setOn: "analyst", appliesTo: "held" },
      { id: "c1", says: "Review if within 5 days before earnings", setOn: "account" },
    ]);
  });
});
