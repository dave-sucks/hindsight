/**
 * get_earnings_calendar — pull tool for the upcoming earnings firehose.
 *
 * The firm-market-sweep cron writes one aggregate Signal per day for the
 * earnings calendar (lib/inngest/functions/firm-market-sweep.ts step
 * "earnings-calendar"). Analysts subscribed via `AgentConfig.feeds`
 * (canonical `EARNINGS_CALENDAR`) get it routed automatically. This tool
 * is the on-demand pull path for analysts that aren't subscribed but want
 * to look at the calendar mid-run, or for any analyst that wants a fresh
 * view at a different days-out window than the cron's default 7-day pull.
 *
 * Renders via the generic ToolUIRenderer (`ui: "tool-ui"`). Each calendar
 * row becomes a ticker row item; an opening generic row narrates how many
 * names + the date window. NEVER add a per-tool renderer for this — the
 * recurring-bugs guidance in CLAUDE.md is explicit on that.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

interface EarningsRow {
  symbol: string;
  date: string;
  hour?: string | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
}

export const getEarningsCalendar = defineTool({
  description:
    "Pull the upcoming earnings calendar for the next N days (default 7). " +
    "Three scopes: `scope: \"all\"` returns the full firm calendar; `scope: \"universe\"` " +
    "returns reports for tickers NOT already in your coverage (the discovery set); " +
    "`scope: \"coverage\"` returns ONLY reports on watchlist + open-position tickers (your book). " +
    "Default is `coverage` to preserve legacy behavior. For per-ticker earnings detail " +
    "(EPS history, beat rate) use get_earnings_data instead.",
  schema: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Days forward to pull; defaults to 7."),
    scope: z
      .enum(["universe", "coverage", "all"])
      .optional()
      .describe(
        "'all' = full firm calendar. 'universe' = full calendar MINUS tickers you already cover (the discovery set — use this in weekly discovery). 'coverage' = calendar intersected with watchlist + open positions (the 'my book' set). Defaults to 'coverage'.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => {
    const scope = args.scope ?? "coverage";
    if (scope === "all") return "Pulling the firm earnings calendar";
    if (scope === "universe") return "Pulling earnings outside your coverage";
    return "Pulling earnings on your book";
  },

  execute: async (args, ctx) => {
    const days = args.days ?? 7;
    const scope = args.scope ?? "coverage";

    const today = new Date();
    const out = new Date(Date.now() + days * 86400_000);
    const from = today.toISOString().slice(0, 10);
    const to = out.toISOString().slice(0, 10);

    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB_KEY}`;
    let calendar: EarningsRow[] = [];
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        return {
          summary: `Finnhub earnings calendar unavailable (HTTP ${res.status}).`,
          data: {
            items: [
              { kind: "generic" as const, text: `Earnings calendar fetch failed (HTTP ${res.status}).` },
            ],
            from,
            to,
            scope,
            count: 0,
            rows: [] as EarningsRow[],
          },
          sources: [],
        };
      }
      const json = (await res.json()) as { earningsCalendar?: EarningsRow[] };
      calendar = (json.earningsCalendar ?? []).filter((r) => r.symbol && r.date);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "earnings calendar fetch error";
      return {
        summary: `Finnhub earnings calendar fetch threw: ${msg}.`,
        data: {
          items: [{ kind: "generic" as const, text: `Earnings calendar unavailable: ${msg}` }],
          from,
          to,
          scope,
          count: 0,
          rows: [] as EarningsRow[],
        },
        sources: [],
      };
    }

    // 2026-05-10 — scope semantics rewrite (mirrors get_market_movers).
    //
    // PRIOR BUG: `scope:"universe"` intersected with watchlist+positions,
    // which is the OPPOSITE of what a discovery agent wants.
    //
    // FIX: three scopes —
    //   "all"      — full firm calendar.
    //   "universe" — calendar MINUS coveredTickers (discovery set).
    //   "coverage" — calendar ∩ (watchlist ∪ positions) (book set — default).
    //
    // Industry / sector fencing requires per-ticker enrichment which is too
    // expensive at tool-call time; deferred.
    const watchlist = (ctx as { watchlist?: string[] })?.watchlist ?? [];
    const positionTickers = (ctx as { positionTickers?: string[] })?.positionTickers ?? [];
    const ctxCovered = (ctx as { coveredTickers?: string[] })?.coveredTickers ?? [];
    const coverageSet = new Set(
      [...watchlist, ...positionTickers].map((t) => t.toUpperCase()),
    );
    const coveredSet = new Set(
      (ctxCovered.length > 0
        ? ctxCovered
        : [...watchlist, ...positionTickers]
      ).map((t) => t.toUpperCase()),
    );
    let filtered: EarningsRow[];
    if (scope === "coverage") {
      filtered = coverageSet.size > 0
        ? calendar.filter((r) => coverageSet.has(r.symbol.toUpperCase()))
        : calendar;
    } else if (scope === "universe") {
      filtered = coveredSet.size > 0
        ? calendar.filter((r) => !coveredSet.has(r.symbol.toUpperCase()))
        : calendar;
    } else {
      filtered = calendar;
    }

    // Sort by date asc, cap at 30 visible rows so the tool row stays readable.
    // The full count is still returned in `data.count` so the agent can decide
    // to widen scope or drill into specific names.
    //
    // 2026-05-13 — universe-scope tightening. Finnhub's calendar doesn't
    // return sector/industry, so scope:"universe" returns a firehose of
    // ~900 random small-caps for any analyst whose coverage doesn't
    // intersect the calendar. Drop the visible cap hard in that scope so
    // the agent sees a short, scannable list instead of 891 names of
    // BUDA / SWMR / NASO no one's ever heard of. Filtering by EPS estimate
    // presence is a weak but cheap proxy for "covered enough to be a
    // real candidate" — companies without estimates are typically
    // micro-caps with no analyst coverage.
    const sorted = [...filtered]
      .sort((a, b) => a.date.localeCompare(b.date))
      .filter((r) => (scope === "universe" ? r.epsEstimate != null : true));
    const VISIBLE_CAP = scope === "universe" ? 15 : 30;
    const visible = sorted.slice(0, VISIBLE_CAP);
    const remaining = sorted.length - visible.length;

    const fenceNote =
      scope === "coverage"
        ? coverageSet.size > 0
          ? `fenced to your ${coverageSet.size} watchlist + position ticker(s)`
          : "no watchlist or open positions — returning full calendar"
        : scope === "universe"
          ? coveredSet.size > 0
            ? `excluding your ${coveredSet.size} already-covered ticker(s) — discovery set`
            : "no coverage to exclude — returning full calendar"
          : "full firm calendar";

    const headerText =
      sorted.length === 0
        ? `No upcoming earnings ${from} → ${to} (${fenceNote}).`
        : `${sorted.length} report${sorted.length === 1 ? "" : "s"} ${from} → ${to} (${fenceNote}).`;

    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [{ kind: "generic", text: headerText }];

    for (const row of visible) {
      const eps = row.epsEstimate != null ? `EPS est $${row.epsEstimate.toFixed(2)}` : "no EPS est";
      items.push({
        kind: "ticker",
        ticker: row.symbol,
        tag: row.date,
        text: eps,
      });
    }

    if (remaining > 0) {
      items.push({ kind: "generic", text: `… and ${remaining} more (use get_stock_data on specific names).` });
    }

    return {
      summary: sorted.length
        ? `Earnings ${from}→${to}: ${sorted.length} name${sorted.length === 1 ? "" : "s"} (${fenceNote}).`
        : `No earnings ${from}→${to} (${fenceNote}).`,
      data: {
        items,
        from,
        to,
        scope,
        count: sorted.length,
        rows: sorted,
      },
      sources: [
        {
          provider: "Finnhub",
          title: `Earnings Calendar ${from}–${to}`,
          url: "https://finnhub.io/docs/api/earnings-calendar",
        },
      ],
    };
  },
});
