/**
 * Buying and selling by hand — the Trade button.
 *
 * A manual order is staged exactly as an agent's proposal is (the same Order
 * and Position rows, the same idempotency key) and then approved on the spot
 * through `approveProposal`, the path every approved proposal already takes.
 * So nothing about sending it is new: the sale lock, the "most in one stock"
 * check on adds, the Alpaca submit, the fill (reconcile-orders) and the
 * thesis flip are the ones that run today. What's here is reading what the
 * account holds and staging the rows.
 *
 * Nothing the dialog sends is trusted: the lanes are read again and the order
 * is checked against the live price before anything is written.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getLiveQuote } from "@/lib/market-data/live-quote";
import { freshQuotePrice } from "@/lib/market-data/quote-age";
import { isMarketOpen } from "@/lib/market-hours";
import { positionTotalCap } from "@/lib/agent/position-sizing";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import {
  approveProposal,
  findRelatedThesisId,
  ProposalExecutionError,
} from "@/lib/proposals/execute";
import { PROPOSAL_TTL_MS } from "@/lib/proposals/maybe-await-approval";
import {
  addRoom,
  planManualOrder,
  type ManualOrderInput,
  type TradeLane,
} from "@/lib/trading/manual-order-rules";

export type Environment = "PAPER" | "LIVE";

export interface TradeTicket {
  ticker: string;
  environment: Environment;
  price: number | null;
  /** ISO time the price printed. */
  priceAt: string | null;
  /** A quote from the last 15 minutes while the market is open. */
  priceLive: boolean;
  marketOpen: boolean;
  lanes: TradeLane[];
}

const MANUAL_RATIONALE = "Placed by you from the Trade button.";

async function livePrice(ticker: string, userId: string, environment: Environment) {
  const creds = (await resolveAlpacaCredentials(userId, environment)) ?? undefined;
  const { quote } = await getLiveQuote(ticker, { caller: "other", creds });
  const now = new Date();
  const price = quote && quote.c > 0 ? quote.c : null;
  return {
    price,
    priceAt: quote ? new Date(quote.t * 1000).toISOString() : null,
    priceLive: isMarketOpen(now) && freshQuotePrice(quote, now) != null,
  };
}

/**
 * Every analyst with a side in this stock: the ones holding it, and the ones
 * watching it with a LONG thesis. Long positions only — a short is not
 * something this button sells.
 */
