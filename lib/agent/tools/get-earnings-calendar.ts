/**
 * get_earnings_calendar — the earnings calendar, forward or back.
 *
 * `window: "upcoming"` (default) — who reports in the next N days. The
 * date to be ready for.
 * `window: "reported"` — who reported in the LAST N days, with actual vs
 * estimate and the surprise. The discovery input: "do discovery off this
 * week's earnings" means this call, `scope: "universe"`, sorted so the
 * biggest beats come first.
 *
 * Reads through lib/market-data/earnings-calendar — the same shared call
 * the /earnings page and the trigger evaluator use. No signal, no router.
 *
 * Renders via the generic ToolUIRenderer (`ui: "tool-ui"`). Each row is a
 * ticker item; an opening generic row narrates how many + the window.
 * NEVER add a per-tool renderer for this — CLAUDE.md is explicit.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { fetchCalendarRows } from "@/lib/market-data/earnings-calendar";
import type { EarningsReport as EarningsRow } from "@/lib/agent/triggers/earnings";

const money = (n: number) =>
  Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(0)}M`;

export const getEarningsCalendar = defineTool({
  description:
    "The earnings calendar, forward or back. `window: \"upcoming\"` (default): who reports in the next N days. " +
    "`window: \"reported\"`: who reported in the LAST N days, with EPS and revenue actual vs estimate and the surprise %, " +
    "biggest beats first — use this for earnings-driven discovery (\"find names off this week's reports\"). " +
    "Three scopes: `scope: \"all\"` = the full firm calendar; `scope: \"universe\"` = names NOT already in your coverage " +
    "(the discovery set); `scope: \"coverage\"` = ONLY watchlist + open-position names (your book). Default is `coverage`. " +
    "For one ticker's history and beat rate use get_earnings_data instead.",
  schema: z.object({
    days: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Days forward (upcoming) or back (reported); defaults to 7."),
    window: z
      .enum(["upcoming", "reported"])
      .optional()
      .describe("'upcoming' = scheduled reports ahead (default). 'reported' = reports already in, with actuals and surprise."),
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
    const what = args.window === "reported" ? "reported earnings" : "upcoming earnings";
    if (scope === "all") return `Pulling ${what}, firm-wide`;
    if (scope === "universe") return `Pulling ${what} outside your coverage`;
    return `Pulling ${what} on your book`;
  },

  execute: async (args, ctx) => {
    const days = args.days ?? 7;
    const scope = args.scope ?? "coverage";
    const window = args.window ?? "upcoming";

    const today = new Date();
    const other = new Date(Date.now() + (window === "reported" ? -days : days) * 86400_000);
    const from = (window === "reported" ? other : today).toISOString().slice(0, 10);
    const to = (window === "reported" ? today : other).toISOString().slice(0, 10);

    let calendar = await fetchCalendarRows({ from, to });
    // Reported = has an actual. Upcoming = doesn't yet (a row dated today
    // with no actual is tonight's, or this morning's not yet posted).
    calendar =
      window === "reported"
        ? calendar.filter((r) => r.epsActual != null)
        : calendar.filter((r) => r.epsActual == null);
    if (calendar.length === 0) {
      return {
        summary: `No ${window} earnings ${from} → ${to} (or the calendar was unavailable).`,
        data: {
          items: [{ kind: "generic" as const, text: `No ${window} earnings ${from} → ${to}.` }],
          from,
          to,
          scope,
          window,
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
      .sort((a, b) =>
        window === "reported"
          ? Math.abs(b.surprisePct ?? 0) - Math.abs(a.surprisePct ?? 0)
          : a.reportDate.localeCompare(b.reportDate),
      )
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
        ? `No ${window} earnings ${from} → ${to} (${fenceNote}).`
        : `${sorted.length} ${window === "reported" ? "report" : "scheduled report"}${sorted.length === 1 ? "" : "s"} ${from} → ${to} (${fenceNote}).`;

    const items: Array<
      | { kind: "generic"; text: string }
      | { kind: "ticker"; ticker: string; tag: string; text: string }
    > = [{ kind: "generic", text: headerText }];

    for (const row of visible) {
      const bell = row.hour === "bmo" ? " before open" : row.hour === "amc" ? " after close" : "";
      let text: string;
      if (row.epsActual != null) {
        const s = row.surprisePct;
        const verdict = s == null ? "" : ` — ${s >= 0 ? "beat" : "missed"} by ${Math.abs(s).toFixed(1)}%`;
        const rev =
          row.revenueActual != null
            ? ` · Rev ${money(row.revenueActual)}${row.revenueEstimate != null ? ` vs ${money(row.revenueEstimate)} est` : ""}`
            : "";
        text = `EPS $${row.epsActual.toFixed(2)}${row.epsEstimate != null ? ` vs $${row.epsEstimate.toFixed(2)} est` : ""}${verdict}${rev}`;
      } else {
        text = `${row.epsEstimate != null ? `EPS est $${row.epsEstimate.toFixed(2)}` : "no EPS est"}${bell}`;
      }
      items.push({ kind: "ticker", ticker: row.symbol, tag: row.reportDate, text });
    }

    if (remaining > 0) {
      items.push({ kind: "generic", text: `… and ${remaining} more (use get_stock_data on specific names).` });
    }

    return {
      summary: sorted.length
        ? `${window === "reported" ? "Reported" : "Upcoming"} earnings ${from}→${to}: ${sorted.length} name${sorted.length === 1 ? "" : "s"} (${fenceNote}).`
        : `No ${window} earnings ${from}→${to} (${fenceNote}).`,
      data: {
        items,
        from,
        to,
        scope,
        window,
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
