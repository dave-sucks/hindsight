/**
 * decision.nothing-on-it.test.ts — a directional view saved with nothing on
 * it can never come back; the writer's own check says so, in its loop
 * (DAV-291).
 *
 * Replay: $LUXE, PEAD Specialist, production 2026-09-18 06:53Z — the real
 * `submit_thesis` input. Two sessions after a +111% EPS beat that gapped
 * 17% on 18× volume. The reasoning was sound ("the gap used up the edge; I
 * want to price a drift or pullback entry rather than buying now") and the
 * save was LONG, PEAD, no entry, no stop, no target, no triggers, no review.
 * It was accepted. That morning the PEAD analyst watched eight stocks with
 * zero buy plans.
 */
import { validateThesisDecision, type ThesisDecisionInput } from "./decision";
import { setupsFor } from "./decision.test-helpers";
import { computePlanSanity } from "@/lib/agent/plan-sanity";

/** The writer's submit_thesis input, verbatim from the run's messages. */
const LUXE_SUBMIT = {
  "conviction": "MEDIUM",
  "conviction_rationale": "The beat quality is real \u2014 +111% EPS, all three segments to growth, EBITDA positive \u2014 but the 17.3% gap has already digested most of the surprise, JP Morgan stayed Neutral at $10, and the trend template is failing. I want the pullback entry, not the chase.",
  "core_belief": "LUXE drifts to $10.39\u2013$11.38 within 45 days as sell-side estimate revisions follow the Q4 all-segments beat-and-raise, institutional accumulation continues in a thinly covered name, and the EBITDA break-even narrative attracts new buyers who missed the gap day.",
  "direction": "LONG",
  "horizon": "TARGET",
  "invalidation_conditions": [
    "Any segment \u2014 Mytheresa, NET-A-PORTER/MR PORTER, or YOOX \u2014 reports a return to GMV decline in Q1 FY2027, invalidating the all-segments inflection thesis.",
    "The stock closes below the 2026-09-16 gap-day low of $7.88 on above-average volume, filling the gap and signaling the market is rejecting the earnings repricing."
  ],
  "key_assumptions": [
    "All three segments sustain positive GMV growth in Q1 FY2027, confirming the Q4 inflection is durable and not driven by one-time tariff refunds (IEEPA items).",
    "Sell-side estimate revisions continue upward in the 72-hour window post-print and beyond, with at least one neutral analyst upgrading within two weeks, providing institutional buying support for the drift."
  ],
  "rationale": "Q4 FY2026 was a clean operational beat \u2014 +111% EPS surprise, first simultaneous return to growth across all three segments, EBITDA break-even 15 months post-acquisition, Q4 GMV +7.9%. The gap (17.3%, 18\u00d7 volume) held convincingly with a +3.3% follow-through on day 2. However, the gap magnitude exceeds the PEAD strategy's 10% edge-consumed threshold, and R/R at current tape ($9.48) does not clear 2:1 at any structurally honest stop/target combination. The thesis is filed WATCHING: I want to price a drift or pullback entry if the stock retraces toward $8.41\u2013$8.72 over the next 1\u20132 weeks, at which point R/R improves and the MA_PULLBACK setup activates. Trend Template 5/8 (downtrend structure) limits conviction to MEDIUM; a breakout through $11.38 would change that.",
  "scoring": {
    "catalystFreshness": {
      "note": "Report was 2 days ago. All-segments beat-and-raise with +111% EPS, EBITDA break-even confirmed, FY2027 loss-halving guidance \u2014 fresh and multi-layered. Estimate revision window still open.",
      "score": 2
    },
    "entryQuality": {
      "note": "PEAD entry condition is open (days 1-3 post-print, price above gap-day low) but the 17.3% gap has consumed most of the edge and R/R at $9.48 does not clear 2:1 \u2014 filing WATCHING for a pullback entry rather than buying now. Score 1: within setup window but not a clean-entry condition.",
      "score": 1
    },
    "relativeStrength": {
      "note": "vs SPY: 1M +26.2pts, 3M +21.2pts, 6M +0.3pts; vs XLY: 1M +29.8pts. As computed: top tier. No adjustment.",
      "score": 3
    },
    "trendStrength": {
      "note": "Trend Template 5/8 \u2014 150-day falling, 200-day falling, 50-day below both. As computed: rally inside a structural downtrend. No adjustment.",
      "score": 0
    }
  },
  "setup_id": "PEAD",
  "variant_view": "Consensus anchors to JPM's $10 Neutral and sees the gap as the event; I think the all-segments inflection is the start of a multi-quarter EBITDA re-rating that lifts estimates repeatedly \u2014 falsifiable if Q1 FY2027 shows any segment reverting to decline."
} as unknown as ThesisDecisionInput;

