/**
 * SEC filings — what a company told the SEC, read live off EDGAR.
 *
 * The same shape as the earnings calendar (docs/plans/SEC_FILINGS.md):
 * nothing is stored, EDGAR is the database, and one reader feeds the
 * trigger evaluator (`SEC_EVENT`) and the agent tool (`get_sec_filings`).
 *
 * A filing is an event with a code. Every 8-K carries SEC item codes — a
 * fixed government list (`5.02` an officer leaving or joining, `4.02` past
 * financials can't be relied on). The code IS the event; no AI classifies
 * it. The tier table below decides how urgent a look it deserves. It lives
 * here, in code, so no prompt has to memorize the codes.
 *
 * Two EDGAR endpoints:
 *   • full-text search (efts.sec.gov) — every filing for a list of companies
 *     over a date range, with item codes, in ONE call. The evaluator's read.
 *   • the ticker → CIK list (sec.gov/files/company_tickers.json, ~800KB) —
 *     changes a few times a year; held in memory for a day.
 *
 * SEC's fair-access rules: ≤ 10 requests a second, and a User-Agent naming
 * a real contact. The evaluator makes one search call per pass.
 */

import {
  classifyFiling,
  WATCHED_FORMS,
  type SecFiling,
} from "./sec-events";

export type { SecFiling, FilingTier } from "./sec-events";

// ── EDGAR ───────────────────────────────────────────────────────────────────

/**
 * SEC requires a User-Agent with a real contact address. Set
 * SEC_CONTACT_EMAIL in the environment; the fallback is the address the
 * old tool used, which SEC may throttle.
 */
export function secUserAgent(): string {
  const email = process.env.SEC_CONTACT_EMAIL?.trim();
  return `Hindsight Research ${email || "research@hindsight.app"}`;
}

/** Days of filings the evaluator reads. Covers a Friday-evening filing on a Monday open. */
export const SEC_LOOKBACK_DAYS = 4;

let cikCache: { at: number; byTicker: Map<string, string> } | null = null;
const DAY_MS = 86_400_000;

/** Ticker → 10-digit CIK. Held in memory for a day; null when SEC can't be reached. */
export async function loadCikMap(now = Date.now()): Promise<Map<string, string> | null> {
  if (cikCache && now - cikCache.at < DAY_MS) return cikCache.byTicker;
  try {
    // Not a live value — the list changes a few times a year — so the data
    // cache may hold it for a day across cold starts.
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": secUserAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 86_400 },
    });
    if (!res.ok) {
      console.error(`[sec-filings] ticker list returned ${res.status}`);
      return cikCache?.byTicker ?? null;
    }
    const data = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
    const byTicker = new Map<string, string>();
    for (const e of Object.values(data)) {
      byTicker.set(e.ticker.toUpperCase(), String(e.cik_str).padStart(10, "0"));
    }
    cikCache = { at: now, byTicker };
    return byTicker;
  } catch (err) {
    console.error("[sec-filings] ticker list unavailable:", err);
    return cikCache?.byTicker ?? null;
  }
}

/** Test seam — drop the in-memory ticker list. */
export function __resetCikCache(): void {
  cikCache = null;
}

interface EftsHit {
  _id: string;
  _source: {
    ciks?: string[];
    form?: string;
    root_forms?: string[];
    items?: string[];
    adsh?: string;
    file_date?: string;
  };
}

/**
 * Turn one EDGAR search page into filings for the companies asked about.
 * EDGAR returns one hit per document; the accession dedupes them. A filing
 * that names two book companies (a 13D filed by one on the other) is listed
 * under each.
 */
