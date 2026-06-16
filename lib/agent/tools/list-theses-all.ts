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
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

export const listThesesAll = defineTool({
  description:
    "List theses across every analyst (or scoped to analyst_id, or to one ticker). Defaults to status in (HOLDING, WATCHING). Use this for portfolio-wide questions — 'show me everything actively held', 'who has a thesis on $NVDA', 'how many WATCHING theses do I have across all analysts'.",
  schema: z.object({
    analyst_id: z.string().optional(),
    ticker: z.string().optional(),
    status: z
      .enum(["HOLDING", "WATCHING", "PROMOTED", "RETIRED", "PASSED"])
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
      accountId: ctx.accountId,
      ...(args.ticker ? { ticker: args.ticker.toUpperCase() } : {}),
      ...(args.direction ? { direction: args.direction } : {}),
    };
    if (args.status) {
      where.status = args.status;
    } else {
      where.status = { in: ["HOLDING", "WATCHING"] };
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
      const composite = getThesisComposite(t);
      // PR-9: replaced 0-100 confidence with /10 composite (single
      // conviction number). Unscored theses get "—".
      const conf = composite != null ? `${composite}/10` : "—";
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
        theses: theses.map((t) => {
          const composite = getThesisComposite(t);
          return {
            id: t.id,
            ticker: t.ticker,
            analystId: t.researchRun?.agentConfigId ?? null,
            analystName: t.researchRun?.agentConfig?.name ?? null,
            direction: t.direction,
            status: t.status,
            // PR-9: agent-facing shape uses composite (0-10) — distinct
            // from the UI side that multiplies × 10 for legacy renderers.
            composite,
            entryPrice: t.entryPrice,
            targetPrice: t.targetPrice,
            stopLoss: t.stopLoss,
            holdDuration: t.holdDuration,
            snapshot: getThesisSnapshotText(t),
            sourceKind: t.sourceKind,
            createdAt: t.createdAt,
          };
        }),
      },
      sources: [],
    };
  },
});