/** The chart block the writer was given that run. */
const LUXE_CHART = {
  atr14: 0.53,
  pivot: 8.25,
  brokenOut: true,
  sma20: { value: 7.75, rising: false },
  sma50: { value: 7.91, rising: true },
  daysSinceReport: 2,
};

const check = (d: ThesisDecisionInput) =>
  validateThesisDecision(d, { mode: "mint", currentPrice: 9.48, setups: setupsFor(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]), chart: LUXE_CHART });

describe("LUXE 2026-09-18 — LONG with nothing on it", () => {
  it("is sent back with the pullback it said it was waiting for, priced from the chart", () => {
    const r = check(LUXE_SUBMIT);
    expect(r.ok).toBe(false);
    const msg = r.errors.join(" | ");
    expect(msg).toMatch(/can never come back/);
    expect(msg).toMatch(/MA_PULLBACK/);
    expect(msg).toContain("$7.91 (the rising 50-day)");
    expect(msg).not.toMatch(/7\.75/); // the 20-day is falling — not a level to buy
    expect(msg).toContain("1 ATR ($0.53)");
    expect(msg).toMatch(/REVIEW_CADENCE/);
  });

  it("the same view with a wake is accepted — an unpriced view is still legal", () => {
    const r = check({
      ...LUXE_SUBMIT,
      triggers: [{ predicate: { kind: "PRICE_BELOW", level: 8.6 }, action: "REVIEW", rationale: "Back to the second gap day's low — price the drift entry here if it holds." }],
    } as ThesisDecisionInput);
    expect(r.errors.filter((e) => e.startsWith("levels:"))).toEqual([]);
  });

  it("a PASS needs nothing on it", () => {
    const r = check({ direction: "PASS", rationale: "The gap used up the edge and nothing clears 2:1 from here." } as ThesisDecisionInput);
    expect(r.errors.filter((e) => e.startsWith("levels:"))).toEqual([]);
  });
});

describe("the six already on the book — get_theses puts them on the work list", () => {
  it("a LONG watch with no entry and no trigger of its own is flagged, with no live price needed", () => {
    const flags = computePlanSanity({ status: "WATCHING", direction: "LONG", entryPrice: null, targetPrice: null, stopLoss: null, currentPrice: null, ownTriggerCount: 0 });
    expect(flags.map((f) => f.kind)).toEqual(["NOTHING_CAN_WAKE"]);
  });
  it("one wake of its own is enough; so is a buy price; a seed and a held stock are never flagged", () => {
    const base = { status: "WATCHING", direction: "LONG", entryPrice: null, targetPrice: null, stopLoss: null, currentPrice: null } as const;
    expect(computePlanSanity({ ...base, ownTriggerCount: 1 })).toEqual([]);
    expect(computePlanSanity({ ...base, entryPrice: 7.91, ownTriggerCount: 0 })).toEqual([]);
    expect(computePlanSanity({ ...base, direction: null, ownTriggerCount: 0 })).toEqual([]);
    expect(computePlanSanity({ ...base, status: "HOLDING", ownTriggerCount: 0 })).toEqual([]);
  });
});
