/**
 * evaluate.test.ts — coverage for the dual-consumer trigger evaluator.
 *
 * One match + one non-match per predicate kind, plus AND/OR composition
 * and shouldFire cooldown. Pure-function tests; no DB, no fetches.
 */

import { evaluateTrigger, shouldFire } from "./evaluate";
import type { EvaluationContext, EvaluationContextSignal } from "./evaluate";
import type { Trigger, TriggerPredicate } from "./types";

const NOW = new Date("2026-04-29T14:30:00Z");
const THESIS_CREATED = new Date("2026-04-01T00:00:00Z"); // 28 days before NOW

function makeCtx(partial: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    thesis: { createdAt: THESIS_CREATED, lastReviewedAt: null },
    now: NOW,
    ...partial,
  };
}

function makeSignal(
  partial: Partial<EvaluationContextSignal> = {},
): EvaluationContextSignal {
  return {
    type: "NEWS",
    sentiment: "NEUTRAL",
    urgency: "MEDIUM",
    tickers: ["NVDA"],
    ...partial,
  };
}

describe("evaluateTrigger", () => {
  // ── Price-based ─────────────────────────────────────────────────────

  describe("PRICE_ABOVE", () => {
    const predicate: TriggerPredicate = { kind: "PRICE_ABOVE", level: 100 };

    it("fires when latestQuote.price > level", () => {
      const ctx = makeCtx({ latestQuote: { price: 105, changePct: 5 } });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when latestQuote is missing", () => {
      expect(evaluateTrigger(predicate, makeCtx())).toBe(false);
    });

    it("does not fire when price equals level (strict greater-than)", () => {
      const ctx = makeCtx({ latestQuote: { price: 100, changePct: 0 } });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });
  });

  describe("PRICE_BELOW", () => {
    const predicate: TriggerPredicate = { kind: "PRICE_BELOW", level: 100 };

    it("fires when latestQuote.price < level", () => {
      const ctx = makeCtx({ latestQuote: { price: 95, changePct: -5 } });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when latestQuote is missing", () => {
      expect(evaluateTrigger(predicate, makeCtx())).toBe(false);
    });
  });

  describe("PRICE_MOVE_PCT", () => {
    // recentPrices: 30 days of synthetic closes leading up to NOW.
    // Day 0 (30 days ago) close = 100; +1/day; day 30 (NOW) close = 130.
    const recentPrices = Array.from({ length: 30 }, (_, i) => ({
      date: new Date(NOW.getTime() - (29 - i) * 86_400_000),
      close: 100 + i,
    }));

    // The 5D window tests that lived here are gone with the window itself
    // (2026-08-25). They passed by hand-feeding `recentPrices`, which no
    // production caller ever supplied — so the predicate was green in CI and
    // dead in the app for its entire existence. Only 1D remains, and it is
    // the path the cron actually exercises.

    // ── Daily move (the "Movement Amount" alert) — window 1D uses the quote's
    //    own daily % change (changePct), so it fires on the cron with no
    //    candle history. This is the path the cron actually exercises.
    describe("1D daily move via changePct (no recentPrices)", () => {
      it("UP fires when the day's change ≥ pct", () => {
        const predicate: TriggerPredicate = {
          kind: "PRICE_MOVE_PCT",
          pct: 5,
          direction: "UP",
          window: "1D",
        };
        const ctx = makeCtx({ latestQuote: { price: 105, changePct: 5.2 } });
        expect(evaluateTrigger(predicate, ctx)).toBe(true);
      });

      it("UP does not fire when the day's change is below pct", () => {
        const predicate: TriggerPredicate = {
          kind: "PRICE_MOVE_PCT",
          pct: 5,
          direction: "UP",
          window: "1D",
        };
        const ctx = makeCtx({ latestQuote: { price: 103, changePct: 3 } });
        expect(evaluateTrigger(predicate, ctx)).toBe(false);
      });

      it("DOWN fires when the day's change ≤ -pct", () => {
        const predicate: TriggerPredicate = {
          kind: "PRICE_MOVE_PCT",
          pct: 5,
          direction: "DOWN",
          window: "1D",
        };
        const ctx = makeCtx({ latestQuote: { price: 94, changePct: -6 } });
        expect(evaluateTrigger(predicate, ctx)).toBe(true);
      });

      it("DOWN does not fire on an UP day", () => {
        const predicate: TriggerPredicate = {
          kind: "PRICE_MOVE_PCT",
          pct: 5,
          direction: "DOWN",
          window: "1D",
        };
        const ctx = makeCtx({ latestQuote: { price: 106, changePct: 6 } });
        expect(evaluateTrigger(predicate, ctx)).toBe(false);
      });
    });
  });

  describe("GAIN_FROM_ENTRY", () => {
    const up10: TriggerPredicate = {
      kind: "GAIN_FROM_ENTRY",
      pct: 10,
      direction: "UP",
    };
    const down10: TriggerPredicate = {
      kind: "GAIN_FROM_ENTRY",
      pct: 10,
      direction: "DOWN",
    };

    it("UP fires when cumulative gain from avgCost reaches pct (LONG)", () => {
      const ctx = makeCtx({
        latestQuote: { price: 112, changePct: 1 },
        position: { avgCost: 100, peakPrice: 115 },
      });
      expect(evaluateTrigger(up10, ctx)).toBe(true);
    });

    it("UP does not fire below the milestone", () => {
      const ctx = makeCtx({
        latestQuote: { price: 105, changePct: 1 },
        position: { avgCost: 100, peakPrice: 115 },
      });
      expect(evaluateTrigger(up10, ctx)).toBe(false);
    });

    it("DOWN fires on drawdown-from-entry (the loser-attention case)", () => {
      const ctx = makeCtx({
        latestQuote: { price: 88, changePct: -2 },
        position: { avgCost: 100, peakPrice: 101 },
      });
      expect(evaluateTrigger(down10, ctx)).toBe(true);
    });

    it("DOWN does not fire while the position is up", () => {
      const ctx = makeCtx({
        latestQuote: { price: 112, changePct: 1 },
        position: { avgCost: 100, peakPrice: 115 },
      });
      expect(evaluateTrigger(down10, ctx)).toBe(false);
    });

    it("SHORT inverts: a price drop is the gain", () => {
      const ctx = makeCtx({
        latestQuote: { price: 85, changePct: -3 },
        position: { avgCost: 100, peakPrice: 84 },
        thesis: {
          createdAt: THESIS_CREATED,
          lastReviewedAt: null,
          direction: "SHORT",
        },
      });
      expect(evaluateTrigger(up10, ctx)).toBe(true);
      expect(evaluateTrigger(down10, ctx)).toBe(false);
    });

    it("SHORT drawdown: a price rise fires DOWN", () => {
      const ctx = makeCtx({
        latestQuote: { price: 112, changePct: 3 },
        position: { avgCost: 100, peakPrice: 98 },
        thesis: {
          createdAt: THESIS_CREATED,
          lastReviewedAt: null,
          direction: "SHORT",
        },
      });
      expect(evaluateTrigger(down10, ctx)).toBe(true);
      expect(evaluateTrigger(up10, ctx)).toBe(false);
    });

    it("returns false without position economics (WATCHING) or a quote", () => {
      expect(
        evaluateTrigger(up10, makeCtx({ latestQuote: { price: 112, changePct: 0 } })),
      ).toBe(false);
      expect(
        evaluateTrigger(up10, makeCtx({ position: { avgCost: 100, peakPrice: 115 } })),
      ).toBe(false);
      expect(
        evaluateTrigger(
          up10,
          makeCtx({
            latestQuote: { price: 112, changePct: 0 },
            position: { avgCost: 0, peakPrice: 115 },
          }),
        ),
      ).toBe(false);
    });
  });

  describe("TRAILING_FROM_HIGH", () => {
    const trail8: TriggerPredicate = { kind: "TRAILING_FROM_HIGH", pct: 8 };

    it("LONG fires when price gives back pct from the peak", () => {
      // peak 120 → trail 110.4
      const ctx = makeCtx({
        latestQuote: { price: 110, changePct: -2 },
        position: { avgCost: 100, peakPrice: 120 },
      });
      expect(evaluateTrigger(trail8, ctx)).toBe(true);
    });

    it("LONG fires at exactly the trail (≤ boundary)", () => {
      const ctx = makeCtx({
        latestQuote: { price: 110.4, changePct: -2 },
        position: { avgCost: 100, peakPrice: 120 },
      });
      expect(evaluateTrigger(trail8, ctx)).toBe(true);
    });

    it("LONG does not fire while inside the trail", () => {
      const ctx = makeCtx({
        latestQuote: { price: 111, changePct: -1 },
        position: { avgCost: 100, peakPrice: 120 },
      });
      expect(evaluateTrigger(trail8, ctx)).toBe(false);
    });

    it("SHORT trails off the low-water mark (price rising fires)", () => {
      // SHORT peakPrice = lowest seen = 80 → trail 86.4
      const shortCtx = (price: number) =>
        makeCtx({
          latestQuote: { price, changePct: 1 },
          position: { avgCost: 100, peakPrice: 80 },
          thesis: {
            createdAt: THESIS_CREATED,
            lastReviewedAt: null,
            direction: "SHORT",
          },
        });
      expect(evaluateTrigger(trail8, shortCtx(87))).toBe(true);
      expect(evaluateTrigger(trail8, shortCtx(86))).toBe(false);
    });

    it("returns false without a peak or a quote", () => {
      expect(
        evaluateTrigger(trail8, makeCtx({ latestQuote: { price: 110, changePct: 0 } })),
      ).toBe(false);
      expect(
        evaluateTrigger(
          trail8,
          makeCtx({
            latestQuote: { price: 110, changePct: 0 },
            position: { avgCost: 100, peakPrice: null },
          }),
        ),
      ).toBe(false);
    });
  });

  describe("VS_SMA", () => {
    it("fires when price is ABOVE SMA", () => {
      const predicate: TriggerPredicate = {
        kind: "VS_SMA",
        period: 50,
        direction: "ABOVE",
      };
      const ctx = makeCtx({
        latestQuote: { price: 110, changePct: 0 },
        sma: { 50: 100 },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when sma value missing", () => {
      const predicate: TriggerPredicate = {
        kind: "VS_SMA",
        period: 200,
        direction: "BELOW",
      };
      const ctx = makeCtx({
        latestQuote: { price: 110, changePct: 0 },
        sma: { 50: 100 }, // 200 not provided
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });
  });

  describe("RSI (v1 stub)", () => {
    it("always returns false (stub) — match case", () => {
      const predicate: TriggerPredicate = {
        kind: "RSI",
        threshold: 70,
        direction: "ABOVE",
      };
      expect(evaluateTrigger(predicate, makeCtx())).toBe(false);
    });

    it("always returns false (stub) — non-match case", () => {
      const predicate: TriggerPredicate = {
        kind: "RSI",
        threshold: 30,
        direction: "BELOW",
      };
      expect(evaluateTrigger(predicate, makeCtx())).toBe(false);
    });
  });

  // ── Signal-based ────────────────────────────────────────────────────

  describe("SIGNAL_TYPE", () => {
    it("fires on type match alone", () => {
      const predicate: TriggerPredicate = {
        kind: "SIGNAL_TYPE",
        signalType: "FILING",
      };
      const ctx = makeCtx({ signal: makeSignal({ type: "FILING" }) });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when signal type differs", () => {
      const predicate: TriggerPredicate = {
        kind: "SIGNAL_TYPE",
        signalType: "FILING",
      };
      const ctx = makeCtx({ signal: makeSignal({ type: "NEWS" }) });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });

    it("respects sentiment filter when set", () => {
      const predicate: TriggerPredicate = {
        kind: "SIGNAL_TYPE",
        signalType: "ANALYST_NOTE",
        sentiment: "BEARISH",
      };
      const matchCtx = makeCtx({
        signal: makeSignal({ type: "ANALYST_NOTE", sentiment: "BEARISH" }),
      });
      const mismatchCtx = makeCtx({
        signal: makeSignal({ type: "ANALYST_NOTE", sentiment: "BULLISH" }),
      });
      expect(evaluateTrigger(predicate, matchCtx)).toBe(true);
      expect(evaluateTrigger(predicate, mismatchCtx)).toBe(false);
    });

    it("respects minUrgency rank when set", () => {
      const predicate: TriggerPredicate = {
        kind: "SIGNAL_TYPE",
        signalType: "NEWS",
        minUrgency: "HIGH",
      };
      const matchCtx = makeCtx({
        signal: makeSignal({ type: "NEWS", urgency: "BREAKING" }),
      });
      const mismatchCtx = makeCtx({
        signal: makeSignal({ type: "NEWS", urgency: "MEDIUM" }),
      });
      expect(evaluateTrigger(predicate, matchCtx)).toBe(true);
      expect(evaluateTrigger(predicate, mismatchCtx)).toBe(false);
    });

    it("does not fire when no signal in context", () => {
      const predicate: TriggerPredicate = {
        kind: "SIGNAL_TYPE",
        signalType: "FILING",
      };
      expect(evaluateTrigger(predicate, makeCtx())).toBe(false);
    });
  });

  describe("EARNINGS_BEAT", () => {
    it("fires on positive surprise meeting minSurprisePct", () => {
      const predicate: TriggerPredicate = {
        kind: "EARNINGS_BEAT",
        minSurprisePct: 5,
      };
      const ctx = makeCtx({
        signal: makeSignal({ type: "EARNINGS", earningsSurprisePct: 8 }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when surprise is negative (a miss, not a beat)", () => {
      const predicate: TriggerPredicate = { kind: "EARNINGS_BEAT" };
      const ctx = makeCtx({
        signal: makeSignal({ type: "EARNINGS", earningsSurprisePct: -3 }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });

    it("does not fire when surprise pct missing on EARNINGS signal", () => {
      const predicate: TriggerPredicate = { kind: "EARNINGS_BEAT" };
      const ctx = makeCtx({
        signal: makeSignal({ type: "EARNINGS" }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });
  });

  describe("EARNINGS_MISS", () => {
    it("fires on negative surprise meeting absolute minSurprisePct", () => {
      const predicate: TriggerPredicate = {
        kind: "EARNINGS_MISS",
        minSurprisePct: 3,
      };
      const ctx = makeCtx({
        signal: makeSignal({ type: "EARNINGS", earningsSurprisePct: -5 }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when surprise is positive (a beat, not a miss)", () => {
      const predicate: TriggerPredicate = { kind: "EARNINGS_MISS" };
      const ctx = makeCtx({
        signal: makeSignal({ type: "EARNINGS", earningsSurprisePct: 2 }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });
  });

  describe("GUIDANCE_CHANGE", () => {
    it("fires when guidance direction matches", () => {
      const predicate: TriggerPredicate = {
        kind: "GUIDANCE_CHANGE",
        direction: "DOWN",
      };
      const ctx = makeCtx({
        signal: makeSignal({ type: "EARNINGS", guidanceDirection: "DOWN" }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when signal is not EARNINGS", () => {
      const predicate: TriggerPredicate = {
        kind: "GUIDANCE_CHANGE",
        direction: "DOWN",
      };
      const ctx = makeCtx({
        signal: makeSignal({ type: "NEWS", guidanceDirection: "DOWN" }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });
  });

  describe("FILING", () => {
    it("fires when formType matches and signal is FILING", () => {
      const predicate: TriggerPredicate = {
        kind: "FILING",
        formType: "8-K",
      };
      const ctx = makeCtx({
        signal: makeSignal({ type: "FILING", filingFormType: "8-K" }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when formType differs", () => {
      const predicate: TriggerPredicate = {
        kind: "FILING",
        formType: "8-K",
      };
      const ctx = makeCtx({
        signal: makeSignal({ type: "FILING", filingFormType: "10-Q" }),
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });
  });

  // ── Time-based ──────────────────────────────────────────────────────

  describe("TIME_ELAPSED", () => {
    it("fires when elapsed days >= threshold", () => {
      // thesis created 28d before NOW; threshold 7d → fires.
      const predicate: TriggerPredicate = { kind: "TIME_ELAPSED", days: 7 };
      expect(evaluateTrigger(predicate, makeCtx())).toBe(true);
    });

    it("does not fire when threshold not yet reached", () => {
      const predicate: TriggerPredicate = { kind: "TIME_ELAPSED", days: 90 };
      expect(evaluateTrigger(predicate, makeCtx())).toBe(false);
    });

    // ── P1-14: clock selection (ACTIVE→openedAt, WATCHING→createdAt) ─────
    // The thesis row is 28d old (THESIS_CREATED). A position opened 2d ago.
    // A "max hold 14d" trigger must NOT fire on the 2-day-old position even
    // though the thesis row is 28 days old.
    const POSITION_OPENED = new Date(NOW.getTime() - 2 * 86_400_000); // 2d ago

    it("ACTIVE: measures from positionOpenedAt, not createdAt (does not fire on a young position)", () => {
      // 14d trigger; position only 2d old → must NOT fire even though the
      // thesis is 28d old. This is the NVDA incident from P1-14.
      const predicate: TriggerPredicate = { kind: "TIME_ELAPSED", days: 14 };
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED, // 28d old
          lastReviewedAt: null,
          status: "HOLDING",
          positionOpenedAt: POSITION_OPENED, // 2d old
        },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });

    it("ACTIVE: fires once the position itself is old enough", () => {
      // 1d trigger; position 2d old → fires off the position clock.
      const predicate: TriggerPredicate = { kind: "TIME_ELAPSED", days: 1 };
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED,
          lastReviewedAt: null,
          status: "HOLDING",
          positionOpenedAt: POSITION_OPENED, // 2d ago
        },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("WATCHING: stays on createdAt (fires off the 28d-old thesis row)", () => {
      // Even with a positionOpenedAt present, a non-ACTIVE row must use the
      // thesis createdAt clock — "is this watch row stale" measures from
      // when the watch was created. 14d trigger, thesis 28d old → fires.
      const predicate: TriggerPredicate = { kind: "TIME_ELAPSED", days: 14 };
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED, // 28d old
          lastReviewedAt: null,
          status: "WATCHING",
          positionOpenedAt: POSITION_OPENED, // ignored on WATCHING
        },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("ACTIVE without positionOpenedAt: falls back to createdAt (legacy callers)", () => {
      // A caller that didn't resolve a position (status ACTIVE but
      // positionOpenedAt null) keeps the pre-fix createdAt behavior so the
      // clock degrades gracefully rather than never firing.
      const predicate: TriggerPredicate = { kind: "TIME_ELAPSED", days: 14 };
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED, // 28d old → fires off createdAt
          lastReviewedAt: null,
          status: "HOLDING",
          positionOpenedAt: null,
        },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });
  });

  describe("REVIEW_CADENCE", () => {
    // Counted from the last ACTUAL review, not from a date someone typed.
    // The old REVIEW_DATE_HIT read Thesis.nextReviewAt, which was a second
    // store of the same idea and the one nothing fired on.
    const cadence: TriggerPredicate = { kind: "REVIEW_CADENCE", days: 7 };

    it("fires once the cadence has elapsed since the last review", () => {
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED,
          lastReviewedAt: new Date(NOW.getTime() - 8 * 86_400_000),
        },
      });
      expect(evaluateTrigger(cadence, ctx)).toBe(true);
    });

    it("does not fire inside the window", () => {
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED,
          lastReviewedAt: new Date(NOW.getTime() - 2 * 86_400_000),
        },
      });
      expect(evaluateTrigger(cadence, ctx)).toBe(false);
    });

    it("treats a never-reviewed thesis as due, counting from creation", () => {
      // How an unresearched watch item asks for its first read — no special
      // case, no seeded date, just an empty clock.
      const ctx = makeCtx({
        thesis: { createdAt: new Date(NOW.getTime() - 30 * 86_400_000) },
      });
      expect(evaluateTrigger(cadence, ctx)).toBe(true);
    });

    it("restarts the clock when a review happens", () => {
      // A decline is NOT a review and does not reach here; the daily run
      // looking at the thesis is, even if it concludes nothing changed.
      const justReviewed = makeCtx({
        thesis: { createdAt: THESIS_CREATED, lastReviewedAt: NOW },
      });
      expect(evaluateTrigger(cadence, justReviewed)).toBe(false);
    });

    it("honours a tighter cadence from a level above", () => {
      const daily: TriggerPredicate = { kind: "REVIEW_CADENCE", days: 1 };
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED,
          lastReviewedAt: new Date(NOW.getTime() - 2 * 86_400_000),
        },
      });
      expect(evaluateTrigger(daily, ctx)).toBe(true);
      expect(evaluateTrigger(cadence, ctx)).toBe(false);
    });
  });

  // ── Composition ─────────────────────────────────────────────────────

  describe("AND", () => {
    it("fires when all sub-predicates fire", () => {
      const predicate: TriggerPredicate = {
        kind: "AND",
        predicates: [
          { kind: "PRICE_ABOVE", level: 100 },
          { kind: "TIME_ELAPSED", days: 7 },
        ],
      };
      const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when any sub-predicate is false", () => {
      const predicate: TriggerPredicate = {
        kind: "AND",
        predicates: [
          { kind: "PRICE_ABOVE", level: 100 },
          { kind: "TIME_ELAPSED", days: 90 }, // 28d < 90d → false
        ],
      };
      const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });
  });

  describe("OR", () => {
    it("fires when any sub-predicate fires", () => {
      const predicate: TriggerPredicate = {
        kind: "OR",
        predicates: [
          { kind: "PRICE_ABOVE", level: 200 }, // false (price 110)
          { kind: "TIME_ELAPSED", days: 7 }, // true
        ],
      };
      const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when all sub-predicates are false", () => {
      const predicate: TriggerPredicate = {
        kind: "OR",
        predicates: [
          { kind: "PRICE_ABOVE", level: 200 },
          { kind: "TIME_ELAPSED", days: 90 },
        ],
      };
      const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });

    it("recurses through nested AND/OR", () => {
      const predicate: TriggerPredicate = {
        kind: "OR",
        predicates: [
          {
            kind: "AND",
            predicates: [
              { kind: "PRICE_ABOVE", level: 200 }, // false
              { kind: "TIME_ELAPSED", days: 7 }, // true → AND false
            ],
          },
          { kind: "PRICE_BELOW", level: 200 }, // true → OR true
        ],
      };
      const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });
  });
});

describe("shouldFire", () => {
  const baseTrigger: Trigger = {
    id: "trig_test",
    predicate: { kind: "PRICE_ABOVE", level: 100 },
    action: "REVIEW",
    rationale: "test",
  };

  it("returns reason='match' when predicate true and no cooldown set", () => {
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(baseTrigger, ctx)).toMatchObject({
      fires: true,
      reason: "match",
    });
  });

  it("returns reason='no-match' when predicate false", () => {
    const ctx = makeCtx({ latestQuote: { price: 90, changePct: 0 } });
    expect(shouldFire(baseTrigger, ctx)).toMatchObject({
      fires: false,
      reason: "no-match",
    });
  });

  it("returns reason='cooldown' when predicate true but lastFiredAt is recent", () => {
    const trigger: Trigger = {
      ...baseTrigger,
      cooldownDays: 7,
      // fired 1 day ago → still in 7-day cooldown
      lastFiredAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: false,
      reason: "cooldown",
    });
  });

  it("returns reason='match' when cooldown expired", () => {
    const trigger: Trigger = {
      ...baseTrigger,
      cooldownDays: 7,
      // fired 10 days ago → cooldown expired
      lastFiredAt: new Date(NOW.getTime() - 10 * 86_400_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: true,
      reason: "match",
    });
  });

  it("falls back to predicate-kind default cooldown when cooldownDays is absent", () => {
    // PRICE_ABOVE has a 1-day default cooldown. Fired 1 minute ago →
    // still inside the default window, so should NOT re-fire.
    const trigger: Trigger = {
      ...baseTrigger,
      // no cooldownDays — evaluator falls back to the per-kind default.
      lastFiredAt: new Date(NOW.getTime() - 60_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: false,
      reason: "cooldown",
    });
  });

  it("treats explicit cooldownDays=0 on EXIT as no rate limit (legitimate escape hatch)", () => {
    // EXIT is terminal — the position closes and the cron's
    // `status:ACTIVE` filter removes the row from future evaluation.
    // No runaway risk; the 0 escape hatch is valid here.
    const trigger: Trigger = {
      ...baseTrigger,
      action: "EXIT",
      cooldownDays: 0,
      lastFiredAt: new Date(NOW.getTime() - 60_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: true,
      reason: "match",
    });
  });

  // ── Defense-in-depth — non-EXIT cooldownDays=0 (NVDA runaway shape) ───
  //
  // The write-path fix (applyTriggerCooldownDefaults) stops new bad
  // values from landing on disk. The evaluator-layer defense below
  // catches existing on-disk bad rows: a non-EXIT action with explicit
  // cooldownDays=0 is treated as "needs default" and falls back to the
  // per-predicate-kind cooldown instead of bypassing the rate limit.
  // See lib/agent/triggers/evaluate.ts shouldFire docstring (2).

  it("REVIEW + cooldownDays=0 + recent lastFiredAt → COOLDOWN, not match (NVDA runaway shape)", () => {
    // This is the exact shape that caused the 2026-06-02 NVDA loop:
    // REVIEW action with cooldownDays=0, fired seconds ago. Pre-fix this
    // returned 'match' (no rate limit). Post-fix the evaluator falls back
    // to the PRICE_ABOVE per-kind default (1d) and blocks the re-fire.
    const trigger: Trigger = {
      ...baseTrigger,
      action: "REVIEW",
      cooldownDays: 0,
      lastFiredAt: new Date(NOW.getTime() - 60_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: false,
      reason: "cooldown",
    });
  });

  it("ENTER + cooldownDays=0 + recent lastFiredAt → COOLDOWN", () => {
    const trigger: Trigger = {
      ...baseTrigger,
      action: "ENTER",
      cooldownDays: 0,
      lastFiredAt: new Date(NOW.getTime() - 60_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: false,
      reason: "cooldown",
    });
  });

  it("TRIM + cooldownDays=0 + recent lastFiredAt → COOLDOWN (IREN $76.87 shape)", () => {
    // IREN had TRIM PRICE_ABOVE $76.87 with cooldownDays:0 — would have
    // partial-closed every 5 minutes if price held above target.
    const trigger: Trigger = {
      ...baseTrigger,
      action: "TRIM",
      cooldownDays: 0,
      lastFiredAt: new Date(NOW.getTime() - 60_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: false,
      reason: "cooldown",
    });
  });

  it("REVIEW + cooldownDays=0 + lastFiredAt past default → MATCH (default cooldown expired)", () => {
    // PRICE_ABOVE default cooldown is 1 day. Fired 2 days ago → expired
    // → fires. Confirms we're falling back to the default, not blocking
    // forever.
    const trigger: Trigger = {
      ...baseTrigger,
      action: "REVIEW",
      cooldownDays: 0,
      lastFiredAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: true,
      reason: "match",
    });
  });

  it("EXIT + cooldownDays=0 + recent lastFiredAt → MATCH (escape hatch preserved)", () => {
    // Re-stating the EXIT carve-out alongside the non-EXIT block so the
    // distinction is unmissable in the test file. EXIT 0 must keep
    // working — that's how the stop fires every tick until position closes.
    const trigger: Trigger = {
      ...baseTrigger,
      action: "EXIT",
      cooldownDays: 0,
      lastFiredAt: new Date(NOW.getTime() - 60_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toMatchObject({
      fires: true,
      reason: "match",
    });
  });
});

// ── Standing-order semantics (principal ruling 2026-08-16) ────────────
//
// A trigger fires every day its condition is true. A declined or expired
// proposal means "did nothing", so it fires again tomorrow. An
// edge-triggered variant shipped 2026-08-13 and was reverted — these pin
// the reverted behavior so it can't creep back.

describe("shouldFire — standing-order re-firing", () => {
  const enterRung: Trigger = {
    id: "enter-1",
    predicate: { kind: "PRICE_ABOVE", level: 128.47 },
    action: "ENTER",
    rationale: "entry",
    cooldownDays: 1,
  };
  const at = (price: number, now: Date): EvaluationContext => ({
    latestQuote: { price, changePct: 0 },
    thesis: { createdAt: new Date("2026-01-01"), status: "WATCHING" },
    now,
  });

  it("re-fires the next day while the condition still holds", () => {
    const day1 = new Date("2026-08-12T14:00:00Z");
    const day2 = new Date("2026-08-13T14:00:00Z");
    expect(shouldFire(enterRung, at(171, day1)).fires).toBe(true);

    // Declined yesterday; still above the level today → fires again.
    const afterDecline: Trigger = { ...enterRung, lastFiredAt: day1.toISOString() };
    expect(shouldFire(afterDecline, at(175, day2)).fires).toBe(true);
  });

  it("does not fire twice within the cooldown window", () => {
    const t = new Date("2026-08-12T14:00:00Z");
    const fired: Trigger = {
      ...enterRung,
      lastFiredAt: new Date("2026-08-12T10:00:00Z").toISOString(),
    };
    expect(shouldFire(fired, at(171, t)).reason).toBe("cooldown");
  });

  it("keeps firing regardless of how long the condition has held", () => {
    // The PLTR shape: 33% above entry for weeks. Under the ruling this is
    // a standing order the principal has not withdrawn, so it keeps
    // asking. Silencing it is the bug the ruling forbids.
    const long: Trigger = {
      ...enterRung,
      lastFiredAt: new Date("2026-07-01T00:00:00Z").toISOString(),
    };
    expect(shouldFire(long, at(171, new Date("2026-08-12T14:00:00Z"))).fires).toBe(
      true,
    );
  });
});
