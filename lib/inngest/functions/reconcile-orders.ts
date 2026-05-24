/**
 * Reconcile Pending Orders — Workstream A v2.
 *
 * Two recovery paths:
 *
 *   1. PENDING + alpacaOrderId set
 *      We submitted to Alpaca and got an id back, but our 5s in-process poll
 *      didn't see a fill. Look up by id and resolve to FILLED / CANCELLED /
 *      REJECTED / still-pending.
 *
 *   2. PENDING + alpacaOrderId NULL + idempotencyKey set  (new in DB-first)
 *      The DB-first write committed but the Alpaca call either never returned
 *      or crashed before we stored the alpacaOrderId. Look up by
 *      client_order_id (the idempotencyKey we sent on submit) and adopt
 *      whatever Alpaca actually has — or mark REJECTED if Alpaca has no
 *      record (the call never landed).
 *
 * FILLED handling dispatches on Order.intent:
 *   OPEN          → update Position.avgCost to real fill, log OPENED
 *   CLOSE         → Position.status=CLOSED with realized P&L, log CLOSED
 *   PARTIAL_CLOSE → Position.quantity -= filledQty, realize partial P&L
 *   ADD           → Position.quantity += filledQty, recompute avgCost
 *   (null/legacy) → fall back to side-based dispatch (BUY=open, SELL=close)
 *
 * Runs every 5 minutes 4 AM – 8 PM ET, Mon–Fri.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import {
  getOrder,
  getOrderByClientOrderId,
  type AlpacaCredentials,
  type AlpacaOrder,
} from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";

const FIVE_MIN_CRON = "TZ=America/New_York */5 4-19 * * 1-5";

interface PendingOrderRow {
  id: string;
  userId: string;
  environment: string;
  positionId: string;
  symbol: string;
  side: string;
  quantity: number;
  alpacaOrderId: string | null;
  idempotencyKey: string | null;
  intent: string | null;
}

