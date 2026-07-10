/**
 * stock-info — per-ticker identity (company name + exchange) from OUR DB.
 *
 * The company name and exchange are static identity data, not live market
 * data — they must never require a provider round-trip to render a header.
 * `getStockInfo` reads the StockInfo cache table and lazily populates it from
 * the Finnhub profile on first touch (or when the row has gone stale). Every
 * surface that shows "Analog Devices Inc · ADI · NASDAQ" reads this; only
 * genuinely live data (price, consensus) is fetched fresh.
 */
import { prisma } from "@/lib/prisma";
import { getStockProfile } from "@/lib/actions/finnhub.actions";

export interface StockIdentity {
  ticker: string;
  companyName: string;
  exchange: string | null;
}

// Identity data barely changes — refresh monthly (renames, exchange moves).
const STALE_MS = 30 * 86_400_000;

/**
 * Finnhub returns verbose venue strings ("NASDAQ NMS - GLOBAL MARKET",
 * "NEW YORK STOCK EXCHANGE, INC."). Normalize to the short form users
 * actually recognize. Unknown venues pass through unchanged.
 */
export function normalizeExchange(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase();
  if (s.includes("NASDAQ")) return "NASDAQ";
  if (s.includes("NEW YORK STOCK EXCHANGE")) return "NYSE";
  if (s.includes("NYSE ARCA")) return "NYSE ARCA";
  if (s.startsWith("NYSE")) return "NYSE";
  if (s.includes("CBOE")) return "CBOE";
  if (s.includes("OTC")) return "OTC";
  return raw;
}

/**
 * Identity for one ticker. DB-first; on a miss (or stale row) fetches the
 * Finnhub profile once and upserts. Falls back to the stale row — and finally
 * to the bare ticker — when the provider fails, so callers always get a
 * usable identity and never need their own fallback logic.
 */
export async function getStockInfo(ticker: string): Promise<StockIdentity> {
  const T = ticker.toUpperCase();
  const row = await prisma.stockInfo
    .findUnique({ where: { ticker: T } })
    .catch(() => null);

  if (row && Date.now() - row.updatedAt.getTime() < STALE_MS) {
    return { ticker: T, companyName: row.companyName, exchange: row.exchange };
  }

  const profile = await getStockProfile(T).catch(() => null);
  if (!profile?.name) {
    // Provider failed — a stale name beats no name; a bare ticker beats nothing.
    return row
      ? { ticker: T, companyName: row.companyName, exchange: row.exchange }
      : { ticker: T, companyName: T, exchange: null };
  }

  const companyName = profile.name;
  const exchange = normalizeExchange(profile.exchange);
  await prisma.stockInfo
    .upsert({
      where: { ticker: T },
      update: { companyName, exchange },
      create: { ticker: T, companyName, exchange },
    })
    .catch(() => {
      /* cache write failure is non-fatal — we still have the identity */
    });
  return { ticker: T, companyName, exchange };
}
