jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { stockTableFromFacts, type TableThesis } from "./stock-table-load";
import type { StockFacts } from "./stock-facts";
import type { IndicatorSnapshot } from "@/lib/market-data/indicator-snapshot";

const snap = { volumeAvg20: 1_000_000, sma: {}, rsVsSpy: {}, closes: [], high52w: 100 } as unknown as IndicatorSnapshot;
const volumeAt = (priceAsOf: string, dayVolume: number) => {
  const facts = {
    load: { livePrice: { AAA: 50 }, indicators: new Map([["AAA", snap]]), positions: new Map(), dayChange: {}, dayVolume: { AAA: dayVolume }, priceAsOf: { AAA: priceAsOf }, proposals: new Map() },
    sources: new Map(),
  } as unknown as StockFacts;
  const thesis = { id: "t", ticker: "AAA", status: "WATCHING", direction: "LONG", researchRun: null } as unknown as TableThesis;
  return stockTableFromFacts([thesis], facts, { nameAnalyst: false, reports: null }).rows[0].volume;
};

describe("the table's volume reads at the price's own time", () => {
  it("in the session, against the normal volume by then", () => {
    // 12:00 ET, minute 150: 30.95% of a normal day has traded.
    expect(volumeAt("2026-11-23T17:00:00.000Z", 500_000)).toBeCloseTo(0.5 / 0.3095, 3);
  });
  it("a price stamped at the last close is that whole day against the average, whatever the clock says now", () => {
    expect(volumeAt("2026-11-20T21:00:00.000Z", 900_000)).toBeCloseTo(0.9, 5);
  });
});
