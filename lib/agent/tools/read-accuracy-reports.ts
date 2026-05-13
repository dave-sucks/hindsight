/**
 * read_accuracy_reports — Principal-chat read tool.
 *
 * Returns the most recent AccuracyReports (the weekly Sunday accuracy
 * scorer output). Each report carries win rate, calibration buckets,
 * signal-type accuracy, direction stats, and the GPT-4o narrative.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import type { ToolUIItem } from "@/lib/agent/tool-result";

export const readAccuracyReports = defineTool({
  description:
    "Read the most recent weekly AccuracyReports (the Sunday scorer output). Returns win rate, confidence calibration, signal-type accuracy, direction breakdowns, and the GPT-4o narrative for each week. Use this to answer 'how am I doing', 'is my system getting better', 'show me last week's calibration'.",
  schema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("How many weeks to return. Default 4."),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: () => "Reading accuracy reports",

  execute: async (args, ctx) => {
    const limit = args.limit ?? 4;
    const reports = await prisma.accuracyReport.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { weekStartDate: "desc" },
      take: limit,
    });

    const items: ToolUIItem[] = reports.map((r) => {
      const winRateStr = r.winRate != null ? `${(r.winRate * 100).toFixed(0)}%` : "—";
      const week = `${r.weekStartDate.toISOString().slice(0, 10)} → ${r.weekEndDate.toISOString().slice(0, 10)}`;
      return {
        kind: "generic" as const,
        text: `${week} · ${r.tradesAnalyzed} trades · win rate ${winRateStr}`,
      };
    });
    if (items.length === 0) {
      items.push({ kind: "generic", text: "No accuracy reports yet." });
    }

    return {
      summary: `${reports.length} accuracy report${reports.length === 1 ? "" : "s"}`,
      data: {
        items,
        reports: reports.map((r) => ({
          id: r.id,
          weekStartDate: r.weekStartDate,
          weekEndDate: r.weekEndDate,
          tradesAnalyzed: r.tradesAnalyzed,
          winRate: r.winRate,
          calibrationData: r.calibrationData,
          signalAccuracy: r.signalAccuracy,
          directionStats: r.directionStats,
          narrativeSummary: r.narrativeSummary,
        })),
      },
      sources: [],
    };
  },
});