async function loadLanes(opts: {
  accountId: string;
  ticker: string;
  environment: Environment;
  price: number | null;
}): Promise<TradeLane[]> {
  const { accountId, ticker, environment, price } = opts;
  const [positions, staged, theses] = await Promise.all([
    prisma.position.findMany({
      where: { accountId, symbol: ticker, environment, status: "OPEN", direction: "LONG" },
      orderBy: { openedAt: "asc" },
      select: {
        id: true,
        quantity: true,
        avgCost: true,
        analystId: true,
        analyst: { select: { name: true, maxPositionSize: true, maxPositionTotal: true } },
        orders: {
          where: { status: "PENDING", intent: { in: ["ADD", "CLOSE", "PARTIAL_CLOSE"] } },
          select: { intent: true, quantity: true },
        },
      },
    }),
    prisma.position.findMany({
      where: { accountId, symbol: ticker, environment, status: "PENDING_APPROVAL" },
      select: { analystId: true },
    }),
    prisma.thesis.findMany({
      where: { accountId, ticker, status: "WATCHING", direction: "LONG" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        targetPrice: true,
        stopLoss: true,
        researchRun: { select: { agentConfigId: true, agentConfig: { select: { name: true } } } },
      },
    }),
  ]);

  const lanes = new Map<string, TradeLane>();
  for (const p of positions) {
    if (lanes.has(p.analystId)) continue; // one holding per analyst; the oldest
    const cap = positionTotalCap({
      maxPositionSize: p.analyst.maxPositionSize,
      maxPositionTotal: p.analyst.maxPositionTotal,
    });
    const sentAdds = p.orders.filter((o) => o.intent === "ADD").reduce((n, o) => n + o.quantity, 0);
    const sentSale = p.orders.find((o) => o.intent === "CLOSE" || o.intent === "PARTIAL_CLOSE");
    lanes.set(p.analystId, {
      analystId: p.analystId,
      analystName: p.analyst.name,
      position: { id: p.id, shares: p.quantity, avgCost: p.avgCost },
      sellBlocked: sentSale
        ? `A sale of ${ticker} is already with Alpaca — wait for it to fill.`
        : null,
      buy:
        price == null
          ? { kind: "NONE", reason: "There's no price for this stock right now." }
          : {
              kind: "ADD",
              cap,
              maxShares: addRoom({ cap, heldShares: p.quantity, avgCost: p.avgCost, sentShares: sentAdds, price }),
            },
    });
  }

  const waitingBuy = new Set(staged.map((s) => s.analystId));
  for (const t of theses) {
    const analystId = t.researchRun?.agentConfigId;
    if (!analystId || lanes.has(analystId)) continue;
    lanes.set(analystId, {
      analystId,
      analystName: t.researchRun.agentConfig?.name ?? "Analyst",
      position: null,
      sellBlocked: null,
      buy: waitingBuy.has(analystId)
        ? { kind: "NONE", reason: `A buy of ${ticker} is already waiting for your approval — review it instead.` }
        : { kind: "OPEN", thesisId: t.id, targetPrice: t.targetPrice, stopLoss: t.stopLoss },
    });
  }
  return [...lanes.values()];
}

export async function getTradeTicket(opts: {
  userId: string;
  accountId: string;
  ticker: string;
  environment: Environment;
}): Promise<TradeTicket> {
  const ticker = opts.ticker.toUpperCase();
  const quote = await livePrice(ticker, opts.userId, opts.environment);
  const lanes = await loadLanes({ ...opts, ticker, price: quote.price });
  return { ticker, environment: opts.environment, marketOpen: isMarketOpen(), ...quote, lanes };
}

export type ManualOrderResult =
  | {
      ok: true;
      intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
      /** The shares Alpaca was sent. */
      shares: number;
      orderId: string;
      alpacaOrderId: string | null;
      /** Alpaca didn't answer cleanly; the order is recovered by reconcile within ~5 min. */
      unconfirmed: boolean;
    }
  | { ok: false; error: string };

