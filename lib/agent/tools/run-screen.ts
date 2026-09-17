/**
 * run_screen — a computed candidate list for one setup (DAV-255).
 *
 * Instead of a firehose of 900 names read by eye, the chat gets 5–15
 * names with the numbers: "reported this week, beat by 5%+, held the
 * gap, not on the book." The pool is what the vendors already give us —
 * the reported-earnings calendar for the earnings setups, today's movers
 * for the chart setups, plus the book on request — fenced to names not
 * already covered; the chart is read for each survivor (Alpaca bars, one
 * call per name, capped), and lib/discovery/screens.ts applies the
 * setup's own numbers. Every rejection is named.
 *
 * Renders via the generic ToolUIRenderer: one generic row for the count,
 * one ticker row per candidate with its screenRow, one generic row for
 * the rejections. NEVER a per-tool renderer (CLAUDE.md).
 *
 * Calls per run: 1 Finnhub calendar call (earnings setups) or 2 Alpaca
 * screener calls (chart setups); up to POOL_CAP Alpaca bar fetches plus
 * SPY once (cached). Nothing on the Finnhub quote budget.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { getDailyBars, type AlpacaCredentials } from "@/lib/alpaca";
import { getBenchmarkBars, CHART_SESSIONS } from "@/lib/market-data/benchmark-bars";
import { computePriceStructure, type PriceStructure } from "@/lib/market-data/price-structure";
import { fetchCalendarRows } from "@/lib/market-data/earnings-calendar";
import { getAlpacaMovers } from "@/lib/market-data/alpaca-screener";
import { daysUntilReport, type EarningsReport } from "@/lib/agent/triggers/earnings";
import { runScreen, type ScreenInput, type ScreenSetup } from "@/lib/discovery/screens";
import { getSetup } from "@/lib/agent/knowledge/setups";

/** Bars are one call per name; this bounds a screen to a few seconds and a few dozen calls. */
export const POOL_CAP = 40;
/** Penny names never pass a seat's liquidity floor. */
const PRICE_FLOOR = 5;

