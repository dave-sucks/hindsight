/**
 * Wall Street price targets and EPS consensus, from Nasdaq's own website JSON
 * (no key). It is a website's feed, not a licensed API: it can change or block
 * without notice, so the 06:25 vendor probe reads it every weekday. This file
 * is the calls, the parser and the words, with no database; the store is
 * street-consensus-store.ts.
 */

/** The three calls per stock, under https://api.nasdaq.com/api/analyst/{SYM}/. */
export const STREET_ENDPOINTS = ["targetprice", "earnings-forecast", "estimate-momentum"] as const;
export type StreetEndpoint = (typeof STREET_ENDPOINTS)[number];
export type StreetResponses = Record<StreetEndpoint, unknown>;

/** One StreetConsensus row as stored, and as get_theses carries it on `row.street`. */
export interface StreetFacts {
  ticker: string;
  asOf: string;
  targetLow: number;
  targetAvg: number;
  targetHigh: number;
  analysts: number;
  buy: number;
  hold: number;
  sell: number;
  epsNextQuarter: number | null;
  epsNextQuarterEstimates: number | null;
  epsNextQuarterUp: number | null;
  epsNextQuarterDown: number | null;
  epsNextQuarterFiscalEnd: string | null;
  epsFiscalYear: number | null;
  epsFiscalYearUp: number | null;
  epsFiscalYearDown: number | null;
  epsNextQuarter1wAgo: number | null;
  epsNextQuarter1mAgo: number | null;
}

// The site hangs up on a request without a browser User-Agent.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json",
};

