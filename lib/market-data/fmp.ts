/**
 * The single FMP client.
 *
 * Before this file there were six copy-pasted `fmp()` helpers (get-stock-data,
 * get-market-context, get-analyst-coverage, get-earnings-history,
 * get-financials-deep, lib/actions/analyst-coverage) that all failed the same
 * silent way: a 402 "not on your plan" or an empty `[]` came back as
 * `{ data: null }`, the caller shrugged, and the tool reported success with
 * less data. That is how half the market-data surface went dark for days
 * without a single log line (DAV-191).
 *
 * Two rules here:
 *   1. Every non-OK status and every vendor error body is logged, with the
 *      status interpreted (402/403 = plan, 404 = retired/unserved).
 *   2. An UNEXPECTED empty response is logged too. `[]` is a legitimate answer
 *      for "no filings this week" but not for "the consensus price target of
 *      AAPL" — callers say which they are via `expectNonEmpty`, and the
 *      unexpected case returns an `error` so it surfaces in the tool's
 *      `apiErrors[]` instead of vanishing.
 *
 * Vendor health is NOT stable — FMP's plan tiering moved twice in a week
 * (see DAV-191). Don't hardcode assumptions about what's alive; let the
 * logs tell you.
 */

const FMP_KEY = process.env.FMP_API_KEY;

export interface FmpResult<T> {
  data: T | null;
  error?: string;
}

export interface FmpOptions {
  /**
   * Treat an empty array / empty object as a failure worth logging and
   * reporting. Set on endpoints where "no rows" means the vendor isn't
   * serving us, not that the answer is genuinely empty.
   */
  expectNonEmpty?: boolean;
  /** Request timeout. Defaults to 10s. */
  timeoutMs?: number;
  /**
   * Live-price paths must never touch the Next.js Data Cache — it is
   * stale-while-revalidate and persists across deploys, so a once-a-morning
   * surface gets served the prior session's close. See the recurring-bug
   * entry in CLAUDE.md.
   */
  liveQuote?: boolean;
}

/** How to read a status code, so the log line says what it means. */
function explainStatus(status: number): string {
  if (status === 401) return "invalid/missing API key";
  if (status === 402) return "not on the current plan";
  if (status === 403) return "forbidden — retired legacy endpoint or plan gate";
  if (status === 404) return "endpoint not served (retired or unknown path)";
  if (status === 429) return "rate limited";
  return `HTTP ${status}`;
}

function isEmptyPayload(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") return Object.keys(data as object).length === 0;
  return false;
}

/**
 * Fetch an FMP endpoint. `path` is namespace-qualified — pass `/stable/...`
 * for everything current. The legacy `/api/v3` + `/api/v4` namespaces were
 * retired by FMP on 2025-08-31 and return 403 for every caller; this client
 * deliberately does not route to them.
 */
export async function fmp<T>(
  path: string,
  opts: FmpOptions = {},
): Promise<FmpResult<T>> {
  const { expectNonEmpty = false, timeoutMs = 10_000, liveQuote = false } = opts;
  const endpoint = path.split("?")[0];

  if (!FMP_KEY) {
    const msg = "FMP_API_KEY is not set";
    console.warn(`[fmp] ${msg} — ${endpoint} skipped`);
    return { data: null, error: msg };
  }

  if (!path.startsWith("/stable/")) {
    // Guard rather than silently rewrite: /api/v3 + /v4 are dead everywhere,
    // and a caller reaching for one is a bug worth seeing.
    const msg = `FMP ${endpoint}: legacy namespace — /api/v3 and /api/v4 were retired 2025-08-31`;
    console.warn(`[fmp] ${msg}`);
    return { data: null, error: msg };
  }

  const url = `https://financialmodelingprep.com${path}${path.includes("?") ? "&" : "?"}apikey=${FMP_KEY}`;
  const t0 = Date.now();

  try {
    const res = await fetch(url, {
      ...(liveQuote
        ? { cache: "no-store" as const }
        : { next: { revalidate: 300 } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const elapsed = Date.now() - t0;

    if (!res.ok) {
      const msg = `FMP ${endpoint} returned ${res.status} — ${explainStatus(res.status)}`;
      console.warn(`[fmp] ${msg} (${elapsed}ms)`);
      return { data: null, error: msg };
    }

    const data = (await res.json()) as T;

    // FMP returns 200 with an { "Error Message": ... } body for some failures.
    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      "Error Message" in (data as object)
    ) {
      const vendorMsg = (data as Record<string, string>)["Error Message"];
      const msg = `FMP ${endpoint}: ${vendorMsg}`;
      console.warn(`[fmp] ${msg}`);
      return { data: null, error: msg };
    }

    if (expectNonEmpty && isEmptyPayload(data)) {
      const msg = `FMP ${endpoint} returned an unexpected empty response — vendor may have dropped this endpoint from our plan`;
      console.warn(`[fmp] EMPTY ${msg} (${elapsed}ms)`);
      return { data: null, error: msg };
    }

    if (elapsed > 3000) console.warn(`[fmp] SLOW ${endpoint} took ${elapsed}ms`);

    return { data };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    const msg = isTimeout
      ? `FMP ${endpoint} timed out after ${timeoutMs}ms`
      : `FMP ${endpoint}: ${err instanceof Error ? err.message : "fetch error"}`;
    console.warn(`[fmp] ${msg}`);
    return { data: null, error: msg };
  }
}
