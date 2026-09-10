/**
 * earnings.test.ts — the calendar-side earnings source.
 *
 * The arithmetic is the whole point of this module: EARNINGS_BEAT /
 * EARNINGS_MISS spent months inert because nothing computed a surprise
 * figure, so the surprise math and the "has it actually reported" filter
 * both get real coverage here.
 */

import {
  daysUntilReport,
  describeEarningsReport,
  describeUpcomingReport,
  fetchEarningsWindow,
  surprisePct,
  EARNINGS_LOOKAHEAD_DAYS,
  EARNINGS_LOOKBACK_DAYS,
} from "./earnings";
import type { EarningsReport } from "./earnings";
import { finnhub } from "@/lib/agent/research-helpers";

// The module goes through the shared Finnhub client (throttle, 429 backoff,
// retry, call counter) rather than a raw fetch, so that is what we stub.
jest.mock("@/lib/agent/research-helpers", () => ({
  finnhub: jest.fn(),
}));

const finnhubMock = finnhub as jest.MockedFunction<typeof finnhub>;

describe("surprisePct", () => {
  it("matches Finnhub's own figure on a real beat (NVDA 2026-08-26)", () => {
    // Finnhub /stock/earnings reports surprisePercent 3.8159 for this row.
    expect(surprisePct(2.22, 2.1384)).toBeCloseTo(3.8159, 3);
  });

  it("is negative on a miss", () => {
    expect(surprisePct(1.8, 2.0)).toBeCloseTo(-10, 6);
  });

  it("treats beating a loss estimate as a beat", () => {
    // Expected −$0.2568, actual −$0.20 — lost less than feared. The sign
    // only comes out right because the denominator is |estimate|.
    expect(surprisePct(-0.2, -0.2568)).toBeGreaterThan(0);
    expect(surprisePct(-0.2, -0.2568)).toBeCloseTo(22.118, 2);
  });

  it("treats losing more than a loss estimate as a miss", () => {
    expect(surprisePct(-0.35, -0.25)).toBeCloseTo(-40, 6);
  });

  it("returns null on a zero estimate rather than Infinity", () => {
    // A predicate with no minSurprisePct would otherwise fire on a
    // percentage that means nothing.
    expect(surprisePct(0.1, 0)).toBeNull();
  });

  it("returns null when the estimate is missing", () => {
    expect(surprisePct(1.5, null)).toBeNull();
    expect(surprisePct(1.5, undefined)).toBeNull();
  });

  it("returns null on non-finite input", () => {
    expect(surprisePct(Number.NaN, 2)).toBeNull();
    expect(surprisePct(2, Number.NaN)).toBeNull();
  });
});

