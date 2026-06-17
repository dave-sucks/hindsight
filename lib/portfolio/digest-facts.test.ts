/**
 * digest-facts.test.ts — pins the pure assembler behind the Daily Portfolio
 * Digest (Feature A). Exercises `assembleDigestFacts` with fixture rows (no IO).
 *
 * The load-bearing invariant: P&L is DEPOSIT-ADJUSTED. total P&L =
 * equity − net contributed, NEVER equity − STARTING_CAPITAL. A deposit must
 * not read as a gain (the homepage "+1015%" recurring bug).
 */

import {
  assembleDigestFacts,
  type DigestRawInputs,
} from "./digest-facts";
import type { AlpacaAccount } from "@/lib/alpaca";

const GEN_AT = "2026-06-17T20:00:00.000Z";
const DATE = "2026-06-17";

function account(over: Partial<AlpacaAccount> = {}): AlpacaAccount {
  return {
    id: "acct",
    account_number: "X",
    status: "ACTIVE",
    currency: "USD",
    cash: "20000",
    portfolio_value: "100000",
    equity: "100000",
    last_equity: "99000",
    buying_power: "40000",
    long_market_value: "80000",
    short_market_value: "0",
    shorting_enabled: true,
    trade_suspended_by_user: false,
    trading_blocked: false,
    pattern_day_trader: false,
    ...over,
  };
}

function baseInputs(over: Partial<DigestRawInputs> = {}): DigestRawInputs {
  return {
    accountId: "acc_1",
    date: DATE,
    generatedAtIso: GEN_AT,
    runs: [],
    thesisUpdates: [],
    openedPositions: [],
    closedPositions: [],
    managementActions: [],
    heldPositions: [],
    pendingProposalCount: 0,
    lastEntryBeforeTodayAt: null,
    passedTheses: [],
    capacity: 10,
    fundingEvents: [],
    startingCapitalFallback: 100_000,
    account: account(),
    ...over,
  };
}

describe("assembleDigestFacts — P&L is deposit-adjusted", () => {
  it("total P&L = equity − net contributed when funding events exist (NOT equity − 100k)", () => {
    // Live-account shape: $8k seed + $80k deposit = $88k contributed.
    // equity $88,377.22 → true total P&L ≈ +$377.22, NOT +$81,377 (vs 100k seed)
    // and NOT +$88,377 (vs 0).
    const f = assembleDigestFacts(
      baseInputs({
        fundingEvents: [
          { date: "2026-05-10", amount: 8_000 },
          { date: "2026-05-21", amount: 80_000 },
        ],
        account: account({ equity: "88377.22", last_equity: "88000", cash: "8000" }),
      }),
    );
    expect(f.pnl.netContributed).toBe(88_000);
    expect(f.pnl.totalPnl).toBeCloseTo(377.22, 2);
    // The deposit-as-gain bug would have reported ~+81k here.
    expect(f.pnl.totalPnl).toBeLessThan(1_000);
  });

  it("a deposit that lands TODAY is stripped from day P&L", () => {
    const f = assembleDigestFacts(
      baseInputs({
        fundingEvents: [{ date: DATE, amount: 50_000 }],
        account: account({ equity: "150100", last_equity: "100000" }),
      }),
    );
    // equity − last_equity = 50,100, but $50k posted today → day P&L = $100.
    expect(f.pnl.dayPnl).toBeCloseTo(100, 2);
  });

  it("falls back to startingCapitalFallback when there are no funding events (paper)", () => {
    const f = assembleDigestFacts(
      baseInputs({ fundingEvents: [], account: account({ equity: "100500" }) }),
    );
    expect(f.pnl.netContributed).toBe(100_000);
    expect(f.pnl.totalPnl).toBeCloseTo(500, 2);
  });

  it("zeroes P&L gracefully when there is no broker account", () => {
    const f = assembleDigestFacts(baseInputs({ account: null }));
    expect(f.hadAlpaca).toBe(false);
    expect(f.pnl.totalPnl).toBe(0);
    expect(f.pnl.dayPnl).toBe(0);
    expect(f.book.totalEquity).toBe(0);
  });
});

