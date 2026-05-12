/**
 * list_positions_all — Principal-chat read tool.
 *
 * Returns open positions across every analyst the user owns (or scoped
 * to one). Distinct from get_portfolio_context, which is the
 * single-analyst version used during a research run.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import type { ToolUIItem } from "@/lib/agent/tool-result";

export const listPositionsAll = defineTool({
  description:
    "List open positions across every analyst (or scoped to analyst_id, or scoped to ticker). Use this at the portfolio level — 'what's my exposure to semis', 'which analyst is holding $NVDA', 'show me everything I'm long'.",
  schema: z.object({
    analyst_id: z.string().optional(),
    ticker: z.string().optional(),
    status: z.enum(["OPEN", "CLOSED"]).optional().describe("Default OPEN"),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: (args) =>
    args.ticker
      ? `Listing positions for $${args.ticker.toUpperCase()}`
      : args.analyst_id
        ? "Listing analyst's positions"
        : "Listing all positions",

  execute: async (args, ctx) => {
    const status = args.status ?? "OPEN";
    const limit = args.limit ?? 100;

    const positions = await prisma.position.findMany({
      where: {
        userId: ctx.userId,
        status,
        ...(args.analyst_id ? { analystId: args.analyst_id } : {}),
        ...(args.ticker ? { symbol: args.ticker.toUpperCase() } : {}),
      },
      include: { analyst: { select: { id: true, name: true } } },
      orderBy: { openedAt: "desc" },
      take: limit,
    });

    const items: ToolUIItem[] = positions.map((p) => {
      const tag = p.direction === "SHORT" ? "SHORT" : "LONG";
      const summary =
        status === "OPEN"
          ? `${p.analyst?.name ?? "—"} · ${p.quantity.toFixed(2)} @ $${p.avgCost.toFixed(2)} · target $${p.targetPrice?.toFixed(2) ?? "—"} · stop $${p.stopLoss?.toFixed(2) ?? "—"}`
          : `${p.analyst?.name ?? "—"} · closed at $${p.closePrice?.toFixed(2) ?? "—"} · ${p.outcome ?? "—"} · P&L $${p.realizedPnl?.toFixed(2) ?? "—"}`;
      return {
        kind: "ticker" as const,
        ticker: p.symbol,
        tag,
        text: summary,
      };
    });
    if (items.length === 0) {
      items.unshift({ kind: "generic", text: "No positions match those filters." });
    } else {
      items.unshift({
        kind: "generic",
        text: `${positions.length} ${status.toLowerCase()} position${positions.length === 1 ? "" : "s"}`,
      });
    }

    return {
      summary: `${positions.length} ${status.toLowerCase()} position${positions.length === 1 ? "" : "s"}`,
      data: {
        items,
        positions: positions.map((p) => ({
          id: p.id,
          ticker: p.symbol,
          analystId: p.analystId,
          analystName: p.analyst?.name ?? null,
          direction: p.direction,
          status: p.status,
          quantity: p.quantity,
          avgCost: p.avgCost,
          targetPrice: p.targetPrice,
          stopLoss: p.stopLoss,
          exitStrategy: p.exitStrategy,
          closePrice: p.closePrice,
          closedAt: p.closedAt,
          closeReason: p.closeReason,
          outcome: p.outcome,
          realizedPnl: p.realizedPnl,
          peakPrice: p.peakPrice,
          troughPrice: p.troughPrice,
          openedAt: p.openedAt,
        })),
      },
      sources: [],
    };
  },
});
