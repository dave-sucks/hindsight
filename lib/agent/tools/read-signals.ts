/**
 * read_signals — migrated to defineTool().
 *
 * Reads intelligence signals routed to this analyst by background jobs.
 * Applies intelligence policy constraints (urgency floor, source quality,
 * budget). Falls back to sector/watchlist match if no routed signals.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { etTradingDayDate } from "@/lib/market-hours";
import { toSourceRefs, sourceRefsToToolSources } from "@/lib/agent/tool-types";
import type { SignalItem, SignalsToolData } from "@/lib/agent/tool-types";

export const readSignals = defineTool({
  description:
    "Read intelligence signals routed to you by background discovery jobs. Returns pre-gathered news, filings, earnings, social, and macro signals matched to your mandate. Filter by tickers, themes, or urgency. Signals are marked as READ after retrieval. Use this to understand what the intelligence pipeline found for you today.",
  schema: z.object({
    tickers: z.array(z.string()).optional().describe("Filter to signals mentioning these tickers"),
    themes: z.array(z.string()).optional().describe("Filter to signals with these themes (e.g. AI_CAPEX, FED_RATE_CUT)"),
    type: z
      .enum(["NEWS", "EARNINGS", "FILING", "SOCIAL", "PRICE_ACTION", "ANALYST_NOTE", "OPTIONS", "MACRO", "SECTOR"])
      .optional()
      .describe("Filter to a specific signal type"),
    urgency: z
      .enum(["LOW", "MEDIUM", "HIGH", "BREAKING"])
      .optional()
      .describe("Minimum urgency level"),
    limit: z.number().optional().describe("Max signals to return (default 20, capped by intelligence policy)"),
  }),
  ui: "ticker-list" as const,

  execute: async ({ tickers, themes, type, urgency, limit = 3 }, ctx) => {
    if (!ctx.analystId) {
      return {
        summary: "No analyst context — cannot read signals.",
        data: { count: 0, signals: [] } as SignalsToolData,
        sources: [],
      };
    }

    const policy = ctx.intelligencePolicy;
    const policyMaxSignals = policy?.maxSignalsPerRun ?? 30;
    const effectiveLimit = Math.min(limit, policyMaxSignals);

    const urgencyOrder = ["LOW", "MEDIUM", "HIGH", "BREAKING"];
    const callerMinIdx = urgency ? urgencyOrder.indexOf(urgency) : 0;
    const policyMinIdx = policy?.minUrgency ? urgencyOrder.indexOf(policy.minUrgency) : 0;
    const effectiveMinIdx = Math.max(callerMinIdx, policyMinIdx);
    const validUrgencies = urgencyOrder.slice(effectiveMinIdx);

    const minSourceQuality = policy?.minSourceQuality ?? 2;
    const excludedCategories = policy?.excludedSourceCategories ?? [];

    const routes = await prisma.analystSignalRoute.findMany({
      where: {
        analystId: ctx.analystId,
        status: { in: ["PENDING", "READ"] },
        signal: {
          ...(tickers && tickers.length > 0 ? { tickers: { hasSome: tickers } } : {}),
          ...(themes && themes.length > 0 ? { themes: { hasSome: themes } } : {}),
          ...(type ? { type } : {}),
          urgency: { in: validUrgencies },
          sourceQuality: { gte: minSourceQuality },
        },
      },
      include: { signal: { include: { artifact: true } } },
      orderBy: { relevanceScore: "desc" },
      take: effectiveLimit + excludedCategories.length * 5,
    });

    let filtered = routes;
    if (excludedCategories.length > 0) {
      filtered = routes.filter((r) => {
        const signalSectors = r.signal.sectors ?? [];
        return !signalSectors.some((s: string) => (excludedCategories as string[]).includes(s));
      });
    }

    const finalRoutes = filtered.slice(0, effectiveLimit);

    if (finalRoutes.length > 0) {
      await prisma.analystSignalRoute.updateMany({
        where: { id: { in: finalRoutes.map((r) => r.id) } },
        data: { status: "READ" },
      });
    }

    // Fallback: query by sectors/watchlist if no routed signals
    if (finalRoutes.length === 0) {
      const config = await prisma.agentConfig.findUnique({
        where: { id: ctx.analystId },
        select: { sectors: true, watchlist: true },
      });

      if (config && (config.sectors.length > 0 || config.watchlist.length > 0)) {
        const today = etTradingDayDate();
        const fallbackSignals = await prisma.signal.findMany({
          where: {
            createdAt: { gte: today },
            urgency: { in: validUrgencies },
            sourceQuality: { gte: minSourceQuality },
            OR: [
              ...(config.watchlist.length > 0 ? [{ tickers: { hasSome: config.watchlist } }] : []),
              ...(config.sectors.length > 0 ? [{ sectors: { hasSome: config.sectors } }] : []),
            ],
          },
          orderBy: { createdAt: "desc" },
          take: effectiveLimit,
        });

        if (fallbackSignals.length > 0) {
          const fbSignals: SignalItem[] = fallbackSignals.map((s) => ({
            signalId: s.id,
            type: s.type,
            headline: s.headline,
            summary: s.summary ?? "",
            tickers: s.tickers,
            themes: s.themes,
            sentiment: s.sentiment ?? "NEUTRAL",
            urgency: s.urgency ?? "MEDIUM",
            freshness: s.freshness ?? undefined,
            sources: toSourceRefs(s.sourceNames, s.sourceUrls),
            relevanceScore: 0,
            routeReason: "fallback_sector_watchlist_match",
            artifactId: s.artifactId,
          }));
          const urgent = fbSignals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
          const bullish = fbSignals.filter((s) => s.sentiment === "BULLISH").length;
          const bearish = fbSignals.filter((s) => s.sentiment === "BEARISH").length;
          return {
            summary: `${fbSignals.length} signal${fbSignals.length !== 1 ? "s" : ""} (${urgent} urgent, ${bullish} bullish, ${bearish} bearish). Fallback: sector/watchlist match.`,
            data: {
              count: fbSignals.length,
              fallback: true,
              fallbackReason: "No routed signals found — falling back to sector/watchlist match",
              policyApplied: { maxSignals: policyMaxSignals, minUrgency: urgencyOrder[effectiveMinIdx], minSourceQuality, excludedCategories },
              signals: fbSignals,
              tickers: fbSignals.map((s) => ({ ticker: s.tickers[0] ?? "MACRO", tag: s.urgency, summary: s.headline })),
            } as SignalsToolData & { tickers: { ticker: string; tag: string; summary: string }[] },
            sources: sourceRefsToToolSources(fbSignals.flatMap((s) => s.sources)),
          };
        }
      }
    }

    const mappedSignals: SignalItem[] = finalRoutes.map((r) => ({
      signalId: r.signal.id,
      type: r.signal.type,
      headline: r.signal.headline,
      summary: r.signal.summary ?? "",
      tickers: r.signal.tickers,
      themes: r.signal.themes,
      sentiment: r.signal.sentiment ?? "NEUTRAL",
      urgency: r.signal.urgency ?? "MEDIUM",
      freshness: r.signal.freshness ?? undefined,
      sources: toSourceRefs(r.signal.sourceNames, r.signal.sourceUrls),
      relevanceScore: r.relevanceScore,
      routeReason: r.routeReason ?? undefined,
      artifactId: r.signal.artifactId,
    }));

    const urgent = mappedSignals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
    const bullish = mappedSignals.filter((s) => s.sentiment === "BULLISH").length;
    const bearish = mappedSignals.filter((s) => s.sentiment === "BEARISH").length;

    return {
      summary: `${mappedSignals.length} signal${mappedSignals.length !== 1 ? "s" : ""} (${urgent} urgent, ${bullish} bullish, ${bearish} bearish).`,
      data: {
        count: mappedSignals.length,
        policyApplied: { maxSignals: policyMaxSignals, minUrgency: urgencyOrder[effectiveMinIdx], minSourceQuality, excludedCategories },
        signals: mappedSignals,
        tickers: mappedSignals.map((s) => ({ ticker: s.tickers[0] ?? "MACRO", tag: s.urgency, summary: s.headline })),
      } as SignalsToolData & { tickers: { ticker: string; tag: string; summary: string }[] },
      sources: sourceRefsToToolSources(mappedSignals.flatMap((s) => s.sources)),
    };
  },
});
