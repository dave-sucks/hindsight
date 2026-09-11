/**
 * load-account-risk.ts — gather what the sizing lines need for one account:
 * equity, every open position with its stop and industry, open risk, and the
 * regime. Server-only (Prisma, Alpaca, Finnhub). Fail-open: any piece that
 * can't be read comes back null and its line is simply not written — sizing
 * info never blocks a trade.
 */

import { prisma } from "@/lib/prisma";
import { getAccount, getLatestPrices, type AlpacaCredentials } from "@/lib/alpaca";
import { finnhub } from "@/lib/agent/research-helpers";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import { computeRegime, type RegimeReading } from "@/lib/agent/regime";
import { openRisk, type OpenRisk, type RiskHolding } from "@/lib/agent/portfolio-risk";

export interface AccountRisk {
  equity: number | null;
  holdings: RiskHolding[];
  open: OpenRisk | null;
  regime: RegimeReading | null;
}

/** Finnhub's industry label for a symbol (profile2, slow-moving, cached upstream). */
export async function industryOf(symbol: string): Promise<string | null> {
  const r = await finnhub(`/stock/profile2?symbol=${symbol}`, 1).catch(() => null);
  const ind = (r?.data as { finnhubIndustry?: string } | null)?.finnhubIndustry;
  return typeof ind === "string" && ind.trim() ? ind.trim() : null;
}

export async function loadAccountRisk(opts: {
  accountId: string | null | undefined;
  environment: string;
  creds?: AlpacaCredentials;
}): Promise<AccountRisk> {
  const empty: AccountRisk = { equity: null, holdings: [], open: null, regime: null };
  if (!opts.accountId) return empty;

  const [account, positions] = await Promise.all([
    getAccount(opts.creds).catch(() => null),
    prisma.position.findMany({
      where: { accountId: opts.accountId, environment: opts.environment, status: "OPEN" },
      select: { analystId: true, symbol: true, direction: true, quantity: true, avgCost: true, stopLoss: true },
    }),
  ]);
  const equity = account ? parseFloat(account.equity) : null;

  const symbols = Array.from(new Set(positions.map((p) => p.symbol)));
  const [prices, theses, industries, snapshots] = await Promise.all([
    symbols.length ? getLatestPrices(symbols, opts.creds).catch(() => ({}) as Record<string, number>) : Promise.resolve({} as Record<string, number>),
    symbols.length
      ? prisma.thesis.findMany({
          where: { ticker: { in: symbols }, status: "HOLDING" },
          select: { ticker: true, stopLoss: true, researchRun: { select: { agentConfigId: true } } },
        })
      : Promise.resolve([]),
    Promise.all(symbols.map(async (s) => [s, await industryOf(s)] as const)),
    loadIndicatorSnapshots(["SPY", ...symbols]).catch(() => new Map()),
  ]);
  const industryBySymbol = new Map(industries);
  const floorOf = (analystId: string, symbol: string) =>
    theses.find((t) => t.ticker === symbol && t.researchRun.agentConfigId === analystId)?.stopLoss ?? null;

  const holdings: RiskHolding[] = positions.map((p) => ({
    symbol: p.symbol,
    direction: p.direction,
    qty: p.quantity,
    price: prices[p.symbol] ?? p.avgCost,
    stop: floorOf(p.analystId, p.symbol) ?? p.stopLoss ?? null,
    industry: industryBySymbol.get(p.symbol) ?? null,
  }));

  const regime = computeRegime(
    snapshots.get("SPY") ?? null,
    symbols.map((s) => snapshots.get(s)).filter((x): x is NonNullable<typeof x> => !!x),
  );

  return {
    equity,
    holdings,
    open: equity != null ? openRisk(holdings, equity) : null,
    regime,
  };
}
