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
 *   • the company list (sec.gov/files/company_tickers_exchange.json) —
 *     ticker, CIK, name, exchange; changes a few times a year; held a day.
 *
 * SEC's fair-access rules: ≤ 10 requests a second, and a User-Agent naming
 * a real contact. The evaluator makes one search call per pass.
 */

import {
  atLeastTier,
  classifyFiling,
  isCountedAmendment,
  planSearch,
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

/** One listed company, as SEC's company list has it. */
export interface SecCompany {
  cik: string;
  ticker: string;
  name: string;
  /** "Nasdaq" | "NYSE" | "OTC" | "CBOE" | null */
  exchange: string | null;
}

export interface CompanyList {
  byTicker: Map<string, SecCompany>;
  /** The company's first-listed ticker — its common stock, in SEC's order. */
  byCik: Map<string, SecCompany>;
}

let listCache: { at: number; list: CompanyList } | null = null;
const DAY_MS = 86_400_000;

/**
 * SEC's company list — ticker, CIK, name, exchange — held in memory for a
 * day; null when SEC can't be reached. One download serves the evaluator,
 * `get_sec_filings` and `get_insider_activity`, which each used to fetch a
 * copy on every call.
 */
export async function loadCompanyList(now = Date.now()): Promise<CompanyList | null> {
  if (listCache && now - listCache.at < DAY_MS) return listCache.list;
  try {
    // Not a live value — the list changes a few times a year — so the data
    // cache may hold it for a day across cold starts.
    const res = await fetch("https://www.sec.gov/files/company_tickers_exchange.json", {
      headers: { "User-Agent": secUserAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      next: { revalidate: 86_400 },
    });
    if (!res.ok) {
      console.error(`[sec-filings] company list returned ${res.status}`);
      return listCache?.list ?? null;
    }
    const body = (await res.json()) as { data?: Array<[number, string, string | null, string | null]> };
    const list: CompanyList = { byTicker: new Map(), byCik: new Map() };
    for (const [cikNum, name, ticker, exchange] of body.data ?? []) {
      if (!ticker) continue;
      const company: SecCompany = {
        cik: String(cikNum).padStart(10, "0"),
        ticker: ticker.toUpperCase(),
        name,
        exchange: exchange ?? null,
      };
      list.byTicker.set(company.ticker, company);
      if (!list.byCik.has(company.cik)) list.byCik.set(company.cik, company);
    }
    listCache = { at: now, list };
    return list;
  } catch (err) {
    console.error("[sec-filings] company list unavailable:", err);
    return listCache?.list ?? null;
  }
}

/** Test seam — drop the in-memory company list. */
export function __resetCikCache(): void {
  listCache = null;
}

interface EftsHit {
  _id: string;
  _source: {
    ciks?: string[];
    display_names?: string[];
    form?: string;
    root_forms?: string[];
    items?: string[];
    adsh?: string;
    file_date?: string;
  };
}

/**
 * Is this document an exhibit rather than the filing itself? EDGAR names
 * them `..._ex99-1.htm`, `ex-101.htm`, `exhibit991.htm`.
 */
function isExhibit(doc: string): boolean {
  return /(^|[_\-])ex(hibit)?[-_]?\d/i.test(doc);
}

/** A filing with the company it's about and who else is named on it. */
export interface FoundFiling extends SecFiling {
  companyName: string;
  exchange: string | null;
  /** Everyone else named on the filing — for a 13D, the holder that took the stake. */
  filers: string[];
}

/** "Oasis Management Co Ltd.  (CIK 0001317904)" → "Oasis Management Co Ltd." */
export function plainFilerName(displayName: string): string {
  return displayName
    .replace(/\s*\(CIK \d+\)\s*$/, "")
    .replace(/\s*\([A-Z0-9.,\s-]+\)\s*$/, "")
    .trim();
}

/**
 * Turn EDGAR search hits into filings. `about` picks which companies named
 * on a hit the filing is listed under:
 *   • a book or company search lists it under every searched company named
 *     on it (a 13D one book company filed on another shows under both);
 *   • a market search lists it under the FIRST company EDGAR names — for a
 *     13D that's the company the stake is in, the holders follow (checked
 *     2026-09-16: 27 of 27 new stakes on a real page).
 * EDGAR returns one hit per matching document, so a filing can appear more
 * than once; the accession dedupes it, and the link prefers the filing
 * itself over an exhibit. (On the book's last 90 days, all 92 filings came
 * back as a single document — a safety net.)
 */
function parseHits(
  hits: EftsHit[],
  companies: CompanyList,
  about: (ciks: string[]) => string[],
): FoundFiling[] {
  const byKey = new Map<string, { filing: FoundFiling; doc: string }>();
  const order: string[] = [];
  for (const h of hits) {
    const s = h._source;
    const accession = s.adsh ?? h._id.split(":")[0];
    const form = s.form ?? "";
    const rootForm = s.root_forms?.[0] ?? form.replace(/\/A$/, "");
    const items = s.items ?? [];
    const doc = h._id.split(":")[1] ?? "";
    const ciks = s.ciks ?? [];
    for (const cik of about(ciks)) {
      const company = companies.byCik.get(cik);
      if (!company || !accession || !s.file_date) continue;
      const key = `${cik}:${accession}`;
      const held = byKey.get(key);
      // Same filing seen again: keep it once, and link the filing itself
      // rather than one of its exhibits.
      if (held && !(isExhibit(held.doc) && !isExhibit(doc))) continue;
      if (!held) order.push(key);
      const names = s.display_names ?? [];
      byKey.set(key, {
        doc,
        filing: {
          accession,
          cik,
          ticker: company.ticker,
          form,
          rootForm,
          items,
          filedDate: s.file_date,
          tier: classifyFiling({ rootForm, form, items }),
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${doc}`,
          companyName: company.name,
          exchange: company.exchange,
          filers: names
            .filter((_, i) => ciks[i] !== cik)
            .map(plainFilerName)
            .filter(Boolean),
        },
      });
    }
  }
  return order.map((k) => byKey.get(k)!.filing);
}

/**
 * Book-search parse, kept for callers that map by ticker. Lists a filing
 * under every company in `tickerByCik` named on it.
 */
export function parseSearchHits(hits: EftsHit[], tickerByCik: Map<string, string>): SecFiling[] {
  const companies: CompanyList = { byTicker: new Map(), byCik: new Map() };
  for (const [cik, ticker] of tickerByCik) {
    companies.byCik.set(cik, { cik, ticker, name: ticker, exchange: null });
  }
  return parseHits(hits, companies, (ciks) => ciks.filter((c) => tickerByCik.has(c))).map(
    ({ companyName: _n, exchange: _e, filers: _f, ...f }) => f,
  );
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

/** Space between search pages — well inside SEC's 10 requests a second. */
let PAGE_GAP_MS = 150;
export function __setPageGap(ms: number): void {
  PAGE_GAP_MS = ms;
}

const PAGE = 100;

/** Pages read per search before stopping and saying so. */
export const BOOK_PAGE_CAP = 3;
export const MARKET_PAGE_CAP = 10;

export interface FilingSearch {
  /** The companies to search. Absent = the whole market. */
  tickers?: string[];
  /** EDGAR form names — "8-K", "SCHEDULE 13D", "NT 10-Q", "424B5", "10-K"… */
  forms?: string[];
  /** 8-K item codes — "5.02", "4.02"… */
  items?: string[];
  /** Only filings at least this serious. */
  tier?: "RED" | "MATERIAL";
  /** Used when no forms, items or tier are named. */
  defaultForms?: string[];
  days: number;
  now: Date;
  /** Keep amended 13Ds, 424B5s and S-3s (amended 8-Ks are always kept). */
  includeAmendments?: boolean;
  /** Pages per EDGAR search. Defaults: 3 for companies, 10 for the market. */
  maxPages?: number;
}

export interface FilingResults {
  /** Newest first. */
  filings: FoundFiling[];
  /** How many filings EDGAR matched, before our filters. */
  matched: number;
  /** EDGAR matched more than was read — the oldest in the window weren't seen. */
  truncated: boolean;
  /** Filings read but left out, and why. */
  dropped: { amended: number; notTheItem: number; belowTier: number };
  /** Tickers asked for that SEC's company list doesn't have. */
  unknownTickers: string[];
  /** Why nothing could be read, in words. Absent when the read worked. */
  error?: string;
}

const noResults = (error?: string, unknownTickers: string[] = []): FilingResults => ({
  filings: [],
  matched: 0,
  truncated: false,
  dropped: { amended: 0, notTheItem: 0, belowTier: 0 },
  unknownTickers,
  ...(error ? { error } : {}),
});

/**
 * THE filing search: any companies (or the whole market), any forms, any
 * 8-K item codes, any tier, any window. Everything else in this file —
 * the evaluator's book read, one company's filings, the tool — is a call
 * to this. Pages are read one after another, inside SEC's rate limit; a
 * search that hits its page cap says so (`truncated`). Fails soft: a
 * failed read returns no filings WITH an error, never an empty success.
 */
export async function searchFilings(q: FilingSearch): Promise<FilingResults> {
  const companies = await loadCompanyList(q.now.getTime());
  if (!companies) return noResults("SEC's company list couldn't be reached");

  let ciks: string[] | null = null;
  const unknownTickers: string[] = [];
  if (q.tickers) {
    const set = new Set<string>();
    for (const t of new Set(q.tickers.map((x) => x.toUpperCase()))) {
      const cik = companies.byTicker.get(t)?.cik;
      if (cik) set.add(cik);
      else unknownTickers.push(t);
    }
    if (set.size === 0) return noResults(undefined, unknownTickers);
    ciks = [...set];
  }

  const plan = planSearch({ forms: q.forms, items: q.items, tier: q.tier });
  if (!plan.itemSearch && !plan.formSearch) {
    plan.formSearch = { forms: q.defaultForms ?? WATCHED_FORMS };
  }
  const start = isoDay(new Date(q.now.getTime() - q.days * DAY_MS));
  const end = isoDay(q.now);
  const cap = q.maxPages ?? (ciks ? BOOK_PAGE_CAP : MARKET_PAGE_CAP);
  const about = ciks
    ? (named: string[]) => named.filter((c) => ciks!.includes(c))
    : (named: string[]) => named.slice(0, 1);

  const searches: Array<{ forms: string[]; text?: string; items?: Set<string> }> = [];
  if (plan.itemSearch) {
    searches.push({
      forms: ["8-K"],
      text: plan.itemSearch.items.map((i) => `"Item ${i}"`).join(" OR "),
      items: new Set(plan.itemSearch.items),
    });
  }
  if (plan.formSearch) searches.push({ forms: plan.formSearch.forms });

  const out = new Map<string, FoundFiling>();
  const dropped = { amended: 0, notTheItem: 0, belowTier: 0 };
  let matched = 0;
  let truncated = false;
  let first = true;

  for (const search of searches) {
    let read = 0;
    let total = 0;
    for (let page = 0; page < cap; page++) {
      if (!first) await new Promise((r) => setTimeout(r, PAGE_GAP_MS));
      first = false;
      const url =
        `https://efts.sec.gov/LATEST/search-index?forms=${search.forms.map(encodeURIComponent).join(",")}` +
        (search.text ? `&q=${encodeURIComponent(search.text)}` : "") +
        (ciks ? `&ciks=${ciks.join(",")}` : "") +
        `&dateRange=custom&startdt=${start}&enddt=${end}&from=${page * PAGE}`;
      let body: { hits?: { hits?: EftsHit[]; total?: { value?: number } } };
      try {
        const res = await searchOnce(url);
        if (!res.ok) return noResults(`EDGAR search returned ${res.status}`, unknownTickers);
        body = await res.json();
      } catch (err) {
        return noResults(`EDGAR search failed: ${err instanceof Error ? err.message : String(err)}`, unknownTickers);
      }
      const hits = body.hits?.hits ?? [];
      total = body.hits?.total?.value ?? total;
      read += hits.length;
      for (const f of parseHits(hits, companies, about)) {
        const key = `${f.cik}:${f.accession}`;
        if (out.has(key)) continue;
        // The text search also finds filings that merely mention an item.
        if (search.items && !f.items.some((i) => search.items!.has(i))) { dropped.notTheItem++; continue; }
        if (!q.includeAmendments && isCountedAmendment(f)) { dropped.amended++; continue; }
        if (!atLeastTier(f, q.tier)) { dropped.belowTier++; continue; }
        out.set(key, f);
      }
      if (hits.length < PAGE || read >= total) break;
    }
    matched += total;
    if (read < total) truncated = true;
  }

  const filings = [...out.values()].sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  return { filings, matched, truncated, dropped, unknownTickers };
}

export interface BookFilings {
  /** Newest first, per ticker. Tickers with nothing filed are absent. */
  byTicker: Map<string, SecFiling[]>;
  /** Why nothing could be read, in words. Absent when the read worked. */
  error?: string;
}

/**
 * The trigger evaluator's read: every watched filing on these tickers over
 * the last `lookbackDays`, grouped by ticker. One EDGAR search for the book.
 */
export async function fetchBookFilings(opts: {
  tickers: string[];
  now: Date;
  lookbackDays?: number;
  forms?: string[];
}): Promise<BookFilings> {
  const byTicker = new Map<string, SecFiling[]>();
  if (opts.tickers.length === 0) return { byTicker };
  const res = await searchFilings({
    tickers: opts.tickers,
    defaultForms: opts.forms ?? WATCHED_FORMS,
    days: opts.lookbackDays ?? SEC_LOOKBACK_DAYS,
    now: opts.now,
    // The evaluator has always kept amendments; the tier table decides them.
    includeAmendments: true,
  });
  if (res.error) return { byTicker, error: res.error };
  for (const f of res.filings) {
    const list = byTicker.get(f.ticker) ?? [];
    list.push(f);
    byTicker.set(f.ticker, list);
  }
  return { byTicker };
}

/**
 * One company's watched filings — the stock page's Filings tab and the
 * thesis sheet's filings line read this. Includes the periodic reports
 * (10-K / 10-Q) for context, which the evaluator's read doesn't need.
 */
export const SYMBOL_FILING_FORMS = [...WATCHED_FORMS, "10-K", "10-Q"];

export interface SymbolFilings {
  symbol: string;
  /** Newest first. Empty when the company filed nothing watched in the window. */
  filings: SecFiling[];
  /** Why nothing could be read, in words. Absent when the read worked. */
  error?: string;
  /** How many days back this covers. */
  days: number;
}

export async function getFilingsForSymbol(
  symbol: string,
  opts: { days?: number; now?: Date } = {},
): Promise<SymbolFilings> {
  const days = opts.days ?? 90;
  const S = symbol.toUpperCase();
  const read = await fetchBookFilings({
    tickers: [S],
    now: opts.now ?? new Date(),
    lookbackDays: days,
    forms: SYMBOL_FILING_FORMS,
  });
  return { symbol: S, filings: read.byTicker.get(S) ?? [], error: read.error, days };
}
