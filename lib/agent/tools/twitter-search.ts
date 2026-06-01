/**
 * twitter_search — Grok Live Search over X for handle-attributed posts.
 *
 * Sibling to web_search. The agent picks between them based on intent:
 *   - web_search (Perplexity Sonar) — general web; consensus / news / sell-side.
 *   - twitter_search (xAI Live Search w/ sources:["x"]) — handle attribution,
 *     fintwit early calls, multi-archetype convergence on a name.
 *
 * Shipped 2026-05-31 as DISCOVERY_OVERHAUL SOON-1b. See
 * docs/plans/DISCOVERY_OVERHAUL.md for the design context.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { searchX, type XaiPost } from "@/lib/intelligence/xai-live-search";

// Per-run search count — keyed by runId to scope budget to the current run.
// Separate from web_search's budget because the costs and use cases differ.
const twitterSearchCounts = new Map<string, number>();

// Default budget when intelligencePolicy doesn't specify one. Lower than
// web_search because twitter_search is meant for sharp investigative
// probes during conversation, not bulk scanning.
const DEFAULT_TWITTER_SEARCH_BUDGET = 5;

export const twitterSearch = defineTool({
  description:
    "Search X (Twitter) via Grok Live Search for handle-attributed posts on a ticker, theme, or named handle. Returns structured posts with author + ticker + archetype (TECHNICAL / FUNDAMENTAL / NARRATIVE / OPTIONS_FLOW / CATALYST_EVENT / MACRO) + claim_excerpt + sentiment + recency. " +
    "Use when you need handle attribution, social attention shifts, fintwit early calls, or multi-archetype convergence (the same ticker named by technicians + fundamentalists + narrative traders is a stronger signal than any one alone). " +
    "Use `web_search` instead for general news, sell-side coverage, or neutral wire content. " +
    "Budget-limited per run; sharp probes (one ticker, one handle, one theme) are the right shape, not bulk scans.",
  schema: z.object({
    query: z
      .string()
      .describe(
        "Search query — sharp and specific. Examples: 'who is bullish on $MU pre-earnings this week', 'rare earths convergence among momentum and fundamentals traders past 7 days', 'what is @traderstewie saying about $NVDA this month'.",
      ),
    recency: z
      .enum(["hour", "day", "week", "month"])
      .optional()
      .describe(
        "Recency window for posts. Default 'week'. Use 'day' for hot reactions, 'month' for trend-tracking.",
      ),
    max_posts: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe(
        "Cap on how many attributed posts to return. Default 12. Lower for focused probes.",
      ),
    handles: z
      .array(z.string())
      .optional()
      .describe(
        "Optional allowlist of handles (with or without @). When set, ONLY posts from these accounts are returned. Use for 'what is @beth_kindig saying' style probes.",
      ),
  }),
  ui: "tool-ui" as const,

  progressLabel: (args) => {
    const q = args.query.trim();
    const truncated = q.length > 50 ? `${q.slice(0, 50)}…` : q;
    return `Reading X for "${truncated}"`;
  },

  execute: async ({ query, recency = "week", max_posts, handles }, ctx) => {
    const policy = ctx.intelligencePolicy;

    // Respect the same allowLiveSearch flag as web_search — if the analyst
    // has live search disabled wholesale, twitter_search is also disabled.
    if (policy && !policy.allowLiveSearch) {
      return {
        summary: "Live search disabled by intelligence policy.",
        data: {
          query,
          source: "xai_live_search" as const,
          resultCount: 0,
          budgetUsed: 0,
          budgetMax: 0,
          posts: [],
          allowed: false,
          items: [],
        },
        sources: [],
      };
    }

    const budget =
      policy?.liveSearchBudget ?? DEFAULT_TWITTER_SEARCH_BUDGET;
    const count = twitterSearchCounts.get(ctx.runId) ?? 0;

    if (count >= budget) {
      return {
        summary: `Twitter search budget exhausted (${budget}/${budget} used).`,
        data: {
          query,
          source: "xai_live_search" as const,
          resultCount: 0,
          budgetUsed: count,
          budgetMax: budget,
          posts: [],
          allowed: false,
          items: [],
        },
        sources: [],
      };
    }

    twitterSearchCounts.set(ctx.runId, count + 1);
    const newCount = count + 1;

    let result;
    try {
      result = await searchX(query, {
        recency,
        maxPosts: max_posts,
        handleAllowlist: handles,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[twitter_search] failed: ${message}`);
      return {
        summary: `Twitter search failed: ${message.slice(0, 200)}`,
        data: {
          query,
          source: "xai_live_search" as const,
          resultCount: 0,
          budgetUsed: newCount,
          budgetMax: budget,
          posts: [],
          allowed: true,
          error: message,
          items: [],
        },
        sources: [],
      };
    }

    const posts = result.posts ?? [];

    // Shape items for ToolUIRenderer. Each ticker-anchored post becomes a
    // ticker row (logo chip + sentiment tag + claim_excerpt); thematic
    // posts (ticker=null) become generic rows. The agent's render is the
    // standard tool-progress card.
    const items = posts.map((p: XaiPost) => {
      const handleTag = `@${p.handle}`;
      const text = `${handleTag} (${p.archetype.toLowerCase()}, ${p.recency}): ${p.claim_excerpt}`;
      if (p.ticker) {
        return {
          kind: "ticker" as const,
          ticker: p.ticker,
          tag: p.sentiment,
          text,
        };
      }
      return { kind: "generic" as const, text };
    });

    // Citation/source list — every post with a URL becomes a tool source.
    const sources = posts
      .filter((p): p is XaiPost & { post_url: string } => Boolean(p.post_url))
      .map((p) => ({
        provider: "xai" as const,
        title: `@${p.handle}${p.ticker ? ` · $${p.ticker}` : ""} (${p.recency})`,
        url: p.post_url,
      }));

    return {
      summary:
        posts.length === 0
          ? `No attributed posts surfaced for "${query.slice(0, 60)}". Budget: ${newCount}/${budget}.`
          : `Found ${posts.length} attributed post${posts.length !== 1 ? "s" : ""} on X for "${query.slice(0, 60)}". Budget: ${newCount}/${budget}.${result.summary ? ` Frame: ${result.summary}` : ""}`,
      data: {
        query,
        source: "xai_live_search" as const,
        resultCount: posts.length,
        budgetUsed: newCount,
        budgetMax: budget,
        posts,
        allowed: true,
        items,
        framingSummary: result.summary ?? null,
      },
      sources,
    };
  },
});
