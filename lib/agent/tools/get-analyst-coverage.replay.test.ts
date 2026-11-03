/**
 * get_analyst_coverage through its real entry point: the stored Street row
 * fills priceTargets; a missing or day-old row is pulled from Nasdaq (MSFT's
 * real replies, 2026-11-02) and stored; a malformed pull writes nothing and
 * yesterday's row stands.
 */
import msft from "@/lib/market-data/__fixtures__/nasdaq-street-MSFT-2026-11-02.json";
import { replayTool } from "@/lib/replay";
import { nyDay, parseStreet } from "@/lib/market-data/street-consensus";

type Data = { priceTargets: Record<string, unknown> | null; items: Array<{ text: string }> };

/** Nasdaq's three replies, by the endpoint at the end of the URL. */
function serveNasdaq(replies: Record<string, unknown>) {
  return jest.spyOn(global, "fetch").mockImplementation(async (url) => {
    const endpoint = String(url).split("/").pop()!;
    return new Response(JSON.stringify(replies[endpoint]), { status: 200 });
  });
}

const run = (seed: Record<string, unknown>[]) =>
  replayTool("get-analyst-coverage", "getAnalystCoverage", {
    seed: { streetConsensus: seed },
    args: { ticker: "MSFT" },
    quotes: { MSFT: 522.4 },
  });

afterEach(() => jest.restoreAllMocks());

describe("get_analyst_coverage — the Street targets", () => {
  it("today's stored row fills the targets, with the move to the average from the live price", async () => {
    const fetch = serveNasdaq(msft);
    const today = { ...parseStreet("MSFT", msft, nyDay()), fetchedAt: new Date() };
    const { result, crashed } = await run([today]);
    expect(crashed).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    const data = result.data as unknown as Data;
    expect(data.priceTargets).toMatchObject({ low: 440, average: 634.08, median: null, high: 750, currentPrice: 522.4, numAnalysts: 38 });
    expect(data.priceTargets!.impliedUpsidePct as number).toBeCloseTo(21.38, 2);
    expect(data.items.map((i) => i.text)).toEqual(
      expect.arrayContaining([
        `Targets — Low $440.00 · Avg $634.08 · High $750.00 (+21.4% vs $522.40) · 38 analysts, as of ${today.asOf}`,
        "EPS consensus: next-quarter EPS $4.85, 6 up / 3 down in 4 weeks (quarter ending Dec 2026, 15 estimates; was $4.84 a week ago, $4.83 a month ago) · fiscal-year EPS $19.79, 9 up / 3 down",
      ]),
    );
  });

  it("with no row it pulls the feed and stores the day's row", async () => {
    const fetch = serveNasdaq(msft);
    const { result, db } = await run([]);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0][0])).toBe("https://api.nasdaq.com/api/analyst/MSFT/targetprice");
    expect(db.store.streetConsensus).toHaveLength(1);
    expect(db.store.streetConsensus[0]).toMatchObject({ ticker: "MSFT", asOf: nyDay(), targetAvg: 634.08, epsNextQuarter: 4.85 });
    expect((result.data as unknown as Data).priceTargets).toMatchObject({ average: 634.08 });
  });

  it("a malformed pull writes nothing: yesterday's row stands and is what the tool reads", async () => {
    const moved = JSON.parse(JSON.stringify(msft));
    delete moved.targetprice.data.consensusOverview;
    serveNasdaq(moved);
    const old = { ...parseStreet("MSFT", msft, "2026-10-30"), fetchedAt: new Date(Date.now() - 3 * 86_400_000) };
    const { result, db } = await run([old]);
    expect(db.store.streetConsensus).toEqual([old]);
    expect((result.data as unknown as Data).priceTargets).toMatchObject({ average: 634.08, asOf: "2026-10-30" });
  });

  it("a row past 14 days is not read: with no fresh pull the range is absent", async () => {
    serveNasdaq({ targetprice: { data: null }, "earnings-forecast": { data: null }, "estimate-momentum": { data: null } });
    const stale = { ...parseStreet("MSFT", msft, nyDay(new Date(Date.now() - 15 * 86_400_000))), fetchedAt: new Date(Date.now() - 15 * 86_400_000) };
    const { result } = await run([stale]);
    expect((result.data as unknown as Data).priceTargets).toBeNull();
  });

  it("nothing stored and nothing pulled: the range is said to be absent", async () => {
    serveNasdaq({ targetprice: { data: null }, "earnings-forecast": { data: null }, "estimate-momentum": { data: null } });
    const { result, db } = await run([]);
    expect(db.store.streetConsensus).toEqual([]);
    const data = result.data as unknown as Data;
    expect(data.priceTargets).toBeNull();
    expect(data.items.map((i) => i.text)).toContain("Price-target range: none on file for this stock. Do not cite a consensus target you did not see.");
  });
});