/** One call's JSON body. Throws on a non-200 or a timeout. */
export async function nasdaqAnalyst(ticker: string, endpoint: StreetEndpoint): Promise<unknown> {
  const res = await fetch(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(ticker.toUpperCase())}/${endpoint}`, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`nasdaq ${endpoint} HTTP ${res.status}`);
  return res.json();
}

/** The value at a dotted path; a missing key throws, a null value is returned. */
function at(json: unknown, path: string, where: StreetEndpoint): unknown {
  let v: unknown = json;
  for (const k of path.split(".")) {
    if (v == null || typeof v !== "object" || !(k in v)) throw new Error(`nasdaq ${where}: no ${path}`);
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

function num(json: unknown, path: string, where: StreetEndpoint): number {
  const v = at(json, path, where);
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`nasdaq ${where}: ${path} is not a number`);
  return v;
}

function numOrNull(json: unknown, path: string, where: StreetEndpoint): number | null {
  return at(json, path, where) == null ? null : num(json, path, where);
}

/** The targets and the rating counts. Throws when a key is gone, or there are no analysts or no target. */
export function readTargets(json: unknown) {
  const w = "targetprice";
  const o = at(json, "data.consensusOverview", w);
  const t = {
    low: num(o, "lowPriceTarget", w),
    avg: num(o, "priceTarget", w),
    high: num(o, "highPriceTarget", w),
    buy: num(o, "buy", w),
    hold: num(o, "hold", w),
    sell: num(o, "sell", w),
  };
  if (t.buy + t.hold + t.sell <= 0 || t.avg <= 0) throw new Error("nasdaq targetprice: no analysts or no target");
  return t;
}

/** A forecast table's first row; null when Nasdaq has no estimates for the stock. */
function firstRow(json: unknown, table: "quarterlyForecast" | "yearlyForecast"): unknown {
  const w = "earnings-forecast";
  if (at(json, `data.${table}`, w) == null) return null;
  const rows = at(json, `data.${table}.rows`, w);
  if (!Array.isArray(rows)) throw new Error(`nasdaq ${w}: ${table}.rows is not a list`);
  return rows[0] ?? null;
}

/** New York's date (YYYY-MM-DD), the day a row belongs to. */
export function nyDay(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** One day's row from the three replies. Throws, and so writes nothing, when the targets are missing or a key moved. */
export function parseStreet(ticker: string, r: StreetResponses, asOf: string): StreetFacts {
  const t = readTargets(r.targetprice);
  const ef = "earnings-forecast";
  const q = firstRow(r[ef], "quarterlyForecast");
  const y = firstRow(r[ef], "yearlyForecast");
  // "No record found" comes back as data: null; the move then reads as unknown.
  const em = "estimate-momentum";
  const moved = at(r[em], "data", em) == null ? null : at(r[em], "data.changeInConsensus", em);
  const fiscalEnd = q == null ? null : at(q, "fiscalEnd", ef);
  return {
    ticker: ticker.toUpperCase(),
    asOf,
    targetLow: t.low,
    targetAvg: t.avg,
    targetHigh: t.high,
    analysts: t.buy + t.hold + t.sell,
    buy: t.buy,
    hold: t.hold,
    sell: t.sell,
    epsNextQuarter: q == null ? null : numOrNull(q, "consensusEPSForecast", ef),
    epsNextQuarterEstimates: q == null ? null : numOrNull(q, "noOfEstimates", ef),
    epsNextQuarterUp: q == null ? null : numOrNull(q, "up", ef),
    epsNextQuarterDown: q == null ? null : numOrNull(q, "down", ef),
    epsNextQuarterFiscalEnd: typeof fiscalEnd === "string" ? fiscalEnd : null,
    epsFiscalYear: y == null ? null : numOrNull(y, "consensusEPSForecast", ef),
    epsFiscalYearUp: y == null ? null : numOrNull(y, "up", ef),
    epsFiscalYearDown: y == null ? null : numOrNull(y, "down", ef),
    epsNextQuarter1wAgo: moved == null ? null : numOrNull(moved, "weekData.qtrMean", em),
    epsNextQuarter1mAgo: moved == null ? null : numOrNull(moved, "monthData.qtrMean", em),
  };
}

/** An EPS figure in dollars, the sign before the dollar sign: "-$0.28". */
export const epsMoney = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`;
/** Whole dollars when the range tops $100, cents below: one format per line. */
const usdBy = (high: number) => (v: number) => (high >= 100 ? `$${Math.round(v).toLocaleString("en-US")}` : `$${v.toFixed(2)}`);

/** "next-quarter EPS $4.85, 6 up / 3 down in 4 weeks": the card's words and the row's. */
export function epsWords(value: number | null, up: number | null, down: number | null): string | null {
  if (value == null) return null;
  return `next-quarter EPS ${epsMoney(value)}${up != null && down != null ? `, ${up} up / ${down} down in 4 weeks` : ""}`;
}

/** The EPS consensus in full: next quarter with its revisions and moves, then the fiscal year. */
export function epsDetail(s: StreetFacts): string | null {
  const next = epsWords(s.epsNextQuarter, s.epsNextQuarterUp, s.epsNextQuarterDown);
  if (!next) return null;
  const was = [
    s.epsNextQuarter1wAgo != null ? `${epsMoney(s.epsNextQuarter1wAgo)} a week ago` : null,
    s.epsNextQuarter1mAgo != null ? `${epsMoney(s.epsNextQuarter1mAgo)} a month ago` : null,
  ].filter(Boolean);
  const about = [
    s.epsNextQuarterFiscalEnd ? `quarter ending ${s.epsNextQuarterFiscalEnd}, ${s.epsNextQuarterEstimates ?? "?"} estimates` : null,
    was.length ? `was ${was.join(", ")}` : null,
  ].filter(Boolean);
  const year = s.epsFiscalYear != null ? ` · fiscal-year EPS ${epsMoney(s.epsFiscalYear)}, ${s.epsFiscalYearUp ?? "?"} up / ${s.epsFiscalYearDown ?? "?"} down` : "";
  return `${next}${about.length ? ` (${about.join("; ")})` : ""}${year}`;
}

/** The row's Street line, from `row.street` (and `row.streetMonthAgo` when a month of rows exists): ratings, the target range and average, which way the average moved, the EPS consensus. */
export function streetLine(row: Record<string, unknown>): string | null {
  const s = row.street as StreetFacts | null | undefined;
  if (!s || typeof s !== "object" || typeof s.targetAvg !== "number") return null;
  const usd = usdBy(s.targetHigh);
  const ago = row.streetMonthAgo as StreetFacts | null | undefined;
  const moved = ago && typeof ago.targetAvg === "number" && Math.abs(ago.targetAvg - s.targetAvg) >= 0.005 ? `, from ${usd(ago.targetAvg)} a month ago` : "";
  return [
    `${s.buy} buy / ${s.hold} hold / ${s.sell} sell`,
    `targets ${usd(s.targetLow)}–${usd(s.targetHigh)}, avg ${usd(s.targetAvg)}${moved} (as of ${String(s.asOf).slice(5)})`,
    epsWords(s.epsNextQuarter, s.epsNextQuarterUp, s.epsNextQuarterDown),
  ].filter(Boolean).join(" · ");
}
