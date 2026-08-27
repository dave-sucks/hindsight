/**
 * context-bundle.test.ts — the pure halves of System 1's money context
 * (THREE_SYSTEMS.md Move 1). The fetch half is deliberately thin (creds →
 * equity, fail-open) and covered by the writer/discovery paths using it.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/actions/api-keys.actions", () => ({
  resolveAlpacaCredentials: jest.fn(),
}));
jest.mock("@/lib/alpaca", () => ({ getAccount: jest.fn() }));

import { floorPctOf, formatMoneyContextBlock } from "./context-bundle";

describe("floorPctOf", () => {
  it("rounds UP to one decimal — the percent that clears the floor", () => {
    // $7,000 floor at $125k equity = 5.6% exactly
    expect(floorPctOf({ equityUSD: 125_000, floorDollars: 7000 })).toBe(5.6);
    // $7,000 at $124k = 5.645…% → 5.7 (rounding down would under-clear)
    expect(floorPctOf({ equityUSD: 124_000, floorDollars: 7000 })).toBe(5.7);
  });

  it("returns null when either input is unavailable", () => {
    expect(floorPctOf({ equityUSD: null, floorDollars: 7000 })).toBeNull();
    expect(floorPctOf({ equityUSD: 125_000, floorDollars: 0 })).toBeNull();
    expect(floorPctOf({ equityUSD: 0, floorDollars: 7000 })).toBeNull();
  });
});

describe("formatMoneyContextBlock", () => {
  it("states equity, the band, the floor percent, and the PASS rule", () => {
    const block = formatMoneyContextBlock({
      equityUSD: 125_000,
      floorDollars: 7000,
      ceilingDollars: 14_000,
      floorPct: 5.6,
    });
    expect(block).toContain("$125,000");
    expect(block).toContain("$7,000 floor to $14,000 ceiling");
    expect(block).toContain("5.6% of the book");
    expect(block).toContain("PASS");
  });

  it("degrades honestly when equity is unavailable", () => {
    const block = formatMoneyContextBlock({
      equityUSD: null,
      floorDollars: 7000,
      ceilingDollars: 14_000,
      floorPct: null,
    });
    expect(block).toContain("equity unavailable");
    expect(block).not.toContain("% of the book");
    expect(block).toContain("$7,000 floor");
  });

  it("returns empty when the seat has no band at all", () => {
    expect(
      formatMoneyContextBlock({
        equityUSD: 125_000,
        floorDollars: 0,
        ceilingDollars: null,
        floorPct: null,
      }),
    ).toBe("");
  });

  it("handles ceiling-only seats (no floor configured)", () => {
    const block = formatMoneyContextBlock({
      equityUSD: null,
      floorDollars: 0,
      ceilingDollars: 5000,
      floorPct: null,
    });
    expect(block).toContain("ceiling: $5,000");
    expect(block).toContain("no floor configured");
  });
});

// ── The book ─────────────────────────────────────────────────────────────

import {
  returnPctOf,
  formatBookContextBlock,
  type BookContext,
} from "./context-bundle";

const emptyBook: BookContext = {
  openPositions: [],
  watching: [],
  pastHolds: [],
  loaded: true,
};

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

describe("formatBookContextBlock", () => {
  it("names held and watched tickers as the ONLY exclusions", () => {
    const out = formatBookContextBlock({
      ...emptyBook,
      openPositions: [
        {
          symbol: "SRRK",
          quantity: 93,
          avgCost: 53.895,
          notionalUSD: 5012,
          openedAt: new Date("2026-08-13"),
        },
      ],
      watching: [
        {
          ticker: "IONS",
          status: "WATCHING",
          catalystDate: new Date("2026-09-22"),
          conviction: "HIGH",
        },
        {
          ticker: "SRRK",
          status: "HOLDING",
          catalystDate: new Date("2026-09-30"),
          conviction: "HIGH",
        },
      ],
    });
    expect(out).toContain("$SRRK 93 sh");
    expect(out).toContain("$IONS WATCHING, catalyst 2026-09-22");
    // A held name must not be labelled as a watch.
    expect(out).toContain("$SRRK HOLDING");
    expect(out).not.toContain("Watching (");
    expect(out).toContain("ONLY names off-limits");
  });

  it("presents past holds as candidates, with OUR P&L attached", () => {
    const out = formatBookContextBlock({
      ...emptyBook,
      pastHolds: [
        {
          symbol: "XENE",
          realizedPnlUSD: 966,
          returnPct: 24.1,
          outcome: "WIN",
          closeReason: "STOP",
          closedAt: new Date("2026-07-16"),
          beliefSurvived: true,
        },
        {
          symbol: "MNKD",
          realizedPnlUSD: -345,
          returnPct: -6.8,
          outcome: "LOSS",
          closeReason: "STOP",
          closedAt: new Date("2026-08-04"),
          beliefSurvived: null,
        },
      ],
    });
    // The framing is the fix — a bare table is what failed on 08-25.
    expect(out).toContain("candidates, not exclusions");
    expect(out).toContain("does NOT disqualify");
    expect(out).toContain("+$966");
    expect(out).toContain("−$345");
    expect(out).toContain("sold on price — the reasoning still held");
    // The scoreboard rule has to be in words, not implied by the numbers.
    expect(out).toMatch(/approved while the trade loses money/i);
    // The prior thesis is still in the database — point at it rather than
    // letting the agent re-underwrite a name we already researched.
    expect(out).toContain("get_stock_data on any ticker returns our");
  });

  it("says so plainly when the seat genuinely holds nothing", () => {
    expect(formatBookContextBlock(emptyBook)).toContain("Holding now: nothing.");
  });

  it("renders NOTHING when the book could not be read — unread is not empty", () => {
    // A DB outage must not tell an agent holding two live positions that it
    // holds none. Found by probing the real book against a dead connection.
    expect(formatBookContextBlock({ ...emptyBook, loaded: false })).toBe("");
  });
});

// ── Per-ticker history (what get_stock_data attaches) ────────────────────

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
