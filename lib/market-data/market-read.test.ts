/**
 * The market check's new reads: the calendar, Cboe's closes, Polymarket's
 * Fed odds and Finnhub's market headlines. The vendor answers below are
 * trimmed copies of what each served on 2026-11-06.
 */
import { calendarGaps, dayLabel, etToday, moverReports, nextFedDecision, scheduledMarketDates } from "./market-calendar";
import { lastCloses, loadGauges } from "./market-gauges";
import { oddsLine, pickNextFedOdds } from "./fed-odds";
import { etTime, newestHeadlines } from "./market-news";

describe("the market's calendar", () => {
  it("lists the dates in the next three weeks in order, and the next Fed decision past them", () => {
    expect(scheduledMarketDates("2026-11-02", 21).map((d) => `${dayLabel(d.date)} ${d.what}`)).toEqual([
      "Tue Nov 3 US midterm elections",
      "Fri Nov 6 jobs report",
      "Tue Nov 10 inflation report (CPI)",
    ]);
    expect(nextFedDecision("2026-11-02")).toBe("2026-12-09");
    expect(scheduledMarketDates("2026-11-25", 21).map((d) => d.what)).toEqual([
      "jobs report",
      "Fed decision, with its projections",
      "inflation report (CPI)",
    ]);
  });

  it("says when a list on file runs out inside the window, instead of going quiet", () => {
    expect(calendarGaps("2026-11-06", 21)).toEqual([]);
    const gaps = calendarGaps("2027-12-01", 21);
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toContain("The Fed decision dates on file end 2027-12-08");
    expect(nextFedDecision("2027-12-09")).toBeNull();
  });

  it("picks the market movers' reports out of an earnings calendar", () => {
    const rows = [
      { symbol: "NVDA", date: "2026-11-17", hour: "amc" },
      { symbol: "HD", date: "2026-11-17", hour: "bmo" },
      { symbol: "AAPL", date: "2026-12-30", hour: "amc" },
      { symbol: "MSFT", date: "2026-11-10", hour: "" },
    ];
    expect(moverReports(rows, "2026-11-12", 7)).toEqual([{ date: "2026-11-17", kind: "EARNINGS", what: "NVDA earnings, after the close" }]);
    expect(moverReports(rows, "2026-11-09", 5)).toEqual([{ date: "2026-11-10", kind: "EARNINGS", what: "MSFT earnings" }]);
  });

  it("dates the day in New York, not UTC", () => {
    // 9:30 PM ET on Thursday is already Friday in UTC.
    expect(etToday(new Date("2026-11-06T02:30:00Z"))).toBe("2026-11-05");
  });
});

describe("Cboe's closes", () => {
  const VIX = "DATE,OPEN,HIGH,LOW,CLOSE\n11/03/2026,21.660000,21.910000,20.290000,20.830000\n11/04/2026,19.200000,19.220000,16.570000,16.610000\n11/05/2026,17.140000,28.360000,16.700000,28.180000\n";
  const TNX = "DATE,TNX\n11/04/2026,48.940000\n11/05/2026,48.370000\n";

  it("reads the last two closes and the day of the last", () => {
    expect(lastCloses(VIX)).toEqual({ close: 28.18, prevClose: 16.61, asOf: "2026-11-05" });
    expect(lastCloses("DATE,TNX\n")).toBeNull();
  });

  it("turns TNX into the yield: the index is ten times it", async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url: string | URL | Request) => new Response(String(url).includes("TNX") ? TNX : VIX)) as typeof fetch;
    try {
      const g = await loadGauges();
      expect(g.tenYear).toEqual({ close: 4.837, prevClose: 4.894, asOf: "2026-11-05" });
      expect(g.vix?.close).toBe(28.18);
      expect(g.errors).toEqual([]);
    } finally {
      global.fetch = realFetch;
    }
  });

  it("names the file that failed", async () => {
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (url: string | URL | Request) =>
      String(url).includes("TNX") ? new Response("", { status: 503 }) : new Response(VIX),
    ) as typeof fetch;
    try {
      const g = await loadGauges();
      expect(g.tenYear).toBeNull();
      expect(g.errors).toEqual(["10-year yield: Cboe's TNX file answered 503"]);
    } finally {
      global.fetch = realFetch;
    }
  });
});

describe("Polymarket's odds on the next Fed decision", () => {
  const market = (groupItemTitle: string, yes: string) => ({ groupItemTitle, outcomePrices: `["${yes}", "${(1 - Number(yes)).toFixed(4)}"]`, closed: false });
  const answer = {
    events: [
      {
        title: "Fed Decision in January?", endDate: "2027-01-28T04:59:00Z", closed: false, slug: "fed-decision-in-january-20260729233815502",
        markets: [market("No change", "0.735"), market("25 bps increase", "0.185")],
      },
      {
        title: "Fed Decision in December?", endDate: "2026-12-10T04:59:00Z", closed: false, slug: "fed-decision-in-december-20260729232808632",
        markets: [
          market("50+ bps decrease", "0.004"), market("25 bps decrease", "0.0065"), market("No change", "0.205"),
          market("25 bps increase", "0.785"), market("50+ bps increase", "0.0055"),
        ],
      },
      {
        title: "Fed decision in January?", endDate: "2026-01-28T00:00:00Z", closed: true, slug: "fed-decision-in-january",
        markets: [market("No change", "1")],
      },
    ],
  };

  it("takes the open event that settles first, likeliest outcome first, long shots left out", () => {
    const odds = pickNextFedOdds(answer, new Date("2026-11-06T12:00:00Z"));
    expect(odds).toMatchObject({ title: "Fed Decision in December?", url: "https://polymarket.com/event/fed-decision-in-december-20260729232808632" });
    expect(odds && oddsLine(odds)).toBe("25 bps increase 79%, No change 21%");
  });

  it("returns nothing when no open event is left", () => {
    expect(pickNextFedOdds(answer, new Date("2027-02-01T00:00:00Z"))).toBeNull();
    expect(pickNextFedOdds(null, new Date())).toBeNull();
  });
});

describe("the market's headlines", () => {
  const now = new Date("2026-11-06T17:00:00Z");
  const news = [
    { datetime: 1793973731, source: "CNBC", headline: "Wall Street's fear gauge may be flashing a buy sign", url: "u3" },
    { datetime: 1793980548, source: "CNBC", headline: "Data center double-down: Hassett says Blue Wave won't stop AI build-out", url: "u1" },
    { datetime: 1793979761, source: "CNBC", headline: "Anthropic IPO announcement odds drop on Kalshi following midterms and AI sell-off", url: "u2" },
    { datetime: 1793979761, source: "CNBC", headline: "Data center double-down: Hassett says Blue Wave won't stop AI build-out", url: "dup" },
    { datetime: 1793700000, source: "Reuters", headline: "Three days old", url: "old" },
  ];

  it("keeps the last 36 hours, newest first, each headline once", () => {
    expect(newestHeadlines(news, now).map((h) => h.url)).toEqual(["u1", "u2", "u3"]);
    expect(newestHeadlines(news, now, 1)).toEqual([
      { at: "2026-11-06T15:55:48.000Z", source: "CNBC", headline: "Data center double-down: Hassett says Blue Wave won't stop AI build-out", url: "u1" },
    ]);
    expect(newestHeadlines({ error: "limit" }, now)).toEqual([]);
  });

  it("shows the day with the time, so last night's list never reads as this morning's", () => {
    expect(etTime("2026-11-06T02:41:00.000Z")).toBe("Thu Nov 5, 9:41 PM ET");
  });
});
