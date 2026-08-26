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
    expect(out).toContain('status: ["RETIRED", "PASSED"]');
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
