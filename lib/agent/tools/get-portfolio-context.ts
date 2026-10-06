/**
 * get_portfolio_context — the account as it stands: every open position with
 * its live price, gain and stop, the cash, the equity, the open risk against
 * the limit and the market line. One shape for every caller: with an analyst
 * in the run it covers that analyst's positions; with none (the chat when no
 * analyst is selected) it covers the account, each position names its
 * analyst, and the latest end-of-day digest comes with it.
 *
 * The stop and target are the thesis's: the position row's copy can lag a
 * moved floor (MU on 2026-10-05: 969 on the position, 1048 on the plan).
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { loadAccountRisk } from "@/lib/agent/load-account-risk";
import { heatLine } from "@/lib/agent/portfolio-risk";
import { prisma } from "@/lib/prisma";
import { getLatestPricesWithMeta, getAccount, type PriceLookup } from "@/lib/alpaca";
import { readPrice } from "@/lib/market-data/quote-age";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

interface PositionDetail {
  positionId: string;
  symbol: string;
  /** The analyst that holds it. */
  analyst: string | null;
  direction: string;
  qty: number;
  initialQty: number;
  avgCost: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  daysHeld: number;
  targetPrice: number | null;
  stopLoss: number | null;
  exitStrategy: string | null;
  trailPct: number | null;
  peakPrice: number | null;
  distanceFromPeak: number | null;
  /** When `currentPrice` printed (ISO). Null when there was no live price. */
  priceAsOf: string | null;
  /** Plain words when `currentPrice` is missing or old; absent when it is live. */
  priceWarning?: string;
  thesis: { id: string; reasoning: string; confidence: number; signalTypes: string[]; status: string } | null;
}

interface CapitalSummary {
  totalEquity: number;
  cash: number;
  buyingPower: number;
  deployedCapital: number;
  deployedPct: number;
  openPositionCount: number;
  /** The analyst's position limit; null for the whole account. */
  maxPositions: number | null;
  slotsRemaining: number | null;
}

type PortfolioContextData = {
  positions: PositionDetail[];
  capitalSummary: CapitalSummary | null;
  summaryLines: string[];
  tickers: { ticker: string; tag: string; summary: string }[];
  /**
   * Account-wide book lines (DAV-251): open risk vs the 6% cap, the market.
   * Inputs for the run's judgment, never gates. Absent when unreadable.
   */
  book: { openRiskPct: number | null; market: string | null; lines: string[] };
  /** The latest end-of-day portfolio digest for this book; whole-account reads only. */
  digest: { date: string; narrative: string } | null;
};