describe("assembleDigestFacts — runs + rollup", () => {
  it("rolls up runs by mode and counts failures", () => {
    const f = assembleDigestFacts(
      baseInputs({
        runs: [
          { id: "r1", mode: "MORNING_PLAN", status: "COMPLETE", analystId: "a1", analystName: "Momentum", startedAt: new Date("2026-06-17T12:00:00Z") },
          { id: "r2", mode: "INTRADAY_TACTICAL", status: "COMPLETE", analystId: "a2", analystName: "Catalyst", startedAt: new Date("2026-06-17T18:30:00Z") },
          { id: "r3", mode: "INTRADAY_TACTICAL", status: "FAILED", analystId: "a2", analystName: "Catalyst", startedAt: new Date("2026-06-17T19:30:00Z") },
          { id: "r4", mode: "EOD_REFLECTIVE", status: "COMPLETE", analystId: null, analystName: null, startedAt: new Date("2026-06-17T13:00:00Z") },
        ],
      }),
    );
    expect(f.runRollup).toEqual({ daily: 1, tactical: 2, discovery: 1, failed: 1 });
    // runs sorted ascending by start time
    expect(f.runs.map((r) => r.runId)).toEqual(["r1", "r4", "r2", "r3"]);
    // ET time label present
    expect(f.runs[0].startedAtEt).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("assembleDigestFacts — trades aggregation", () => {
  it("merges opens, closes, and management actions into one trade list", () => {
    const f = assembleDigestFacts(
      baseInputs({
        openedPositions: [
          { id: "p1", symbol: "MU", direction: "LONG", quantity: 10, avgCost: 100, openedAt: new Date("2026-06-17T14:00:00Z"), analystId: "a1", analystName: "Momentum" },
        ],
        closedPositions: [
          { id: "p2", symbol: "NVDA", direction: "LONG", quantity: 5, closePrice: 120, realizedPnl: 250, closedAt: new Date("2026-06-17T15:00:00Z"), analystId: "a1", analystName: "Momentum" },
        ],
        managementActions: [
          { positionId: "p3", symbol: "AMD", direction: "LONG", actionType: "PARTIAL_CLOSE", newQty: 3, createdAt: new Date("2026-06-17T16:00:00Z"), analystId: "a2", analystName: "Catalyst" },
        ],
      }),
    );
    expect(f.trades).toHaveLength(3);
    const kinds = f.trades.map((t) => `${t.kind}:${t.ticker}`);
    expect(kinds).toContain("OPEN:MU");
    expect(kinds).toContain("CLOSE:NVDA");
    expect(kinds).toContain("PARTIAL_CLOSE:AMD");
    const close = f.trades.find((t) => t.ticker === "NVDA")!;
    expect(close.realizedPnl).toBe(250);
    expect(f.pnl.realizedToday).toBe(250);
  });
});

describe("assembleDigestFacts — book snapshot + concentration", () => {
  it("computes slots, exposure, and top sector concentration from cost basis", () => {
    const f = assembleDigestFacts(
      baseInputs({
        capacity: 5,
        heldPositions: [
          { id: "p1", symbol: "MU", direction: "LONG", quantity: 100, avgCost: 100, sector: "Technology", thesisId: "t1", analystId: "a1", analystName: "Momentum" }, // 10k
          { id: "p2", symbol: "NVDA", direction: "LONG", quantity: 100, avgCost: 200, sector: "Technology", thesisId: "t2", analystId: "a1", analystName: "Momentum" }, // 20k
          { id: "p3", symbol: "XOM", direction: "LONG", quantity: 100, avgCost: 100, sector: "Energy", thesisId: "t3", analystId: "a2", analystName: "Energy" }, // 10k
        ],
        account: account({ long_market_value: "40000", short_market_value: "0", equity: "100000" }),
      }),
    );
    expect(f.book.heldCount).toBe(3);
    expect(f.book.slotsUsedLabel).toBe("3/5");
    expect(f.book.grossExposure).toBe(40_000);
    expect(f.book.topSector).toBe("Technology");
    // Tech = 30k of 40k known notional = 0.75
    expect(f.book.topSectorConcentration).toBeCloseTo(0.75, 4);
    // thesisId carried through for reference tokens
    expect(f.book.held.find((h) => h.ticker === "MU")?.thesisId).toBe("t1");
  });

  it("null sector concentration when no sectors are known", () => {
    const f = assembleDigestFacts(
      baseInputs({
        heldPositions: [
          { id: "p1", symbol: "MU", direction: "LONG", quantity: 1, avgCost: 100, sector: null, thesisId: null, analystId: null, analystName: null },
        ],
      }),
    );
    expect(f.book.topSector).toBeNull();
    expect(f.book.topSectorConcentration).toBeNull();
  });
});

describe("assembleDigestFacts — cadence + passes", () => {
  it("flags fully deployed and computes days since last entry", () => {
    const f = assembleDigestFacts(
      baseInputs({
        capacity: 2,
        heldPositions: [
          { id: "p1", symbol: "MU", direction: "LONG", quantity: 1, avgCost: 100, sector: null, thesisId: null, analystId: null, analystName: null },
          { id: "p2", symbol: "NVDA", direction: "LONG", quantity: 1, avgCost: 100, sector: null, thesisId: null, analystId: null, analystName: null },
        ],
        openedPositions: [],
        lastEntryBeforeTodayAt: new Date("2026-06-10T14:00:00Z"),
      }),
    );
    expect(f.cadence.fullyDeployed).toBe(true);
    expect(f.cadence.slotsTotal).toBe(2);
    expect(f.cadence.daysSinceLastNewEntry).toBe(7);
  });

  it("days since last entry is 0 when a position opened today", () => {
    const f = assembleDigestFacts(
      baseInputs({
        openedPositions: [
          { id: "p1", symbol: "MU", direction: "LONG", quantity: 1, avgCost: 100, openedAt: new Date("2026-06-17T14:00:00Z"), analystId: null, analystName: null },
        ],
        lastEntryBeforeTodayAt: new Date("2026-06-01T14:00:00Z"),
      }),
    );
    expect(f.cadence.daysSinceLastNewEntry).toBe(0);
  });

  it("ages passes by days since pass, most-recent first", () => {
    const f = assembleDigestFacts(
      baseInputs({
        passedTheses: [
          { id: "t1", ticker: "SOFI", passedAt: new Date("2026-06-15T14:00:00Z"), priceAtPass: 12 },
          { id: "t2", ticker: "PLTR", passedAt: new Date("2026-06-10T14:00:00Z"), priceAtPass: 30 },
        ],
      }),
    );
    expect(f.passesAged.map((p) => p.ticker)).toEqual(["SOFI", "PLTR"]);
    expect(f.passesAged[0].daysSincePass).toBe(2);
    expect(f.passesAged[1].daysSincePass).toBe(7);
    expect(f.passesAged[0].priceAtPass).toBe(12);
  });
});

describe("assembleDigestFacts — decisions + version", () => {
  it("maps thesis updates to decisions with ids for reference tokens", () => {
    const f = assembleDigestFacts(
      baseInputs({
        thesisUpdates: [
          { id: "u1", type: "REVIEWED", summary: "No change", timestamp: new Date("2026-06-17T13:00:00Z"), priceAtTime: 101, runId: "r1", thesisId: "t1", ticker: "MU", analystId: "a1", analystName: "Momentum" },
        ],
      }),
    );
    expect(f.version).toBe(1);
    expect(f.decisions).toHaveLength(1);
    expect(f.decisions[0]).toMatchObject({
      thesisId: "t1",
      ticker: "MU",
      type: "REVIEWED",
      runId: "r1",
      analystId: "a1",
    });
  });
});
