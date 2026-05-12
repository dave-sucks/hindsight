/**
 * list_runs — Principal-chat read tool.
 *
 * Lists recent ResearchRuns across all analysts (or filtered to one).
 * Used when the user asks "how did this morning go" / "show me last
 * week's runs" / "what did Catalyst Event Raider do today".
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import type { ToolUIItem } from "@/lib/agent/tool-result";

export const listRuns = defineTool({
  description:
    "List recent ResearchRuns across all analysts. Filter by analyst_id, mode (MORNING_PLAN / INTRADAY_TACTICAL / DISCOVERY), or status (RUNNING / COMPLETE / FAILED). Defaults to last 20 runs across all analysts. Use this to answer 'how did today go', 'show me failed runs', 'what did $analyst do this week'.",
  schema: z.object({
    analyst_id: z.string().optional(),
    mode: z
      .enum(["MORNING_PLAN", "INTRADAY_TACTICAL", "DISCOVERY", "EOD_REFLECTIVE"])
      .optional(),
    status: z.enum(["RUNNING", "COMPLETE", "FAILED", "PENDING"]).optional(),
    limit: z.number().int().min(1).max(50).optional().describe("Default 20"),
    lookback_days: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .describe("If set, only return runs from the last N days"),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: (args) => {
    const parts = ["Listing runs"];
    if (args.analyst_id) parts.push("for analyst");
    if (args.status) parts.push(`(${args.status.toLowerCase()})`);
    return parts.join(" ");
  },

  execute: async (args, ctx) => {
    const limit = args.limit ?? 20;
    const since = args.lookback_days
      ? new Date(Date.now() - args.lookback_days * 86400_000)
      : undefined;

    const runs = await prisma.researchRun.findMany({
      where: {
        userId: ctx.userId,
        ...(args.analyst_id ? { agentConfigId: args.analyst_id } : {}),
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.status ? { status: args.status } : {}),
        ...(since ? { startedAt: { gte: since } } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: limit,
      include: {
        agentConfig: { select: { id: true, name: true } },
        _count: { select: { theses: true, decisions: true } },
      },
    });

    const items: ToolUIItem[] = runs.map((r) => {
      const ts = r.startedAt.toISOString().slice(0, 16).replace("T", " ");
      const analyst = r.agentConfig?.name ?? "—";
      const duration =
        r.completedAt && r.startedAt
          ? `${Math.round((r.completedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
          : r.status === "RUNNING"
            ? "running"
            : "—";
      return {
        kind: "generic" as const,
        text: `${ts} · ${analyst} · ${r.mode} · ${r.status} · ${r._count.theses} theses · ${r._count.decisions} decisions · ${duration}`,
      };
    });
    if (items.length === 0) {
      items.push({ kind: "generic", text: "No runs match those filters." });
    }

    return {
      summary: `${runs.length} run${runs.length === 1 ? "" : "s"}`,
      data: {
        items,
        runs: runs.map((r) => ({
          id: r.id,
          analystId: r.agentConfigId,
          analystName: r.agentConfig?.name ?? null,
          mode: r.mode,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          thesisCount: r._count.theses,
          decisionCount: r._count.decisions,
        })),
      },
      sources: [],
    };
  },
});
