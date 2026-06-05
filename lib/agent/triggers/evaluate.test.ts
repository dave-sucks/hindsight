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
          nextReviewAt: null,
          status: "ACTIVE",
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
          nextReviewAt: null,
          status: "ACTIVE",
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
          nextReviewAt: null,
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
          nextReviewAt: null,
          status: "ACTIVE",
          positionOpenedAt: null,
        },
      });
      expect(evaluateTrigger(predicate, ctx)).toBe(true);
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
    expect(shouldFire(trigger, ctx)).toEqual({
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
    expect(shouldFire(trigger, ctx)).toEqual({
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
    expect(shouldFire(trigger, ctx)).toEqual({
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
    expect(shouldFire(trigger, ctx)).toEqual({
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
    expect(shouldFire(trigger, ctx)).toEqual({
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
    expect(shouldFire(trigger, ctx)).toEqual({
      fires: true,
      reason: "match",
    });
  });
});
