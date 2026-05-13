/**
 * read_analyst_config — Principal-chat read tool.
 *
 * Returns the full configuration for one analyst (universe, prompt,
 * intelligence policy, watchlist, sizing rules, monitors). The principal
 * agent uses this when the user references an analyst by name and the
 * conversation needs more than the stats row from list_analysts.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";

export const readAnalystConfig = defineTool({
  description:
    "Read the full configuration for one analyst — analystPrompt, universe (sectors/industries/themes/marketCap/feeds), watchlist, exclusionList, position sizing rules, intelligence policy, and monitor counts. Pass analyst_id (preferred) or analyst_name (case-insensitive). Use this when the user asks 'what does this analyst do' or before suggesting changes.",
  schema: z.object({
    analyst_id: z.string().optional().describe("AgentConfig.id"),
    analyst_name: z
      .string()
      .optional()
      .describe("Falls back to case-insensitive name match if analyst_id is omitted"),
  }),
  ui: "tool-ui" as const,
  groupId: "Reading",

  progressLabel: (args) =>
    `Reading ${args.analyst_name ?? args.analyst_id ?? "analyst"} config`,

  execute: async (args, ctx) => {
    if (!args.analyst_id && !args.analyst_name) {
      throw new Error("Pass analyst_id or analyst_name.");
    }

    const analyst = await prisma.agentConfig.findFirst({
      where: {
        accountId: ctx.accountId,
        ...(args.analyst_id
          ? { id: args.analyst_id }
          : { name: { equals: args.analyst_name, mode: "insensitive" } }),
      },
      include: {
        _count: {
          select: {
            monitors: true,
            positions: { where: { status: "OPEN" } },
          },
        },
      },
    });

    if (!analyst) {
      throw new Error(
        `Analyst not found (id=${args.analyst_id ?? "—"}, name=${args.analyst_name ?? "—"})`,
      );
    }

    // Watchlist = WATCHING theses (post-collapse). Replaces both
    // `analyst.watchlist` (dropped column) and `_count.watchlistItems`.
    const watchingTheses = await prisma.thesis.findMany({
      where: {
        status: "WATCHING",
        researchRun: { agentConfigId: analyst.id },
      },
      select: { ticker: true },
      orderBy: { createdAt: "desc" },
    });
    const watchlist = Array.from(new Set(watchingTheses.map((t) => t.ticker)));

    const items = [
      {
        kind: "generic" as const,
        text: `${analyst.name} — ${analyst.enabled ? "enabled" : "disabled"} · ${analyst.directionBias} · holds ${analyst.holdDurations.join(", ") || "—"}`,
      },
      {
        kind: "generic" as const,
        text: `Universe: ${analyst.sectors.length} sectors · ${analyst.industries.length} industries · ${analyst.themes.length} themes · ${analyst.feeds.length} feeds`,
      },
      {
        kind: "generic" as const,
        text: `Sizing: minConfidence ${analyst.minConfidence} · maxPositionSize $${analyst.maxPositionSize} · maxOpenPositions ${analyst.maxOpenPositions}`,
      },
      {
        kind: "generic" as const,
        text: `Watchlist: ${watchlist.length} tickers · Exclusion: ${analyst.exclusionList.length} · Monitors: ${analyst._count.monitors}`,
      },
    ];

    return {
      summary: `${analyst.name}: ${analyst.enabled ? "enabled" : "disabled"}, ${analyst._count.positions} open positions`,
      data: {
        items,
        analyst: {
          id: analyst.id,
          name: analyst.name,
          description: analyst.description,
          enabled: analyst.enabled,
          analystPrompt: analyst.analystPrompt,
          analystVoice: analyst.analystVoice,
          directionBias: analyst.directionBias,
          holdDurations: analyst.holdDurations,
          sectors: analyst.sectors,
          industries: analyst.industries,
          themes: analyst.themes,
          feeds: analyst.feeds,
          marketCapMin: analyst.marketCapMin?.toString() ?? null,
          marketCapMax: analyst.marketCapMax?.toString() ?? null,
          watchlist,
          exclusionList: analyst.exclusionList,
          signalTypes: analyst.signalTypes,
          minConfidence: analyst.minConfidence,
          maxPositionSize: analyst.maxPositionSize,
          maxOpenPositions: analyst.maxOpenPositions,
          intelligencePolicy: analyst.intelligencePolicy,
          monitorCount: analyst._count.monitors,
          openPositions: analyst._count.positions,
          watchlistItemCount: watchlist.length,
          createdAt: analyst.createdAt,
        },
      },
      sources: [],
    };
  },
});
