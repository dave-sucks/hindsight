/**
 * list_monitors — Principal-chat read tool.
 *
 * Lists Monitors across all analysts (or scoped to one) with ROI counters
 * — tradesSourced / winsSourced / lossesSourced / successScore. The
 * principal agent uses this to answer "which monitors are dead" / "what
 * are my best sources" / "show me Catalyst Event Raider's monitors".
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import type { ToolUIItem } from "@/lib/agent/tool-result";

export const listMonitors = defineTool({
  description:
    "List monitors with ROI counters (tradesSourced, winsSourced, lossesSourced, successScore). Filter by analyst_id (only that analyst's monitors), type (SEARCH/DOMAIN/API), enabled flag, or origin (USER/BUILDER/BRIEFING_AGENT). Sort by recency or successScore. Use this to answer 'which monitors are dead', 'show me my best sources', 'what monitors does $analyst have'.",
  schema: z.object({
    analyst_id: z.string().optional(),
    type: z.enum(["SEARCH", "DOMAIN", "API", "EMAIL"]).optional(),
    enabled_only: z.boolean().optional(),
    origin: z.enum(["USER", "BUILDER", "BRIEFING_AGENT"]).optional(),
    sort: z
      .enum(["recent", "score_desc", "score_asc", "trades_desc"])
      .optional()
      .describe("Default 'recent'"),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: (args) =>
    `Listing monitors${args.analyst_id ? " for analyst" : ""}${args.type ? ` (${args.type})` : ""}`,

  execute: async (args, ctx) => {
    const sort = args.sort ?? "recent";
    const limit = args.limit ?? 50;

    // Build where clause that scopes monitors to the account via
    // (a) analyst.accountId match for ANALYST-scoped monitors, or
    // (b) FIRM scope (shared across accounts).
    // Either include analyst-in-account OR scope=FIRM.
    const monitors = await prisma.monitor.findMany({
      where: {
        ...(args.analyst_id
          ? { analystId: args.analyst_id, analyst: { accountId: ctx.accountId } }
          : {
              OR: [
                { scope: "FIRM" },
                { analyst: { accountId: ctx.accountId } },
              ],
            }),
        ...(args.type ? { type: args.type } : {}),
        ...(args.enabled_only ? { enabled: true } : {}),
        ...(args.origin ? { origin: args.origin } : {}),
      },
      include: {
        analyst: { select: { id: true, name: true } },
      },
      orderBy:
        sort === "score_desc"
          ? [{ successScore: "desc" }, { tradesSourced: "desc" }]
          : sort === "score_asc"
            ? [{ successScore: "asc" }, { tradesSourced: "desc" }]
            : sort === "trades_desc"
              ? { tradesSourced: "desc" }
              : { createdAt: "desc" },
      take: limit,
    });

    const items: ToolUIItem[] = monitors.map((m) => {
      const scoreStr =
        m.successScore == null
          ? "no closed trades"
          : `score ${m.successScore.toFixed(2)}`;
      const owner = m.scope === "FIRM" ? "FIRM" : (m.analyst?.name ?? "—");
      const enabled = m.enabled ? "" : " · disabled";
      return {
        kind: "generic" as const,
        text: `${m.name} — ${m.type} · ${owner}${enabled} · ${m.tradesSourced} trades (${m.winsSourced}W/${m.lossesSourced}L) · ${scoreStr}`,
      };
    });
    if (items.length === 0) {
      items.push({ kind: "generic", text: "No monitors match those filters." });
    }

    return {
      summary: `${monitors.length} monitor${monitors.length === 1 ? "" : "s"}`,
      data: {
        items,
        monitors: monitors.map((m) => ({
          id: m.id,
          name: m.name,
          type: m.type,
          method: m.method,
          scope: m.scope,
          analystId: m.analystId,
          analystName: m.analyst?.name ?? null,
          enabled: m.enabled,
          origin: m.origin,
          category: m.category,
          class: m.class,
          successScore: m.successScore,
          tradesSourced: m.tradesSourced,
          winsSourced: m.winsSourced,
          lossesSourced: m.lossesSourced,
          lastRunAt: m.lastRunAt,
          lastOutcomeAt: m.lastOutcomeAt,
          config: m.config,
          createdAt: m.createdAt,
        })),
      },
      sources: [],
    };
  },
});
