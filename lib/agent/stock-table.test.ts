import { columnsOf, sortStockRows, stockCell, stockTableLines, STOCK_TABLE_COLUMNS, type StockTableRow } from "./stock-table";

const row = (over: Partial<StockTableRow>): StockTableRow => ({
  ticker: "AAA", status: "watch", analyst: null, situations: [], price: 10.5, dayPct: 0, volume: 1, move5dPct: null, move20dPct: null,
  vsSpy1M: null, vs50dPct: null, offHighPct: null, sinceBuyPct: null, outlook: null, conviction: null, nextReport: null, waiting: null, ...over,
});

describe("the stock table", () => {
  // The Nov 19 close on the live account: LUXE fell 10.1% on 2.4x volume and its line on the Nov 20 morning list showed only its price.
  const luxe = row({ ticker: "LUXE", price: 10.55, dayPct: -10.1, volume: 2.4, move5dPct: -0.5, outlook: "BULLISH", conviction: "MEDIUM" });
  const panw = row({ ticker: "PANW", status: "held", price: 361.73, dayPct: 6.4, volume: 2.8, sinceBuyPct: 1.2, conviction: "MEDIUM" });
  const iot = row({ ticker: "IOT", status: "held", price: 38.4, dayPct: -3.7, volume: 0.9, sinceBuyPct: -10.1, outlook: "not rated", conviction: "LOW", waiting: "sell 300" });
  const srrk = row({ ticker: "SRRK", price: 50.37, dayPct: 4.9, volume: 1.5 });

  it("lists held stocks first, each group by the day's move, biggest rise first", () => {
    expect(sortStockRows([luxe, iot, srrk, panw]).map((r) => r.ticker)).toEqual(["PANW", "IOT", "SRRK", "LUXE"]);
  });

  it("is one shape for every reader: the note, the column names, then a line a stock with every column", () => {
    const lines = stockTableLines({ asOf: "2026-11-19T21:00:00.000Z", rows: sortStockRows([luxe, iot]) });
    expect(lines[0]).toContain("Prices as of Thu, Nov 19, 4:00 PM ET");
    expect(lines[1]).toBe("Stock | Status | Situation | Price | Day | Volume | 5-day | 1-month | vs S&P, 1-month | vs 50-day | Off 52w high | Since buy | Outlook | Conviction | Next report | Waiting for you");
    expect(lines[2]).toBe("IOT | held | — | $38.40 | -3.7% | 0.9x | — | — | — | — | — | -10.1% | not rated | low | — | sell 300");
    expect(lines[3]).toBe("LUXE | watch | — | $10.55 | -10.1% | 2.4x | -0.5% | — | — | — | — | — | bullish | medium | — | —");
    for (const l of lines.slice(1)) expect(l.split(" | ")).toHaveLength(16);
  });

  it("names the analyst only on a read of more than one analyst's stocks, and a situation by its name", () => {
    const table = { asOf: null, rows: [row({ analyst: "PEAD Specialist", situations: ["a report", "a filing"] })] };
    expect(columnsOf(table)).toHaveLength(STOCK_TABLE_COLUMNS.length);
    expect(stockTableLines(table)[2]).toContain("AAA | watch | PEAD Specialist | a report, a filing | $10.50");
    expect(columnsOf({ asOf: null, rows: [luxe] }).some((c) => c.key === "analyst")).toBe(false);
  });

  it("says a number it doesn't have as a dash, never a zero", () => {
    const day = STOCK_TABLE_COLUMNS.find((c) => c.key === "dayPct")!;
    expect(stockCell(row({ dayPct: null }), day)).toBe("—");
    expect(stockCell(row({ dayPct: 0 }), day)).toBe("+0.0%");
  });
});
