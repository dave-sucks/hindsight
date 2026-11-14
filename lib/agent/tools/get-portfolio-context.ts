/**
 * get_portfolio_context — the account as it stands: every open position with
 * its price, its day, its gain and its stop, the account's value, cash, day
 * and lifetime, the open risk against the limit and the market line. One
 * shape for every caller: with an analyst in the run it covers that analyst's
 * positions; with none (the chat when no analyst is selected) it covers the
 * account and each position names its analyst.
 *
 * Every number the portfolio snapshot has is the snapshot's
 * (lib/portfolio/load-snapshot.ts), the one every request's Market and
 * portfolio block prints (lib/agent/portfolio-block.ts), so the two can't
 * disagree. The account's value used to be the broker's equity, which marks
 * holdings at after-hours trades: at 10 PM on Nov 11 it had CEG at $271.81
 * while the block had its $274.73 close. Read here, because the snapshot
 * doesn't carry them: the stop and target, days held, the distance from the
 * peak (at the snapshot's price), buying power, the open risk (on the
 * snapshot's value and prices) and each analyst's room.
 *
 * The stop and target are the thesis's: the position row's copy can lag a
 * moved floor (MU on 2026-10-05: 969 on the position, 1048 on the plan).
 * A read of the account adds each analyst's slots and limits, so a question
 * about the whole book (what to sell to free cash) needs no second read.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { loadAccountRisk } from "@/lib/agent/load-account-risk";
import { heatLine } from "@/lib/agent/portfolio-risk";
import { prisma } from "@/lib/prisma";
import { getAccount } from "@/lib/alpaca";
import { readPrice } from "@/lib/market-data/quote-age";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { analystRoomLines } from "@/lib/agent/analyst-scope";
import { getThesisSnapshotText } from "@/lib/agent/thesis-narrative";
import { loadPortfolioSnapshot } from "@/lib/portfolio/load-snapshot";
import { snapshotWhen, type HoldingLine, type PortfolioSnapshot } from "@/lib/portfolio/snapshot";

type Change = { dollars: number; pct: number };

interface PositionDetail {
  positionId: string;
  symbol: string;
  /** The analyst that holds it. */
  analyst: string | null;
  direction: string;
  qty: number;
  initialQty: number;
  avgCost: number;
  /** The snapshot's price: the latest trade in the session, the close outside it. Null when it has none. */
  currentPrice: number | null;
  /** The position at that price, and its share of the account (%). */
  value: number | null;
  sharePct: number | null;
  /** The stock's move on the snapshot's day, against the prior close (%). */
  dayMovePct: number | null;
  /** What these shares made that day, its buys and sales included. Null when another analyst holds the stock too. */
  dayPnl: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  daysHeld: number;
  targetPrice: number | null;
  stopLoss: number | null;
  exitStrategy: string | null;
  trailPct: number | null;
  peakPrice: number | null;
  distanceFromPeak: number | null;
  /** When `currentPrice` printed (ISO). Null when there is no price. */
  priceAsOf: string | null;
  /** Plain words when `currentPrice` is missing or old; absent when it is current. */
  priceWarning?: string;
  thesis: { id: string; reasoning: string; status: string } | null;
}

interface CapitalSummary {
  /** When the prices are from: "Wed, Nov 11 at the close", or the time while the market is open. */
  pricesAt: string;
  totalEquity: number;
  cash: number;
  /** The account's day against the prior close. Null when a price it needs is missing. */
  dayChange: Change | null;
  /** The value less the money put in. Null when the transfers couldn't be read. */
  lifetime: (Change & { contributed: number }) | null;
  /** The broker's. Null when the broker couldn't be read. */
  buyingPower: number | null;
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
};

const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
const signed = (n: number | null) => (n == null ? "unknown" : `${n >= 0 ? "+" : ""}${n}%`);

/**
 * One position's numbers from the snapshot's line for its stock. The line is
 * the broker's whole holding, so it is this position's own when no other
 * analyst holds the stock; when one does, the value and gain are this
 * position's shares at the snapshot's price, and the day's dollars aren't split.
 */
function fromSnapshot(pos: { quantity: number; avgCost: number; direction: string }, line: HoldingLine | undefined, accountValue: number) {
  const price = line?.price ?? null;
  if (!line || price == null) return { price, value: null, share: null, move: null, dayPnl: null, gain: null };
  if (Math.abs(line.shares) === pos.quantity) {
    return { price, value: line.value, share: line.share, move: line.move, dayPnl: line.dayDollars, gain: line.sinceBought };
  }
  const sign = pos.direction === "SHORT" ? -1 : 1;
  const value = sign * pos.quantity * price;
  const gain = pos.avgCost > 0 ? { dollars: sign * pos.quantity * (price - pos.avgCost), pct: (sign * (price - pos.avgCost) / pos.avgCost) * 100 } : null;
  return { price, value, share: accountValue > 0 ? (value / accountValue) * 100 : null, move: line.move, dayPnl: null, gain };
}

