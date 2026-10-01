/**
 * vendor-probe.test.ts — the classification is the whole point: a 200 with
 * nothing in it is `empty`, never `ok`. That is the reply FMP gave for three
 * weeks while the writer logged "all sources ok".
 */

import { runVendorProbe, summarizeProbe } from "./vendor-probe";
import type { ProbeDeps } from "./vendor-probe";

jest.mock("@/lib/agent/research-helpers", () => ({ finnhub: jest.fn() }));
jest.mock("@/lib/market-data/alpaca-screener", () => ({ getAlpacaMovers: jest.fn() }));
jest.mock("@/lib/alpaca", () => ({ getBars: jest.fn(), getSnapshots: jest.fn() }));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getIntradayCandles: jest.fn() }));

// SMMT as Alpaca's tape had it at the 2026-09-29 probe; at 06:25 the daily
// bar is still the prior session's.
const smmtBefore0930 = {
  latestTrade: { p: 15.9, t: "2026-09-10T10:24:30Z" },
  dailyBar: { t: "2026-09-09T04:00:00Z", o: 15.5, h: 15.82, l: 15.18, c: 15.48, v: 6_124_956 },
  prevDailyBar: { t: "2026-09-08T04:00:00Z", o: 16.45, h: 16.58, l: 15.55, c: 15.61, v: 3_782_038 },
};

const healthy: ProbeDeps = {
  finnhub: jest.fn(async (path: string) => {
    if (path.startsWith("/quote")) return { data: { c: 17.2 } };
    if (path.startsWith("/stock/metric")) return { data: { metric: { peTTM: 30 } } };
    if (path.startsWith("/stock/earnings")) return { data: [{ actual: 1 }] };
    if (path.startsWith("/stock/recommendation")) return { data: [{ buy: 5 }] };
    if (path.startsWith("/stock/financials-reported")) return { data: { data: [{ year: 2026 }] } };
    if (path.startsWith("/calendar/earnings")) return { data: { earningsCalendar: [] } };
    return { data: null, error: `unexpected path ${path}` };
  }),
  getAlpacaMovers: jest.fn(async () => ({ data: [{ symbol: "NVDA", price: 100, percentChange: 1 }] })) as never,
  getBars: jest.fn(async () => [{ close: 17.1, volume: 1 }]) as never,
  getSnapshots: jest.fn(async () => ({ SMMT: smmtBefore0930 })) as never,
  getIntradayCandles: jest.fn(async () => [{ date: "2026-09-09T19:59:00Z", open: 15.5, high: 15.5, low: 15.48, close: 15.48, volume: 12_000 }]) as never,
};

const NOW = new Date("2026-09-10T10:25:00Z");

describe("runVendorProbe", () => {
  it("every source answering with a body is ok — an empty calendar week is still an answer", async () => {
    const out = await runVendorProbe("smmt", { now: NOW, deps: healthy });
    expect(out).toHaveLength(10);
    expect(out.every((r) => r.status === "ok")).toBe(true);
    expect(out.find((r) => r.source === "Finnhub earnings calendar")?.detail).toBe("0 reports in 7 days");
    expect(out.find((r) => r.source === "Alpaca intraday bars")).toMatchObject({ status: "ok", detail: "1 one-minute bars, last 19:59Z" });
    expect(summarizeProbe("smmt", out)).toBe("ok=10 empty=0 error=0 (SMMT)");
  });

  it("the live price is probed on Alpaca with the mid-cap: before the open it is the last close, with its prior close", async () => {
    const out = await runVendorProbe("SMMT", { now: NOW, deps: healthy });
    expect(healthy.getSnapshots).toHaveBeenCalledWith(["SMMT"], { creds: undefined });
    expect(out.find((r) => r.source === "Alpaca live quote")).toMatchObject({
      status: "ok",
      detail: "$15.48, prior close $15.61, printed 2026-09-09T20:00:00.000Z",
    });
    // The bars probe no longer names IEX — it reads the feed the app reads.
    expect((healthy.getBars as jest.Mock).mock.calls[0][1]).not.toHaveProperty("feed");
  });

  it("Alpaca answering with no snapshot for the name is empty; refusing is error", async () => {
    const none = await runVendorProbe("SMMT", { now: NOW, deps: { ...healthy, getSnapshots: jest.fn(async () => ({})) as never } });
    expect(none.find((r) => r.source === "Alpaca live quote")).toMatchObject({ status: "empty", detail: "no price on the tape" });
    const refused = await runVendorProbe("SMMT", {
      now: NOW,
      deps: {
        ...healthy,
        getSnapshots: jest.fn(async () => {
          throw new Error("Alpaca getSnapshots(1 symbols) 403: subscription does not permit querying recent SIP data");
        }) as never,
      },
    });
    expect(refused.find((r) => r.source === "Alpaca live quote")).toMatchObject({ status: "error" });
    expect(summarizeProbe("SMMT", refused)).toContain("error: Alpaca live quote");
  });

  it("a 200 with nothing in it is empty, not ok (the FMP shape)", async () => {
    const deps: ProbeDeps = {
      ...healthy,
      finnhub: jest.fn(async (path: string) =>
        path.startsWith("/stock/financials-reported")
          ? { data: { data: [] } }
          : (healthy.finnhub as (p: string) => Promise<{ data: unknown; error?: string }>)(path),
      ),
    };
    const out = await runVendorProbe("SMMT", { now: NOW, deps });
    expect(out.find((r) => r.source === "Finnhub filed statements")).toMatchObject({ status: "empty", detail: "0 filings" });
    expect(summarizeProbe("SMMT", out)).toBe("ok=9 empty=1 error=0 (SMMT) — empty: Finnhub filed statements");
  });

  it("a thrown or refused call is error, and the other probes still run", async () => {
    const deps: ProbeDeps = {
      ...healthy,
      getBars: jest.fn(async () => {
        throw new Error("403 Forbidden");
      }) as never,
      getAlpacaMovers: jest.fn(async () => ({ data: null, error: "HTTP 429" })) as never,
    };
    const out = await runVendorProbe("SMMT", { now: NOW, deps });
    expect(out.find((r) => r.source === "Alpaca daily bars")).toMatchObject({ status: "error", detail: "403 Forbidden" });
    expect(out.find((r) => r.source === "Alpaca screener")).toMatchObject({ status: "error", detail: "HTTP 429" });
    expect(out.filter((r) => r.status === "ok")).toHaveLength(8);
    expect(summarizeProbe("SMMT", out)).toContain("error: Alpaca daily bars, Alpaca screener");
  });

  it("a Finnhub client error is error; a null body is empty", async () => {
    const deps: ProbeDeps = {
      ...healthy,
      finnhub: jest.fn(async (path: string) =>
        path.startsWith("/quote")
          ? { data: null, error: "HTTP 401" }
          : path.startsWith("/stock/metric")
            ? { data: null }
            : (healthy.finnhub as (p: string) => Promise<{ data: unknown; error?: string }>)(path),
      ),
    };
    const out = await runVendorProbe("SMMT", { now: NOW, deps });
    expect(out.find((r) => r.source === "Finnhub quote (fallback)")).toMatchObject({ status: "error", detail: "HTTP 401" });
    expect(out.find((r) => r.source === "Finnhub key metrics")).toMatchObject({ status: "empty", detail: "null body" });
  });
});