export const getPortfolioContext = defineTool({
  description:
    "Open positions with live price, gain, days held, distance from peak, stop and target; cash, equity, open risk and the market line. " +
    "Covers the run's analyst, or with none selected the whole account, naming each position's analyst, plus the daily digest.",
  schema: z.object({
    include_thesis: z
      .boolean()
      .default(true)
      .describe("Whether to include the original thesis reasoning for each position"),
  }),
  ui: "tool-ui" as const,

  progressLabel: () => "Checking live portfolio P&L and exit levels",

  execute: async (args, ctx) => {
    const analystId = ctx.analystId ?? null;
    const runEnvironment = ctx.runEnvironment ?? "PAPER";
    const creds =
      ctx.alpacaCreds ??
      (await resolveAlpacaCredentials(ctx.userId, runEnvironment)) ??
      undefined;

    // This run's book only. A LIVE run must never see PAPER positions and
    // vice versa — they live in different Alpaca accounts.
    const openPositions = await prisma.position.findMany({
      where: { accountId: ctx.accountId, status: "OPEN", environment: runEnvironment, ...(analystId ? { analystId } : {}) },
      include: { analyst: { select: { name: true } } },
      orderBy: { openedAt: "asc" },
    });

    let lookup: PriceLookup | null = null;
    if (openPositions.length > 0) {
      try {
        lookup = await getLatestPricesWithMeta(openPositions.map((p) => p.symbol), creds);
      } catch { /* every position is then shown at cost, and says so */ }
    }
    const prices = lookup?.prices ?? {};

    // Each position's thesis: its stop and target are the plan's, and its reasoning on request.
    const theses = new Map<string, { id: string; snapshot: unknown; scoring: unknown; status: string; stopLoss: number | null; targetPrice: number | null }>();
    for (const pos of openPositions) {
      try {
        const thesis = await prisma.thesis.findFirst({
          where: { ticker: pos.symbol, status: "HOLDING", researchRun: { agentConfigId: pos.analystId } },
          orderBy: { createdAt: "desc" },
          select: { id: true, snapshot: true, scoring: true, status: true, stopLoss: true, targetPrice: true },
        });
        if (thesis) theses.set(pos.id, thesis);
      } catch { /* the position's own levels stand in */ }
    }

    const now = Date.now();
    const positionDetails: PositionDetail[] = openPositions.map((pos) => {
      const currentPrice = prices[pos.symbol] ?? pos.avgCost;
      // How old the price is, in words when it isn't live (quote-age).
      const at = lookup?.asOf[pos.symbol];
      const reading = readPrice({
        ticker: pos.symbol,
        quote: prices[pos.symbol] != null ? { c: prices[pos.symbol], t: at ? new Date(at).getTime() / 1000 : undefined } : null,
        now: new Date(now),
      });
      const priceWarning =
        reading.price == null
          ? `Live price for $${pos.symbol} unavailable — shown at its cost $${pos.avgCost.toFixed(2)}; its P&L and distance from peak are not measured.`
          : reading.warning;
      const isLong = pos.direction === "LONG";
      const unrealizedPnl = isLong
        ? (currentPrice - pos.avgCost) * pos.quantity
        : (pos.avgCost - currentPrice) * pos.quantity;
      const unrealizedPnlPct = pos.avgCost > 0
        ? (isLong
            ? ((currentPrice - pos.avgCost) / pos.avgCost)
            : ((pos.avgCost - currentPrice) / pos.avgCost)) * 100
        : 0;
      const daysHeld = Math.max(0, Math.floor((now - new Date(pos.openedAt).getTime()) / 86_400_000));

      let distanceFromPeak: number | null = null;
      if (pos.peakPrice) {
        distanceFromPeak = isLong
          ? ((currentPrice - pos.peakPrice) / pos.peakPrice) * 100
          : ((pos.peakPrice - currentPrice) / pos.peakPrice) * 100;
      }

      const thesis = theses.get(pos.id) ?? null;
      // PR-9: conviction lives in scoring.composite (/10); the 0-100 shape here is ×10.
      const composite = thesis ? getThesisComposite(thesis as never) : null;
      return {
        positionId: pos.id,
        symbol: pos.symbol,
        analyst: pos.analyst?.name ?? null,
        direction: pos.direction,
        qty: pos.quantity,
        initialQty: pos.initialQty ?? pos.quantity,
        avgCost: pos.avgCost,
        currentPrice,
        unrealizedPnl,
        unrealizedPnlPct: Math.round(unrealizedPnlPct * 100) / 100,
        daysHeld,
        targetPrice: thesis?.targetPrice ?? pos.targetPrice ?? null,
        stopLoss: thesis?.stopLoss ?? pos.stopLoss ?? null,
        exitStrategy: pos.exitStrategy,
        trailPct: pos.trailingStopPct ?? null,
        peakPrice: pos.peakPrice ?? null,
        distanceFromPeak: distanceFromPeak !== null ? Math.round(distanceFromPeak * 100) / 100 : null,
        priceAsOf: reading.asOf,
        ...(priceWarning ? { priceWarning } : {}),
        thesis:
          args.include_thesis && thesis
            ? {
                id: thesis.id,
                reasoning: getThesisSnapshotText(thesis as never),
                confidence: composite != null ? composite * 10 : 0,
                signalTypes: [],
                status: thesis.status,
              }
            : null,
      };
    });

    let capitalSummary: CapitalSummary | null = null;
    try {
      const account = await getAccount(creds);
      const deployedCapital = positionDetails.reduce((sum, p) => sum + p.avgCost * p.qty, 0);
      const totalEquity = parseFloat(account.equity);
      const maxPositions = analystId ? (ctx.maxOpenPositions ?? 5) : null;
      capitalSummary = {
        totalEquity,
        cash: parseFloat(account.cash),
        buyingPower: parseFloat(account.buying_power),
        deployedCapital,
        deployedPct: totalEquity > 0 ? Math.round((deployedCapital / totalEquity) * 100) : 0,
        openPositionCount: openPositions.length,
        maxPositions,
        slotsRemaining: maxPositions != null ? maxPositions - openPositions.length : null,
      };
    } catch { /* non-fatal */ }

    const summaryLines = positionDetails.map((p) => {
      const pnlSign = p.unrealizedPnlPct >= 0 ? "+" : "";
      const peakStr = p.distanceFromPeak !== null ? ` | ${p.distanceFromPeak >= 0 ? "+" : ""}${p.distanceFromPeak}% from peak` : "";
      const stopStr = p.stopLoss != null ? ` | stop $${p.stopLoss}` : " | no stop";
      const who = !analystId && p.analyst ? ` (${p.analyst})` : "";
      return `${p.priceWarning ? `⚠ ${p.priceWarning} ` : ""}${p.symbol}${who} ${p.direction} ${p.qty}sh @ $${p.avgCost.toFixed(2)} | now $${p.currentPrice.toFixed(2)} (${pnlSign}${p.unrealizedPnlPct}%) | ${p.daysHeld}d held${peakStr}${stopStr}`;
    });

    // Ticker rows for UI rendering — portfolio data, not stock data
    const tickers = positionDetails.map((p) => {
      const pnlSign = p.unrealizedPnlPct >= 0 ? "+" : "";
      const peakStr = p.distanceFromPeak !== null ? ` | ${p.distanceFromPeak >= 0 ? "+" : ""}${p.distanceFromPeak}% from peak` : "";
      return {
        ticker: p.symbol,
        tag: p.direction,
        summary: `${p.priceWarning ? "⚠ Price not live · " : ""}$${p.currentPrice.toFixed(2)} (${pnlSign}${p.unrealizedPnlPct}%) | ${p.qty}sh @ $${p.avgCost.toFixed(2)} | ${p.daysHeld}d held${peakStr}`,
      };
    });

    // Account-wide book lines — open risk across every seat, and the market.
    const risk = await loadAccountRisk({
      accountId: ctx.accountId,
      environment: runEnvironment,
      creds,
    }).catch(() => null);
    const market = risk?.regime?.line ?? null;
    const bookLines = [
      ...(risk?.open && risk.equity ? [heatLine(risk.open, risk.equity)] : []),
      ...(market ? [market] : []),
    ];

    // The latest end-of-day digest for this book (PAPER and LIVE have one
    // each). It narrates the whole account, other analysts' trades included,
    // so it comes with a read of the whole account only: an analyst's own
    // run does not get it (docs/plans/AGENT_ARCHITECTURE.md, step 3).
    let digest: PortfolioContextData["digest"] = null;
    if (ctx.accountId && !analystId) {
      try {
        const row = await prisma.portfolioDigest.findFirst({
          where: { accountId: ctx.accountId, environment: runEnvironment },
          orderBy: { date: "desc" },
          select: { narrative: true, date: true },
        });
        if (row?.narrative) digest = { date: row.date.toISOString().slice(0, 10), narrative: row.narrative };
      } catch { /* no digest; the rest stands */ }
    }

    const data: PortfolioContextData = {
      positions: positionDetails,
      capitalSummary,
      summaryLines: [...summaryLines, ...bookLines],
      tickers,
      book: { openRiskPct: risk?.open ? Math.round(risk.open.riskPct * 10) / 10 : null, market, lines: bookLines },
      digest,
    };
    return {
      summary:
        positionDetails.filter((p) => p.priceWarning).map((p) => `⚠ ${p.priceWarning} `).join("") +
        (openPositions.length === 0 ? "No open positions" : `Portfolio: ${openPositions.length} open position${openPositions.length !== 1 ? "s" : ""}`) +
        (capitalSummary ? ` | $${capitalSummary.cash.toFixed(0)} cash | ${capitalSummary.deployedPct}% deployed | $${capitalSummary.buyingPower.toFixed(0)} buying power` : "") +
        (bookLines.length ? ` | ${bookLines.join(" ")}` : ""),
      data,
      sources: [],
    };
  },
});
