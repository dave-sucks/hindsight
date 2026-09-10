/**
 * Vendor probe — does every market-data source we depend on still answer?
 *
 * Why (DAV-239): FMP's tier refused 26 of the 28 names on the book for about
 * three weeks while every writer run logged "all sources ok", because an
 * empty body was treated as a good answer. Then on 2026-09-09 a Finnhub
 * quote failed silently inside record_thesis and a buy trigger landed on the
 * wrong side. Both were vendors going quiet with nothing saying so.
 *
 * This hits each endpoint we rely on, once, with a mid-cap book name (never
 * a mega-cap — the free lists cover those, which is how the August audit was
 * fooled) and classifies the reply: `ok` (a real body), `empty` (200 with
 * nothing in it), or `error` (non-200, thrown, timed out). The cron in
 * lib/inngest/functions/vendor-probe.ts runs it every weekday before the
 * pipeline wakes and emails when anything is not `ok`.
 *
 * Pure apart from the injected clients, so the classification is testable
 * without the network.
 */

import { finnhub } from "@/lib/agent/research-helpers";
import { getAlpacaMovers } from "@/lib/market-data/alpaca-screener";
import { getBars, type AlpacaCredentials } from "@/lib/alpaca";

export type ProbeStatus = "ok" | "empty" | "error";

export interface ProbeResult {
  /** Human name of the source, e.g. "Finnhub quote". */
  source: string;
  status: ProbeStatus;
  /** One line: what came back, or what went wrong. */
  detail: string;
  ms: number;
}

export interface ProbeDeps {
  finnhub: (path: string, retries?: number) => Promise<{ data: unknown; error?: string }>;
  getAlpacaMovers: typeof getAlpacaMovers;
  getBars: typeof getBars;
}

const DEFAULT_DEPS: ProbeDeps = { finnhub, getAlpacaMovers, getBars };

/** The mid-cap used when the book has nothing held. */
export const DEFAULT_PROBE_TICKER = "SMMT";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function timed(
  source: string,
  fn: () => Promise<{ status: ProbeStatus; detail: string }>,
): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { source, ...r, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { source, status: "error", detail: msg.slice(0, 200), ms: Date.now() - t0 };
  }
}

/** A Finnhub reply → ok / empty / error, given a "has a body" test. */
function classify(
  res: { data: unknown; error?: string },
  hasBody: (data: unknown) => { ok: boolean; detail: string },
): { status: ProbeStatus; detail: string } {
  if (res.error) return { status: "error", detail: res.error };
  if (res.data == null) return { status: "empty", detail: "null body" };
  const { ok, detail } = hasBody(res.data);
  return { status: ok ? "ok" : "empty", detail };
}

const arrayLen = (d: unknown, key?: string) => {
  const arr = key ? (d as Record<string, unknown>)?.[key] : d;
  return Array.isArray(arr) ? arr.length : null;
};

/**
 * Probe every source for one ticker. Never throws; every failure is a row.
 * Runs the Finnhub calls in sequence (the shared client throttles at 60/min)
 * and the Alpaca calls alongside.
 */
export async function runVendorProbe(
  ticker: string,
  opts: { now?: Date; creds?: AlpacaCredentials; deps?: Partial<ProbeDeps> } = {},
): Promise<ProbeResult[]> {
  const T = ticker.toUpperCase();
  const now = opts.now ?? new Date();
  const d: ProbeDeps = { ...DEFAULT_DEPS, ...opts.deps };
  const today = isoDay(now);
  const weekOut = isoDay(new Date(now.getTime() + 7 * 86_400_000));
  const tenBack = isoDay(new Date(now.getTime() - 10 * 86_400_000));

  const finnhubProbes = async (): Promise<ProbeResult[]> => {
    const out: ProbeResult[] = [];
    out.push(
      await timed("Finnhub quote", async () =>
        classify(await d.finnhub(`/quote?symbol=${T}`, 1), (data) => {
          const c = (data as { c?: number }).c;
          return { ok: typeof c === "number" && c > 0, detail: c ? `$${c}` : "no price" };
        }),
      ),
    );
    out.push(
      await timed("Finnhub key metrics", async () =>
        classify(await d.finnhub(`/stock/metric?symbol=${T}&metric=all`, 1), (data) => {
          const n = Object.keys((data as { metric?: Record<string, unknown> }).metric ?? {}).length;
          return { ok: n > 0, detail: `${n} metrics` };
        }),
      ),
    );
    out.push(
      await timed("Finnhub EPS history", async () =>
        classify(await d.finnhub(`/stock/earnings?symbol=${T}&limit=2`, 1), (data) => {
          const n = arrayLen(data) ?? 0;
          return { ok: n > 0, detail: `${n} quarters` };
        }),
      ),
    );
    out.push(
      await timed("Finnhub ratings", async () =>
        classify(await d.finnhub(`/stock/recommendation?symbol=${T}`, 1), (data) => {
          const n = arrayLen(data) ?? 0;
          return { ok: n > 0, detail: `${n} months` };
        }),
      ),
    );
    out.push(
      await timed("Finnhub filed statements", async () =>
        classify(await d.finnhub(`/stock/financials-reported?symbol=${T}&freq=quarterly`, 1), (data) => {
          const n = arrayLen(data, "data") ?? 0;
          return { ok: n > 0, detail: `${n} filings` };
        }),
      ),
    );
    // A quiet calendar week is a real state: the key being an array is the
    // "answered" test, not the count.
    out.push(
      await timed("Finnhub earnings calendar", async () =>
        classify(await d.finnhub(`/calendar/earnings?from=${today}&to=${weekOut}`, 1), (data) => {
          const n = arrayLen(data, "earningsCalendar");
          return { ok: n != null, detail: n == null ? "no calendar key" : `${n} reports in 7 days` };
        }),
      ),
    );
    return out;
  };

  const alpacaProbes = async (): Promise<ProbeResult[]> => {
    const bars = await timed("Alpaca daily bars", async () => {
      const rows = await d.getBars(
        T,
        { start: tenBack, end: today, timeframe: "1Day", limit: 5, feed: "iex" },
        opts.creds,
      );
      return rows.length > 0
        ? { status: "ok" as const, detail: `${rows.length} bars, last close $${rows[rows.length - 1].close}` }
        : { status: "empty" as const, detail: "no bars in 10 days" };
    });
    const screener = await timed("Alpaca screener", async () => {
      const res = await d.getAlpacaMovers("active", { top: 5, creds: opts.creds });
      if (res.error) return { status: "error" as const, detail: res.error };
      const n = res.data?.length ?? 0;
      return n > 0
        ? { status: "ok" as const, detail: `${n} most-active names` }
        : { status: "empty" as const, detail: "empty movers list" };
    });
    return [bars, screener];
  };

  const [fh, al] = await Promise.all([finnhubProbes(), alpacaProbes()]);
  return [...fh, ...al];
}

/** One line for the log: `ok=6 empty=1 error=1 (SMMT) — empty: Finnhub filed statements; error: Alpaca screener`. */
export function summarizeProbe(ticker: string, results: ProbeResult[]): string {
  const by = (s: ProbeStatus) => results.filter((r) => r.status === s);
  const bad = [
    by("empty").length ? `empty: ${by("empty").map((r) => r.source).join(", ")}` : null,
    by("error").length ? `error: ${by("error").map((r) => r.source).join(", ")}` : null,
  ].filter(Boolean);
  return (
    `ok=${by("ok").length} empty=${by("empty").length} error=${by("error").length} (${ticker.toUpperCase()})` +
    (bad.length ? ` — ${bad.join("; ")}` : "")
  );
}