describe("fetchEarningsWindow", () => {
  const NOW = new Date("2026-09-02T14:30:00Z");

  function mockCalendar(rows: unknown[]) {
    finnhubMock.mockResolvedValue({ data: { earningsCalendar: rows } });
  }

  beforeEach(() => {
    finnhubMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("asks the shared client for the lookback window ending today", () => {
    mockCalendar([]);
    return fetchEarningsWindow({ now: NOW }).then(() => {
      const path = String(finnhubMock.mock.calls[0][0]);
      expect(path).toBe("/calendar/earnings?from=2026-08-30&to=2026-09-02");
    });
  });

  it("extends the window forward only when asked", async () => {
    // The scheduled half triples the payload; the cron only asks for it
    // when some thesis carries an EARNINGS_WITHIN.
    mockCalendar([]);
    await fetchEarningsWindow({ now: NOW, lookaheadDays: 14 });
    const path = String(finnhubMock.mock.calls[0][0]);
    expect(path).toBe("/calendar/earnings?from=2026-08-30&to=2026-09-16");
  });

  it("puts a scheduled row in `upcoming`, keeping the earliest per ticker", async () => {
    mockCalendar([
      { symbol: "MU", date: "2026-09-30", hour: "amc", epsEstimate: 32.21, epsActual: null },
      { symbol: "MU", date: "2026-12-17", hour: "amc", epsEstimate: 35, epsActual: null },
      { symbol: "ABT", date: "2026-10-13", hour: "bmo", epsEstimate: 1.43, epsActual: null },
    ]);
    const w = await fetchEarningsWindow({ now: NOW, lookaheadDays: 14 });
    expect(w.reported.size).toBe(0);
    expect(w.upcoming.get("MU")?.reportDate).toBe("2026-09-30");
    expect(w.upcoming.get("MU")?.epsActual).toBeNull();
    expect(w.upcoming.get("ABT")?.hour).toBe("bmo");
  });

  it("drops a past-dated row with no actual — not posted yet, not scheduled", async () => {
    mockCalendar([
      { symbol: "LATE", date: "2026-08-31", epsEstimate: 1, epsActual: null },
    ]);
    const w = await fetchEarningsWindow({ now: NOW, lookaheadDays: 14 });
    expect(w.reported.has("LATE")).toBe(false);
    expect(w.upcoming.has("LATE")).toBe(false);
  });

  it("a row dated today with no actual is upcoming (after-close print tonight)", async () => {
    mockCalendar([
      { symbol: "AVGO", date: "2026-09-02", hour: "amc", epsEstimate: 3.3, epsActual: null },
    ]);
    const w = await fetchEarningsWindow({ now: NOW, lookaheadDays: 14 });
    expect(w.upcoming.get("AVGO")?.reportDate).toBe("2026-09-02");
  });

  it("goes through the shared client, not a raw fetch", async () => {
    // The client owns the 60/min throttle and the 429 backoff. The evaluator
    // fans out over up to 200 quotes on the same tick, so an unthrottled
    // extra call is exactly the one that trips the rate limit.
    mockCalendar([]);
    await fetchEarningsWindow({ now: NOW });
    expect(finnhubMock).toHaveBeenCalledTimes(1);
  });

  it("keeps reported rows and computes their surprise", async () => {
    mockCalendar([
      {
        symbol: "NVDA",
        date: "2026-08-26",
        hour: "amc",
        quarter: 2,
        year: 2027,
        epsEstimate: 2.1384,
        epsActual: 2.22,
        revenueEstimate: 94008645045,
        revenueActual: 96221000000,
      },
    ]);

    const map = (await fetchEarningsWindow({ now: NOW })).reported;
    const nvda = map.get("NVDA");
    expect(nvda).toBeDefined();
    expect(nvda!.reportDate).toBe("2026-08-26");
    expect(nvda!.surprisePct).toBeCloseTo(3.8159, 3);
    expect(nvda!.revenueActual).toBe(96221000000);
  });

  it("drops scheduled-but-unreported rows", async () => {
    // The calendar carries the estimate for a future quarter with a null
    // actual. Treating that as a report would fire every trigger on the
    // book the moment a date was published.
    mockCalendar([
      {
        symbol: "NVDA",
        date: "2026-11-17",
        hour: "amc",
        epsEstimate: 2.4659,
        epsActual: null,
        revenueEstimate: 108129157692,
        revenueActual: null,
      },
    ]);

    const w = await fetchEarningsWindow({ now: NOW });
    expect(w.reported.has("NVDA")).toBe(false);
    // It's a scheduled report, so it's the NEXT one — that's the other map.
    expect(w.upcoming.get("NVDA")?.reportDate).toBe("2026-11-17");
  });

  it("keeps a report whose estimate is missing, with a null surprise", async () => {
    // It reported; we just can't score it. EARNINGS_BEAT/MISS then return
    // false, which is honest — better than inventing a percentage.
    mockCalendar([
      { symbol: "BBN", date: "2026-09-02", epsEstimate: null, epsActual: 0.42 },
    ]);

    const map = (await fetchEarningsWindow({ now: NOW })).reported;
    expect(map.get("BBN")?.surprisePct).toBeNull();
  });

  it("upper-cases the key and skips rows with no symbol or date", async () => {
    mockCalendar([
      { symbol: "avgo", date: "2026-09-02", epsEstimate: 3.3013, epsActual: 3.32 },
      { symbol: "", date: "2026-09-02", epsActual: 1 },
      { symbol: "XYZ", epsActual: 1 },
    ]);

    const map = (await fetchEarningsWindow({ now: NOW })).reported;
    expect(map.size).toBe(1);
    expect(map.has("AVGO")).toBe(true);
  });

  it("keeps the later date when a ticker appears twice", async () => {
    mockCalendar([
      { symbol: "DUP", date: "2026-09-01", epsEstimate: 1, epsActual: 1.1 },
      { symbol: "DUP", date: "2026-09-02", epsEstimate: 1, epsActual: 1.5 },
    ]);

    const map = (await fetchEarningsWindow({ now: NOW })).reported;
    expect(map.get("DUP")?.reportDate).toBe("2026-09-02");
  });

  it("returns an empty map when the client reports an error", async () => {
    // finnhub() resolves rather than throws; a vendor failure must delay a
    // look, never block the price triggers evaluating on the same tick.
    finnhubMock.mockResolvedValue({
      data: null,
      error: "Finnhub /calendar/earnings rate limited (429) after 1 retries",
    });
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetchEarningsWindow({ now: NOW })).resolves.toEqual({
      reported: new Map(),
      upcoming: new Map(),
    });
  });

  it("returns an empty map when the payload has no data", async () => {
    finnhubMock.mockResolvedValue({ data: null });
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetchEarningsWindow({ now: NOW })).resolves.toEqual({
      reported: new Map(),
      upcoming: new Map(),
    });
  });

  it("returns an empty map when the payload has no calendar array", async () => {
    finnhubMock.mockResolvedValue({ data: {} });

    await expect(fetchEarningsWindow({ now: NOW })).resolves.toEqual({
      reported: new Map(),
      upcoming: new Map(),
    });
  });

  it("stays inside the 7-day earnings cooldown so one report fires once", () => {
    // The window is the de-duplication mechanism (see the constant's
    // docstring). If someone raises it past the cooldown, the same quarter
    // fires twice.
    expect(EARNINGS_LOOKBACK_DAYS).toBeLessThan(7);
  });
});

