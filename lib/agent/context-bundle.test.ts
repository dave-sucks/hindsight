import { returnPctOf } from "./context-bundle";

describe("returnPctOf", () => {
  it("is direction-aware — a short that fell is a gain", () => {
    expect(
      returnPctOf({ direction: "SHORT", avgCost: 100, closePrice: 90 }),
    ).toBe(10);
    expect(
      returnPctOf({ direction: "SHORT", avgCost: 91.325, closePrice: 96.16 }),
    ).toBe(-5.3);
  });

  it("reports a long correctly", () => {
    expect(
      returnPctOf({ direction: "LONG", avgCost: 53.36, closePrice: 66.2423 }),
    ).toBe(24.1);
  });

  it("returns null on missing or nonsense inputs", () => {
    expect(returnPctOf({ direction: "LONG", avgCost: 0, closePrice: 10 })).toBeNull();
    expect(returnPctOf({ direction: "LONG", avgCost: 10, closePrice: null })).toBeNull();
  });
});

import {
  formatTickerHistory,
  formatTickerHistoryShort,
  heldDaysOf,
  type TickerHistory,
} from "./context-bundle";

const noHistory: TickerHistory = {
  ticker: "AGIO",
  thesis: null,
  trades: [],
  otherSeatTrades: [],
  openPosition: null,
  otherSeatCoverage: [],
  loaded: true,
};

describe("heldDaysOf", () => {
  it("counts calendar days, and returns null when either end is missing", () => {
    expect(heldDaysOf(new Date("2026-06-17"), new Date("2026-07-16"))).toBe(29);
    expect(heldDaysOf(null, new Date("2026-07-16"))).toBeNull();
    expect(heldDaysOf(new Date("2026-07-16"), null)).toBeNull();
  });
});

