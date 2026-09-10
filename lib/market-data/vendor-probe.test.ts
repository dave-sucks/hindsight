/**
 * vendor-probe.test.ts — the classification is the whole point: a 200 with
 * nothing in it is `empty`, never `ok`. That is the reply FMP gave for three
 * weeks while the writer logged "all sources ok".
 */

import { runVendorProbe, summarizeProbe } from "./vendor-probe";
import type { ProbeDeps } from "./vendor-probe";

jest.mock("@/lib/agent/research-helpers", () => ({ finnhub: jest.fn() }));
jest.mock("@/lib/market-data/alpaca-screener", () => ({ getAlpacaMovers: jest.fn() }));
jest.mock("@/lib/alpaca", () => ({ getBars: jest.fn() }));

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
};

const NOW = new Date("2026-09-10T10:25:00Z");

describe("runVendorProbe", () => {
  it("every source answering with a body is ok — an empty calendar week is still an answer", async () => {
    const out = await runVendorProbe("smmt", { now: NOW, deps: healthy });
    expect(out).toHaveLength(8);
    expect(out.every((r) => r.status === "ok")).toBe(true);
    expect(out.find((r) => r.source === "Finnhub earnings calendar")?.detail).toBe("0 reports in 7 days");
    expect(summarizeProbe("smmt", out)).toBe("ok=8 empty=0 error=0 (SMMT)");
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
    expect(summarizeProbe("SMMT", out)).toBe("ok=7 empty=1 error=0 (SMMT) — empty: Finnhub filed statements");
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
    expect(out.filter((r) => r.status === "ok")).toHaveLength(6);
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
    expect(out.find((r) => r.source === "Finnhub quote")).toMatchObject({ status: "error", detail: "HTTP 401" });
    expect(out.find((r) => r.source === "Finnhub key metrics")).toMatchObject({ status: "empty", detail: "null body" });
  });
});
