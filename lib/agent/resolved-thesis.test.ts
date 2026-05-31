/**
 * resolved-thesis.test.ts — actionability classifier coverage.
 *
 * Each of the 7 actionability states reachable through a fixture.
 * See docs/plans/CONVICTION_EXPRESSION.md §6.
 */

import { buildResolvedEnvelope, buildSupersessionMap } from "./resolved-thesis";
import type { Trigger } from "./triggers/types";

const NOW = new Date("2026-06-01T12:00:00Z");

function baseThesis(overrides: Partial<Parameters<typeof buildResolvedEnvelope>[0]["thesis"]> = {}) {
  return {
    id: "thesis_1",
    ticker: "TEST",
    status: "WATCHING",
    direction: "LONG",
    entryPrice: 100,
    triggers: [],
    catalystDate: null,
    createdAt: new Date("2026-05-30T00:00:00Z"),
    nextReviewAt: null,
    scoring: {
      trendStrength: { score: 2, note: "" },
      relativeStrength: { score: 2, note: "" },
      entryQuality: { score: 2, note: "" },
      catalystFreshness: { score: 1, note: "" },
      composite: 7,
    },
    parsedTriggers: [] as Trigger[],
    ...overrides,
  };
}

describe("buildResolvedEnvelope — actionability classifier", () => {
  it("DEAD when status is INVALIDATED", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({ status: "INVALIDATED" }),
      currentPrice: 100,
      now: NOW,
    });
    expect(r.actionability).toBe("DEAD");
  });

  it("SUPERSEDED when a newer terminal sister exists", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({
        status: "WATCHING",
        createdAt: new Date("2026-05-25T00:00:00Z"),
      }),
      currentPrice: 100,
      supersession: {
        ticker: "TEST",
        terminalId: "thesis_newer_invalidated",
        terminalCreatedAt: new Date("2026-05-30T00:00:00Z"),
      },
      now: NOW,
    });
    expect(r.actionability).toBe("SUPERSEDED");
    expect(r.supersededBy).toBe("thesis_newer_invalidated");
  });

  it("does NOT supersede when the sister is older than this row", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({
        status: "WATCHING",
        createdAt: new Date("2026-05-30T00:00:00Z"),
      }),
      currentPrice: 100,
      supersession: {
        ticker: "TEST",
        terminalId: "thesis_older_archived",
        terminalCreatedAt: new Date("2026-05-25T00:00:00Z"),
      },
      now: NOW,
    });
    expect(r.actionability).not.toBe("SUPERSEDED");
    expect(r.supersededBy).toBeNull();
  });

  it("ACTIVE_HOLD when status is ACTIVE", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({ status: "ACTIVE" }),
      currentPrice: 105,
      now: NOW,
    });
    expect(r.actionability).toBe("ACTIVE_HOLD");
  });

  it("PENDING_CATALYST when catalystDate is in the future", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({
        catalystDate: new Date("2026-06-15T20:30:00Z"),
      }),
      currentPrice: 100,
      now: NOW,
    });
    expect(r.actionability).toBe("PENDING_CATALYST");
  });

  it("STALE_PAST_CATALYST when catalystDate is past and not resolved", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({
        catalystDate: new Date("2026-05-26T20:30:00Z"),
      }),
      currentPrice: 100,
      now: NOW,
    });
    expect(r.actionability).toBe("STALE_PAST_CATALYST");
    expect(r.staleness).toBe("STALE");
  });

  it("ENTER_NOW when ENTER trigger PRICE_ABOVE fires", () => {
    const enterTrigger: Trigger = {
      action: "ENTER",
      predicate: { kind: "PRICE_ABOVE", level: 92.5 },
      cooldownDays: 1,
      rationale: "Breakout confirm.",
    };
    const r = buildResolvedEnvelope({
      thesis: baseThesis({ parsedTriggers: [enterTrigger] }),
      currentPrice: 94, // above 92.5 → fired
      now: NOW,
    });
    expect(r.actionability).toBe("ENTER_NOW");
    expect(r.triggerState).toBe("ENTER_FIRED");
    expect(r.triggerDetail).toMatch(/PRICE_ABOVE 92.5/);
  });

  it("WAIT_FOR_TRIGGER when ENTER trigger has not fired (price below threshold)", () => {
    const enterTrigger: Trigger = {
      action: "ENTER",
      predicate: { kind: "PRICE_ABOVE", level: 92.5 },
      cooldownDays: 1,
      rationale: "Breakout confirm.",
    };
    const r = buildResolvedEnvelope({
      thesis: baseThesis({ parsedTriggers: [enterTrigger] }),
      currentPrice: 90, // below 92.5 → waiting
      now: NOW,
    });
    expect(r.actionability).toBe("WAIT_FOR_TRIGGER");
    expect(r.triggerState).toBe("ENTER_WAITING");
    expect(r.triggerDetail).toMatch(/PRICE_ABOVE 92.5 \(cur 90\.00, -2\.7%\)/);
  });

  it("ENTER_NOW (buy-now case) when no ENTER trigger AND entry ≈ current price", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({
        parsedTriggers: [], // no ENTER trigger
        entryPrice: 100,
      }),
      currentPrice: 100.5, // within 1%
      now: NOW,
    });
    expect(r.actionability).toBe("ENTER_NOW");
  });

  it("WAIT_FOR_TRIGGER when no ENTER trigger AND entry not close to current", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({
        parsedTriggers: [],
        entryPrice: 100,
      }),
      currentPrice: 110, // 10% away
      now: NOW,
    });
    expect(r.actionability).toBe("WAIT_FOR_TRIGGER");
  });

  it("surfaces entryQualityScore flat from nested scoring", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis({
        scoring: {
          trendStrength: { score: 3, note: "" },
          relativeStrength: { score: 2, note: "" },
          entryQuality: { score: 1, note: "" },
          catalystFreshness: { score: 1, note: "" },
          composite: 7,
        },
      }),
      currentPrice: 100,
      now: NOW,
    });
    expect(r.entryQualityScore).toBe(1);
  });

  it("currentPrice null when no quote provided; quoteAgeMs null", () => {
    const r = buildResolvedEnvelope({
      thesis: baseThesis(),
      currentPrice: null,
      now: NOW,
    });
    expect(r.currentPrice).toBeNull();
    expect(r.quoteAgeMs).toBeNull();
  });
});

describe("buildSupersessionMap", () => {
  it("picks the newest terminal sibling per ticker", () => {
    const map = buildSupersessionMap([
      { ticker: "ZS", id: "zs_old", createdAt: new Date("2026-05-20") },
      { ticker: "ZS", id: "zs_new", createdAt: new Date("2026-05-26") },
      { ticker: "MRVL", id: "mrvl_a", createdAt: new Date("2026-05-25") },
    ]);
    expect(map.get("ZS")?.terminalId).toBe("zs_new");
    expect(map.get("MRVL")?.terminalId).toBe("mrvl_a");
    expect(map.get("AAPL")).toBeUndefined();
  });
});
