/**
 * list_analysts — Principal-chat read tool.
 *
 * Cross-cutting: returns every analyst owned by the user with a tight
 * stats row (open positions, watchlist size, active theses, last run,
 * recent accuracy if available). Lets the chat-level agent answer
 * "which of my analysts is underperforming" / "show me my analysts" /
 * "@Catalyst Event Raider — what's going on" without needing a separate
 * page load.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import type { ToolUIItem } from "@/lib/agent/tool-result";

export const listAnalysts = defineTool({
  description:
    "List every analyst owned by the user with quick stats: enabled flag, archetype/holdDurations, open positions, watchlist size, active theses, last run timestamp. Use this before talking about a specific analyst — names + IDs come from here.",
  schema: z.object({
    enabled_only: z
      .boolean()
      .optional()
      .describe("If true, only return analysts with enabled=true."),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: () => "Listing your analysts",

  execute: async (args, ctx) => {
    const analysts = await prisma.agentConfig.findMany({
      where: {
        accountId: ctx.accountId,
        ...(args.enabled_only ? { enabled: true } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        directionBias: true,
        holdDurations: true,
        sectors: true,
        maxOpenPositions: true,
        createdAt: true,
      },
    });

    // Replacement for the _count include (Prisma doesn't allow _count
    // alongside selected scalars on every model in our version).
    const countsByAnalyst = new Map<
      string,
      { openPositions: number; researchRuns: number }
    >();
    if (analysts.length > 0) {
      const [openPositions, runCounts] = await Promise.all([
        prisma.position.groupBy({
          by: ["analystId"],
          where: { analystId: { in: analysts.map((a) => a.id) }, status: "OPEN" },
          _count: true,
        }),
        prisma.researchRun.groupBy({
          by: ["agentConfigId"],
          where: { agentConfigId: { in: analysts.map((a) => a.id) } },
          _count: true,
        }),
      ]);
      for (const op of openPositions) {
        if (!op.analystId) continue;
        countsByAnalyst.set(op.analystId, {
          openPositions: op._count,
          researchRuns: 0,
        });
      }
      for (const rc of runCounts) {
        if (!rc.agentConfigId) continue;
        const existing = countsByAnalyst.get(rc.agentConfigId) ?? {
          openPositions: 0,
          researchRuns: 0,
        };
        existing.researchRuns = rc._count;
        countsByAnalyst.set(rc.agentConfigId, existing);
      }
    }

    // Watchlist tickers per analyst — WATCHING theses (post-collapse).
    const watchlistByAnalyst = new Map<string, string[]>();
    if (analysts.length > 0) {
      const watchingTheses = await prisma.thesis.findMany({
        where: {
          status: "WATCHING",
          researchRun: { agentConfigId: { in: analysts.map((a) => a.id) } },
        },
        select: {
          ticker: true,
          researchRun: { select: { agentConfigId: true } },
        },
      });
      for (const t of watchingTheses) {
        const aid = t.researchRun.agentConfigId;
        if (!aid) continue;
        const arr = watchlistByAnalyst.get(aid) ?? [];
        if (!arr.includes(t.ticker)) arr.push(t.ticker);
        watchlistByAnalyst.set(aid, arr);
      }
    }

    // Active thesis counts per analyst (via ResearchRun → Thesis)
    const analystIds = analysts.map((a) => a.id);
    const activeTheses = analystIds.length
      ? await prisma.thesis.groupBy({
          by: ["researchRunId"],
          where: {
            researchRun: { agentConfigId: { in: analystIds } },
            // Live coverage book — every status the closeout contract
            // expects action on each run. PROMOTED included so the per-
            // analyst thesis count doesn't drop during the promotion window.
            status: { in: ["ACTIVE", "WATCHING", "PROMOTED"] },
          },
          _count: true,
        })
      : [];
    // Map ResearchRun → agentConfigId
    const runIds = activeTheses.map((t) => t.researchRunId);
    const runs = runIds.length
      ? await prisma.researchRun.findMany({
          where: { id: { in: runIds } },
          select: { id: true, agentConfigId: true },
        })
      : [];
    const runToAnalyst = new Map(runs.map((r) => [r.id, r.agentConfigId]));
    const thesisByAnalyst = new Map<string, number>();
    for (const t of activeTheses) {
      const analystId = runToAnalyst.get(t.researchRunId);
      if (!analystId) continue;
      thesisByAnalyst.set(
        analystId,
        (thesisByAnalyst.get(analystId) ?? 0) + t._count,
      );
    }

    // Last completed run per analyst
    const lastRuns = analystIds.length
      ? await prisma.researchRun.findMany({
          where: { agentConfigId: { in: analystIds }, status: "COMPLETE" },
          orderBy: { completedAt: "desc" },
          distinct: ["agentConfigId"],
          select: { agentConfigId: true, completedAt: true },
        })
      : [];
    const lastRunByAnalyst = new Map(
      lastRuns
        .filter((r) => r.agentConfigId)
        .map((r) => [r.agentConfigId as string, r.completedAt]),
    );

    const rows = analysts.map((a) => {
      const activeThesisCount = thesisByAnalyst.get(a.id) ?? 0;
      const lastRunAt = lastRunByAnalyst.get(a.id) ?? null;
      const lastRunStr = lastRunAt
        ? new Date(lastRunAt).toISOString().slice(0, 10)
        : "no completed runs";
      const enabled = a.enabled ? "enabled" : "disabled";
      const counts = countsByAnalyst.get(a.id) ?? { openPositions: 0, researchRuns: 0 };
      const text = `${a.name} — ${enabled} · ${counts.openPositions} open · ${activeThesisCount} active theses · last run ${lastRunStr}`;
      return { id: a.id, name: a.name, text };
    });

    const items: ToolUIItem[] = rows.map((r) => ({
      kind: "generic" as const,
      text: r.text,
    }));

    const headline = `${rows.length} analyst${rows.length === 1 ? "" : "s"}`;
    items.unshift({ kind: "generic", text: headline });

    return {
      summary: headline,
      data: {
        items,
        analysts: analysts.map((a) => {
          const counts = countsByAnalyst.get(a.id) ?? { openPositions: 0, researchRuns: 0 };
          return {
            id: a.id,
            name: a.name,
            description: a.description,
            enabled: a.enabled,
            directionBias: a.directionBias,
            holdDurations: a.holdDurations,
            sectors: a.sectors,
            watchlist: watchlistByAnalyst.get(a.id) ?? [],
            maxOpenPositions: a.maxOpenPositions,
            activeTheses: thesisByAnalyst.get(a.id) ?? 0,
            openPositions: counts.openPositions,
            totalRuns: counts.researchRuns,
            lastRunAt: lastRunByAnalyst.get(a.id) ?? null,
          };
        }),
      },
      sources: [],
    };
  },
});
