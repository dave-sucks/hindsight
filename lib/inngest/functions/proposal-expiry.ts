/**
 * Proposal expiry — terminal-state cleanup for Trade-as-Proposal.
 *
 * Every 30 min during US-market hours (Mon-Fri 4 AM-8 PM ET), find every
 * Order(AWAITING_APPROVAL, expiresAt < now) and:
 *   - flip Order.status → EXPIRED
 *   - for OPEN intent: flip Position(PENDING_APPROVAL → CANCELLED) so the
 *     portfolio stops carrying the phantom (no real Alpaca holding ever
 *     existed for it)
 *   - write ThesisUpdate(type='PROPOSAL_EXPIRED') so the agent reads the
 *     expiry on its next run and can choose to re-propose
 *
 * The cron mirrors reconcile-orders' cadence pattern. 30 min is the right
 * granularity: 24h default expiry × 48 cron ticks per day means we never
 * leave an expired proposal more than 30 min past its deadline.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md §5.8 + §8.4.
 */

import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";

// Mon-Fri 4 AM-8 PM ET, every 30 min — covers any proposal expiring during
// the trading day. Off-hours expiries roll over to the next ET open.
const THIRTY_MIN_CRON = "TZ=America/New_York */30 4-19 * * 1-5";

export const proposalExpiry = inngest.createFunction(
  {
    id: "proposal-expiry",
    name: "Proposal Expiry Cron",
    retries: 0,
  },
  { cron: THIRTY_MIN_CRON },
  async ({ step }) => {
    const now = new Date();

    // 1. Find expired proposals.
    const expired = await step.run("fetch-expired", async () => {
      return prisma.order.findMany({
        where: {
          status: "AWAITING_APPROVAL",
          expiresAt: { lt: now },
        },
        select: {
          id: true,
          positionId: true,
          symbol: true,
          intent: true,
          expiresAt: true,
          quantity: true,
          rationale: true,
          position: {
            select: {
              id: true,
              status: true,
              analystId: true,
              accountId: true,
            },
          },
        },
      });
    });

    if (expired.length === 0) {
      return { checked: 0, expired: 0 };
    }

    let flippedOrders = 0;
    let cancelledPositions = 0;
    let auditFailures = 0;

    // 2. For each expired proposal: flip the Order to EXPIRED, cancel the
    //    Position for OPEN intent, write the ThesisUpdate audit row.
    //    One step per order so a single failure doesn't block the rest.
    for (const order of expired) {
      await step.run(`expire-${order.id}`, async () => {
        const intent = (order.intent ?? "OPEN") as
          | "OPEN"
          | "ADD"
          | "CLOSE"
          | "PARTIAL_CLOSE";

        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id, status: "AWAITING_APPROVAL" },
            data: { status: "EXPIRED" },
          });
          flippedOrders++;

          // Buy proposals leave a Position(PENDING_APPROVAL) row. Cancel
          // it so the portfolio queries stop seeing it. For close/add/trim
          // the Position is already OPEN and stays OPEN — only the order
          // expires.
          if (
            intent === "OPEN" &&
            order.position.status === "PENDING_APPROVAL"
          ) {
            await tx.position.update({
              where: { id: order.positionId },
              data: {
                status: "CANCELLED",
                closedAt: now,
                closeReason: "MANUAL",
              },
            });
            cancelledPositions++;
          }

          await tx.positionEvent.create({
            data: {
              positionId: order.positionId,
              eventType: intent === "OPEN" ? "CLOSED" : "PRICE_CHECK",
              description: `Proposal expired without user decision (orderId=${order.id.slice(0, 8)}, intent=${intent}).`,
              priceAt: null,
            },
          });
        });

        // Write the ThesisUpdate audit OUTSIDE the position-update tx —
        // failures here shouldn't block the expiry flip. The agent reads
        // this on its next run to decide whether to re-propose.
        try {
          const thesis = await prisma.thesis.findFirst({
            where: {
              ticker: order.symbol,
              researchRun: { agentConfigId: order.position.analystId },
              status: { in: ["HOLDING", "WATCHING", "PROMOTED"] },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (thesis) {
            await writeThesisUpdate({
              thesisId: thesis.id,
              type: "PROPOSAL_EXPIRED",
              summary: `${intent} proposal on ${order.symbol} expired without user decision`,
              rationale: `Proposed ${order.quantity} ${order.symbol} (${intent}) — no approve / reject within the expiry window. ${order.rationale ? `Original rationale: ${order.rationale.slice(0, 240)}` : ""}`.trim(),
              fieldChanges: {
                proposal: {
                  from: { orderId: order.id, status: "AWAITING_APPROVAL" },
                  to: {
                    orderId: order.id,
                    status: "EXPIRED",
                    intent,
                    quantity: order.quantity,
                    expiredAt: now.toISOString(),
                  },
                },
              },
            });
          }
        } catch (err) {
          auditFailures++;
          console.warn(
            `[proposal-expiry] ThesisUpdate(PROPOSAL_EXPIRED) failed for order ${order.id}:`,
            err instanceof Error ? err.message : err,
          );
        }
      });
    }

    return {
      checked: expired.length,
      expired: flippedOrders,
      cancelledPositions,
      auditFailures,
    };
  },
);
