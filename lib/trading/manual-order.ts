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
import { freshQuotePrice, staleForTrading } from "@/lib/market-data/quote-age";
import { isMarketOpen } from "@/lib/market-hours";
import { positionTotalCap } from "@/lib/agent/position-sizing";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { getAccount } from "@/lib/alpaca";
import {
  approveProposal,
  findRelatedThesisId,
  ProposalExecutionError,
} from "@/lib/proposals/execute";
import { PROPOSAL_TTL_MS } from "@/lib/proposals/maybe-await-approval";
import { addWatchlistItem } from "@/lib/actions/watchlist.actions";
import { sendWriterAfterBuy } from "@/lib/trading/after-buy";
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
  /** The market is open and the quote is older than 15 minutes — no buy acts on it. */
  priceStale: boolean;
  /** The account's cash — what a buy may spend (never margin). Null when it couldn't be read. */
  cash: number | null;
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
    priceStale: price != null && staleForTrading(quote, now),
  };
}

/** Alpaca's `cash` for this book — not `buying_power`, which counts margin. */
export async function accountCash(userId: string, environment: Environment): Promise<number | null> {
  try {
    const creds = (await resolveAlpacaCredentials(userId, environment)) ?? undefined;
    const cash = Number((await getAccount(creds)).cash);
    return Number.isFinite(cash) ? cash : null;
  } catch {
    return null;
  }
}

/**
 * Every analyst on the account, and what a trade does for each: the ones
 * holding the stock (a sale, or an add), the ones watching it (a buy on that
 * thesis), and the rest (a buy that puts it on their watchlist first). Long
 * positions only — a short is not something this button sells. A new holding
 * goes in its analyst's own book (Paper or Live), as every agent buy does:
 * the trigger check and the duplicate check don't tell the books apart, so a
 * paper buy for a live analyst would run as its holding.
 */
