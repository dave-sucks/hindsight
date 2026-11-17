import { bookTable, type BookThesis } from "./book-table";
import type { PortfolioSnapshot } from "@/lib/portfolio/snapshot";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

const now = new Date("2026-11-17T15:00:00Z");
const thesis = (over: Partial<BookThesis>): BookThesis => ({
  ticker: "NVDA", status: "HOLDING", conviction: "HIGH", coreBelief: "Demand outruns supply. More after.", lastReviewedAt: new Date("2026-11-14T15:00:00Z"), catalystDate: null, analyst: "Secular Compounder", ...over,
});
const holding = (ticker: string, value: number, share: number) => ({ ticker, value, share, move: -1.1, sinceBought: { dollars: -500, pct: -12.3 } });
const snapshot = { holdings: [holding("IOT", 4_000, 4), holding("NVDA", 14_200, 14.2)] } as unknown as PortfolioSnapshot;
const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
const charts = new Map([["NVDA", { closes, rsVsSpy: { "1M": -6.2, "3M": null, "6M": null } } as unknown as IndicatorSnapshot]]);

describe("the Portfolio Manager's book table", () => {
  const text = bookTable(
    [thesis({ ticker: "IOT", analyst: "PEAD Specialist" }), thesis({}), thesis({ ticker: "ABBV", status: "WATCHING", conviction: null, lastReviewedAt: null, catalystDate: new Date("2026-12-03T00:00:00Z") }), thesis({ status: "WATCHING", analyst: "Other" })],
    snapshot,
    charts,
    now,
  );
  const lines = text.split("\n");

  it("lists what we own biggest first, then what we watch, one line a stock", () => {
    expect(lines.filter((l) => l.startsWith("- ")).map((l) => l.slice(2, 6).trim())).toEqual(["NVDA", "IOT", "ABBV"]);
  });

  it("writes a holding's line from the snapshot, the chart and the thesis", () => {
    expect(lines[1]).toBe(
      "- NVDA · held, 14.2% of the account · since bought −12.3% · today −1.1%, 5 days +4.0%, 20 days +18.3% · against the S&P over a month −6.2 points · conviction HIGH · Secular Compounder · last look 3 days ago · Demand outruns supply.",
    );
  });

  it("says what is missing on a watch instead of leaving it out", () => {
    expect(lines.find((l) => l.startsWith("- ABBV"))).toBe("- ABBV · watched · no chart numbers · conviction not set · Secular Compounder · never reviewed · catalyst Dec 3 · Demand outruns supply.");
  });

  it("says none when the book has no watches", () => {
    expect(bookTable([thesis({})], snapshot, charts, now).endsWith("## What we watch\n- none")).toBe(true);
  });
});