export const reconcileOrders = inngest.createFunction(
  {
    id: "reconcile-pending-orders",
    name: "Reconcile Pending Orders",
    retries: 0,
  },
  { cron: FIVE_MIN_CRON },
  async ({ step }) => {
    // 1. Fetch every PENDING order. We can recover orders even without an
    // alpacaOrderId now, as long as they have an idempotencyKey.
    const pending = await step.run("fetch-pending-orders", async () => {
      return prisma.order.findMany({
        where: {
          status: "PENDING",
          OR: [
            { alpacaOrderId: { not: null } },
            { idempotencyKey: { not: null } },
          ],
        },
        select: {
          id: true,
          userId: true,
          environment: true,
          positionId: true,
          symbol: true,
          side: true,
          quantity: true,
          alpacaOrderId: true,
          idempotencyKey: true,
          intent: true,
        },
      });
    });

    if (pending.length === 0) {
      return { checked: 0, reason: "no-pending-orders" };
    }

    // Group by (userId, environment) so each cohort hits the matching
    // Alpaca account. A user may hold pending orders in both PAPER and LIVE
    // simultaneously; using one set of creds for both would query the wrong
    // host for half of them and miss every match.
    const byUserEnv = new Map<string, PendingOrderRow[]>();
    for (const o of pending) {
      const key = `${o.userId}|${o.environment}`;
      const arr = byUserEnv.get(key) ?? [];
      arr.push(o);
      byUserEnv.set(key, arr);
    }

    let filled = 0;
    let cancelled = 0;
    let rejected = 0;
    let adopted = 0;
    let stillPending = 0;
    let errors = 0;

    for (const [key, orders] of byUserEnv) {
      const [userId, environment] = key.split("|") as [string, "PAPER" | "LIVE"];
      const creds: AlpacaCredentials | undefined =
        (await resolveAlpacaCredentials(userId, environment)) ?? undefined;

      for (const order of orders) {
        await step.run(`reconcile-${order.id}`, async () => {
          try {
            // Resolve Alpaca's view of this order.
            let alpacaOrder: AlpacaOrder | null;
            let didAdopt = false;

            if (order.alpacaOrderId) {
              alpacaOrder = await getOrder(order.alpacaOrderId, creds);
            } else if (order.idempotencyKey) {
              // DB-first commit landed but Alpaca call result was lost.
              // Ask Alpaca: do you have anything with this client_order_id?
              alpacaOrder = await getOrderByClientOrderId(order.idempotencyKey, creds);
              if (!alpacaOrder) {
                // Alpaca has no record — the submit never landed. Safe to mark REJECTED.
                console.error(
                  `CRITICAL-SYNC-RECOVERED [reconcile-orders] PENDING order ${order.id} has no Alpaca match by idem=${order.idempotencyKey.slice(0, 8)}; marking REJECTED. intent=${order.intent ?? "?"} symbol=${order.symbol}`,
                );
                await markOrderRejectedAndCancelPosition(order, "no Alpaca record by client_order_id");
                rejected++;
                return;
              }
              didAdopt = true;
              await prisma.order.update({
                where: { id: order.id },
                data: {
                  alpacaOrderId: alpacaOrder.id,
                  alpacaConfirmedAt: new Date(),
                },
              });
              adopted++;
            } else {
              // Should not happen given our query — but be defensive.
              stillPending++;
              return;
            }

            const status = alpacaOrder.status;

            // ── FILLED ────────────────────────────────────────────────────
            if (status === "filled" && alpacaOrder.filled_avg_price) {
              const fillPrice = parseFloat(alpacaOrder.filled_avg_price);
              const fillQty = alpacaOrder.filled_qty
                ? parseFloat(alpacaOrder.filled_qty)
                : order.quantity;
              const filledAt = alpacaOrder.filled_at
                ? new Date(alpacaOrder.filled_at)
                : new Date();

              const handled = await applyFillByIntent(order, fillPrice, fillQty, filledAt);
              if (handled) filled++;
              return;
            }

            // ── CANCELLED / REJECTED / EXPIRED ────────────────────────────
            if (["canceled", "cancelled", "expired", "rejected"].includes(status)) {
              // Partial-fill-on-terminal-status: Alpaca took some shares
              // before killing the rest. We must adopt the partial fill;
              // otherwise Alpaca holds shares the DB never sees (NVDA-2026-05).
              const partialQty = alpacaOrder.filled_qty
                ? parseFloat(alpacaOrder.filled_qty)
                : 0;
              const partialPrice = alpacaOrder.filled_avg_price
                ? parseFloat(alpacaOrder.filled_avg_price)
                : 0;
              if (partialQty > 0 && partialPrice > 0) {
                const partialFilledAt = alpacaOrder.filled_at
                  ? new Date(alpacaOrder.filled_at)
                  : new Date();
                const handled = await applyFillByIntent(
                  order,
                  partialPrice,
                  partialQty,
                  partialFilledAt,
                );
                if (handled) filled++;
                return;
              }
              const finalStatus = status === "rejected" ? "REJECTED" : "CANCELLED";
              await markOrderTerminalAndMaybeCancelPosition(order, finalStatus, status);
              if (finalStatus === "REJECTED") rejected++;
              else cancelled++;
              return;
            }

            // ── Still pending ─────────────────────────────────────────────
            stillPending++;
            void didAdopt;
          } catch (err) {
            errors++;
            console.warn(
              `[reconcile-orders] failed to reconcile ${order.id} (alpaca=${order.alpacaOrderId ?? "null"} idem=${order.idempotencyKey?.slice(0, 8) ?? "null"}): ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        });
      }
    }

    return {
      checked: pending.length,
      filled,
      cancelled,
      rejected,
      adopted,
      stillPending,
      errors,
    };
  },
);

/**
 * Apply a FILLED Alpaca order to the linked Position based on Order.intent.
 * Returns true if the row was actually flipped (idempotent — no-op if it was
 * already non-PENDING).
 */
async function applyFillByIntent(
  order: PendingOrderRow,
  fillPrice: number,
  fillQty: number,
  filledAt: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: {
        status: "FILLED",
        quantity: fillQty,
        filledPrice: fillPrice,
        filledQty: fillQty,
        filledAt,
      },
    });
    if (updated.count === 0) return false;

    const position = await tx.position.findUnique({
      where: { id: order.positionId },
    });
    if (!position) return true;

    // Dispatch on intent, fall back to side-based legacy behavior.
    const intent = order.intent ?? (order.side === "BUY" ? "OPEN" : "CLOSE");

    switch (intent) {
      case "OPEN": {
        if (position.status === "OPEN" && Math.abs(position.avgCost - fillPrice) > 0.01) {
          await tx.position.update({
            where: { id: position.id },
            data: { avgCost: fillPrice, quantity: fillQty, initialQty: fillQty },
          });
        }
        await tx.positionEvent.create({
          data: {
            positionId: position.id,
            eventType: "OPENED",
            description: `Reconciled: opening order filled at $${fillPrice.toFixed(2)} (${fillQty} shares)`,
            priceAt: fillPrice,
          },
        });
        break;
      }

      case "CLOSE": {
        if (position.status !== "OPEN") break;
        const realizedPnl =
          position.direction === "LONG"
            ? (fillPrice - position.avgCost) * position.quantity
            : (position.avgCost - fillPrice) * position.quantity;
        const positionCost = position.avgCost * position.quantity;
        const outcome: "WIN" | "LOSS" | "BREAKEVEN" =
          realizedPnl > 0.01 * positionCost
            ? "WIN"
            : realizedPnl < -0.01 * positionCost
              ? "LOSS"
              : "BREAKEVEN";
        const sign = realizedPnl >= 0 ? "+" : "";
        await tx.position.update({
          where: { id: position.id },
          data: {
            status: "CLOSED",
            closePrice: fillPrice,
            realizedPnl,
            outcome,
            closedAt: filledAt,
            // Audit fields — pre-2026-05-19 this branch left closeReason
            // and closeSource null, which is what caused the 4 mystery
            // closes (AMZN/TSM/NVDA/AMD) on 2026-05-18 to have blank
            // attribution. Reconcile fills always trace back to an
            // earlier intent="CLOSE" Order submitted by the agent (via
            // close_position) or the user (via /api/trades/.../close).
            // We mark this path "reconcile" to distinguish from
            // first-touch closes that set closeSource themselves.
            closeReason: position.closeReason ?? `RECONCILED_FILL ($${fillPrice.toFixed(2)})`,
            closeSource: position.closeSource ?? "reconcile",
          },
        });
        await tx.positionEvent.create({
          data: {
            positionId: position.id,
            eventType: "CLOSED",
            description: `Reconciled: closing order filled at $${fillPrice.toFixed(2)}. P&L: ${sign}$${realizedPnl.toFixed(2)} — ${outcome}`,
            priceAt: fillPrice,
            pnlAt: realizedPnl,
          },
        });
        break;
      }

      case "PARTIAL_CLOSE": {
        if (position.status !== "OPEN") break;
        const newQty = Math.max(0, position.quantity - fillQty);
        const partialPnl =
          position.direction === "LONG"
            ? (fillPrice - position.avgCost) * fillQty
            : (position.avgCost - fillPrice) * fillQty;
        const sign = partialPnl >= 0 ? "+" : "";
        await tx.position.update({
          where: { id: position.id },
          data: { quantity: newQty },
        });
        await tx.positionEvent.create({
          data: {
            positionId: position.id,
            eventType: "PARTIAL_CLOSE",
            description: `Reconciled: partial close filled. Sold ${fillQty} at $${fillPrice.toFixed(2)}. P&L: ${sign}$${partialPnl.toFixed(2)}. Remaining: ${newQty} shares.`,
            priceAt: fillPrice,
            pnlAt: partialPnl,
          },
        });
        break;
      }

      case "ADD": {
        if (position.status !== "OPEN") break;
        const newTotal = position.quantity + fillQty;
        const newAvg =
          newTotal > 0
            ? (position.avgCost * position.quantity + fillPrice * fillQty) / newTotal
            : position.avgCost;
        await tx.position.update({
          where: { id: position.id },
          data: { quantity: newTotal, avgCost: newAvg },
        });
        await tx.positionEvent.create({
          data: {
            positionId: position.id,
            eventType: "ADDED",
            description: `Reconciled: add filled. Bought ${fillQty} at $${fillPrice.toFixed(2)}. New: ${newTotal} shares @ avg $${newAvg.toFixed(2)}.`,
            priceAt: fillPrice,
          },
        });
        break;
      }

      default:
        // Unknown intent — log and leave Position untouched.
        console.warn(
          `[reconcile-orders] order ${order.id} has unknown intent="${intent}"; FILLED with no Position mutation.`,
        );
    }

    return true;
  });
}

/**
 * Mark a CANCELLED/EXPIRED/REJECTED Alpaca order in the DB. For OPEN-intent
 * orders that never had a successful fill on the same Position, also cancel
 * the Position so it doesn't sit OPEN forever.
 */
async function markOrderTerminalAndMaybeCancelPosition(
  order: PendingOrderRow,
  finalStatus: "CANCELLED" | "REJECTED",
  alpacaStatus: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING" },
      data: { status: finalStatus, alpacaConfirmedAt: new Date() },
    });
    if (updated.count === 0) return;

    const intent = order.intent ?? (order.side === "BUY" ? "OPEN" : "CLOSE");
    if (intent !== "OPEN") return;

    const position = await tx.position.findUnique({
      where: { id: order.positionId },
    });
    if (!position || position.status !== "OPEN") return;

    // Only cancel the Position if no opening fill ever landed on it.
    const filledOpen = await tx.order.findFirst({
      where: {
        positionId: position.id,
        status: "FILLED",
        OR: [{ intent: "OPEN" }, { intent: null, side: "BUY" }],
      },
      select: { id: true },
    });
    if (filledOpen) return;

    await tx.position.update({
      where: { id: position.id },
      data: {
        status: "CANCELLED",
        closedAt: new Date(),
        closeReason: "MANUAL",
        realizedPnl: 0,
      },
    });
    await tx.positionEvent.create({
      data: {
        positionId: position.id,
        eventType: "CLOSED",
        description: `Reconciled: opening order ${alpacaStatus}. Position cancelled.`,
        priceAt: position.avgCost,
        pnlAt: 0,
      },
    });
  });
}

/**
 * Used when Alpaca returns 404 on a client_order_id lookup — the submit
 * never reached the broker. Mark the Order REJECTED and, for OPEN intents
 * that never had a fill, cancel the empty Position.
 */
async function markOrderRejectedAndCancelPosition(
  order: PendingOrderRow,
  reasonText: string,
): Promise<void> {
  await markOrderTerminalAndMaybeCancelPosition(order, "REJECTED", `rejected (${reasonText})`);
}