async function loadLanes(opts: {
  accountId: string;
  ticker: string;
  environment: Environment;
  price: number | null;
}): Promise<TradeLane[]> {
  const { accountId, ticker, environment, price } = opts;
  const [analysts, positions, staged, theses] = await Promise.all([
    prisma.agentConfig.findMany({
      where: { accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, tradingEnvironment: true },
    }),
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
    // Every WATCHING thesis, newest first: the fill flips the analyst's newest
    // one (armHeldLadderOnFill), so that is the one a buy is staged against.
    prisma.thesis.findMany({
      where: { accountId, ticker, status: "WATCHING" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        direction: true,
        targetPrice: true,
        stopLoss: true,
        researchRun: { select: { agentConfigId: true } },
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
  const bookName = (b: string) => (b === "LIVE" ? "Live" : "Paper");
  const watched = new Map<string, (typeof theses)[number]>();
  for (const t of theses) {
    const id = t.researchRun?.agentConfigId;
    if (id && !watched.has(id)) watched.set(id, t); // newest first
  }
  // Holders first, then the analysts watching it, then everyone else.
  const order = [...analysts].sort((a, b) => Number(watched.has(b.id)) - Number(watched.has(a.id)));
  for (const a of order) {
    if (lanes.has(a.id)) continue;
    const t = watched.get(a.id);
    const book = a.tradingEnvironment === "LIVE" ? "LIVE" : "PAPER";
    lanes.set(a.id, {
      analystId: a.id,
      analystName: a.name,
      position: null,
      sellBlocked: null,
      buy: waitingBuy.has(a.id)
        ? { kind: "NONE", reason: `A buy of ${ticker} is already waiting for your approval — review it instead.` }
        : book !== environment
          ? { kind: "NONE", reason: `${a.name} trades on ${bookName(book)}. Switch to ${bookName(book)} to buy ${ticker} for it.` }
          : t?.direction === "SHORT"
            ? { kind: "NONE", reason: `${a.name}'s view on ${ticker} is short.` }
            : {
                kind: "OPEN",
                thesisId: t?.id ?? null,
                needsResearch: t?.direction !== "LONG",
                targetPrice: t?.targetPrice ?? null,
                stopLoss: t?.stopLoss ?? null,
              },
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
  const [quote, cash] = await Promise.all([
    livePrice(ticker, opts.userId, opts.environment),
    accountCash(opts.userId, opts.environment),
  ]);
  const lanes = await loadLanes({ ...opts, ticker, price: quote.price });
  return { ticker, environment: opts.environment, marketOpen: isMarketOpen(), ...quote, cash, lanes };
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
      /** The writer was sent to fill the new holding's missing view, floor or target. */
      researchStarted: boolean;
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
  if (!lane) return { ok: false, error: "That analyst isn't on this account." };

  const cash = opts.order.side === "BUY" ? await accountCash(opts.userId, environment) : null;
  const plan = planManualOrder(lane, opts.order, { price: quote.price, stale: quote.priceStale, cash });
  if (!plan.ok) return plan;

  const idempotencyKey = randomUUID();
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);
  const now = new Date();

  // ── Stage the rows, as a proposal would be ─────────────────────────────────
  let orderId: string;
  /** The seed this buy turned LONG — put back if the buy doesn't go. */
  let madeLong: string | null = null;
  /** The thesis a new holding lands on. */
  let openedThesisId: string | null = null;
  const undoLong = async () => {
    if (!madeLong) return;
    await prisma.thesis
      .updateMany({ where: { id: madeLong, status: "WATCHING", direction: "LONG" }, data: { direction: null } })
      .catch(() => null);
  };
  if (plan.intent === "OPEN") {
    if (lane.buy.kind !== "OPEN") return { ok: false, error: "This analyst can't open a new holding here." };
    // Not watched yet: it goes on the analyst's watchlist first — the same
    // seed the watchlist's Add makes — so the buy has a thesis to land on.
    let thesisId = lane.buy.thesisId;
    if (thesisId == null) {
      const seed = await addWatchlistItem(lane.analystId, ticker, "Bought by hand from the Trade button", "USER");
      thesisId = seed.id;
    }
    // No view yet: we bought it long, so that is its direction (the fill arms
    // a long ladder from it). The belief and the plan are the writer's,
    // sent once the buy lands.
    if (lane.buy.needsResearch) {
      const made = await prisma.thesis.updateMany({
        where: { id: thesisId, status: "WATCHING", direction: null },
        data: { direction: "LONG" },
      });
      madeLong = made.count > 0 ? thesisId : null;
    }
    const stop = opts.order.stopLoss ?? null;
    const target = opts.order.targetPrice ?? null;
    const staged = await prisma.$transaction(async (tx) => {
      // One new holding per analyst and stock. Two requests at once (two tabs,
      // a retry racing a slow first try) queue on this lock, and the second
      // finds the first's position — the same rule place_trade applies.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`manual-open:${lane.analystId}:${ticker}`}))`;
      const existing = await tx.position.count({
        where: { analystId: lane.analystId, symbol: ticker, status: { in: ["OPEN", "PENDING_APPROVAL"] } },
      });
      if (existing > 0) return null;
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
          thesisId: thesisId!,
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
    }).catch(async (err: unknown) => {
      // Nothing was staged: put the seed's direction back before saying so.
      await undoLong();
      throw err;
    });
    openedThesisId = thesisId;
    if (!staged) {
      await undoLong();
      return { ok: false, error: `${lane.analystName} already holds ${ticker} or has a buy of it in flight. Reload and try again.` };
    }
    orderId = staged;
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

  // The shares the order went out with — approval can shrink an add to the
  // room left, or a trim to what's still held.
  const sentShares = async () =>
    (await prisma.order
      .findUnique({ where: { id: orderId }, select: { quantity: true } })
      .catch(() => null))?.quantity ?? plan.shares;

  // After a new holding lands, the writer fills a missing view, floor or
  // target (lib/trading/after-buy.ts). A failed dispatch never fails the trade.
  const startResearch = async (): Promise<boolean> =>
    plan.intent === "OPEN" && openedThesisId
      ? sendWriterAfterBuy({
          userId: opts.userId,
          accountId: opts.accountId,
          analystId: lane.analystId,
          environment,
          ticker,
          thesisId: openedThesisId,
          noView: madeLong != null,
        }).catch(() => false)
      : false;

  // ── Send it: the approval path every proposal takes ────────────────────────
  try {
    const result = await approveProposal(orderId, opts.userId);
    return {
      ok: true,
      intent: plan.intent,
      shares: await sentShares(),
      orderId,
      alpacaOrderId: result.alpacaOrderId,
      unconfirmed: false,
      researchStarted: await startResearch(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Sent, but something after the submit failed (Alpaca didn't answer
    // cleanly, or a write after it threw) — the order is PENDING and
    // reconcile-orders finds it by its idempotency key. Never report a sent
    // order as failed: you'd place it again.
    const after = await prisma.order
      .findUnique({ where: { id: orderId }, select: { status: true } })
      .catch(() => null);
    const sent =
      (err instanceof ProposalExecutionError && err.code === "ALPACA_UNCERTAIN") ||
      after?.status === "PENDING" ||
      after?.status === "FILLED";
    if (sent) {
      return {
        ok: true,
        intent: plan.intent,
        shares: await sentShares(),
        orderId,
        alpacaOrderId: null,
        unconfirmed: true,
        researchStarted: await startResearch(),
      };
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
    await undoLong();
    return { ok: false, error: message };
  }
}
