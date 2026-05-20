/**
 * defaults.test.ts — coverage for the minimal-safety-net default templates.
 *
 * The 2026-05-20 strip (docs/plans/SYSTEM_AUDIT_2026_05_19.md §5a, items
 * C1/C2) removed event-driven REVIEW defaults from every template. The
 * agent now declares earnings/filings/guidance triggers per-thesis based
 * on the keyAssumptions. These tests pin the new mechanical-only shape
 * so a future refactor can't sleepwalk back into auto-attaching review
 * triggers.
 */

import { defaultTriggersForHorizon } from "./defaults";
import type { Trigger } from "./types";

function predicateKinds(triggers: Trigger[]): string[] {
  return triggers.map((t) => t.predicate.kind);
}

function actions(triggers: Trigger[]): string[] {
  return triggers.map((t) => t.action);
}

describe("defaultTriggersForHorizon — HELD shape (mechanical only)", () => {
  const heldThesis = {
    entryPrice: 100,
    targetPrice: 150,
    stopLoss: 90,
    direction: "LONG" as const,
  };

  it("COMPOUNDER HELD has exactly 1 trigger (hard stop EXIT)", () => {
    const t = defaultTriggersForHorizon("COMPOUNDER", heldThesis, "HELD");
    expect(t).toHaveLength(1);
    expect(t[0].predicate.kind).toBe("PRICE_BELOW");
    expect(t[0].action).toBe("EXIT");
  });

  it("TARGET HELD has exactly 1 trigger (hard stop EXIT)", () => {
    const t = defaultTriggersForHorizon("TARGET", heldThesis, "HELD");
    expect(t).toHaveLength(1);
    expect(t[0].action).toBe("EXIT");
  });

  it("TRADE HELD has exactly 2 triggers (stop EXIT + target EXIT)", () => {
    // TRADE is unique — the target is also an exit because the trade
    // plan commits to closing at target, not trailing it.
    const t = defaultTriggersForHorizon("TRADE", heldThesis, "HELD");
    expect(t).toHaveLength(2);
    expect(actions(t).sort()).toEqual(["EXIT", "EXIT"]);
  });

  it("CATALYST HELD has exactly 1 trigger (hard stop EXIT)", () => {
    const t = defaultTriggersForHorizon("CATALYST", heldThesis, "HELD");
    expect(t).toHaveLength(1);
    expect(t[0].action).toBe("EXIT");
  });
});

describe("defaultTriggersForHorizon — HELD does NOT include event triggers", () => {
  // Regression guard: pre-2026-05-20 the templates auto-attached earnings
  // beat/miss, guidance change, 8-K filing, time-elapsed hygiene, and
  // (on COMPOUNDER) an 8%-from-entry review. All of those are now the
  // agent's job to declare. These tests pin the absence.
  const heldThesis = {
    entryPrice: 100,
    targetPrice: 150,
    stopLoss: 90,
    direction: "LONG" as const,
  };

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s HELD has no EARNINGS_BEAT trigger",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, heldThesis, "HELD");
      expect(predicateKinds(t)).not.toContain("EARNINGS_BEAT");
    },
  );

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s HELD has no EARNINGS_MISS trigger",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, heldThesis, "HELD");
      expect(predicateKinds(t)).not.toContain("EARNINGS_MISS");
    },
  );

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s HELD has no FILING trigger",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, heldThesis, "HELD");
      expect(predicateKinds(t)).not.toContain("FILING");
    },
  );

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s HELD has no TIME_ELAPSED hygiene trigger",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, heldThesis, "HELD");
      expect(predicateKinds(t)).not.toContain("TIME_ELAPSED");
    },
  );

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s HELD has no REVIEW_DATE_HIT trigger (daily-run owns scheduled review)",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, heldThesis, "HELD");
      expect(predicateKinds(t)).not.toContain("REVIEW_DATE_HIT");
    },
  );
});

describe("defaultTriggersForHorizon — WATCHING shape (entry-only)", () => {
  const watchingLong = { targetPrice: 100, direction: "LONG" as const };
  const watchingShort = { targetPrice: 100, direction: "SHORT" as const };

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s WATCHING LONG has exactly 1 trigger: PRICE_ABOVE(target) → ENTER",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, watchingLong, "WATCHING");
      expect(t).toHaveLength(1);
      expect(t[0].predicate.kind).toBe("PRICE_ABOVE");
      expect(t[0].action).toBe("ENTER");
      if (t[0].predicate.kind === "PRICE_ABOVE") {
        expect(t[0].predicate.level).toBe(100);
      }
    },
  );

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s WATCHING SHORT has exactly 1 trigger: PRICE_BELOW(target) → ENTER",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, watchingShort, "WATCHING");
      expect(t).toHaveLength(1);
      expect(t[0].predicate.kind).toBe("PRICE_BELOW");
      expect(t[0].action).toBe("ENTER");
    },
  );

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s WATCHING does NOT include REVIEW_DATE_HIT",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, watchingLong, "WATCHING");
      expect(predicateKinds(t)).not.toContain("REVIEW_DATE_HIT");
    },
  );

  it("COMPOUNDER WATCHING entry trigger has 7d cooldown (patient)", () => {
    const t = defaultTriggersForHorizon("COMPOUNDER", watchingLong, "WATCHING");
    expect(t[0].cooldownDays).toBe(7);
  });

  it("TRADE WATCHING entry trigger has 1d cooldown (intraday cross)", () => {
    const t = defaultTriggersForHorizon("TRADE", watchingLong, "WATCHING");
    expect(t[0].cooldownDays).toBe(1);
  });
});

describe("defaultTriggersForHorizon — PASS WATCHING attaches no entry trigger", () => {
  // PASS is terminal-at-write institutional memory. Re-evaluation
  // happens via Discovery re-encountering the ticker, not via a trigger
  // waking up the old PASS row.
  const passThesis = { targetPrice: 100, direction: "PASS" as const };

  it.each(["CATALYST", "TRADE", "TARGET", "COMPOUNDER"] as const)(
    "%s PASS WATCHING produces an empty trigger array",
    (horizon) => {
      const t = defaultTriggersForHorizon(horizon, passThesis, "WATCHING");
      expect(t).toHaveLength(0);
    },
  );
});

describe("defaultTriggersForHorizon — missing levels degrade gracefully", () => {
  it("HELD with no stopLoss returns empty array (no mechanical EXIT to attach)", () => {
    const t = defaultTriggersForHorizon(
      "COMPOUNDER",
      { entryPrice: 100, direction: "LONG" },
      "HELD",
    );
    expect(t).toHaveLength(0);
  });

  it("WATCHING with no targetPrice returns empty array (no entry trigger to attach)", () => {
    const t = defaultTriggersForHorizon(
      "TARGET",
      { direction: "LONG" },
      "WATCHING",
    );
    expect(t).toHaveLength(0);
  });
});
