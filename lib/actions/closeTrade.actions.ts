"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  placeMarketOrder,
  getOrder,
  getLatestPrice,
  cancelOrder,
  type AlpacaCredentials,
  type AlpacaOrder,
} from "@/lib/alpaca";
import { inngest } from "@/lib/inngest/client";
import { sendEmail, getUserEmail } from "@/lib/email";
import { getOwnerUserId } from "@/lib/auth/account";
import { tradeClosedHtml } from "@/lib/emails/trade-closed";
import { isInsideMorningBatch } from "@/lib/email-suppression";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClosedPositionResult {
  positionId: string;
  orderId: string;
  alpacaOrderId: string | null;
  closePrice: number;
  realizedPnl: number;
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  fillStatus: "FILLED" | "PENDING";
  placedAt: Date;
  filledAt: Date | null;
}

/** Who triggered the close — determines audit trail source label. */
export type CloseSource = "agent" | "price_monitor" | "user";

// ─── Audit helpers ────────────────────────────────────────────────────────────

function buildCloseReason(
  source: CloseSource,
  reason: "TARGET" | "STOP" | "TIME" | "MANUAL",
  symbol: string,
  closePrice: number,
  stopLoss: number | null,
  targetPrice: number | null,
): string {
  if (source === "price_monitor") {
    if (reason === "TARGET" && targetPrice) {
      return `Target price of $${targetPrice.toFixed(2)} was reached. ${symbol} closed at $${closePrice.toFixed(2)} by the automated price monitor.`;
    }
    if (reason === "STOP" && stopLoss) {
      return `Stop loss at $${stopLoss.toFixed(2)} was hit. ${symbol} closed at $${closePrice.toFixed(2)} by the automated price monitor.`;
    }
    if (reason === "TIME") {
      return `Hold duration expired. ${symbol} closed at $${closePrice.toFixed(2)} by the automated price monitor.`;
    }
    return `${symbol} closed at $${closePrice.toFixed(2)} by the automated price monitor (${reason}).`;
  }
  if (source === "user") {
    return `${symbol} manually closed at $${closePrice.toFixed(2)} via the UI.`;
  }
  return `${symbol} closed at $${closePrice.toFixed(2)} by the agent (${reason}).`;
}

/**
 * Classify an Alpaca submit error — same shape as place_trade.
 *
 *   "rejected"  — 4xx with a definitive "no" (validation, market closed, etc).
 *                 Safe to mark Order REJECTED; Position stays OPEN since we
 *                 never touched it. Caller decides what to do next.
 *   "uncertain" — Network failure, timeout, 5xx. The order may or may not
 *                 have landed. Leave Order PENDING; reconcile-orders will
 *                 look it up by client_order_id.
 *   "missing"   — 404 "position does not exist". Alpaca says there's nothing
 *                 to close; our DB is out of sync. Heartbeat will surface it
 *                 as a stale row — no inline mutation here.
 */
function classifyAlpacaError(err: unknown): "rejected" | "uncertain" | "missing" {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const code = e?.statusCode ?? e?.status;
  const msg = e?.message ?? "";
  if (code === 404 || msg.includes("position does not exist")) return "missing";
  if (typeof code === "number" && code >= 400 && code < 500) return "rejected";
  return "uncertain";
}

// ─── Action ───────────────────────────────────────────────────────────────────

/**
 * Close an open position — DB-first.
 *
 * Lifecycle (mirrors place_trade):
 *   1. Generate idempotencyKey, create PENDING closing Order in DB tx.
 *      Position stays OPEN — we don't mark it CLOSED until Alpaca fills.
 *   2. Submit market order to Alpaca with client_order_id = idempotencyKey.
 *      Three outcomes: ok, rejected (4xx), uncertain (5xx/network/timeout).
 *   3. Poll up to 5s for fill. On fill: mark Order FILLED + Position CLOSED
 *      in a single tx, using the real Alpaca fill price for realized P&L.
 *   4. If still pending after the poll: leave Order PENDING + Position OPEN;
 *      the reconcile-orders cron resolves via alpacaOrderId.
 *
 * Returning a "PENDING" fillStatus is a valid success — callers should not
 * assume the position is closed in the DB until they see fillStatus="FILLED".
 */