export async function placeManualOrder(opts: {
  userId: string;
  accountId: string;
  environment: Environment;
  ticker: string;
  analystId: string;
  order: ManualOrderInput;
}): Promise<ManualOrderResult> {
  const ticker = opts.ticker.toUpperCase();
  const { environment } = opts;

  // A live order goes out on live keys or not at all — never on the paper
  // keys a missing credential would fall back to.
  if (environment === "LIVE" && !(await resolveAlpacaCredentials(opts.userId, "LIVE"))) {
    return { ok: false, error: "No live Alpaca keys on this account — add them in Settings." };
  }

  const quote = await livePrice(ticker, opts.userId, environment);
  if (quote.price == null) return { ok: false, error: `There's no price for ${ticker} right now.` };
  const lanes = await loadLanes({ accountId: opts.accountId, ticker, environment, price: quote.price });
  const lane = lanes.find((l) => l.analystId === opts.analystId);
  if (!lane) return { ok: false, error: `That analyst neither holds nor watches ${ticker}.` };

  const plan = planManualOrder(lane, opts.order, quote.price);
  if (!plan.ok) return plan;

  const idempotencyKey = randomUUID();
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
  const now = new Date();

  // ── Stage the rows, as a proposal would be ─────────────────────────────────
  let orderId: string;
  if (plan.intent === "OPEN") {
    if (lane.buy.kind !== "OPEN") return { ok: false, error: "This analyst can't open a new holding here." };
    const thesisId = lane.buy.thesisId;
    const stop = opts.order.stopLoss!;
    const target = opts.order.targetPrice!;
    orderId = await prisma.$transaction(async (tx) => {
      const pos = await tx.position.create({
        data: {
          analystId: lane.analystId,
          userId: opts.userId,
          accountId: opts.accountId,
          environment,
          symbol: ticker,
          direction: "LONG",
          status: "PENDING_APPROVAL",
          quantity: plan.shares,
          avgCost: quote.price!,
          targetPrice: target,
          stopLoss: stop,
          initialStop: stop,
          exitStrategy: "MANUAL",
          initialQty: plan.shares,
        },
      });
      const ord = await tx.order.create({
        data: {
          positionId: pos.id,
          userId: opts.userId,
          environment,
          symbol: ticker,
          side: "BUY",
          orderType: "MARKET",
          quantity: plan.shares,
          status: "AWAITING_APPROVAL",
          idempotencyKey,
          intent: "OPEN",
          thesisId,
          expiresAt,
          rationale: MANUAL_RATIONALE,
        },
      });
      await tx.positionEvent.create({
        data: {
          positionId: pos.id,
          eventType: "OPENED",
          description: `Manual buy: LONG ${plan.shares} shares of ${ticker} at ~$${quote.price!.toFixed(2)} (idem=${idempotencyKey.slice(0, 8)})`,
          priceAt: quote.price!,
        },
      });
      return ord.id;
    });
  } else {
    const pos = lane.position;
    if (!pos) return { ok: false, error: `${lane.analystName} holds no shares of ${ticker}.` };
    const isSale = plan.intent === "CLOSE" || plan.intent === "PARTIAL_CLOSE";
    const thesisId = await findRelatedThesisId(lane.analystId, ticker).catch(() => null);
    const ord = await prisma.order.create({
      data: {
        positionId: pos.id,
        userId: opts.userId,
        environment,
        symbol: ticker,
        side: isSale ? "SELL" : "BUY",
        orderType: "MARKET",
        quantity: plan.shares,
        status: "AWAITING_APPROVAL",
        idempotencyKey,
        intent: plan.intent,
        ...(isSale ? { closeReason: "MANUAL", closeSource: "user" } : {}),
        thesisId,
        expiresAt,
        rationale: MANUAL_RATIONALE,
      },
    });
    orderId = ord.id;
  }

  // ── Send it: the approval path every proposal takes ────────────────────────
  try {
    const result = await approveProposal(orderId, opts.userId);
    const sent = await prisma.order.findUnique({ where: { id: orderId }, select: { quantity: true } });
    return {
      ok: true,
      intent: plan.intent,
      shares: sent?.quantity ?? plan.shares,
      orderId,
      alpacaOrderId: result.alpacaOrderId,
      unconfirmed: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Sent, but Alpaca didn't answer cleanly — the order stays PENDING and
    // reconcile-orders finds it by its idempotency key. Not a failure.
    if (err instanceof ProposalExecutionError && err.code === "ALPACA_UNCERTAIN") {
      return { ok: true, intent: plan.intent, shares: plan.shares, orderId, alpacaOrderId: null, unconfirmed: true };
    }
    // Anything else left the staged rows unsent: take them down, so no
    // proposal you never asked for is left in the queue.
    await prisma.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { id: orderId, status: "AWAITING_APPROVAL" },
        data: { status: "CANCELLED", alpacaConfirmedAt: now, rejectionMessage: `Manual order not sent: ${message}` },
      });
      if (plan.intent === "OPEN") {
        const ord = await tx.order.findUnique({ where: { id: orderId }, select: { positionId: true } });
        if (ord) {
          await tx.position.updateMany({
            where: { id: ord.positionId, status: "PENDING_APPROVAL" },
            data: { status: "CANCELLED", closedAt: now, closeReason: "MANUAL" },
          });
        }
      }
    });
    return { ok: false, error: message };
  }
}
