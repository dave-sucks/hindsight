/**
 * staleness.test.ts — anti-regression for horizon-aware research-age
 * classification.
 *
 * Pre-P1-1 there was a single uniform STALE_DAYS = 14. The new model
 * keys off the thesis's horizon: CATALYST/TRADE 7d, TARGET 30d,
 * COMPOUNDER 90d. If someone reverts to a uniform threshold or swaps
 * the per-horizon values, these tests fail.
 */

import {
  STALE_DAYS_BY_HORIZON,
  classifyResearchAge,
  formatResearchAge,
} from "./staleness";

const ONE_DAY_MS = 86_400_000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * ONE_DAY_MS);
}

describe("classifyResearchAge", () => {
  describe("missing", () => {
    it("returns missing when researchUpdatedAt is null", () => {
      const age = classifyResearchAge(null);
      expect(age.freshness).toBe("missing");
      expect(age.daysOld).toBeNull();
      expect(age.lastWrittenAt).toBeNull();
      expect(age.horizonThreshold).toBeNull();
    });

    it("returns missing when researchUpdatedAt is undefined", () => {
      const age = classifyResearchAge(undefined);
      expect(age.freshness).toBe("missing");
      expect(age.daysOld).toBeNull();
    });

    it("ignores horizon when input is missing (no threshold applies)", () => {
      const age = classifyResearchAge(null, "COMPOUNDER");
      expect(age.freshness).toBe("missing");
      expect(age.horizonThreshold).toBeNull();
    });
  });

  describe("CATALYST horizon (threshold 7d)", () => {
    it("is fresh at 0 days old", () => {
      const age = classifyResearchAge(daysAgo(0), "CATALYST");
      expect(age.freshness).toBe("fresh");
      expect(age.horizonThreshold).toBe(7);
    });
    it("is fresh at 7 days old (on the boundary)", () => {
      const age = classifyResearchAge(daysAgo(7), "CATALYST");
      expect(age.freshness).toBe("fresh");
    });
    it("is stale at 8 days old (one past threshold)", () => {
      const age = classifyResearchAge(daysAgo(8), "CATALYST");
      expect(age.freshness).toBe("stale");
      expect(age.daysOld).toBe(8);
      expect(age.horizonThreshold).toBe(7);
    });
  });

  describe("TRADE horizon (threshold 7d)", () => {
    it("is fresh at 6 days old", () => {
      const age = classifyResearchAge(daysAgo(6), "TRADE");
      expect(age.freshness).toBe("fresh");
      expect(age.horizonThreshold).toBe(7);
    });
    it("is stale at 8 days old", () => {
      const age = classifyResearchAge(daysAgo(8), "TRADE");
      expect(age.freshness).toBe("stale");
    });
  });

  describe("TARGET horizon (threshold 30d)", () => {
    it("is fresh at 29 days old", () => {
      const age = classifyResearchAge(daysAgo(29), "TARGET");
      expect(age.freshness).toBe("fresh");
      expect(age.horizonThreshold).toBe(30);
    });
    it("is fresh at 30 days old (on the boundary)", () => {
      const age = classifyResearchAge(daysAgo(30), "TARGET");
      expect(age.freshness).toBe("fresh");
    });
    it("is stale at 31 days old (one past threshold)", () => {
      const age = classifyResearchAge(daysAgo(31), "TARGET");
      expect(age.freshness).toBe("stale");
      expect(age.daysOld).toBe(31);
    });
    it("a 10-day-old TARGET would be STALE under uniform 7d but is fresh here", () => {
      const age = classifyResearchAge(daysAgo(10), "TARGET");
      expect(age.freshness).toBe("fresh");
    });
  });

  describe("COMPOUNDER horizon (threshold 90d)", () => {
    it("is fresh at 14 days old (would be stale under legacy uniform 14d)", () => {
      const age = classifyResearchAge(daysAgo(14), "COMPOUNDER");
      expect(age.freshness).toBe("fresh");
      expect(age.horizonThreshold).toBe(90);
    });
    it("is fresh at 60 days old", () => {
      const age = classifyResearchAge(daysAgo(60), "COMPOUNDER");
      expect(age.freshness).toBe("fresh");
    });
    it("is fresh at 90 days old (on the boundary)", () => {
      const age = classifyResearchAge(daysAgo(90), "COMPOUNDER");
      expect(age.freshness).toBe("fresh");
    });
    it("is stale at 91 days old (one past threshold)", () => {
      const age = classifyResearchAge(daysAgo(91), "COMPOUNDER");
      expect(age.freshness).toBe("stale");
    });
  });

  describe("horizon undefined / null (default 7d)", () => {
    it("falls back to 7-day threshold when horizon is undefined", () => {
      const age = classifyResearchAge(daysAgo(8));
      expect(age.freshness).toBe("stale");
      expect(age.horizonThreshold).toBe(7);
    });
    it("falls back to 7-day threshold when horizon is null", () => {
      const age = classifyResearchAge(daysAgo(8), null);
      expect(age.freshness).toBe("stale");
      expect(age.horizonThreshold).toBe(7);
    });
    it("conservative default — 14-day-old research with no horizon is stale", () => {
      // Pre-P1-1 the uniform 14-day threshold would have called this fresh.
      // We deliberately bias toward "stale" in the no-horizon case so
      // PENDING seeds and edge cases get refreshed sooner rather than later.
      const age = classifyResearchAge(daysAgo(14), null);
      expect(age.freshness).toBe("stale");
    });
  });

  describe("returned fields", () => {
    it("populates lastWrittenAt as ISO string when present", () => {
      const ts = daysAgo(5);
      const age = classifyResearchAge(ts, "TRADE");
      expect(age.lastWrittenAt).toBe(ts.toISOString());
    });
    it("populates daysOld as an integer day count", () => {
      const age = classifyResearchAge(daysAgo(3), "CATALYST");
      expect(age.daysOld).toBe(3);
    });
    it("surfaces horizonThreshold for the prompt to render", () => {
      // The prompt uses this to render "stale: 32d > 30d threshold" so the
      // agent sees BOTH numbers without re-deriving the threshold.
      expect(classifyResearchAge(daysAgo(1), "CATALYST").horizonThreshold).toBe(7);
      expect(classifyResearchAge(daysAgo(1), "TRADE").horizonThreshold).toBe(7);
      expect(classifyResearchAge(daysAgo(1), "TARGET").horizonThreshold).toBe(30);
      expect(classifyResearchAge(daysAgo(1), "COMPOUNDER").horizonThreshold).toBe(90);
    });
  });
});