export async function closeOpenPosition(
  positionId: string,
  reason: "TARGET" | "STOP" | "TIME" | "MANUAL",
  alpacaCreds?: AlpacaCredentials | null,
  source: CloseSource = "agent",
  auditReason?: string,
  runId?: string,
): Promise<ClosedPositionResult> {
  const position = await prisma.position.findUniqueOrThrow({
    where: { id: positionId },
  });

  if (position.status !== "OPEN") {
    throw new Error(`Position ${positionId} is not OPEN (status: ${position.status})`);
  }

  const positionEnvironment = (position.environment as "PAPER" | "LIVE") ?? "PAPER";
  const creds =
    alpacaCreds ??
    (await resolveAlpacaCredentials(position.userId, positionEnvironment)) ??
    undefined;
  const placedAt = new Date();
  const idempotencyKey = randomUUID();
  const closeSide: "buy" | "sell" = position.direction === "LONG" ? "sell" : "buy";

  // 1. DB tx — create PENDING closing Order. Position stays OPEN.
  const order = await prisma.$transaction(async (tx) => {
    const ord = await tx.order.create({
      data: {
        positionId,
        userId: position.userId,
        environment: positionEnvironment,
        symbol: position.symbol,
        side: closeSide.toUpperCase(),
        orderType: "MARKET",
        quantity: position.quantity,
        status: "PENDING",
        alpacaOrderId: null,
        idempotencyKey,
        intent: "CLOSE",
        createdAt: placedAt,
      },
    });

    await tx.positionEvent.create({
      data: {
        positionId,
        eventType: "PRICE_CHECK",
        description: `Close order submitted (${reason}). Awaiting Alpaca fill (idem=${idempotencyKey.slice(0, 8)}).`,
      },
    });

    return ord;
  });

  // 2. Submit to Alpaca with client_order_id = idempotencyKey.
  let alpacaOrderId: string | null = null;
  try {
    const alpacaOrder = await placeMarketOrder(
      {
        symbol: position.symbol,
        qty: position.quantity,
        side: closeSide,
        clientOrderId: idempotencyKey,
      },
      creds,
    );
    alpacaOrderId = alpacaOrder.id;
    await prisma.order.update({
      where: { id: order.id },
      data: {
        alpacaOrderId,
        alpacaSubmittedAt: placedAt,
        alpacaConfirmedAt: new Date(),
      },
    });
  } catch (submitErr) {
    const outcome = classifyAlpacaError(submitErr);
    const msg = submitErr instanceof Error ? submitErr.message : String(submitErr);

    if (outcome === "rejected") {
      // Definitive 4xx no — the closing order never landed. Leave Position
      // OPEN; just mark the Order REJECTED so we don't carry a phantom
      // PENDING close.
      console.warn(
        `[closeOpenPosition] Alpaca rejected close for ${position.symbol} (idem=${idempotencyKey.slice(0, 8)}): ${msg}`,
      );
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "REJECTED",
          alpacaSubmittedAt: placedAt,
          alpacaConfirmedAt: new Date(),
        },
      });
      throw new Error(`Alpaca rejected close: ${msg}`);
    }

    if (outcome === "missing") {
      // Alpaca has no position. DB is stale — heartbeat will flag it.
      // We do not mutate Position here (per design: detection-only, no
      // inline reconcile). Return the order to REJECTED state so the
      // PENDING close doesn't linger and we don't loop on it.
      console.error(
        `CRITICAL-SYNC-DRIFT [closeOpenPosition] Alpaca has no position for ${position.symbol} but DB row ${positionId} is OPEN. Heartbeat will surface this; no inline mutation. error=${msg}`,
      );
      await prisma.order.update({
        where: { id: order.id },
        data: {
          status: "REJECTED",
          alpacaSubmittedAt: placedAt,
          alpacaConfirmedAt: new Date(),
        },
      });
      throw new Error(
        `Alpaca has no position in ${position.symbol} — DB out of sync. Inspect SyncHealthSnapshot for stale row and reconcile manually.`,
      );
    }

    // Uncertain (5xx / network / timeout). The order may or may not have
    // landed. Leave Order PENDING; reconcile-orders looks it up by
    // client_order_id and adopts whatever Alpaca actually has.
    console.error(
      `CRITICAL-SYNC-UNCERTAIN [closeOpenPosition] Alpaca submit uncertain for ${position.symbol} (idem=${idempotencyKey.slice(0, 8)}): ${msg}. Reconcile will recover via client_order_id.`,
    );
    await prisma.order.update({
      where: { id: order.id },
      data: { alpacaSubmittedAt: placedAt },
    });

    return {
      positionId,
      orderId: order.id,
      alpacaOrderId: null,
      closePrice: 0,
      realizedPnl: 0,
      outcome: "BREAKEVEN",
      fillStatus: "PENDING",
      placedAt,
      filledAt: null,
    };
  }

  // 3. Poll up to 5s for fill.
  let closePrice = 0;
  let didFill = false;
  let filledAt: Date | null = null;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && alpacaOrderId) {
    const probed = await getOrder(alpacaOrderId, creds);
    if (probed.status === "filled" && probed.filled_avg_price) {
      closePrice = parseFloat(probed.filled_avg_price);
      didFill = true;
      filledAt = probed.filled_at ? new Date(probed.filled_at) : new Date();
      break;
    }
    if (["cancelled", "expired", "rejected"].includes(probed.status)) {
      // Alpaca accepted then killed it. Mark Order CANCELLED; Position
      // stays OPEN since the close never executed.
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED", alpacaConfirmedAt: new Date() },
      });
      throw new Error(`Alpaca close order ${probed.status}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }

  // 4a. Still pending — leave Order PENDING + Position OPEN. reconcile-orders
  // will pick this up by alpacaOrderId.
  if (!didFill) {
    try {
      closePrice = await getLatestPrice(position.symbol, creds);
    } catch {
      closePrice = position.avgCost;
    }
    return {
      positionId,
      orderId: order.id,
      alpacaOrderId,
      closePrice,
      realizedPnl: 0,
      outcome: "BREAKEVEN",
      fillStatus: "PENDING",
      placedAt,
      filledAt: null,
    };
  }

  // 4b. Filled — finalize the Position CLOSED with the real Alpaca price.
  const realizedPnl =
    position.direction === "LONG"
      ? (closePrice - position.avgCost) * position.quantity
      : (position.avgCost - closePrice) * position.quantity;

  const positionCost = position.avgCost * position.quantity;
  const outcome: "WIN" | "LOSS" | "BREAKEVEN" =
    realizedPnl > 0.01 * positionCost
      ? "WIN"
      : realizedPnl < -0.01 * positionCost
        ? "LOSS"
        : "BREAKEVEN";
  const sign = realizedPnl >= 0 ? "+" : "";
  const finalFilledAt = filledAt ?? new Date();

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "FILLED",
        filledPrice: closePrice,
        filledQty: position.quantity,
        filledAt: finalFilledAt,
      },
    });

    await tx.position.update({
      where: { id: positionId },
      data: {
        status: "CLOSED",
        closePrice,
        closeReason: reason,
        closeSource: source,
        realizedPnl,
        outcome,
        closedAt: finalFilledAt,
      },
    });

    await tx.positionEvent.create({
      data: {
        positionId,
        eventType: "CLOSED",
        description: `Position closed (${reason}) at $${closePrice.toFixed(2)}. P&L: ${sign}$${realizedPnl.toFixed(2)} — ${outcome}`,
        priceAt: closePrice,
        pnlAt: realizedPnl,
      },
    });

    const generatedReason =
      auditReason ??
      buildCloseReason(source, reason, position.symbol, closePrice, position.stopLoss, position.targetPrice);
    await tx.positionManagementAction.create({
      data: {
        positionId,
        runId: runId ?? null,
        actionType: "FULL_CLOSE",
        source,
        reason: generatedReason,
        fillPrice: closePrice,
        fillQty: position.quantity,
        alpacaOrderId,
      },
    });
  });

  // 5. Post-close side effects (non-fatal).
  //
  // Two parallel side effects intentionally:
  //   (a) `trade/closed` Inngest event — consumed by `evaluateTrade`
  //       (lib/inngest/functions/trade-evaluator.ts). Runs GPT-4o
  //       post-trade evaluation and updates Monitor ROI counters. Not
  //       responsible for email.
  //   (b) Inline trade-closed email below — fire-and-forget so every
  //       close path (agent close_position, manage_position full close,
  //       price-monitor stop/target, intraday EOD flatten, user-UI
  //       close) emails exactly once. Inline (not its own Inngest
  //       handler) prevents the double-send failure mode that would
  //       come with a duplicate event delivery.
  //
  // Suppression: if the close happened inside a MORNING_PLAN run during
  // the morning-cron window (Mon-Fri 7-10 AM ET), the 10 AM digest
  // covers it — skip the immediate email. Off-cycle closes (price-
  // monitor, user-UI, EOD-flatten, tactical-run agent closes) email
  // immediately. Gated on AgentConfig.emailAlerts for trade-closed too
  // so a "no emails for this analyst" opt-out actually means none.
  await inngest.send({ name: "trade/closed", data: { positionId } });

  void (async () => {
    try {
      const run = runId
        ? await prisma.researchRun.findUnique({
            where: { id: runId },
            select: { mode: true },
          })
        : null;
      if (isInsideMorningBatch(run?.mode)) {
        return; // digest will cover it
      }
      const config = position.analystId
        ? await prisma.agentConfig.findUnique({
            where: { id: position.analystId },
            select: { emailAlerts: true },
          })
        : null;
      if (config && config.emailAlerts === false) return;
      // Send to the account OWNER, not whoever placed the trade. For
      // single-OWNER accounts they're identical; for team workspaces the
      // OWNER is the canonical recipient. Falls back to position.userId
      // if the account membership lookup misses for any reason.
      const ownerUserId = await getOwnerUserId(position.accountId);
      const toEmail = await getUserEmail(ownerUserId ?? position.userId);
      if (!toEmail) return;
      const pnlPct = positionCost > 0 ? (realizedPnl / positionCost) * 100 : 0;
      const daysHeld = Math.max(
        1,
        Math.round((Date.now() - new Date(position.openedAt).getTime()) / 86_400_000),
      );
      const isWin = outcome === "WIN";
      const sign2 = realizedPnl >= 0 ? "+" : "";
      const livePrefix = positionEnvironment === "LIVE" ? "[LIVE] " : "";
      await sendEmail({
        to: toEmail,
        subject: isWin
          ? `${livePrefix}✅ ${position.symbol} closed ${sign2}${pnlPct.toFixed(1)}% — WIN`
          : `${livePrefix}⛔ ${position.symbol} closed ${sign2}${pnlPct.toFixed(1)}% — ${outcome}`,
        html: tradeClosedHtml({
          ticker: position.symbol,
          direction: position.direction as "LONG" | "SHORT",
          entryPrice: position.avgCost,
          closePrice,
          realizedPnl,
          realizedPnlPct: pnlPct,
          outcome,
          closeReason: reason,
          daysHeld,
          tradeId: positionId,
        }),
      });
    } catch (err) {
      console.warn(
        "[closeOpenPosition] trade-closed email failed:",
        err instanceof Error ? err.message : err,
      );
    }
  })();

  return {
    positionId,
    orderId: order.id,
    alpacaOrderId,
    closePrice,
    realizedPnl,
    outcome,
    fillStatus: "FILLED",
    placedAt,
    filledAt: finalFilledAt,
  };
}

// ─── Cancel Position (pending orders that haven't been filled) ───────────────

/**
 * Cancel a Position whose orders are still PENDING — used when the user
 * decides to abandon a trade before it fills.
 *
 * Safety rules:
 *   - Ask Alpaca to cancel each pending Order, then *re-fetch* Alpaca's
 *     view of that order. We never trust the cancel call's return; we trust
 *     getOrder. Alpaca's cancel is async — it can race a fill.
 *   - If any order actually FILLED on Alpaca (the cancel lost the race),
 *     adopt the fill into our DB and refuse to cancel the Position. Throw
 *     so the caller knows the position is real now.
 *   - If we couldn't determine an order's terminal state (5xx/network),
 *     log CRITICAL-SYNC-UNCERTAIN and refuse to cancel the Position. The
 *     reconcile cron will resolve it next pass.
 *   - Only mark Position CANCELLED when *every* pending order is confirmed
 *     terminal (canceled/expired/rejected) on Alpaca's side.
 */
export async function cancelPosition(positionId: string): Promise<void> {
  const position = await prisma.position.findUniqueOrThrow({
    where: { id: positionId },
  });

  if (position.status !== "OPEN") {
    throw new Error(`Position ${positionId} is not OPEN (status: ${position.status})`);
  }

  const creds = (await resolveAlpacaCredentials(position.userId)) ?? undefined;

  const pendingOrders = await prisma.order.findMany({
    where: { positionId, status: "PENDING" },
    select: { id: true, alpacaOrderId: true, idempotencyKey: true, intent: true, side: true, quantity: true },
  });

  // Issue cancel requests, then confirm Alpaca's actual state.
  type Confirmed = { orderId: string; finalAlpaca: AlpacaOrder | null; alpacaOrderId: string | null };
  const confirmations: Confirmed[] = [];

  for (const order of pendingOrders) {
    let alpacaId = order.alpacaOrderId;

    // No alpacaOrderId yet (DB-first crash gap). Try to recover via client_order_id.
    if (!alpacaId && order.idempotencyKey) {
      const { getOrderByClientOrderId } = await import("@/lib/alpaca");
      const found = await getOrderByClientOrderId(order.idempotencyKey, creds).catch(() => null);
      if (found) alpacaId = found.id;
    }

    if (!alpacaId) {
      // Truly never landed at Alpaca — safe to mark our row REJECTED.
      confirmations.push({ orderId: order.id, finalAlpaca: null, alpacaOrderId: null });
      continue;
    }

    try {
      await cancelOrder(alpacaId, creds);
    } catch {
      // 4xx "not cancellable" usually means already filled or cancelled —
      // fall through to the getOrder below to learn the truth.
    }

    let finalAlpaca: AlpacaOrder | null = null;
    try {
      finalAlpaca = await getOrder(alpacaId, creds);
    } catch (err) {
      // Couldn't read back. We have no idea if it filled. Don't touch DB.
      console.error(
        `CRITICAL-SYNC-UNCERTAIN [cancelPosition] could not confirm Alpaca state for order ${order.id} (alpaca=${alpacaId}). Refusing to cancel position. error=${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error(
        `Could not confirm Alpaca state for ${order.id}. Position not cancelled — try again or wait for reconcile cron.`,
      );
    }

    confirmations.push({ orderId: order.id, finalAlpaca, alpacaOrderId: alpacaId });
  }

  // Inspect Alpaca's verdict on each.
  const stillOpen: typeof confirmations = [];
  const filledRaces: typeof confirmations = [];

  for (const c of confirmations) {
    if (!c.finalAlpaca) continue;
    const s = c.finalAlpaca.status;
    if (s === "filled") filledRaces.push(c);
    else if (!["canceled", "cancelled", "expired", "rejected"].includes(s)) stillOpen.push(c);
  }

  if (stillOpen.length > 0) {
    console.error(
      `CRITICAL-SYNC-UNCERTAIN [cancelPosition] ${stillOpen.length} order(s) still alive on Alpaca after cancel attempt; refusing to cancel position ${positionId}.`,
    );
    throw new Error(
      `Some orders did not cancel cleanly. Position not cancelled — try again or wait for reconcile cron.`,
    );
  }

  if (filledRaces.length > 0) {
    // The cancel lost a race — Alpaca filled while we were trying to cancel.
    // Adopt the fills into our DB so the Position reflects reality, then
    // refuse to cancel.
    for (const race of filledRaces) {
      const ap = race.finalAlpaca!;
      const fillPrice = ap.filled_avg_price ? parseFloat(ap.filled_avg_price) : null;
      const fillQty = ap.filled_qty ? parseFloat(ap.filled_qty) : null;
      if (fillPrice == null || fillQty == null) continue;
      await prisma.order.update({
        where: { id: race.orderId },
        data: {
          status: "FILLED",
          alpacaOrderId: race.alpacaOrderId,
          filledPrice: fillPrice,
          filledQty: fillQty,
          quantity: fillQty,
          filledAt: ap.filled_at ? new Date(ap.filled_at) : new Date(),
          alpacaConfirmedAt: new Date(),
        },
      });
    }
    console.error(
      `CRITICAL-SYNC-RECOVERED [cancelPosition] ${filledRaces.length} order(s) filled while cancelling position ${positionId}; adopted fills, refusing to cancel.`,
    );
    throw new Error(
      `Cancel raced an Alpaca fill. ${filledRaces.length} order(s) filled and have been adopted into the DB. Position remains OPEN.`,
    );
  }

  // All clear — every pending order is terminal on Alpaca's side. Safe to cancel.
  await prisma.$transaction(async (tx) => {
    for (const c of confirmations) {
      const aStatus = c.finalAlpaca?.status;
      const finalDbStatus =
        aStatus === "rejected" ? "REJECTED" : "CANCELLED";
      await tx.order.update({
        where: { id: c.orderId },
        data: {
          status: finalDbStatus,
          alpacaOrderId: c.alpacaOrderId,
          alpacaConfirmedAt: new Date(),
        },
      });
    }

    await tx.position.update({
      where: { id: positionId },
      data: {
        status: "CANCELLED",
        closedAt: new Date(),
        closeReason: "MANUAL",
        closeSource: "user",
        realizedPnl: 0,
      },
    });

    await tx.positionEvent.create({
      data: {
        positionId,
        eventType: "CLOSED",
        description: `Position cancelled manually. ${confirmations.length} pending order(s) confirmed cancelled on Alpaca.`,
        priceAt: position.avgCost,
        pnlAt: 0,
      },
    });
  });
}

// ─── Legacy aliases (for old code paths during migration) ────────────────────

export type ClosedTradeResult = ClosedPositionResult;

export async function closeTrade(
  tradeId: string,
  reason: "TARGET" | "STOP" | "TIME" | "MANUAL",
): Promise<ClosedPositionResult> {
  return closeOpenPosition(tradeId, reason);
}

export async function cancelTrade(tradeId: string): Promise<void> {
  return cancelPosition(tradeId);
}