export const runScreenTool = defineTool({
  description:
    "A computed candidate list for one setup, with the numbers — how the analysts find stocks. " +
    "`setup: \"PEAD\"`: reported in the last N days (default 3), EPS beat ≥ 5%, revenue not missed, the reaction gap held, not already run 10%+ past it. " +
    "`\"EPISODIC_PIVOT\"`: gapped up 8%+ on 3×+ volume in the last 10 sessions and held. " +
    "`\"MA_PULLBACK\"`: an uptrend beating SPY over 3 months, within 3% of its rising 20- or 50-day on light volume. " +
    "`\"BASE_BREAKOUT\"`: Trend Template, a tight base under a clear pivot. " +
    "The pool is the calendar (earnings setups) or today's movers (chart setups), minus names already covered; `scope: \"book\"` screens your own watchlist and holdings instead. " +
    "Each candidate row carries its `screenRow` — pass it with `setup_id` into dispatch_thesis_research. Every name that failed is listed with the reason.",
  schema: z.object({
    setup: z.enum(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK", "BASE_BREAKOUT"]),
    scope: z
      .enum(["universe", "book"])
      .optional()
      .describe("'universe' (default) = the pool minus names you already cover. 'book' = your watchlist and holdings only (a pullback on a stock we already watch)."),
    days: z.number().int().min(1).max(10).optional().describe("Earnings setups: how many days back to look for reports. Default 3."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Screening for ${getSetup(args.setup)?.name ?? args.setup}`,

  execute: async (args, ctx) => {
    const setup = args.setup as ScreenSetup;
    const scope = args.scope ?? "universe";
    const days = args.days ?? 3;
    const now = new Date();
    const creds = (ctx as { alpacaCreds?: AlpacaCredentials }).alpacaCreds;
    const watchlist = ((ctx as { watchlist?: string[] }).watchlist ?? []).map((t) => t.toUpperCase());
    const positionTickers = ((ctx as { positionTickers?: string[] }).positionTickers ?? []).map((t) => t.toUpperCase());
    const ctxCovered = ((ctx as { coveredTickers?: string[] }).coveredTickers ?? []).map((t) => t.toUpperCase());
    const covered = new Set(ctxCovered.length ? ctxCovered : [...watchlist, ...positionTickers]);
    const held = new Set(positionTickers);
    const exclusions = new Set(((ctx as { exclusionList?: string[] }).exclusionList ?? []).map((t) => t.toUpperCase()));
    const setupName = getSetup(setup)?.name ?? setup;

    // ── The pool ─────────────────────────────────────────────────────────
    const notes: string[] = [];
    let pool: Array<{ ticker: string; report?: EarningsReport | null }> = [];
    if (setup === "PEAD" || setup === "EPISODIC_PIVOT") {
      const from = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
      const to = now.toISOString().slice(0, 10);
      const rows = (await fetchCalendarRows({ from, to }).catch(() => [] as EarningsReport[])).filter((r) => r.epsActual != null);
      if (rows.length === 0) notes.push(`No reported earnings ${from} → ${to} (or the calendar was unavailable).`);
      // Real companies first: a usable estimate, then the biggest surprise.
      rows.sort((a, b) => (b.surprisePct ?? -999) - (a.surprisePct ?? -999));
      pool = rows.map((r) => ({ ticker: r.symbol.toUpperCase(), report: r }));
    } else {
      const [gainers, active] = await Promise.all([
        getAlpacaMovers("gainers", { top: 50, creds }),
        getAlpacaMovers("active", { top: 50, creds }),
      ]);
      if (gainers.error && active.error) notes.push(`Movers unavailable: ${gainers.error}`);
      const seen = new Set<string>();
      for (const m of [...(gainers.data ?? []), ...(active.data ?? [])]) {
        const t = m.symbol.toUpperCase();
        if (seen.has(t)) continue;
        if (m.price != null && m.price < PRICE_FLOOR) continue;
        seen.add(t);
        pool.push({ ticker: t });
      }
    }

    // ── The fence ────────────────────────────────────────────────────────
    if (scope === "book") {
      const book = new Set([...watchlist, ...positionTickers]);
      const inPool = new Set(pool.map((p) => p.ticker));
      for (const t of book) if (!inPool.has(t)) pool.push({ ticker: t });
      pool = pool.filter((p) => book.has(p.ticker));
    } else {
      pool = pool.filter((p) => !covered.has(p.ticker) && !held.has(p.ticker));
    }
    pool = pool.filter((p) => !exclusions.has(p.ticker));
    const truncated = pool.length > POOL_CAP;
    pool = pool.slice(0, POOL_CAP);

    // ── The chart, one call per name ─────────────────────────────────────
    const spy = await getBenchmarkBars("SPY", creds).catch(() => undefined);
    const inputs: ScreenInput[] = await Promise.all(
      pool.map(async (p) => {
        let structure: PriceStructure | null = null;
        try {
          const own = await getDailyBars(p.ticker, CHART_SESSIONS, creds, now);
          structure = computePriceStructure({ bars: own.bars, price: null, spyBars: spy });
        } catch {
          structure = null;
        }
        return {
          ticker: p.ticker,
          structure,
          report: p.report ?? null,
          daysSinceReport: p.report ? -daysUntilReport(p.report, now) : null,
        };
      }),
    );

    const result = runScreen(setup, inputs);
    const top = result.passed.slice(0, 15);

    // ── Rows ─────────────────────────────────────────────────────────────
    const headline =
      `${setupName}: ${top.length} candidate${top.length === 1 ? "" : "s"} from a pool of ${pool.length}` +
      (scope === "book" ? " (your book)" : " outside your coverage") +
      (truncated ? ` (the first ${POOL_CAP} read; the rest wait)` : "") +
      `.` +
      (notes.length ? ` ${notes.join(" ")}` : "");
    const items: Array<{ kind: "generic"; text: string } | { kind: "ticker"; ticker: string; tag: string; text: string }> = [
      { kind: "generic", text: headline },
      ...top.map((r) => ({ kind: "ticker" as const, ticker: r.ticker, tag: setup, text: r.screenRow })),
    ];
    if (result.rejected.length) {
      const shown = result.rejected.slice(0, 12).map((r) => `${r.ticker}: ${r.reason}`);
      items.push({
        kind: "generic",
        text: `Didn't pass (${result.rejected.length}): ${shown.join(" · ")}${result.rejected.length > 12 ? ` · and ${result.rejected.length - 12} more` : ""}`,
      });
    }
    items.push({
      kind: "generic",
      text: `To research one: dispatch_thesis_research(ticker, mode: "mint", setup_id: "${setup}", screen_row: <the row's numbers>). The writer checks the setup against the chart itself.`,
    });

    return {
      summary: headline,
      data: {
        items,
        setup,
        scope,
        poolSize: pool.length,
        candidates: top.map((r) => ({ ticker: r.ticker, setup: r.setup, screenRow: r.screenRow })),
        rejected: result.rejected,
      },
      sources: [],
    };
  },
});
