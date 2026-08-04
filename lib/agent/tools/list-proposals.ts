/**
 * list_proposals — the approval queue as a first-class read.
 *
 * Trade-as-Proposal parks every agent-initiated trade behind a human gate:
 * `Order.status='AWAITING_APPROVAL'` (+ `Position.status='PENDING_APPROVAL'`
 * for a not-yet-approved OPEN). Before this tool existed the principal agent
 * had no way to answer "what's pending approval?" — it fell through to
 * `read_database` on `order`, which was itself broken (Order has no
 * `accountId` column), so the answer was two Prisma errors and a guess.
 *
 * This is the read side of the gate ONLY. Approve/reject stays with the
 * human — deliberately no write tool here. See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { getLatestPrices } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";
import type { ToolUIItem } from "@/lib/agent/tool-result";

/** Display tag per intent — TRIM reads better than PARTIAL_CLOSE in a chip. */
const INTENT_TAG: Record<string, string> = {
  OPEN: "BUY",
  ADD: "ADD",
  CLOSE: "SELL",
  PARTIAL_CLOSE: "TRIM",
};

export const listProposals = defineTool({
  description:
    "List trade proposals waiting on the principal's approval (and, with status, the resolved ones). A proposal is an agent-initiated trade parked at Order.status='AWAITING_APPROVAL' — nothing was sent to the broker. Each row carries the intent (OPEN buy / ADD / CLOSE sell / PARTIAL_CLOSE trim), the agent's rationale, the linked thesis, live unrealized P&L on the underlying position, and the 24h expiry clock. THIS is the tool for 'what's pending', 'what's awaiting approval', 'my open proposals', 'what sells are staged', 'what's the agent asking me to do'. You can only READ proposals — approving or rejecting is the principal's call in the UI.",
  schema: z.object({
    status: z
      .enum([
        "AWAITING_APPROVAL",
        "PENDING",
        "FILLED",
        "REJECTED",
        "EXPIRED",
        "CANCELLED",
        "all",
      ])
      .optional()
      .describe(
        "Default AWAITING_APPROVAL (the live approval queue). Use REJECTED / EXPIRED to see what the principal declined or let lapse — that history is why an exit shouldn't be re-proposed.",
      ),
    intent: z
      .enum(["OPEN", "ADD", "CLOSE", "PARTIAL_CLOSE"])
      .optional()
      .describe("Filter to buys (OPEN), adds, full exits (CLOSE), or trims."),
    analyst_id: z.string().optional(),
    ticker: z.string().optional(),
    environment: z
      .enum(["PAPER", "LIVE"])
      .optional()
      .describe("Default: both. Every row is labeled with its environment."),
    limit: z.number().int().min(1).max(100).optional().describe("Default 50."),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: (args) =>
    args.ticker
      ? `Checking proposals for $${args.ticker.toUpperCase()}`
      : (args.status ?? "AWAITING_APPROVAL") === "AWAITING_APPROVAL"
        ? "Checking the approval queue"
        : "Listing proposals",

  execute: async (args, ctx) => {
    const status = args.status ?? "AWAITING_APPROVAL";
    const take = args.limit ?? 50;

    // Order carries userId + positionId but NOT accountId — scope through
    // the position relation. (Getting this wrong is what broke read_database.)
    const orders = await prisma.order.findMany({
      where: {
        position: {
          accountId: ctx.accountId,
          ...(args.analyst_id ? { analystId: args.analyst_id } : {}),
        },
        ...(status === "all" ? {} : { status }),
        ...(args.intent ? { intent: args.intent } : {}),
        ...(args.ticker ? { symbol: args.ticker.toUpperCase() } : {}),
        ...(args.environment ? { environment: args.environment } : {}),
      },
      include: {
        position: { include: { analyst: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    // Resolve the LIVE thesis per (analyst, ticker) rather than walking
    // Order → TradeDecision → Thesis. That relation only carries a thesisId
    // on the original open: every subsequent HOLD decision writes thesisId
    // null, so the newest decision on a held name — exactly the names that
    // get exit proposals — resolves to nothing. Ticker+analyst also gives
    // the CURRENT belief instead of the one from entry day, which is what
    // you want when judging a staged exit.
    const analystIds = [...new Set(orders.map((o) => o.position.analystId))];
    const tickers = [...new Set(orders.map((o) => o.symbol))];
    const thesisRows =
      orders.length === 0
        ? []
        : await prisma.thesis.findMany({
            where: {
              accountId: ctx.accountId,
              ticker: { in: tickers },
              status: { in: ["HOLDING", "WATCHING", "PROMOTED"] },
              researchRun: { agentConfigId: { in: analystIds } },
            },
            select: {
              id: true,
              ticker: true,
              direction: true,
              status: true,
              horizon: true,
              entryPrice: true,
              targetPrice: true,
              stopLoss: true,
              snapshot: true,
              scoring: true,
              updatedAt: true,
              researchRun: { select: { agentConfigId: true } },
            },
            orderBy: { updatedAt: "desc" },
          });
    // Newest wins — the findMany is already sorted, so first insert sticks.
    const thesisByKey = new Map<string, (typeof thesisRows)[number]>();
    for (const t of thesisRows) {
      const key = `${t.researchRun.agentConfigId}:${t.ticker}`;
      if (!thesisByKey.has(key)) thesisByKey.set(key, t);
    }

    // Live prices so "is this sell at a loss?" is answerable in one call
    // instead of a get_stock_data fan-out. Best-effort — falls back to
    // avgCost, which reads as flat P&L rather than a wrong number.
    const symbols = [...new Set(orders.map((o) => o.symbol))];
    let prices: Record<string, number> = {};
    if (symbols.length > 0) {
      try {
        const creds =
          ctx.alpacaCreds ??
          (await resolveAlpacaCredentials(ctx.userId, ctx.runEnvironment ?? "PAPER")) ??
          undefined;
        prices = await getLatestPrices(symbols, creds);
      } catch {
        /* fall through to avgCost */
      }
    }

    const now = Date.now();

    const proposals = orders.map((o) => {
      const pos = o.position;
      const thesis = thesisByKey.get(`${pos.analystId}:${o.symbol}`) ?? null;
      const currentPrice = prices[o.symbol] ?? pos.avgCost;
      const isLong = pos.direction === "LONG";

      // Unrealized on the WHOLE position, at live price.
      const unrealizedPnl = isLong
        ? (currentPrice - pos.avgCost) * pos.quantity
        : (pos.avgCost - currentPrice) * pos.quantity;
      const unrealizedPnlPct =
        pos.avgCost > 0
          ? ((isLong ? currentPrice - pos.avgCost : pos.avgCost - currentPrice) /
              pos.avgCost) *
            100
          : 0;

      // What this specific proposal would realize if approved. Exits realize
      // their share of the position; a buy/add realizes nothing.
      const isExit = o.intent === "CLOSE" || o.intent === "PARTIAL_CLOSE";
      const wouldRealizePnl = isExit
        ? (isLong ? currentPrice - pos.avgCost : pos.avgCost - currentPrice) *
          o.quantity
        : null;

      const hoursUntilExpiry = o.expiresAt
        ? (new Date(o.expiresAt).getTime() - now) / 3_600_000
        : null;

      const daysHeld = Math.floor(
        (now - new Date(pos.openedAt).getTime()) / 86_400_000,
      );

      return {
        orderId: o.id,
        status: o.status,
        symbol: o.symbol,
        side: o.side,
        intent: o.intent,
        quantity: o.quantity,
        environment: o.environment,
        // The agent's reasoning at proposal time — the thing the principal
        // is actually being asked to judge.
        rationale: o.rationale,
        rejectionMessage: o.rejectionMessage,
        proposedAt: o.createdAt,
        expiresAt: o.expiresAt,
        hoursUntilExpiry:
          hoursUntilExpiry == null ? null : Math.round(hoursUntilExpiry * 10) / 10,
        expired: hoursUntilExpiry != null && hoursUntilExpiry <= 0,
        closeReason: o.closeReason,
        position: {
          id: pos.id,
          analystId: pos.analystId,
          analystName: pos.analyst?.name ?? null,
          status: pos.status,
          direction: pos.direction,
          quantity: pos.quantity,
          avgCost: pos.avgCost,
          currentPrice,
          priceIsLive: prices[o.symbol] != null,
          unrealizedPnl,
          unrealizedPnlPct,
          targetPrice: pos.targetPrice,
          stopLoss: pos.stopLoss,
          peakPrice: pos.peakPrice,
          daysHeld,
          openedAt: pos.openedAt,
        },
        wouldRealizePnl,
        thesis: thesis
          ? {
              id: thesis.id,
              ticker: thesis.ticker,
              direction: thesis.direction,
              status: thesis.status,
              horizon: thesis.horizon,
              entryPrice: thesis.entryPrice,
              targetPrice: thesis.targetPrice,
              stopLoss: thesis.stopLoss,
              conviction: getThesisComposite(thesis),
              snapshot: getThesisSnapshotText(thesis),
            }
          : null,
      };
    });

    const money = (n: number) =>
      `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`;

    const items: ToolUIItem[] = proposals.map((p) => {
      const parts: string[] = [];
      parts.push(p.position.analystName ?? "—");
      parts.push(`${p.quantity} sh @ ~$${p.position.currentPrice.toFixed(2)}`);
      parts.push(
        `pos P&L ${money(p.position.unrealizedPnl)} (${p.position.unrealizedPnlPct.toFixed(1)}%)`,
      );
      if (p.wouldRealizePnl != null) {
        parts.push(`realizes ${money(p.wouldRealizePnl)}`);
      }
      if (p.status === "AWAITING_APPROVAL" && p.hoursUntilExpiry != null) {
        parts.push(
          p.expired ? "EXPIRED" : `expires in ${p.hoursUntilExpiry.toFixed(1)}h`,
        );
      } else if (p.status !== "AWAITING_APPROVAL") {
        parts.push(p.status);
      }
      if (p.environment === "LIVE") parts.push("LIVE");
      return {
        kind: "ticker" as const,
        ticker: p.symbol,
        tag: INTENT_TAG[p.intent ?? ""] ?? p.side,
        text: parts.join(" · "),
      };
    });

    const label =
      status === "AWAITING_APPROVAL"
        ? `${proposals.length} proposal${proposals.length === 1 ? "" : "s"} awaiting approval`
        : `${proposals.length} proposal${proposals.length === 1 ? "" : "s"} (${status})`;

    items.unshift({
      kind: "generic",
      text:
        proposals.length === 0
          ? status === "AWAITING_APPROVAL"
            ? "Nothing awaiting approval — the queue is clear."
            : "No proposals match those filters."
          : label,
    });

    return {
      summary: label,
      data: { items, status, proposals },
      sources: [],
    };
  },
});
