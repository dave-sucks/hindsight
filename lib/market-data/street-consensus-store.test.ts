/**
 * The 14-day window on the stored Street rows: a stock the feed stops
 * serving shows its last row for two weeks, then reads as absent, so a
 * Street variable on a trigger reads "no row" rather than a stale target.
 * The store is read through the prisma double.
 */
import { prismaDouble } from "@/lib/replay";

const NOW = new Date("2026-11-04T16:00:00.000Z");
const DAY = 86_400_000;
const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const row = (ticker: string, daysOld: number, targetAvg: number) => ({
  ticker, asOf: nyDay(new Date(NOW.getTime() - daysOld * DAY)), fetchedAt: new Date(NOW.getTime() - daysOld * DAY),
  targetLow: targetAvg * 0.8, targetAvg, targetHigh: targetAvg * 1.2, analysts: 10, buy: 7, hold: 3, sell: 0,
  epsNextQuarter: null, epsNextQuarterEstimates: null, epsNextQuarterUp: null, epsNextQuarterDown: null, epsNextQuarterFiscalEnd: null,
  epsFiscalYear: null, epsFiscalYearUp: null, epsFiscalYearDown: null, epsNextQuarter1wAgo: null, epsNextQuarter1mAgo: null,
});

async function newest(rows: ReturnType<typeof row>[], tickers: string[]) {
  let out = new Map<string, { targetAvg: number; asOf: string }>();
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: prismaDouble({ streetConsensus: rows }) }));
    const { newestStreetRows } = await import("./street-consensus-store");
    out = await newestStreetRows(tickers, NOW);
  });
  return out;
}

describe("newestStreetRows: the 14-day window", () => {
  it("returns a row 13 days old and not one 15 days old; a stock with only an old row is absent", async () => {
    const out = await newest([row("AAA", 13, 100), row("BBB", 15, 200)], ["AAA", "BBB"]);
    expect(out.get("AAA")?.targetAvg).toBe(100);
    expect(out.has("BBB")).toBe(false);
  });

  it("the newest row within the window wins, and an older one past it changes nothing", async () => {
    const out = await newest([row("AAA", 2, 110), row("AAA", 9, 105), row("AAA", 20, 90)], ["AAA"]);
    expect(out.get("AAA")?.targetAvg).toBe(110);
  });

  it("a stock with no row at all is absent", async () => {
    expect((await newest([], ["ZZZ"])).size).toBe(0);
  });
});
