/**
 * load-market-numbers.ts — reads the market's numbers (lib/market-data/market-numbers.ts
 * says what they are): one live-quote batch for SPY, QQQ and the 11 sector
 * funds, SPY's daily indicator snapshot, and Cboe's VIX and 10-year closes.
 * The one copy: the Market and portfolio block and the 7:30 market run both
 * read it. A piece that can't be read is left out.
 */
import { getLiveQuotes } from "@/lib/market-data/live-quote";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import { loadGauges, type Gauges } from "@/lib/market-data/market-gauges";
import { marketNumbersFrom, SECTOR_FUNDS, type MarketNumbers } from "@/lib/market-data/market-numbers";
import type { AlpacaCredentials } from "@/lib/alpaca";

// Cboe's closes change once a day; one read serves every request for a while.
const GAUGES_FOR_MS = 15 * 60_000;
// A failed or slow read is remembered too, so the next requests don't each wait on Cboe again.
const GAUGES_FAILED_FOR_MS = 5 * 60_000;
/** Cboe's own files get this long inside the market numbers' part; the funds' lines don't wait past it. */
export const GAUGES_LIMIT = { ms: 2_000 };
const NONE: Gauges = { vix: null, tenYear: null, errors: [] };
let gaugesCache: { at: number; value: Gauges; failed: boolean } | null = null;
async function gauges(now: Date): Promise<Gauges> {
  if (gaugesCache && now.getTime() - gaugesCache.at < (gaugesCache.failed ? GAUGES_FAILED_FOR_MS : GAUGES_FOR_MS)) return gaugesCache.value;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const value = await Promise.race([
    loadGauges(),
    new Promise<Gauges>((resolve) => {
      timer = setTimeout(() => resolve({ ...NONE, errors: [`no answer in ${GAUGES_LIMIT.ms / 1000}s`] }), GAUGES_LIMIT.ms);
    }),
  ])
    .catch((err): Gauges => ({ ...NONE, errors: [err instanceof Error ? err.message : String(err)] }))
    .finally(() => clearTimeout(timer));
  gaugesCache = { at: now.getTime(), value, failed: !value.vix && !value.tenYear };
  return value;
}
/** Tests only: forget the cached Cboe read. */
export function forgetGauges(): void {
  gaugesCache = null;
}

export async function loadMarketNumbers(opts: { now?: Date; creds?: AlpacaCredentials } = {}): Promise<MarketNumbers> {
  const now = opts.now ?? new Date();
  const [quotes, snapshots, g] = await Promise.all([
    getLiveQuotes(["SPY", "QQQ", ...SECTOR_FUNDS.map(([t]) => t)], { caller: "other", creds: opts.creds, now }).catch(() => ({})),
    loadIndicatorSnapshots(["SPY"], now).catch(() => new Map()),
    gauges(now).catch((): Gauges => ({ vix: null, tenYear: null, errors: [] })),
  ]);
  return marketNumbersFrom({ quotes, spy: snapshots.get("SPY") ?? null, gauges: g }, now);
}
