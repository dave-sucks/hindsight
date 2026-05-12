/**
 * list_theses_all — Principal-chat read tool.
 *
 * Returns Theses across all analysts (or scoped to one analyst or one
 * ticker). Distinct from the analyst-scoped get_theses tool, which
 * fences to the running analyst's own library.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import type { ToolUIItem } from "@/lib/agent/tool-result";

export const listThesesAll = defineTool({
  description:
    "List theses across every analyst (or scoped to analyst_id, or to one ticker). Defaults to status in (ACTIVE, WATCHING). Use this for portfolio-wide questions — 'show me everything actively held', 'who has a thesis on $NVDA', 'how many WATCHING theses do I have across all analysts'.",
  schema: z.object({
    analyst_id: z.string().optional(),
    ticker: z.string().optional(),
    status: z
      .enum(["ACTIVE", "WATCHING", "INVALIDATED", "CLOSED", "SUPERSEDED"])
      .optional(),
    direction: z.enum(["LONG", "SHORT", "PASS"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: (args) =>
    args.ticker
      ? `Listing theses for $${args.ticker.toUpperCase()}`
      : args.analyst_id
        ? "Listing analyst's theses"
        : "Listing theses across analysts",

  execute: async (args, ctx) => {
    const limit = args.limit ?? 50;

    const where: Record<string, unknown> = {
      userId: ctx.userId,
      ...(args.ticker ? { ticker: args.ticker.toUpperCase() } : {}),
      ...(args.direction ? { direction: args.direction } : {}),
    };
    if (args.status) {
      where.status = args.status;
    } else {
      where.status = { in: ["ACTIVE", "WATCHING"] };
    }
    if (args.analyst_id) {
      where.researchRun = { agentConfigId: args.analyst_id };
    }

    const theses = await prisma.thesis.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        researchRun: {
          select: {
            id: true,
            agentConfigId: true,
            agentConfig: { select: { id: true, name: true } },
          },
        },
      },
    });

    const items: ToolUIItem[] = theses.map((t) => {
      const analyst = t.researchRun?.agentConfig?.name ?? "—";
      const conf = `${t.confidenceScore}%`;
      const target = t.targetPrice ? `target $${t.targetPrice.toFixed(2)}` : "no target";
      return {
        kind: "ticker" as const,
        ticker: t.ticker,
        tag: `${t.direction}/${t.status}`,
        text: `${analyst} · ${conf} · ${target}`,
      };
    });
    if (items.length === 0) {
      items.unshift({ kind: "generic", text: "No theses match those filters." });
    } else {
      items.unshift({
        kind: "generic",
        text: `${theses.length} thes${theses.length === 1 ? "is" : "es"}`,
      });
    }

    return {
      summary: `${theses.length} thes${theses.length === 1 ? "is" : "es"}`,
      data: {
        items,
        theses: theses.map((t) => ({
          id: t.id,
          ticker: t.ticker,
          analystId: t.researchRun?.agentConfigId ?? null,
          analystName: t.researchRun?.agentConfig?.name ?? null,
          direction: t.direction,
          status: t.status,
          confidenceScore: t.confidenceScore,
          entryPrice: t.entryPrice,
          targetPrice: t.targetPrice,
          stopLoss: t.stopLoss,
          holdDuration: t.holdDuration,
          reasoningSummary: t.reasoningSummary,
          sourceKind: t.sourceKind,
          createdAt: t.createdAt,
        })),
      },
      sources: [],
    };
  },
});