export function parseSearchHits(hits: EftsHit[], tickerByCik: Map<string, string>): SecFiling[] {
  const out: SecFiling[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const s = h._source;
    const accession = s.adsh ?? h._id.split(":")[0];
    const form = s.form ?? "";
    const rootForm = s.root_forms?.[0] ?? form.replace(/\/A$/, "");
    const items = s.items ?? [];
    const doc = h._id.split(":")[1] ?? "";
    for (const cik of s.ciks ?? []) {
      const ticker = tickerByCik.get(cik);
      if (!ticker || !accession || !s.file_date) continue;
      const key = `${cik}:${accession}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        accession,
        cik,
        ticker,
        form,
        rootForm,
        items,
        filedDate: s.file_date,
        tier: classifyFiling({ rootForm, form, items }),
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${doc}`,
      });
    }
  }
  return out;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One search request, retried once on a server error or throttle. EDGAR's
 * search returns an intermittent 500 on longer windows (measured
 * 2026-09-15: the same 45-day query failed, then passed); the book's
 * 4-day query passed 12 of 12.
 */
async function searchOnce(url: string): Promise<Response> {
  const get = () =>
    fetch(url, {
      headers: { "User-Agent": secUserAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  const first = await get();
  if (first.status < 500 && first.status !== 429) return first;
  await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  return get();
}

/** Test seam. */
export let RETRY_DELAY_MS = 1_000;
export function __setRetryDelay(ms: number): void {
  RETRY_DELAY_MS = ms;
}

export interface BookFilings {
  /** Newest first, per ticker. Tickers with nothing filed are absent. */
  byTicker: Map<string, SecFiling[]>;
  /** Why nothing could be read, in words. Absent when the read worked. */
  error?: string;
}

/**
 * Every watched filing on these tickers over the last `lookbackDays`, in one
 * EDGAR search call (two or three pages at most for a book this size).
 * Fails soft: an unreachable EDGAR returns an empty map WITH an error, so a
 * caller can say "filings unavailable" rather than "nothing filed".
 */
export async function fetchBookFilings(opts: {
  tickers: string[];
  now: Date;
  lookbackDays?: number;
  forms?: string[];
}): Promise<BookFilings> {
  const byTicker = new Map<string, SecFiling[]>();
  const tickers = Array.from(new Set(opts.tickers.map((t) => t.toUpperCase())));
  if (tickers.length === 0) return { byTicker };

  const cikMap = await loadCikMap(opts.now.getTime());
  if (!cikMap) return { byTicker, error: "SEC's ticker list couldn't be reached" };
  const tickerByCik = new Map<string, string>();
  for (const t of tickers) {
    const cik = cikMap.get(t);
    if (cik && !tickerByCik.has(cik)) tickerByCik.set(cik, t);
  }
  if (tickerByCik.size === 0) return { byTicker };

  const start = isoDay(new Date(opts.now.getTime() - (opts.lookbackDays ?? SEC_LOOKBACK_DAYS) * DAY_MS));
  const end = isoDay(opts.now);
  const forms = (opts.forms ?? WATCHED_FORMS).map(encodeURIComponent).join(",");
  const ciks = Array.from(tickerByCik.keys()).join(",");

  const filings: SecFiling[] = [];
  const PAGE = 100;
  for (let from = 0; from < 300; from += PAGE) {
    const url =
      `https://efts.sec.gov/LATEST/search-index?forms=${forms}&ciks=${ciks}` +
      `&dateRange=custom&startdt=${start}&enddt=${end}&from=${from}`;
    try {
      const res = await searchOnce(url);
      if (!res.ok) return { byTicker, error: `EDGAR search returned ${res.status}` };
      const body = (await res.json()) as { hits?: { hits?: EftsHit[]; total?: { value?: number } } };
      const hits = body.hits?.hits ?? [];
      filings.push(...parseSearchHits(hits, tickerByCik));
      if (hits.length < PAGE || from + PAGE >= (body.hits?.total?.value ?? 0)) break;
    } catch (err) {
      return { byTicker, error: `EDGAR search failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const seen = new Set<string>();
  for (const f of filings.sort((a, b) => b.filedDate.localeCompare(a.filedDate))) {
    const key = `${f.ticker}:${f.accession}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = byTicker.get(f.ticker) ?? [];
    list.push(f);
    byTicker.set(f.ticker, list);
  }
  return { byTicker };
}
