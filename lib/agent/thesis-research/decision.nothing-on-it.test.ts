/**
 * decision.nothing-on-it.test.ts — a directional view saved with nothing on
 * it can never come back; the writer is told so after its save, where it
 * adds triggers now (DAV-291).
 *
 * Replay: $LUXE, PEAD Specialist, production 2026-09-18 06:53Z — the real
 * `submit_thesis` input. Two sessions after a +111% EPS beat that gapped
 * 17% on 18× volume. The reasoning was sound ("the gap used up the edge; I
 * want to price a drift or pullback entry rather than buying now") and the
 * save was LONG, PEAD, no entry, no stop, no target, no triggers, no review.
 * It was accepted. That morning the PEAD analyst watched eight stocks with
 * zero buy plans.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { validateThesisDecision, type ThesisDecisionInput } from "./decision";
import { ratedNow } from "@/lib/replay/rated";
import { tailorMessage } from "@/lib/agent/run-thesis-writer";
import type { Trigger } from "@/lib/agent/triggers/types";

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

const saved = (triggers: Trigger[]) =>
  tailorMessage({ ticker: "LUXE", decision: LUXE_SUBMIT, status: "WATCHING", direction: "LONG", triggers, notWritten: [] });

describe("LUXE 2026-09-18 — LONG with nothing on it", () => {
  it("the decision is accepted: its triggers come after the save", () => {
    expect(validateThesisDecision(ratedNow(LUXE_SUBMIT), { mode: "mint", currentPrice: 9.48 }).ok).toBe(true);
  });

  it("saved with no trigger, the writer is told it can never come back, with the two reviews that bring it back and no price of the code's", () => {
    const msg = saved([]);
    expect(msg).toMatch(/can never come back/);
    expect(msg).toContain('{watch:"repeat", value: days}');
    expect(msg).toContain("edit_triggers");
    expect(msg.slice(msg.indexOf("Saved."))).not.toMatch(/7\.91|7\.75|\$\d/);
  });

  it("saved with a wake, the writer is asked to tailor, not told it is stuck", () => {
    const msg = saved([{ id: "r1", action: "REVIEW", predicate: { watch: "price", is: "below", value: 8.6 }, rationale: "Back to the second gap day's low." } as Trigger]);
    expect(msg).not.toMatch(/can never come back/);
    expect(msg).toContain("[id r1]");
  });
});