describe("formatTickerHistory", () => {
  it("renders nothing for a genuinely new name", () => {
    expect(formatTickerHistory(noHistory)).toBeNull();
  });

  it("renders nothing when the lookup FAILED — unread is not 'no history'", () => {
    // Asserting "no prior coverage" on a failed read would be a lie about a
    // name we may have lost money on.
    expect(formatTickerHistory({ ...noHistory, loaded: false })).toBeNull();
  });

  it("leads with our P&L on a name we traded, and carries the old belief", () => {
    const out = formatTickerHistory({
      ...noHistory,
      ticker: "XENE",
      trades: [
        {
          analystName: null,
          openedAt: new Date("2026-07-17"),
          closedAt: new Date("2026-08-10"),
          heldDays: 24,
          entryPrice: 68.84,
          exitPrice: 62.98,
          realizedPnlUSD: -586,
          returnPct: -8.5,
          outcome: "LOSS",
          closeReason: "MANUAL",
        },
        {
          analystName: null,
          openedAt: new Date("2026-06-17"),
          closedAt: new Date("2026-07-16"),
          heldDays: 29,
          entryPrice: 53.36,
          exitPrice: 66.24,
          realizedPnlUSD: 966,
          returnPct: 24.1,
          outcome: "WIN",
          closeReason: "STOP",
        },
      ],
      thesis: {
        id: "th_1",
        status: "RETIRED",
        direction: "LONG",
        conviction: "HIGH",
        coreBelief: "XENE reaches $80–$100 within 12 months.",
        retiredReason: "SOLD",
        catalystDate: null,
        researchUpdatedAt: new Date("2026-08-04"),
      },
    })!;
    expect(out).toContain("WE HAVE TRADED THIS BEFORE — 2 closed positions");
    expect(out).toContain("+$966 (+24.1%)");
    // "when we bought and when we sold" has to be answerable inline.
    expect(out).toContain("bought 2026-06-17 @ $53.36");
    expect(out).toContain("sold 2026-07-16 @ $66.24 (held 29d)");
    // And the deep detail has to be one named call away, not a guess.
    expect(out).toContain('get_theses(tickers: ["XENE"]');
    expect(out).toContain("include_history: true");
    expect(out).toContain("−$586 (-8.5%)");
    expect(out).toContain("RETIRED (SOLD) LONG");
    expect(out).toContain("XENE reaches $80–$100");
    expect(out).toMatch(/not on whether the event resolved well in the world/);
  });

  it("surfaces a name we PASSED on but never traded — the case a position-derived list misses", () => {
    const out = formatTickerHistory({
      ...noHistory,
      ticker: "NUVL",
      thesis: {
        id: "th_2",
        status: "PASSED",
        direction: null,
        conviction: null,
        coreBelief: null,
        retiredReason: null,
        catalystDate: null,
        researchUpdatedAt: null,
      },
    })!;
    expect(out).toContain("LAST THESIS (th_2): PASSED");
    expect(out).toContain("researched this name before without trading it");
  });

  it("surfaces other seats on the account — a name is a name", () => {
    // AKAM cost Catalyst $396 and Momentum $675 independently, and neither
    // run could see the other's result.
    const out = formatTickerHistory({
      ...noHistory,
      ticker: "AKAM",
      otherSeatTrades: [
        {
          analystName: "Momentum Breakout",
          openedAt: new Date("2026-04-06"),
          closedAt: new Date("2026-04-09"),
          heldDays: 3,
          entryPrice: 117.89,
          exitPrice: 109.86,
          realizedPnlUSD: -675,
          returnPct: -6.8,
          outcome: "LOSS",
          closeReason: "STOP",
        },
      ],
      otherSeatCoverage: ["Secular Compounder (HOLDING)"],
    })!;
    expect(out).toContain("OTHER SEATS HAVE TRADED IT: Momentum Breakout 2026-04-09 −$675");
    expect(out).toContain("ANOTHER SEAT ON THIS ACCOUNT COVERS IT: Secular Compounder (HOLDING)");
    // Another desk's mandate differs — evidence, not a verdict.
    expect(out).toContain("evidence rather than a verdict");
    // Must not claim "we researched it without trading it" when other desks
    // demonstrably traded it — that reads as a contradiction.
    expect(out).not.toContain("without trading it");
    expect(out).toContain("This seat has never traded it; other desks have");
  });

  it("says plainly when we hold it right now", () => {
    const out = formatTickerHistory({
      ...noHistory,
      ticker: "SRRK",
      openPosition: { quantity: 93, avgCost: 53.895, openedAt: new Date("2026-08-13") },
    })!;
    expect(out).toContain("WE HOLD IT NOW: 93 sh @ $53.90 since 2026-08-13");
  });
});

describe("formatTickerHistoryShort", () => {
  it("is one line for the chat row, not the full paragraph", () => {
    const out = formatTickerHistoryShort({
      ...noHistory,
      ticker: "XENE",
      trades: [
        { analystName: null, openedAt: null, closedAt: null, heldDays: null, entryPrice: null, exitPrice: null, realizedPnlUSD: 966, returnPct: 24.1, outcome: "WIN", closeReason: "STOP" },
        { analystName: null, openedAt: null, closedAt: null, heldDays: null, entryPrice: null, exitPrice: null, realizedPnlUSD: -586, returnPct: -8.5, outcome: "LOSS", closeReason: "MANUAL" },
      ],
      otherSeatTrades: [
        { analystName: "PEAD Specialist", openedAt: null, closedAt: null, heldDays: null, entryPrice: null, exitPrice: null, realizedPnlUSD: 74, returnPct: 9.7, outcome: "WIN", closeReason: "TARGET" },
      ],
      thesis: { id: "t", status: "RETIRED", direction: "LONG", conviction: "HIGH", coreBelief: "…", retiredReason: "SOLD", catalystDate: null, researchUpdatedAt: null },
    });
    expect(out).toBe(
      "Prior coverage: 2 prior trades +$380 net, 1 on another desk, last thesis RETIRED (SOLD).",
    );
    expect(out!.length).toBeLessThan(120);
  });

  it("returns null for a name with no history", () => {
    expect(formatTickerHistoryShort(noHistory)).toBeNull();
  });
});
