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
 * shares; the consolidated tape leaves such odd lots out of the last sale and
 * the day's high and low, so no minute before 9:30 became a bar and the
 * chart's left band was empty. Any line is better than no line, but not a
 * line the market doesn't count: where the day has no bars, the tape's
 * round-lot trades stand in, and a stretch with none holds flat at the last
 * round-lot price before the window — here yesterday's close, 18,999 shares
 * at $66.98 at 4:50 PM, fifteen odd lots back. The bars, the trades and the
 * newest trades before 7:00 are the vendor's own replies.
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

  it("every pre-market trade was an odd lot, so none is drawn: at noon the line holds flat at yesterday's close from 7:00, then the 148 bars from 9:30", async () => {
    jest.setSystemTime(new Date("2026-09-30T16:00:00Z"));
    vendor();
    const { getIntradayCandles } = await import("./finnhub.actions");
    const points = await getIntradayCandles("DOCU");
    const pre = points.filter((b) => etMinutes(b.date) < 570);
    expect(pre.map((b) => [b.date.slice(11, 16), b.close, b.volume])).toEqual([["11:00", 66.98, 0]]);
    // The 5-share $65.48 print at 8:49 is not on the chart, and nothing before the open sits under the close.
    expect(points.some((b) => b.low === 65.48)).toBe(false);
    expect(Math.min(...pre.map((b) => b.low))).toBe(66.98);
    expect(points.filter((b) => etMinutes(b.date) >= 570)).toHaveLength(148);
    expect(Date.parse(points[0].date)).toBe(Date.parse("2026-09-30T11:00:00Z"));
    // Two trade reads: the bar-less stretch 7:00–9:30, then one page back from 7:00 for the anchor.
    const tradeCalls = asked.filter((u) => u.pathname.endsWith("/trades"));
    expect(tradeCalls.map((u) => [u.searchParams.get("start"), u.searchParams.get("end"), u.searchParams.get("sort")])).toEqual([
      ["2026-09-30T11:00:00.000Z", "2026-09-30T13:30:00.000Z", "asc"],
      ["2026-09-23T11:00:00.000Z", "2026-09-30T11:00:00.000Z", "desc"],
    ]);
  });

  it("at 8:00 AM, before any bar: a flat line from 7:00 to now at yesterday's close", async () => {
    jest.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    vendor();
    const { getIntradayCandles } = await import("./finnhub.actions");
    const points = await getIntradayCandles("DOCU");
    expect(points.map((b) => [b.date.slice(11, 16), b.close, b.volume])).toEqual([
      ["11:00", 66.98, 0],
      ["12:00", 66.98, 0],
    ]);
  });

  it("the anchor skips the fifteen overnight odd lots (the newest a 20-share $66.62 at 5:26 AM) for the 18,999-share close print", async () => {
    jest.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    vendor();
    const before = (docu.lastBeforeWindow as TradeTuple[]);
    expect(before.slice(0, 15).every(([, , s]) => s < 100)).toBe(true);
    expect(before[0].slice(1, 3)).toEqual([66.62, 20]);
    expect(before[15].slice(1, 3)).toEqual([66.98, 18999]);
    const { getIntradayCandles } = await import("./finnhub.actions");
    const points = await getIntradayCandles("DOCU");
    expect(points[0].close).toBe(66.98);
    expect(points[0].close).not.toBe(66.62);
  });
});
