/**
 * get_market_movers — pull tool for today's biggest movers.
 *
 * The firm-market-sweep cron writes one aggregate Signal per category
 * (gainers, losers, most actives) per day via FMP /stable/biggest-gainers,
 * /stable/biggest-losers, /stable/most-actives. Analysts subscribed via
 * `AgentConfig.feeds` (canonical `MARKET_MOVERS_GAINERS`,
 * `MARKET_MOVERS_LOSERS`, `MARKET_MOVERS_ACTIVES`) get them routed
 * automatically. This tool is the on-demand pull path for analysts that
 * aren't subscribed but want a fresh look.
 *
 * Renders via the generic ToolUIRenderer (`ui: "tool-ui"`). Each mover
 * becomes a ticker row item with the % change in the tag and price in the
 * text. NEVER add a per-tool renderer — the recurring-bugs guidance in
 * CLAUDE.md is explicit on that.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";

const FMP_KEY = process.env.FMP_API_KEY!;

const MOVER_PATHS: Record<"gainers" | "losers" | "active", { path: string; label: string }> = {
  gainers: { path: "/stable/biggest-gainers", label: "Top gainers" },
  losers: { path: "/stable/biggest-losers", label: "Top losers" },
  active: { path: "/stable/most-actives", label: "Most active" },
};

interface MoverRow {
  symbol: string;
  name?: string;
  price?: number;
  change?: number;
  // FMP renamed `changesPercentage` → `percentChange` in /stable/. Accept both.
  percentChange?: number;
  changesPercentage?: number;
  volume?: number;
}

export const getMarketMovers = defineTool({
  description:
    "Pull today's market movers from FMP — gainers, losers, or most actives. " +
    "Use `scope: \"universe\"` to fence to this analyst's watchlist + open positions; " +
    "`scope: \"all\"` returns the full top-list. Prefer `scope: \"all\"` for momentum / " +
    "mean-reversion playbooks where the universe IS the firehose; prefer `scope: \"universe\"` " +
    "for sector-specialist analysts who only want movers among their own names.",
  schema: z.object({
    type: z
      .enum(["gainers", "losers", "active"])
      .describe("'gainers' = top % up, 'losers' = top % down, 'active' = highest volume."),
    scope: z
      .enum(["universe", "all"])
      .optional()
      .describe(
        "'universe' fences to watchlist + open positions; 'all' returns the full top-list. Defaults to 'all'.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => {
    const { label } = MOVER_PATHS[args.type];
    const scope = args.scope ?? "all";
    return scope === "universe" ? `Pulling ${label.toLowerCase()} in your universe` : `Pulling ${label.toLowerCase()}`;
  },

  execute: async (args, ctx) => {
    const scope = args.scope ?? "all";
    const { path, label } = MOVER_PATHS[args.type];

    const url = `https://financialmodelingprep.com${path}?apikey=${FMP_KEY}`;
    let raw: MoverRow[] = [];
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        return {
          summary: `FMP ${label.toLowerCase()} unavailable (HTTP ${res.status}).`,
          data: {
            items: [{ kind: "generic" as const, text: `${label} fetch failed (HTTP ${res.status}).` }],
            type: args.type,
            scope,
            count: 0,
            rows: [] as MoverRow[],
          },
          sources: [],
        };
      }
      const json = (await res.json()) as MoverRow[];
      raw = Array.isArray(json) ? json : [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : "movers fetch error";
      return {
        summary: `FMP ${label.toLowerCase()} fetch threw: ${msg}.`,
        data: {
          items: [{ kind: "generic" as const, text: `${label} unavailable: ${msg}` }],
          type: args.type,
          scope,
          count: 0,
          rows: [] as MoverRow[],
        },
        sources: [],
      };
    }

    const pctOf = (m: MoverRow): number => m.percentChange ?? m.changesPercentage ?? 0;

    // ── Universe fence (v1): ticker-set intersection vs watchlist + positions
    // Industry / sector fencing requires per-ticker enrichment — too expensive
    // here. Same trade-off as get_earnings_calendar; deferred to router-side.
    const watchlist = (ctx as { watchlist?: string[] })?.watchlist ?? [];
    const positionTickers = (ctx as { positionTickers?: string[] })?.positionTickers ?? [];
    const universeSet = new Set(
      [...watchlist, ...positionTickers].map((t) => t.toUpperCase()),
    );
    const filtered =
      scope === "universe" && universeSet.size > 0
        ? raw.filter((m) => universeSet.has(m.symbol.toUpperCase()))
        : raw;

    // Sort by absolute % change so the most extreme moves bubble to the top
    // regardless of gainer/loser/active. Cap at 25 visible rows to keep the
    // tool row readable; full set still in data.rows for the agent.
    const sorted = [...filtered].sort((a, b) => Math.abs(pctOf(b)) - Math.abs(pctOf(a)));
    const VISIBLE_CAP = 25;
    const visible = sorted.slice(0, VISIBLE_CAP);
    const remaining = sorted.length - visible.length;

    const fenceNote =
      scope === "universe"
        ? universeSet.size > 0
          ? `fenced to your ${universeSet.size} watchlist + position ticker(s)`
          : "no watchlist or open positions to fence against — returning full list"
        : "full firm list";

    const headerText =
      sorted.length === 0
        ? `No ${label.toLowerCase()} matched (${fenceNote}).`
        : `${label}: ${sorted.length} name${sorted.length === 1 ? "" : "s"} (${fenceNote}).`;

    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [{ kind: "generic", text: headerText }];

    for (const row of visible) {
      const pct = pctOf(row);
      const sign = pct >= 0 ? "+" : "";
      const priceText = row.price != null ? ` · $${row.price.toFixed(2)}` : "";
      items.push({
        kind: "ticker",
        ticker: row.symbol,
        tag: `${sign}${pct.toFixed(2)}%`,
        text: `${row.name ?? ""}${priceText}`.trim() || `Today's ${args.type}`,
      });
    }

    if (remaining > 0) {
      items.push({ kind: "generic", text: `… and ${remaining} more (use get_stock_data on specific names).` });
    }

    return {
      summary: sorted.length
        ? `${label}: ${sorted.length} name${sorted.length === 1 ? "" : "s"} (${fenceNote}).`
        : `No ${label.toLowerCase()} (${fenceNote}).`,
      data: {
        items,
        type: args.type,
        scope,
        count: sorted.length,
        rows: sorted,
      },
      sources: [
        {
          provider: "FMP",
          title: label,
          url: `https://financialmodelingprep.com${path}`,
        },
      ],
    };
  },
});
