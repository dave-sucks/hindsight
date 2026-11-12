/**
 * web_search — migrated to defineTool().
 *
 * Live Perplexity Sonar search, LIVE_SEARCH_BUDGET searches a run (the
 * Market Reviewer's, which researches the market itself, gets
 * MARKET_REVIEWER_SEARCHES), tracked via a module-level Map keyed by runId.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { searchSignals } from "@/lib/intelligence/sonar";
import { toSourceRefs, sourceRefsToToolSources } from "@/lib/agent/tool-types";
import type { SignalItem, WebSearchToolData } from "@/lib/agent/tool-types";

// Per-run search count — keyed by runId to scope budget to the current run.
const liveSearchCounts = new Map<string, number>();
/** Searches per run (a first search on a stock doesn't count against it). */
export const LIVE_SEARCH_BUDGET = 5;
/** The Market Reviewer's searches a run: it finds the market's moves and news itself. */
export const MARKET_REVIEWER_SEARCHES = 10;
// The stocks whose one news search this run has spent (voice.ts: look it up before a decision note).
const stockSearches = new Map<string, Set<string>>();
// The pages the Market Reviewer's searches returned, by run: its digest links only these (write-market-digest.ts).
const pagesByRun = new Map<string, Set<string>>();
/** A link as it is compared: no spaces, no trailing slash. */
export const pageKey = (url: string) => url.trim().replace(/\/+$/, "");
/** The pages this run's searches returned. */
export const pagesFound = (runId: string): ReadonlySet<string> => pagesByRun.get(runId) ?? new Set();
/** The run is over: forget its pages (lib/agent/market-reviewer/run.ts). */
export const forgetPagesFound = (runId: string) => void pagesByRun.delete(runId);
/** The reply budget a search asks Sonar for. */
export const SEARCH_REPLY_TOKENS = 4096;

export const webSearch = defineTool({
  description:
    "Search the web for real-time information via Perplexity Sonar: breaking news, recent developments, or niche topics.",
  schema: z.object({
    query: z.string().describe("Search query — be specific and financial-context-aware"),
    recency: z
      .enum(["hour", "day", "week", "month"])
      .optional()
      .describe("How recent results should be (default: day)"),
    ticker: z
      .string()
      .optional()
      .describe("The stock, when this is its news search before a decision: one per stock per run, outside the run's search budget."),
  }),
  ui: "tool-ui" as const,

  progressLabel: (args) => {
    const q = args.query.trim();
    const truncated = q.length > 50 ? `${q.slice(0, 50)}…` : q;
    return `Searching the web for "${truncated}"`;
  },

  execute: async ({ query, recency = "day", ticker }, ctx) => {
    // One budget for every run but the Market Reviewer's; there is no per-analyst setting.
    const budget = ctx.runMode === "MARKET_REVIEWER" ? MARKET_REVIEWER_SEARCHES : LIVE_SEARCH_BUDGET;
    const count = liveSearchCounts.get(ctx.runId) ?? 0;
    const searched = stockSearches.get(ctx.runId) ?? new Set<string>();
    const stock = ticker?.trim().toUpperCase().replace(/^\$/, "") || null;
    const stockSearch = stock != null && !searched.has(stock);

    if (!stockSearch && count >= budget) {
      return {
        summary: `Live search budget exhausted (${budget}/${budget} used).`,
        data: {
          query,
          resultCount: 0,
          budgetUsed: count,
          budgetMax: budget,
          results: [],
          allowed: false,
        } as WebSearchToolData & { allowed: boolean },
        sources: [],
      };
    }

    // A stock's one news search doesn't spend the run's budget; any other search does.
    if (stockSearch) stockSearches.set(ctx.runId, searched.add(stock));
    else liveSearchCounts.set(ctx.runId, count + 1);
    const newCount = stockSearch ? count : count + 1;

    // Room for the whole reply: at Sonar's default 1,024 tokens the JSON was cut off,
    // failed to parse and came back as no results (IOT, NVDA, SMCI on 2026-10-20).
    const sonarResult = await searchSignals(query, { recency, model: "sonar", maxTokens: SEARCH_REPLY_TOKENS });

    const results: SignalItem[] = sonarResult.signals.map((s) => ({
      headline: s.headline,
      summary: s.summary,
      tickers: s.tickers,
      themes: s.themes,
      sentiment: s.sentiment,
      urgency: s.urgency,
      sources: toSourceRefs(s.sourceNames, s.sourceUrls),
    }));

    if (ctx.runMode === "MARKET_REVIEWER") {
      const pages = pagesByRun.get(ctx.runId) ?? new Set<string>();
      for (const r of results) for (const s of r.sources) if (s.url) pages.add(pageKey(s.url));
      pagesByRun.set(ctx.runId, pages);
    }

    return {
      summary: `Found ${results.length} result${results.length !== 1 ? "s" : ""} for "${query.slice(0, 60)}". Budget: ${newCount}/${budget}.`,
      data: {
        query,
        resultCount: results.length,
        budgetUsed: newCount,
        budgetMax: budget,
        results,
        tickers: results
          .filter((r) => r.tickers.length > 0)
          .map((r) => ({ ticker: r.tickers[0], tag: r.sentiment, summary: r.headline })),
      } as WebSearchToolData & { tickers: { ticker: string; tag: string; summary: string }[] },
      sources: sourceRefsToToolSources(results.flatMap((r) => r.sources)),
    };
  },
});
