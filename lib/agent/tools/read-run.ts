/**
 * read_run — Principal-chat read tool.
 *
 * Pulls one ResearchRun in detail: status, mode, parameters snapshot,
 * theses produced, trade decisions taken, briefing standup, and the
 * toolStats observability bundle. The agent uses this to answer
 * "why did that run fail" / "what did $analyst's morning run decide".
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";

export const readRun = defineTool({
  description:
    "Read one ResearchRun in detail — status, mode, theses produced, decisions taken, briefing standup, tool stats. Pass run_id from list_runs. Use this to triage a specific run: 'why did the 8 AM Catalyst run fail', 'what did discovery mint on Sunday'.",
  schema: z.object({
    run_id: z.string(),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: () => "Reading run details",

  execute: async (args, ctx) => {
    const run = await prisma.researchRun.findFirst({
      where: { id: args.run_id, accountId: ctx.accountId },
      include: {
        agentConfig: { select: { id: true, name: true } },
        theses: {
          select: {
            id: true,
            ticker: true,
            direction: true,
            status: true,
            scoring: true,
            targetPrice: true,
            stopLoss: true,
            snapshot: true,
            createdAt: true,
          },
        },
        decisions: {
          select: {
            id: true,
            symbol: true,
            decision: true,
            reasoning: true,
            thesisId: true,
            positionId: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        briefing: {
          select: {
            id: true,
            narrative: true,
            createdAt: true,
          },
        },
      },
    });

    if (!run) throw new Error(`Run ${args.run_id} not found.`);

    const params = (run.parameters as Record<string, unknown> | null) ?? {};
    const toolStats =
      params.toolStats && typeof params.toolStats === "object"
        ? (params.toolStats as Record<string, unknown>)
        : null;

    const items: Array<{ kind: "generic"; text: string }> = [
      {
        kind: "generic",
        text: `${run.agentConfig?.name ?? "—"} · ${run.mode} · ${run.status} · started ${run.startedAt.toISOString()}`,
      },
      {
        kind: "generic",
        text: `${run.theses.length} theses · ${run.decisions.length} decisions${run.briefing ? " · briefing written" : " · no briefing"}`,
      },
    ];
    if (toolStats) {
      items.push({
        kind: "generic",
        text: `Tool calls: ${toolStats.totalToolCalls ?? "?"} · duration ${toolStats.durationMs ?? "?"}ms`,
      });
    }
    for (const d of run.decisions.slice(0, 8)) {
      items.push({
        kind: "generic",
        text: `${d.decision} $${d.symbol}${d.reasoning ? ` — ${d.reasoning.slice(0, 60)}` : ""}`,
      });
    }
    if (run.decisions.length > 8) {
      items.push({
        kind: "generic",
        text: `…and ${run.decisions.length - 8} more decisions`,
      });
    }

    return {
      summary: `Run ${run.id.slice(0, 8)} — ${run.status} · ${run.theses.length} theses · ${run.decisions.length} decisions`,
      data: {
        items,
        run: {
          id: run.id,
          analystId: run.agentConfigId,
          analystName: run.agentConfig?.name ?? null,
          mode: run.mode,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          briefing: run.briefing
            ? {
                id: run.briefing.id,
                narrative: run.briefing.narrative,
                generatedAt: run.briefing.createdAt,
              }
            : null,
          theses: run.theses,
          decisions: run.decisions,
          toolStats,
        },
      },
      sources: [],
    };
  },
});
