/**
 * get_catalyst_calendar — dated FDA decisions, read from the companies' own
 * filings.
 *
 * The seat that trades dated binaries has never had a list to search: no
 * vendor we hold carries FDA decision dates, and the FDA cannot publish them.
 * The sponsor's 8-K is the primary source, so that is what this reads — see
 * lib/market-data/catalyst-calendar.
 *
 * Renders through the generic ToolUIRenderer: an opening generic row, a ticker
 * row per event, a closing row for what it couldn't reach. NEVER a per-tool
 * renderer — CLAUDE.md is explicit.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { searchCatalystEvents, type CatalystEvent } from "@/lib/market-data/catalyst-calendar";

/** The setup's own window: a dated event is tradeable 14–70 days out. */
const DEFAULT_WINDOW: [number, number] = [0, 70];

function describe(e: CatalystEvent): string {
  if (e.datePrecision === "month" && e.eventDate) {
    const month = new Date(`${e.eventDate}T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    return `${e.company} · ${month} (month only — the filing gave no day) · announced ${e.announcedDate}`;
  }
  const when =
    e.daysAway == null
      ? "date unclear"
      : e.daysAway < 0
        ? `${-e.daysAway} days ago`
        : e.daysAway === 0
          ? "today"
          : e.daysAway === 1
            ? "tomorrow"
            : `in ${e.daysAway} days`;
  return `${e.company} · ${e.eventDate} (${when}) · announced ${e.announcedDate}`;
}

export const getCatalystCalendar = defineTool({
  description:
    "Dated FDA decisions, taken from the filings the companies themselves made — the PDUFA date a sponsor announced in its own 8-K, with the sentence it wrote and a link to the document. " +
    "This is the Catalyst seat's calendar, the way get_earnings_calendar is the earnings seat's. " +
    "Defaults to decisions landing in the next 70 days; pass `days` for a different horizon, or `from`/`to` for a specific stretch (\"the catalysts in June\"). " +
    "`scope: \"universe\"` (default) is names you don't already cover — the discovery set; `\"coverage\"` is your watchlist and holdings; `\"all\"` is both. " +
    "WHAT TO DO WITH A ROW: a dated event 14–70 days out is a WATCH with a catalyst date and a review before it, not a buy today — and never enter the day before. " +
    "Rank a label expansion, sNDA or supplemental approval ABOVE a first approval: a miss on the incremental kind costs 5–8%, while a first-approval binary on a single-asset company gaps straight through any stop. " +
    "Size at half, and if a 50% gap down would cost more than 0.5% of equity the position is too big. The exit is the event itself, or sell the run-up one to two weeks before it. " +
    "Having a date is not enough on its own — the event has to be the kind this seat trades.",
  schema: z.object({
    scope: z
      .enum(["universe", "coverage", "all"])
      .optional()
      .describe("'universe' (default) = names you don't cover. 'coverage' = your watchlist + holdings. 'all' = everything."),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe("Decisions landing within this many days. Default 70 — the setup's tradeable window."),
    from: z.string().optional().describe("Start of an explicit range, YYYY-MM-DD. Overrides `days`."),
    to: z.string().optional().describe("End of an explicit range, YYYY-MM-DD."),
    announced_within_days: z
      .number()
      .int()
      .min(7)
      .max(365)
      .optional()
      .describe("How far back to look for the announcement. Default 120 — a decision is usually announced months ahead."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) =>
    args.scope === "coverage" ? "Reading catalyst dates on your book" : "Reading catalyst dates from company filings",

  execute: async (args, ctx) => {
    const scope = args.scope ?? "universe";
    const covered = new Set(
      [
        ...((ctx as { coveredTickers?: string[] }).coveredTickers ?? []),
        ...((ctx as { watchlist?: string[] }).watchlist ?? []),
        ...((ctx as { positionTickers?: string[] }).positionTickers ?? []),
      ].map((t) => t.toUpperCase()),
    );

    const res = await searchCatalystEvents({
      now: new Date(),
      ...(args.from || args.to ? { from: args.from, to: args.to } : {}),
      ...(args.days && !args.from ? { eventWindowDays: [0, args.days] as [number, number] } : {}),
      ...(!args.days && !args.from ? { eventWindowDays: DEFAULT_WINDOW } : {}),
      ...(args.announced_within_days ? { announcedWithinDays: args.announced_within_days } : {}),
      // A fence of your own names is a cheaper read than the whole market.
      ...(scope === "coverage" && covered.size ? { tickers: [...covered] } : {}),
    });

    if (res.error) {
      return {
        summary: `Catalyst dates unavailable — ${res.error}. This is not "nothing scheduled".`,
        data: { items: [{ kind: "generic" as const, text: `Catalyst dates unavailable: ${res.error}` }], events: [], error: res.error },
        sources: [],
      };
    }

    const events =
      scope === "universe"
        ? res.events.filter((e) => !covered.has(e.ticker.toUpperCase()))
        : res.events;

    const fence =
      scope === "universe"
        ? covered.size
          ? `outside your ${covered.size} covered name(s)`
          : "whole market"
        : scope === "coverage"
          ? "your watchlist and holdings"
          : "whole market";

    const headline =
      events.length === 0
        ? `No FDA decisions announced for this window (${fence}).`
        : `${events.length} dated FDA decision${events.length === 1 ? "" : "s"} (${fence}), read from each company's own filing.`;

    const items: Array<{ kind: "generic"; text: string } | { kind: "ticker"; ticker: string; tag: string; text: string }> = [
      { kind: "generic", text: headline },
    ];
    for (const e of events) {
      items.push({ kind: "ticker", ticker: e.ticker, tag: e.kind, text: describe(e) });
    }
    if (res.truncated) {
      items.push({
        kind: "generic",
        text: `EDGAR matched ${res.matched} announcements and the newest ${res.read} were read; older ones in the window weren't.`,
      });
    }

    return {
      summary: headline,
      data: { items, scope, count: events.length, events, matched: res.matched, read: res.read, truncated: res.truncated },
      sources: events.slice(0, 8).map((e) => ({
        provider: "SEC EDGAR",
        title: `${e.ticker} — ${e.eventDate}`,
        url: e.url,
      })),
    };
  },
});
