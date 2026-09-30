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
    if (u.pathname.endsWith("/trades")) return new Response(JSON.stringify({ trades: [], next_page_token: null }), { status: 200 });
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
    const bars = asked.filter((u) => u.pathname.endsWith("/bars"));
    expect(bars).toHaveLength(1);
    expect(bars[0].pathname).toBe("/v2/stocks/SMMT/bars");
    expect(bars[0].searchParams.get("feed")).toBe("sip");
    expect(bars[0].searchParams.get("timeframe")).toBe("1Min");
    for (const call of (global.fetch as jest.Mock).mock.calls) expect(call[1]).toMatchObject({ cache: "no-store" });
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

/**
 * DOCU, 2026-09-30 — the quiet morning that drew nothing.
 *
 * Eleven trades before the open, 110 shares in all, every one under 100
 * shares; Alpaca's one-minute bars skip such minutes, so the first bar was
 * 9:30 and the chart's left band was empty. Any line is better than no line:
 * where the day has no bars, the tape's trades of any size stand in, one
 * point per minute, and the line runs from the window's left edge to now.
 * The bars, the trades and the last trade before 7:00 are the vendor's own
 * replies, captured that noon.
 */
import docu from "@/lib/market-data/__fixtures__/alpaca-docu-day-2026-09-30.json";

type TradeTuple = [string, number, number, string, string];

describe("DOCU's 1D chart, 2026-09-30 — a quiet pre-market", () => {
  const allTrades = () => {
    const seen = new Set<string>();
    return [...(docu.lastBeforeWindow as TradeTuple[]), ...(docu.preMarketTrades as TradeTuple[])]
      .filter(([t, p, s]) => (seen.has(`${t}${p}${s}`) ? false : (seen.add(`${t}${p}${s}`), true)))
      .map(([t, p, s]) => ({ t, p, s }))
      .sort((a, b) => a.t.localeCompare(b.t));
  };
  const vendor = () => {
    asked = [];
    global.fetch = jest.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      asked.push(u);
      // Instants, not strings: the vendor is asked with millisecond ISO
      // stamps and answers with nanosecond ones.
      const ms = (iso: string) => new Date(iso).getTime();
      const start = ms(u.searchParams.get("start") ?? "2000-01-01T00:00:00Z");
      const end = ms(u.searchParams.get("end") ?? "2100-01-01T00:00:00Z");
      if (u.pathname.endsWith("/trades")) {
        let rows = allTrades().filter((t) => ms(t.t) >= start && ms(t.t) < end);
        if (u.searchParams.get("sort") === "desc") rows = rows.reverse();
        rows = rows.slice(0, Number(u.searchParams.get("limit") ?? 10000));
        return new Response(JSON.stringify({ trades: rows, next_page_token: null }), { status: 200 });
      }
      const bars = toBars(docu.bars).filter((b) => ms(b.t) >= start && ms(b.t) <= end);
      return new Response(JSON.stringify({ bars, next_page_token: null }), { status: 200 });
    }) as unknown as typeof fetch;
  };

  it("at noon: seven pre-market points from the small trades, then the 148 bars from 9:30 — the line starts at 7:00", async () => {
    jest.setSystemTime(new Date("2026-09-30T16:00:00Z"));
    vendor();
    const { getIntradayCandles } = await import("./finnhub.actions");
    const points = await getIntradayCandles("DOCU");
    const pre = points.filter((b) => etMinutes(b.date) < 570);
    expect(pre.map((b) => [b.date.slice(11, 16), b.close, b.volume])).toEqual([
      ["11:00", 66.54, 7],
      ["11:01", 66.98, 1],
      ["11:30", 66.99, 26],
      ["12:14", 67, 25],
      ["12:49", 65.48, 5],
      ["12:53", 66.92, 3],
      ["13:05", 67.55, 1],
    ]);
    // Two trades in the 7:30 minute fold into one point: first, high, low, last.
    expect(pre[2]).toMatchObject({ open: 67.8225, high: 67.8225, low: 66.99, close: 66.99 });
    expect(points.filter((b) => etMinutes(b.date) >= 570)).toHaveLength(148);
    expect(points[0].date).toBe("2026-09-30T11:00:00Z");
    // Only the bar-less stretch was read for trades: one call, 7:00 to 9:30.
    const tradeCalls = asked.filter((u) => u.pathname.endsWith("/trades"));
    expect(tradeCalls).toHaveLength(1);
    expect(tradeCalls[0].searchParams.get("start")).toBe("2026-09-30T11:00:00.000Z");
    expect(tradeCalls[0].searchParams.get("end")).toBe("2026-09-30T13:30:00.000Z");
  });

  it("at 8:00 AM, before any bar: the line runs from 7:00 to now on the trades so far, carrying the last price to the right edge", async () => {
    jest.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    vendor();
    const { getIntradayCandles } = await import("./finnhub.actions");
    const points = await getIntradayCandles("DOCU");
    expect(points.map((b) => [b.date.slice(11, 16), b.close])).toEqual([
      ["11:00", 66.54],
      ["11:01", 66.98],
      ["11:30", 66.99],
      ["12:00", 66.99],
    ]);
    expect(points[points.length - 1].volume).toBe(0);
  });

  it("with nothing traded in the window yet, the left edge starts from the last trade before 7:00", async () => {
    jest.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    vendor();
    const sevenAm = Date.parse("2026-09-30T11:00:00Z");
    const inWindow = new Set((docu.preMarketTrades as TradeTuple[]).filter(([t]) => Date.parse(t) >= sevenAm).map(([t]) => t));
    const base = global.fetch as jest.Mock;
    global.fetch = jest.fn(async (url: string | URL, init?: RequestInit) => {
      const res = await base(url, init);
      const u = new URL(String(url));
      if (!u.pathname.endsWith("/trades") || u.searchParams.get("sort") === "desc") return res;
      const body = (await res.json()) as { trades: { t: string }[] };
      return new Response(JSON.stringify({ trades: body.trades.filter((t) => !inWindow.has(t.t)), next_page_token: null }), { status: 200 });
    }) as unknown as typeof fetch;
    const { getIntradayCandles } = await import("./finnhub.actions");
    const points = await getIntradayCandles("DOCU");
    // 5:26 AM, 20 shares at $66.62 — the last print before the window.
    expect(points.map((b) => [b.date.slice(11, 16), b.close, b.volume])).toEqual([
      ["11:00", 66.62, 0],
      ["12:00", 66.62, 0],
    ]);
  });
});
