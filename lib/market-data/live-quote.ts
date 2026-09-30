/**
 * The live price — the one place it comes from.
 *
 * Alpaca's consolidated tape first: one call prices any number of symbols,
 * against 10,000 calls a minute. Finnhub `/quote` (one call a symbol, 60 a
 * minute, shared with everything else Finnhub serves) is what's left for a
 * symbol Alpaca could not price, or when Alpaca is down. On 2026-09-14 and
 * 09-15 the Finnhub key ran out while the app was in use: four chat lookups
 * read Friday's close as the price, and ~29 stocks went unpriced on a
 * trigger pass.
 *
 * Both sources come back in the one shape lib/market-data/quote-age.ts
 * reads — `c` the price, `t` when it printed — so how old a price is stays
 * decided there, and a buy still never fires on a stale one.
 *
 * What "the price" is. Between 9:30 and the bell it is the latest trade on
 * the tape, with that trade's own timestamp. The tape also carries
 * pre-market and after-hours prints, which Finnhub's quote never did; those
 * are NOT served as the price. Outside the session — and at 9:30:02 for a
 * stock that hasn't opened yet — the price is the last finished session's
 * close, stamped at its bell, which is what every reader of this quote has
 * always been given. Whether the 8 AM run should see a pre-market print is a
 * trading decision, not a vendor swap.
 */

import { getSnapshots, type AlpacaCredentials, type AlpacaSnapshot, type AlpacaSnapshotBar } from "@/lib/alpaca";
import { finnhub } from "@/lib/agent/research-helpers";
import { isMarketOpen, sessionCloseAt } from "@/lib/market-hours";
import type { QuoteCaller } from "@/lib/market-data/quote-budget";

export interface LiveQuote {
  /** The price. */
  c: number;
  /** When it printed, unix seconds. */
  t: number;
  /** The close of the session before the one `c` belongs to. */
  pc: number | null;
  /** `c` against `pc`, in dollars and percent. Null when `pc` is unknown — never a made-up zero. */
  d: number | null;
  dp: number | null;
  /** Open, high and low of the session `c` belongs to. */
  o: number | null;
  h: number | null;
  l: number | null;
  source: "alpaca" | "finnhub";
}

export interface LiveQuoteResult {
  quote: LiveQuote | null;
  /** Why there is no price, in the vendor's words. Reads as rate-limited or failed in `readPrice`. */
  error?: string;
}

type DatedBar = AlpacaSnapshotBar & { t: string; c: number };

const etDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const positive = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);

function priced(c: number, at: Date, session: DatedBar | undefined, prior: DatedBar | undefined): Omit<LiveQuote, "source"> {
  const pc = positive(prior?.c);
  return {
    c,
    t: Math.floor(at.getTime() / 1000),
    pc,
    d: pc != null ? Math.round((c - pc) * 10_000) / 10_000 : null,
    dp: pc != null ? ((c - pc) / pc) * 100 : null,
    o: positive(session?.o),
    h: positive(session?.h),
    l: positive(session?.l),
  };
}

/**
 * One Alpaca snapshot → the price and its time. Pure.
 *
 * Reads each daily bar's own date rather than trusting which slot it came
 * in: before the open `dailyBar` is still the prior session's, and
 * `prevDailyBar` the one before that.
 */
export function quoteFromSnapshot(snap: AlpacaSnapshot | undefined, now: Date): Omit<LiveQuote, "source"> | null {
  if (!snap) return null;
  const bars = [snap.prevDailyBar, snap.dailyBar]
    .filter((b): b is DatedBar => !!b && typeof b.t === "string" && positive(b.c) != null)
    .sort((a, b) => a.t.localeCompare(b.t));
  const dateOf = (b: DatedBar) => b.t.slice(0, 10);
  const on = (date: string) => bars.find((b) => dateOf(b) === date);
  const before = (date: string) => bars.filter((b) => dateOf(b) < date).at(-1);

  const tradePrice = positive(snap.latestTrade?.p);
  const tradeAt = snap.latestTrade?.t ? new Date(snap.latestTrade.t) : null;
  if (tradePrice != null && tradeAt && Number.isFinite(tradeAt.getTime()) && isMarketOpen(tradeAt)) {
    const date = etDate(tradeAt);
    return priced(tradePrice, tradeAt, on(date), before(date));
  }

  const today = etDate(now);
  const finished = bars
    .filter((b) => dateOf(b) < today || (dateOf(b) === today && now.getTime() >= sessionCloseAt(today).getTime()))
    .at(-1);
  if (!finished) return null;
  return priced(finished.c, sessionCloseAt(dateOf(finished)), finished, before(dateOf(finished)));
}

async function fromFinnhub(symbol: string, caller: QuoteCaller, why: string): Promise<LiveQuoteResult> {
  try {
    const r = await finnhub(`/quote?symbol=${encodeURIComponent(symbol)}`, 1, undefined, caller);
    const q = r.data as Record<string, unknown> | null;
    const c = positive(q?.c);
    const t = positive(q?.t);
    if (c == null) return { quote: null, error: `${why}; ${r.error ?? "Finnhub /quote returned no price"}` };
    const pc = positive(q?.pc);
    return {
      quote: {
        c,
        // A quote with no timestamp has no age: 0 reads as stale, never as live.
        t: t ?? 0,
        pc,
        d: typeof q?.d === "number" ? q.d : pc != null ? c - pc : null,
        dp: typeof q?.dp === "number" ? q.dp : pc != null ? ((c - pc) / pc) * 100 : null,
        o: positive(q?.o),
        h: positive(q?.h),
        l: positive(q?.l),
        source: "finnhub",
      },
    };
  } catch (err) {
    return { quote: null, error: `${why}; ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Live quotes for many symbols: one Alpaca call, then Finnhub for whatever is
 * left. Never throws. `caller` decides who yields when a vendor's minute runs
 * low — the trigger check never does (lib/market-data/quote-budget).
 */
export async function getLiveQuotes(
  symbols: string[],
  opts: { caller: QuoteCaller; creds?: AlpacaCredentials; now?: Date },
): Promise<Record<string, LiveQuoteResult>> {
  const now = opts.now ?? new Date();
  const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
  const out: Record<string, LiveQuoteResult> = {};
  if (wanted.length === 0) return out;

  let alpacaSaid: string | undefined;
  try {
    const snaps = await getSnapshots(wanted, { creds: opts.creds, caller: opts.caller });
    for (const symbol of wanted) {
      const q = quoteFromSnapshot(snaps[symbol], now);
      if (q) out[symbol] = { quote: { ...q, source: "alpaca" } };
    }
  } catch (err) {
    alpacaSaid = err instanceof Error ? err.message : String(err);
    console.warn(`[live-quote] Alpaca did not answer for ${wanted.length} symbols — falling back to Finnhub: ${alpacaSaid}`);
  }

  const missing = wanted.filter((s) => !out[s]);
  await Promise.all(
    missing.map(async (symbol) => {
      out[symbol] = await fromFinnhub(symbol, opts.caller, alpacaSaid ?? `Alpaca has no price for ${symbol}`);
    }),
  );
  return out;
}

/** One symbol. See `getLiveQuotes`. */
export async function getLiveQuote(
  symbol: string,
  opts: { caller: QuoteCaller; creds?: AlpacaCredentials; now?: Date },
): Promise<LiveQuoteResult> {
  return (await getLiveQuotes([symbol], opts))[symbol.toUpperCase()] ?? { quote: null, error: "no quote" };
}