describe("describeEarningsReport", () => {
  const base: EarningsReport = {
    symbol: "NVDA",
    reportDate: "2026-08-26",
    hour: "amc",
    epsActual: 2.22,
    epsEstimate: 2.1384,
    surprisePct: 3.8159,
    revenueActual: 96221000000,
    revenueEstimate: 94008645045,
    quarter: 2,
    year: 2027,
  };

  it("states the figures a reviewer needs", () => {
    expect(describeEarningsReport(base)).toBe(
      "Reported 2026-08-26 (after close): EPS $2.22 vs $2.14 est — beat by 3.8%. " +
        "Revenue $96.22B vs $94.01B est.",
    );
  });

  it("says 'missed' on a negative surprise", () => {
    expect(
      describeEarningsReport({ ...base, epsActual: 1.9, surprisePct: -11.1 }),
    ).toContain("missed by 11.1%");
  });

  it("labels a before-open report", () => {
    expect(describeEarningsReport({ ...base, hour: "bmo" })).toContain(
      "(before open)",
    );
  });

  it("omits what it doesn't have", () => {
    const sparse: EarningsReport = {
      ...base,
      hour: null,
      epsEstimate: null,
      surprisePct: null,
      revenueActual: null,
      revenueEstimate: null,
    };
    expect(describeEarningsReport(sparse)).toBe("Reported 2026-08-26: EPS $2.22.");
  });

  it("scales millions", () => {
    expect(
      describeEarningsReport({ ...base, revenueActual: 383980000, revenueEstimate: 303620342 }),
    ).toContain("Revenue $383.98M vs $303.62M est.");
  });
});

describe("upcoming reports", () => {
  const NOW = new Date("2026-09-27T14:30:00Z");
  const mu: EarningsReport = {
    symbol: "MU",
    reportDate: "2026-09-30",
    hour: "amc",
    epsActual: null,
    epsEstimate: 32.2138,
    surprisePct: null,
    revenueActual: null,
    revenueEstimate: 12_010_000_000,
    quarter: 4,
    year: 2026,
  };

  it("counts calendar days to the report", () => {
    expect(daysUntilReport(mu, NOW)).toBe(3);
    expect(daysUntilReport(mu, new Date("2026-09-30T20:00:00Z"))).toBe(0);
    expect(daysUntilReport(mu, new Date("2026-10-01T00:00:00Z"))).toBe(-1);
  });

  it("describes the heads-up with date, bell, and estimates", () => {
    expect(describeUpcomingReport(mu, NOW)).toBe(
      "Reports 2026-09-30 (after close), in 3 days. EPS est $32.21. Revenue est $12.01B.",
    );
    expect(describeUpcomingReport(mu, new Date("2026-09-29T12:00:00Z"))).toContain("tomorrow");
    expect(describeUpcomingReport(mu, new Date("2026-09-30T12:00:00Z"))).toContain("today");
  });

  it("describeEarningsReport hands an unreported row to the upcoming form", () => {
    expect(describeEarningsReport(mu)).toMatch(/^Reports 2026-09-30/);
  });

  it("the schema's 14-day cap matches the fetch lookahead", () => {
    // An EARNINGS_WITHIN longer than the lookahead would ask about reports
    // the cron never fetches — it would silently never fire.
    expect(EARNINGS_LOOKAHEAD_DAYS).toBe(14);
  });
});