describe("STALE_DAYS_BY_HORIZON", () => {
  it("scales with hold style — CATALYST/TRADE shortest, COMPOUNDER longest", () => {
    expect(STALE_DAYS_BY_HORIZON.CATALYST).toBeLessThanOrEqual(
      STALE_DAYS_BY_HORIZON.TARGET,
    );
    expect(STALE_DAYS_BY_HORIZON.TRADE).toBeLessThanOrEqual(
      STALE_DAYS_BY_HORIZON.TARGET,
    );
    expect(STALE_DAYS_BY_HORIZON.TARGET).toBeLessThanOrEqual(
      STALE_DAYS_BY_HORIZON.COMPOUNDER,
    );
  });
  it("locks in the per-horizon values from the design doc", () => {
    // Anti-regression for someone reverting to uniform 14. If you're
    // intentionally retuning a threshold, update both the constant and
    // this assertion together.
    expect(STALE_DAYS_BY_HORIZON.CATALYST).toBe(7);
    expect(STALE_DAYS_BY_HORIZON.TRADE).toBe(7);
    expect(STALE_DAYS_BY_HORIZON.TARGET).toBe(30);
    expect(STALE_DAYS_BY_HORIZON.COMPOUNDER).toBe(90);
  });
});

describe("formatResearchAge", () => {
  it("formats missing without numbers", () => {
    expect(formatResearchAge(classifyResearchAge(null))).toBe("missing");
  });
  it("formats fresh with daysOld and threshold", () => {
    const age = classifyResearchAge(daysAgo(3), "CATALYST");
    expect(formatResearchAge(age)).toBe("fresh (3d / 7d)");
  });
  it("formats stale with daysOld and threshold", () => {
    const age = classifyResearchAge(daysAgo(35), "TARGET");
    expect(formatResearchAge(age)).toBe("stale (35d / 30d)");
  });
});

// ── Watchlist cap (2026-08-31) ────────────────────────────────────────────
// A name we don't own yet is capped at WATCHLIST_STALE_DAYS_CAP on top of
// its horizon threshold: the next decision on it is "buy this today?", and
// that must not rest on last quarter's work. Held names keep the horizon
// clock — a compounder you already own genuinely can run a quarter.
describe("classifyResearchAge — the watchlist cap", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("flags an 80-day-old COMPOUNDER on the watchlist as stale (the GD/GEV/VST case)", () => {
    const age = classifyResearchAge(daysAgo(80), "COMPOUNDER", "WATCHING");
    expect(age.freshness).toBe("stale");
    expect(age.horizonThreshold).toBe(35);
  });

  it("leaves the same 80-day-old research FRESH on a stock we own", () => {
    const age = classifyResearchAge(daysAgo(80), "COMPOUNDER", "HOLDING");
    expect(age.freshness).toBe("fresh");
    expect(age.horizonThreshold).toBe(90);
  });

  it("never loosens a tighter horizon — a CATALYST watch stays on 7 days", () => {
    expect(
      classifyResearchAge(daysAgo(10), "CATALYST", "WATCHING").horizonThreshold,
    ).toBe(7);
    expect(classifyResearchAge(daysAgo(10), "CATALYST", "WATCHING").freshness).toBe(
      "stale",
    );
  });

  it("omitting status keeps the old horizon-only behavior", () => {
    const age = classifyResearchAge(daysAgo(80), "COMPOUNDER");
    expect(age.freshness).toBe("fresh");
    expect(age.horizonThreshold).toBe(90);
  });

  it("a 20-day-old compounder watch is still fresh — this is not a weekly re-research", () => {
    expect(classifyResearchAge(daysAgo(20), "COMPOUNDER", "WATCHING").freshness).toBe(
      "fresh",
    );
  });
});
