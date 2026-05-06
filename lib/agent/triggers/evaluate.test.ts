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
    thesis: { createdAt: THESIS_CREATED, nextReviewAt: null },
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

    it("fires on a 5D up move >= pct", () => {
      // 5 days back close ≈ 100 + (29-5) = 124 → current 129 (latestQuote)
      // Actually with our synthetic data: closes index 24 (5 days ago) = 124
      // We pretend latestQuote is 130 so move = (130 - 124) / 124 ≈ 4.8%
      const predicate: TriggerPredicate = {
        kind: "PRICE_MOVE_PCT",
        pct: 4,
        direction: "UP",
        window: "5D",
      };
      const ctx = makeCtx({
        recentPrices,
        latestQuote: { price: 130, changePct: 0 },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when window history missing (recentPrices empty)", () => {
      const predicate: TriggerPredicate = {
        kind: "PRICE_MOVE_PCT",
        pct: 4,
        direction: "UP",
        window: "5D",
      };
      const ctx = makeCtx({
        recentPrices: [],
        latestQuote: { price: 130, changePct: 0 },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
    });

    it("fires on a DOWN move when current is far below past close", () => {
      const predicate: TriggerPredicate = {
        kind: "PRICE_MOVE_PCT",
        pct: 10,
        direction: "DOWN",
        window: "5D",
      };
      // 5 days back close = 124; latestQuote 100 → -19% move
      const ctx = makeCtx({
        recentPrices,
        latestQuote: { price: 100, changePct: 0 },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when move is below threshold", () => {
      const predicate: TriggerPredicate = {
        kind: "PRICE_MOVE_PCT",
        pct: 50,
        direction: "UP",
        window: "5D",
      };
      const ctx = makeCtx({
        recentPrices,
        latestQuote: { price: 130, changePct: 0 },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
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
  });

  describe("REVIEW_DATE_HIT", () => {
    it("fires when nextReviewAt is at-or-before now", () => {
      const predicate: TriggerPredicate = { kind: "REVIEW_DATE_HIT" };
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED,
          nextReviewAt: new Date(NOW.getTime() - 60_000),
        },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
    });

    it("does not fire when nextReviewAt is null", () => {
      const predicate: TriggerPredicate = { kind: "REVIEW_DATE_HIT" };
      expect(evaluateTrigger(predicate, makeCtx())).toBe(false);
    });

    it("does not fire when nextReviewAt is in the future", () => {
      const predicate: TriggerPredicate = { kind: "REVIEW_DATE_HIT" };
      const ctx = makeCtx({
        thesis: {
          createdAt: THESIS_CREATED,
          nextReviewAt: new Date(NOW.getTime() + 60_000),
        },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(false);
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
    expect(shouldFire(baseTrigger, ctx)).toEqual({
      fires: true,
      reason: "match",
    });
  });

  it("returns reason='no-match' when predicate false", () => {
    const ctx = makeCtx({ latestQuote: { price: 90, changePct: 0 } });
    expect(shouldFire(baseTrigger, ctx)).toEqual({
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
    expect(shouldFire(trigger, ctx)).toEqual({
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
    expect(shouldFire(trigger, ctx)).toEqual({
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
    expect(shouldFire(trigger, ctx)).toEqual({
      fires: false,
      reason: "cooldown",
    });
  });

  it("treats explicit cooldownDays=0 as no rate limit", () => {
    // Escape hatch: an explicit zero opts out of the default-cooldown
    // fallback. Useful for terminal EXIT triggers where the trigger
    // fires once and the position closes anyway.
    const trigger: Trigger = {
      ...baseTrigger,
      cooldownDays: 0,
      lastFiredAt: new Date(NOW.getTime() - 60_000).toISOString(),
    };
    const ctx = makeCtx({ latestQuote: { price: 110, changePct: 0 } });
    expect(shouldFire(trigger, ctx)).toEqual({
      fires: true,
      reason: "match",
    });
  });
});
