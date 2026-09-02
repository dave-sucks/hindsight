/**
 * format-data-block.test.ts — the writer must be given real price levels.
 *
 * The bug this pins: `sma20` and `sma50` were pulled into the data block and
 * never printed — only the PERCENT distance to them was. So a writer asked to
 * name an entry, a target and a stop, and to "cite the level," had exactly one
 * dollar figure available: today's price. It used it, every time. TOST entry
 * $35.15 against a $35.16 tape; ISRG $401.23 against $401.29; BMRN $64.67
 * against its own quoted price. Those are not judgement errors — the model was
 * asked for structure and handed none.
 */

import { formatDataBlock } from "./format-data-block";

function inputs(technicals: Record<string, unknown> | null) {
  return {
    ticker: "tost",
    pulledAt: new Date("2026-09-02T13:00:00.000Z"),
    stockData: {
      companyName: "Toast, Inc.",
      quote: {
        current: 35.16,
        changePercent: 0.4,
        week52Low: 24.5,
        week52High: 44.0,
      },
      technicals,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    financials: null,
    analystCoverage: null,
    insider: null,
    earningsHistory: null,
    peers: null,
    filings: null,
  };
}

describe("formatDataBlock — price levels the writer can anchor to", () => {
  it("prints the moving averages in DOLLARS, not just percent distance", () => {
    const out = formatDataBlock(
      inputs({ sma20: 33.4, sma50: 31.87, rsi14: 58, priceVsSma20: "+5.3%" }),
    );
    expect(out).toContain("20-day: $33.40");
    expect(out).toContain("50-day: $31.87");
  });

  it("still prints the percent-distance line — this adds, it does not replace", () => {
    const out = formatDataBlock(
      inputs({ sma20: 33.4, sma50: 31.87, rsi14: 58, priceVsSma20: "+5.3%" }),
    );
    expect(out).toContain("vs SMA20: +5.3%");
    expect(out).toContain("RSI(14): 58");
  });

  it("carries the 52-week boundaries onto the levels line", () => {
    const out = formatDataBlock(inputs({ sma20: 33.4, sma50: 31.87 }));
    expect(out).toContain("52w low $24.50");
    expect(out).toContain("52w high $44.00");
  });

  it("tells the writer an entry cannot be today's price", () => {
    const out = formatDataBlock(inputs({ sma20: 33.4, sma50: 31.87 }));
    expect(out).toMatch(/price the stock has NOT reached/i);
    expect(out).toMatch(/Today's price is not an entry/i);
  });

  it("degrades quietly when the moving averages are missing", () => {
    const out = formatDataBlock(inputs({ rsi14: 58 }));
    expect(out).not.toContain("Price levels —");
    expect(out).toContain("RSI(14): 58");
    expect(out).toContain("Current: $35.16");
  });

  it("says nothing about levels when there are no technicals at all", () => {
    const out = formatDataBlock(inputs(null));
    expect(out).not.toContain("Price levels —");
    expect(out).toContain("Current: $35.16");
  });
});
