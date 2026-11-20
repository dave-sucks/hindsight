/**
 * Charts read every page Alpaca sends.
 *
 * Nov 20 2026: the sheet's 1M view of MU ended on Nov 3. Alpaca answered the
 * month of hourly bars with 170 bars ending 2026-11-04T11:00:00Z and a
 * `next_page_token`; the chart read the first page only. A batch of daily
 * bars for 8 stocks stopped at 1,000 bars the same way. This replays both
 * shapes through the entry points the chart routes call.
 */

export {};

const OLD_ENV = process.env;

async function loadFresh() {
  let mod!: typeof import("./finnhub.actions");
  await jest.isolateModulesAsync(async () => {
    mod = await import("./finnhub.actions");
  });
  return mod;
}

const bar = (t: string, c: number) => ({ t, c, o: c, h: c, l: c, v: 1000 });
const reply = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

let urls: string[] = [];
function pages(...bodies: unknown[]) {
  urls = [];
  let i = 0;
  global.fetch = jest.fn(async (url: unknown) => {
    urls.push(String(url));
    const body = bodies[i++];
    return body === "refuse" ? reply({ message: "no" }, false, 500) : reply(body);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "k", ALPACA_API_SECRET: "s" };
});
afterAll(() => {
  process.env = OLD_ENV;
});

describe("the 1M view's hourly bars", () => {
  it("follows the next page past Nov 4, so the range ends on the last session", async () => {
    pages(
      { bars: [bar("2026-10-20T17:00:00Z", 900), bar("2026-11-04T15:00:00Z", 640)], next_page_token: "TVV8TXwxNzkzNzkzNjAwMDAwMDAwMDAw" },
      { bars: [bar("2026-11-19T18:00:00Z", 650), bar("2026-11-20T16:00:00Z", 606.64)], next_page_token: null },
    );
    const { getHourlyCandles } = await loadFresh();
    const candles = await getHourlyCandles("MU", 31, "1Hour");
    expect(candles.map((c) => c.date)).toEqual([
      "2026-10-20T17:00:00Z",
      "2026-11-04T15:00:00Z",
      "2026-11-19T18:00:00Z",
      "2026-11-20T16:00:00Z",
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("&page_token=TVV8TXwxNzkzNzkzNjAwMDAwMDAwMDAw");
  });

  it("shows nothing rather than half a month when a later page is refused", async () => {
    pages({ bars: [bar("2026-10-20T17:00:00Z", 900)], next_page_token: "next" }, "refuse");
    const { getHourlyCandles } = await loadFresh();
    expect(await getHourlyCandles("MU", 31, "1Hour")).toEqual([]);
  });
});

describe("daily bars for a list of stocks", () => {
  it("keeps the stocks that come after the first page, and a stock split across pages whole", async () => {
    pages(
      { bars: { AAPL: [bar("2026-11-19T05:00:00Z", 230), bar("2026-11-20T05:00:00Z", 231)], MU: [bar("2026-11-18T05:00:00Z", 640)] }, next_page_token: "p2" },
      { bars: { MU: [bar("2026-11-19T05:00:00Z", 635), bar("2026-11-20T05:00:00Z", 606.64)], WST: [bar("2026-11-20T05:00:00Z", 420)] }, next_page_token: null },
    );
    const { getStockCandlesBatch } = await loadFresh();
    const out = await getStockCandlesBatch(["AAPL", "MU", "WST"], 365);
    expect(Object.keys(out).sort()).toEqual(["AAPL", "MU", "WST"]);
    expect(out.MU.map((c) => c.date)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(out.WST.map((c) => c.close)).toEqual([420]);
  });
});
