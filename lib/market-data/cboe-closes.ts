/**
 * The VIX and the 10-year Treasury yield, from Cboe's daily history files.
 *
 * No plan we pay for serves either index (DAV-339: Finnhub refuses CFD
 * indices, Alpaca has no index bars). Cboe publishes each index's daily
 * history as a public CSV: the VIX (DATE,OPEN,HIGH,LOW,CLOSE) and TNX, its
 * 10-year yield index, which is the yield times ten (DATE,TNX). The URLs
 * redirect once, to cdn-api.cboe.com, and want a browser user agent. Each
 * reading carries the day it closed: never passed off as today's level.
 *
 * Read with no cache: the Data Cache serves stale-while-revalidate, so a
 * morning run could be handed the file from before last night's close.
 */

const CBOE = "https://cdn.cboe.com/api/global/us_indices/daily_prices";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type CboeIndex = "VIX" | "TNX";
export const cboeHistoryUrl = (index: CboeIndex) => `${CBOE}/${index}_History.csv`;

export interface IndexClose {
  close: number;
  prevClose: number | null;
  /** The day it closed, YYYY-MM-DD. */
  asOf: string;
}

/** The last two closes in a Cboe history file. Null when it has none. */
export function lastCloses(csv: string): IndexClose | null {
  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(-3)
    .map((line) => {
      const cells = line.split(",");
      const m = cells[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const close = Number(cells[cells.length - 1]);
      return m && Number.isFinite(close) && close > 0 ? { date: `${m[3]}-${m[1]}-${m[2]}`, close } : null;
    })
    .filter((r): r is { date: string; close: number } => r != null);
  const last = rows[rows.length - 1];
  if (!last) return null;
  return { close: last.close, prevClose: rows[rows.length - 2]?.close ?? null, asOf: last.date };
}

/** TNX is the yield times ten: 48.59 is 4.859%. */
export function tenYearYield(tnx: IndexClose | null): IndexClose | null {
  const pct = (n: number) => Math.round((n / 10) * 1000) / 1000;
  return tnx ? { close: pct(tnx.close), prevClose: tnx.prevClose != null ? pct(tnx.prevClose) : null, asOf: tnx.asOf } : null;
}

/** An index's file as Cboe serves it. Throws on a refusal. */
export async function fetchCboeHistory(index: CboeIndex): Promise<string> {
  const res = await fetch(cboeHistoryUrl(index), {
    cache: "no-store",
    redirect: "follow",
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Cboe's ${index} file answered ${res.status}`);
  return res.text();
}
