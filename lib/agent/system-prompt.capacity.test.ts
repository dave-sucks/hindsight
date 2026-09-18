/**
 * system-prompt.capacity.test.ts — the daily run is told the analyst's real
 * limit, not what is left of it.
 *
 * Caught 2026-09-18, the day DAV-292's book line shipped. The 8 AM cron has
 * handed the prompt `slotsRemaining` in the `maxOpenPositions` field since
 * long before that line existed ("Use remaining slots, not max"). The line
 * reads that field as the LIMIT and the open positions as the count, so the
 * PEAD Specialist — 4 open against a limit of 6 — was told "4 of 2, this
 * analyst is FULL" and not to buy. Two free slots, told to stand down.
 */
import { buildDailyRunSystemPromptV2 } from "./system-prompt";
import type { RunInput } from "./run-input";

const pos = (symbol: string) => ({
  symbol, direction: "LONG", quantity: 10, avgCost: 100, currentPrice: 101,
  unrealizedPnl: 10, unrealizedPnlPct: 1, targetPrice: null,
});

const runInput = (symbols: string[]) =>
  ({
    analyst: { name: "PEAD Specialist", mandate: null, voice: null, directionBias: "LONG_ONLY", holdDurations: ["SWING"], sectors: [], industries: [], themes: [], marketCapMin: null, marketCapMax: null, exclusionList: [], minConfidence: 70, minPositionSize: 3000, maxPositionSize: 14000, maxOpenPositions: 6 },
    portfolio: { cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: symbols.map(pos), exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
    watchlist: [], activeTheses: [], performance: null, recentClosedTrades: [], priorityReviews: [],
    triggersFiredSinceLastRun: [], triggersMatchingNow: [], latestDigest: null,
    earnings: { reportingSoon: [], justReported: [] }, filings: { recent: [] },
    intelligencePolicy: { maxSignalsPerRun: 0 },
  }) as unknown as RunInput;

describe("the PEAD Specialist on 2026-09-18 — 4 open, limit 6", () => {
  it("reads 4 of 6 with two free, and carries no full-analyst rule", () => {
    const p = buildDailyRunSystemPromptV2(
      { name: "PEAD Specialist", minConfidence: 70, maxPositionSize: 14000, minPositionSize: 3000, maxOpenPositions: 6 },
      runInput(["FIVE", "IOT", "MU", "NVDA"]),
    );
    expect(p).toContain("Positions: 4 of 6 — 2 free.");
    expect(p).not.toContain("this analyst is FULL");
    expect(p).not.toContain("**This analyst is full.**");
  });

  it("what the cron used to hand it — the remainder in the limit's place — reads as full", () => {
    // The bug, pinned so it cannot come back: 2 slots left, passed as the
    // limit, against 4 open.
    const p = buildDailyRunSystemPromptV2(
      { name: "PEAD Specialist", minConfidence: 70, maxPositionSize: 14000, minPositionSize: 3000, maxOpenPositions: 2 },
      runInput(["FIVE", "IOT", "MU", "NVDA"]),
    );
    expect(p).toContain("this analyst is FULL");
  });

  it("a genuinely full analyst still reads full", () => {
    const p = buildDailyRunSystemPromptV2(
      { name: "Secular Compounder", minConfidence: 70, maxPositionSize: 10000, minPositionSize: 4000, maxOpenPositions: 4 },
      runInput(["ABT", "ASML", "CEG", "WST"]),
    );
    expect(p).toContain("Positions: 4 of 4 — this analyst is FULL.");
  });
});
