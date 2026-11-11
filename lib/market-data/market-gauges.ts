/**
 * The VIX and the 10-year Treasury yield, from Cboe's daily index files.
 *
 * No plan we pay for serves either index (DAV-339: Finnhub refuses CFD
 * indices, Alpaca has no index bars), so the market check's only fear gauge
 * was VIXY's day move. Cboe publishes each index's daily history as a public
 * file: the VIX (DATE,OPEN,HIGH,LOW,CLOSE) and TNX, its 10-year yield index,
 * which is the yield times ten (DATE,TNX). Both are closes, and each reading
 * carries the date it closed: never passed off as today's level. (FRED
 * serves the same series but refused connections when probed 2026-11-06.)
 *
 * Read with no cache. The Data Cache serves stale-while-revalidate, so a
 * morning run could be handed the file from before last night's close.
 */

const CBOE = "https://cdn.cboe.com/api/global/us_indices/daily_prices";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface IndexClose {
  close: number;
  prevClose: number | null;
  /** The day it closed, YYYY-MM-DD. */
  asOf: string;
}

export interface Gauges {
  vix: IndexClose | null;
  /** The 10-year Treasury yield in percent (4.84 = 4.84%). */
  tenYear: IndexClose | null;
  errors: string[];
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

async function cboeFile(index: "VIX" | "TNX"): Promise<string> {
  const res = await fetch(`${CBOE}/${index}_History.csv`, {
    cache: "no-store",
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Cboe's ${index} file answered ${res.status}`);
  return res.text();
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

export async function loadGauges(): Promise<Gauges> {
  const [vixFile, tnxFile] = await Promise.allSettled([cboeFile("VIX"), cboeFile("TNX")]);
  const errors: string[] = [];
  const read = (file: PromiseSettledResult<string>, name: string) => {
    if (file.status === "rejected") {
      errors.push(`${name}: ${file.reason instanceof Error ? file.reason.message : "Cboe did not answer"}`);
      return null;
    }
    const closes = lastCloses(file.value);
    if (!closes) errors.push(`${name}: Cboe's file had no closes in it`);
    return closes;
  };
  const vix = read(vixFile, "VIX");
  const tnx = read(tnxFile, "10-year yield");
  const tenYear = tnx
    ? { close: round(tnx.close / 10, 3), prevClose: tnx.prevClose != null ? round(tnx.prevClose / 10, 3) : null, asOf: tnx.asOf }
    : null;
  return { vix, tenYear, errors };
}