export const getPortfolioContext = defineTool({
  description:
    "Open positions with price, day's move, gain, days held, distance from peak, stop and target; " +
    "the account's value, cash, day and lifetime (the portfolio snapshot's numbers), buying power, open risk and the market line. " +
    "Covers the run's analyst, or with none selected the whole account, naming each position's analyst.",
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
    const [openPositions, snapshot, account] = await Promise.all([
      prisma.position.findMany({
        where: { accountId: ctx.accountId, status: "OPEN", environment: runEnvironment, ...(analystId ? { analystId } : {}) },
        include: { analyst: { select: { name: true } } },
        orderBy: { openedAt: "asc" },
      }),
      loadPortfolioSnapshot({ accountId: ctx.accountId, environment: runEnvironment }).catch((err): PortfolioSnapshot | null => {
        console.warn(`[get_portfolio_context] the snapshot couldn't be read: ${err instanceof Error ? err.message : err}`);
        return null;
      }),
      // Buying power is the broker's alone.
      getAccount(creds).catch(() => null),
    ]);
    const holdingOf = new Map((snapshot?.holdings ?? []).map((h) => [h.ticker, h]));

    // Each position's thesis: its stop and target are the plan's, and its reasoning on request.
    const theses = new Map<string, { id: string; snapshot: unknown; status: string; stopLoss: number | null; targetPrice: number | null }>();
    for (const pos of openPositions) {
      try {
        const thesis = await prisma.thesis.findFirst({
          where: { ticker: pos.symbol, status: "HOLDING", researchRun: { agentConfigId: pos.analystId } },
          orderBy: { createdAt: "desc" },
          select: { id: true, snapshot: true, status: true, stopLoss: true, targetPrice: true },
        });
        if (thesis) theses.set(pos.id, thesis);
      } catch { /* the position's own levels stand in */ }
    }

    const now = new Date();
    const positionDetails: PositionDetail[] = openPositions.map((pos) => {
      const line = holdingOf.get(pos.symbol.toUpperCase());
      const n = fromSnapshot(pos, line, snapshot?.value ?? 0);
      // How old the price is, in words when it isn't current (quote-age).
      const reading =
        n.price != null ? readPrice({ ticker: pos.symbol, quote: { c: n.price, t: line?.priceAt ? Date.parse(line.priceAt) / 1000 : undefined }, now }) : null;
      const why = !snapshot ? " (the portfolio snapshot couldn't be read)" : !line ? " (the broker's account doesn't hold it)" : "";
      const priceWarning =
        n.price == null ? `No price for $${pos.symbol}${why}: its value, gain and distance from peak are not measured.` : reading?.warning ?? undefined;
      const sign = pos.direction === "SHORT" ? -1 : 1;
      const distanceFromPeak = n.price != null && pos.peakPrice ? ((sign * (n.price - pos.peakPrice)) / pos.peakPrice) * 100 : null;
      const daysHeld = Math.max(0, Math.floor((now.getTime() - new Date(pos.openedAt).getTime()) / 86_400_000));

      const thesis = theses.get(pos.id) ?? null;
      return {
        positionId: pos.id,
        symbol: pos.symbol,
        analyst: pos.analyst?.name ?? null,
        direction: pos.direction,
        qty: pos.quantity,
        initialQty: pos.initialQty ?? pos.quantity,
        avgCost: pos.avgCost,
        currentPrice: n.price,
        value: n.value,
        sharePct: round2(n.share),
        dayMovePct: round2(n.move),
        dayPnl: n.dayPnl,
        unrealizedPnl: n.gain?.dollars ?? null,
        unrealizedPnlPct: round2(n.gain?.pct ?? null),
        daysHeld,
        targetPrice: thesis?.targetPrice ?? pos.targetPrice ?? null,
        stopLoss: thesis?.stopLoss ?? pos.stopLoss ?? null,
        exitStrategy: pos.exitStrategy,
        trailPct: pos.trailingStopPct ?? null,
        peakPrice: pos.peakPrice ?? null,
        distanceFromPeak: round2(distanceFromPeak),
        priceAsOf: reading?.asOf ?? null,
        ...(priceWarning ? { priceWarning } : {}),
        thesis:
          args.include_thesis && thesis
            ? {
                id: thesis.id,
                reasoning: getThesisSnapshotText(thesis as never),
                status: thesis.status,
              }
            : null,
      };
    });

    let capitalSummary: CapitalSummary | null = null;
    if (snapshot) {
      const deployedCapital = positionDetails.reduce((sum, p) => sum + p.avgCost * p.qty, 0);
      const maxPositions = analystId ? (ctx.maxOpenPositions ?? 5) : null;
      capitalSummary = {
        pricesAt: snapshotWhen(snapshot),
        totalEquity: snapshot.value,
        cash: snapshot.cash,
        dayChange: snapshot.dayChange,
        lifetime: snapshot.lifetime,
        buyingPower: account ? parseFloat(account.buying_power) : null,
        deployedCapital,
        deployedPct: snapshot.value > 0 ? Math.round((deployedCapital / snapshot.value) * 100) : 0,
        openPositionCount: openPositions.length,
        maxPositions,
        slotsRemaining: maxPositions != null ? maxPositions - openPositions.length : null,
      };
    }

    const price = (p: PositionDetail) => (p.currentPrice != null ? `$${p.currentPrice.toFixed(2)}` : "no price");
    const peakStr = (p: PositionDetail) => (p.distanceFromPeak !== null ? ` | ${p.distanceFromPeak >= 0 ? "+" : ""}${p.distanceFromPeak}% from peak` : "");
    const summaryLines = positionDetails.map((p) => {
      const stopStr = p.stopLoss != null ? ` | stop $${p.stopLoss}` : " | no stop";
      const who = !analystId && p.analyst ? ` (${p.analyst})` : "";
      return (
        `${p.priceWarning ? `⚠ ${p.priceWarning} ` : ""}${p.symbol}${who} ${p.direction} ${p.qty}sh @ $${p.avgCost.toFixed(2)} | now ${price(p)}` +
        ` | day ${signed(p.dayMovePct)} | since bought ${signed(p.unrealizedPnlPct)} | ${p.daysHeld}d held${peakStr(p)}${stopStr}`
      );
    });

    // Ticker rows for UI rendering — portfolio data, not stock data
    const tickers = positionDetails.map((p) => ({
      ticker: p.symbol,
      tag: p.direction,
      summary: `${p.priceWarning ? "⚠ Price not current · " : ""}${price(p)} (${signed(p.unrealizedPnlPct)}) | day ${signed(p.dayMovePct)} | ${p.qty}sh @ $${p.avgCost.toFixed(2)} | ${p.daysHeld}d held${peakStr(p)}`,
    }));

    // Account-wide book lines — open risk across every seat, on the snapshot's value and prices, and the market.
    const risk = await loadAccountRisk({
      accountId: ctx.accountId,
      environment: runEnvironment,
      creds,
      ...(snapshot ? { snapshot } : {}),
    }).catch(() => null);
    const market = risk?.regime?.line ?? null;
    const bookLines = [
      ...(risk?.open && risk.equity ? [heatLine(risk.open, risk.equity)] : []),
      ...(market ? [market] : []),
    ];

    // Each analyst holding here or able to buy, its slots counted as place_trade counts them.
    let analystLines: string[] = [];
    if (ctx.accountId && !analystId) {
      try {
        analystLines = await analystRoomLines(ctx.accountId, [...new Set(openPositions.map((p) => p.analystId))]);
      } catch { /* the positions stand without it */ }
    }

    const data: PortfolioContextData = {
      positions: positionDetails,
      capitalSummary,
      summaryLines: [...summaryLines, ...bookLines, ...analystLines],
      tickers,
      book: { openRiskPct: risk?.open ? Math.round(risk.open.riskPct * 10) / 10 : null, market, lines: bookLines },
    };
    const usd = (n: number) => `$${n.toFixed(0)}`;
    const c = capitalSummary;
    return {
      summary:
        positionDetails.filter((p) => p.priceWarning).map((p) => `⚠ ${p.priceWarning} `).join("") +
        (openPositions.length === 0 ? "No open positions" : `Portfolio: ${openPositions.length} open position${openPositions.length !== 1 ? "s" : ""}`) +
        (c
          ? ` | value ${usd(c.totalEquity)}, ${c.pricesAt} | day ${c.dayChange ? signed(round2(c.dayChange.pct)) : "unknown"} | ${usd(c.cash)} cash | ${c.deployedPct}% deployed` +
            (c.buyingPower != null ? ` | ${usd(c.buyingPower)} buying power` : "")
          : " | the account's value and cash couldn't be read") +
        (bookLines.length ? ` | ${bookLines.join(" ")}` : ""),
      data,
      sources: [],
    };
  },
});
