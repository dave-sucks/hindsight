/**
 * earnings.test.ts — the calendar-side earnings source.
 *
 * The arithmetic is the whole point of this module: EARNINGS_BEAT /
 * EARNINGS_MISS spent months inert because nothing computed a surprise
 * figure, so the surprise math and the "has it actually reported" filter
 * both get real coverage here.
 */

import {
  describeEarningsReport,
  fetchRecentEarningsReports,
  surprisePct,
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

describe("fetchRecentEarningsReports", () => {
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
    return fetchRecentEarningsReports({ now: NOW }).then(() => {
      const path = String(finnhubMock.mock.calls[0][0]);
      expect(path).toBe("/calendar/earnings?from=2026-08-30&to=2026-09-02");
    });
  });

  it("goes through the shared client, not a raw fetch", async () => {
    // The client owns the 60/min throttle and the 429 backoff. The evaluator
    // fans out over up to 200 quotes on the same tick, so an unthrottled
    // extra call is exactly the one that trips the rate limit.
    mockCalendar([]);
    await fetchRecentEarningsReports({ now: NOW });
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

    const map = await fetchRecentEarningsReports({ now: NOW });
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

    const map = await fetchRecentEarningsReports({ now: NOW });
    expect(map.has("NVDA")).toBe(false);
  });

  it("keeps a report whose estimate is missing, with a null surprise", async () => {
    // It reported; we just can't score it. EARNINGS_BEAT/MISS then return
    // false, which is honest — better than inventing a percentage.
    mockCalendar([
      { symbol: "BBN", date: "2026-09-02", epsEstimate: null, epsActual: 0.42 },
    ]);

    const map = await fetchRecentEarningsReports({ now: NOW });
    expect(map.get("BBN")?.surprisePct).toBeNull();
  });

  it("upper-cases the key and skips rows with no symbol or date", async () => {
    mockCalendar([
      { symbol: "avgo", date: "2026-09-02", epsEstimate: 3.3013, epsActual: 3.32 },
      { symbol: "", date: "2026-09-02", epsActual: 1 },
      { symbol: "XYZ", epsActual: 1 },
    ]);

    const map = await fetchRecentEarningsReports({ now: NOW });
    expect(map.size).toBe(1);
    expect(map.has("AVGO")).toBe(true);
  });

  it("keeps the later date when a ticker appears twice", async () => {
    mockCalendar([
      { symbol: "DUP", date: "2026-09-01", epsEstimate: 1, epsActual: 1.1 },
      { symbol: "DUP", date: "2026-09-02", epsEstimate: 1, epsActual: 1.5 },
    ]);

    const map = await fetchRecentEarningsReports({ now: NOW });
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

    await expect(fetchRecentEarningsReports({ now: NOW })).resolves.toEqual(
      new Map(),
    );
  });

  it("returns an empty map when the payload has no data", async () => {
    finnhubMock.mockResolvedValue({ data: null });
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(fetchRecentEarningsReports({ now: NOW })).resolves.toEqual(
      new Map(),
    );
  });

  it("returns an empty map when the payload has no calendar array", async () => {
    finnhubMock.mockResolvedValue({ data: {} });

    await expect(fetchRecentEarningsReports({ now: NOW })).resolves.toEqual(
      new Map(),
    );
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
