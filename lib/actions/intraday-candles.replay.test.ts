/**
 * intraday-candles.replay.test.ts — DAV-340, from SMMT's real day.
 *
 * The thesis sheet's 1D chart read the free IEX feed: one exchange, so a
 * mid-cap's line had missing minutes and a wrong high, and no pre-market or
 * after-hours prints at all — the chart's off-hours bands stayed empty. On
 * 2026-09-29 SMMT's tape ran 19.09 / 16.15 for the session; IEX showed 384
 * of 391 minutes and a high of 19.07, and nothing before 9:30 or after 4:00.
 *
 * Both feeds' one-minute bars for that day were pulled the same evening,
 * 4:00 AM to 8:00 PM ET. The vendor is doubled to answer each feed with its
 * own bars, so the test reads what the chart asks for. On main it asks for
 * IEX, and fails.
 *
 * The chart draws 7:00 AM to 6:30 PM and sizes its price scale from every
 * bar it holds, so the bars are trimmed to that window here: SMMT's 4:00 AM
 * print at $19.81 sat above the whole visible day ($16.15–$19.09) and
 * stretched the scale to a point nobody could see (the QB's review of #741).
 */
import fixture from "@/lib/market-data/__fixtures__/alpaca-smmt-1min-2026-09-29.json";

type Tuple = [string, number, number, number, number, number];
const toBars = (rows: unknown[]) => (rows as Tuple[]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

const OLD_ENV = process.env;
let asked: URL[] = [];

beforeEach(() => {
  asked = [];
  process.env = { ...OLD_ENV, ALPACA_API_KEY: "PKTEST", ALPACA_API_SECRET: "secret" };
  jest.useFakeTimers({ now: new Date("2026-09-29T23:00:00Z"), doNotFake: ["nextTick", "queueMicrotask", "setImmediate", "clearImmediate"] });
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = new URL(String(url));
    asked.push(u);
    const feed = u.searchParams.get("feed");
    const rows = feed === "sip" ? fixture.sip : feed === "iex" ? fixture.iex : [];
    return new Response(JSON.stringify({ bars: toBars(rows), next_page_token: null }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  jest.useRealTimers();
  process.env = OLD_ENV;
});

const etMinutes = (iso: string) => {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .split(":")
    .map(Number);
  return h * 60 + m;
};

describe("SMMT's 1D chart, 2026-09-29", () => {
  it("asks for the consolidated tape and never the Data Cache", async () => {
    const { getIntradayCandles } = await import("./finnhub.actions");
    await getIntradayCandles("smmt");
    expect(asked).toHaveLength(1);
    expect(asked[0].pathname).toBe("/v2/stocks/SMMT/bars");
    expect(asked[0].searchParams.get("feed")).toBe("sip");
    expect(asked[0].searchParams.get("timeframe")).toBe("1Min");
    expect((global.fetch as jest.Mock).mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("the session's bars match the tape's daily high and low — 19.09 and 16.15, every minute present", async () => {
    const { getIntradayCandles } = await import("./finnhub.actions");
    const bars = await getIntradayCandles("SMMT");
    const session = bars.filter((b) => etMinutes(b.date) >= 570 && etMinutes(b.date) <= 960);
    expect(session).toHaveLength(391);
    expect(Math.max(...session.map((b) => b.high))).toBe(19.09);
    expect(Math.min(...session.map((b) => b.low))).toBe(16.15);
  });

  it("pre-market and after-hours prints are on the chart, for display", async () => {
    const { getIntradayCandles } = await import("./finnhub.actions");
    const bars = await getIntradayCandles("SMMT");
    const pre = bars.filter((b) => etMinutes(b.date) < 570);
    const post = bars.filter((b) => etMinutes(b.date) > 960);
    expect(pre.length).toBe(149);
    expect(post.length).toBe(88);
    // The morning's first print inside the window, and the last after the bell.
    expect(etMinutes(pre[0].date)).toBe(7 * 60);
    expect(etMinutes(post[post.length - 1].date)).toBe(18 * 60 + 28);
    expect(bars.every((b) => b.date.startsWith("2026-09-29"))).toBe(true);
  });

  it("only what the chart draws: nothing before 7:00 or after 6:30, so the 4:00 AM $19.81 print never sizes the scale", async () => {
    const { getIntradayCandles } = await import("./finnhub.actions");
    const bars = await getIntradayCandles("SMMT");
    expect(bars.every((b) => etMinutes(b.date) >= 7 * 60 && etMinutes(b.date) <= 18 * 60 + 30)).toBe(true);
    expect(Math.max(...bars.map((b) => b.high))).toBe(19.09);
    // The tape had it; the chart never sees it.
    expect(Math.max(...toBars(fixture.sip).map((b) => b.h))).toBe(19.81);
  });

  it("the free feed the chart used to read: seven minutes short and two cents under the real high", async () => {
    const rows = toBars(fixture.iex).filter((b) => etMinutes(b.t) >= 570 && etMinutes(b.t) <= 960);
    expect(rows).toHaveLength(384);
    expect(Math.max(...rows.map((b) => b.h))).toBe(19.07);
    expect(toBars(fixture.iex).some((b) => etMinutes(b.t) < 570 || etMinutes(b.t) > 960)).toBe(false);
  });
});
