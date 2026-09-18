/**
 * read_trade_results — how the closed book actually did (DAV-295).
 *
 * The chat could list theses, positions, proposals, filings, earnings and
 * screens, but nothing read realized results, so "how is the PEAD analyst
 * doing" or "which setup is working" could only be guessed from open
 * positions. This reads what /performance already computes — the same
 * builder, so the chat and the page cannot disagree about a win rate.
 *
 * Read-only. Renders through the generic ToolUIRenderer: generic rows for
 * the headline and the per-setup / per-analyst lines, ticker rows for the
 * individual trades. Never a per-tool renderer (CLAUDE.md).
 *
 * Realized TRADE P&L only. Account return is measured against net
 * contributed capital (lib/portfolio/contributions.ts) because a deposit
 * raises equity without being a gain; the summary says so in words.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { loadClosedTrades, SCORECARD_SINCE } from "@/lib/performance/load-setup-scorecard";
import { buildTradeResults, resultsHeadline } from "@/lib/performance/trade-results";
import { prisma } from "@/lib/prisma";

/** Enough to answer "how are we doing" without pasting the whole book. */
const MAX_RECENT = 25;

export const readTradeResultsTool = defineTool({
  description:
    "How the closed trades actually did: win rate, average R, days held, give-back from the peak, realized dollars — " +
    "overall, by setup, by analyst, and the most recent closes one by one. " +
    "Use it for 'how have my trades done', 'how is the PEAD analyst doing', 'which setup is working', " +
    "'what did we sell last week'. Read-only. Covers closes since 2026-05-27 (the seats were rebuilt then; " +
    "earlier trades ran on configs that no longer exist). Realized TRADE P&L — not the account's return, " +
    "which is measured against deposits elsewhere.",
  schema: z.object({
    analyst: z
      .string()
      .optional()
      .describe("Limit to one analyst by name, e.g. 'PEAD Specialist'. Omit for every analyst on the account."),
    setup_id: z
      .string()
      .optional()
      .describe("Limit to one setup, e.g. 'PEAD' or 'MA_PULLBACK'. Omit for every setup."),
    days: z
      .number()
      .int()
      .positive()
      .max(400)
      .optional()
      .describe("Only closes in the last N days. Omit for everything since the seats were rebuilt."),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_RECENT)
      .optional()
      .describe(`How many individual trades to list, newest first (default 10, max ${MAX_RECENT}).`),
  }),
  ui: "tool-ui",
  groupId: "research",

  execute: async (args, ctx) => {
    if (!ctx.accountId) {
      return { summary: "No account in scope.", data: { items: [{ kind: "generic" as const, text: "No account in scope." }] }, sources: [] };
    }
    const analystId = args.analyst
      ? (
          await prisma.agentConfig.findFirst({
            where: { accountId: ctx.accountId, name: { equals: args.analyst, mode: "insensitive" } },
            select: { id: true, name: true },
          })
        )?.id
      : undefined;
    if (args.analyst && !analystId) {
      const names = (await prisma.agentConfig.findMany({ where: { accountId: ctx.accountId }, select: { name: true } })).map((a) => a.name);
      return {
        summary: `No analyst called "${args.analyst}".`,
        data: { items: [{ kind: "generic" as const, text: `No analyst called "${args.analyst}". On this account: ${names.join(", ")}.` }] },
        sources: [],
      };
    }

    const all = await loadClosedTrades({
      accountId: ctx.accountId,
      ...(ctx.runEnvironment ? { environment: ctx.runEnvironment } : {}),
      ...(analystId ? { analystId } : {}),
    });
    const since = args.days != null ? new Date(Date.now() - args.days * 86_400_000) : null;
    const trades = all.filter(
      (t) =>
        (since == null || t.closedAt >= since) &&
        (args.setup_id == null || (t.setupId ?? "").toUpperCase() === args.setup_id.toUpperCase()),
    );

    const windowLabel = since
      ? `in the last ${args.days} days`
      : `since ${SCORECARD_SINCE.toISOString().slice(0, 10)}`;
    const scope = [args.analyst, args.setup_id].filter(Boolean).join(" · ");
    const r = buildTradeResults(trades, args.limit ?? 10);
    const headline = resultsHeadline(r, windowLabel);

    const items: Array<{ kind: "generic"; text: string } | { kind: "ticker"; ticker: string; tag?: string; text: string }> = [
      { kind: "generic", text: scope ? `${scope} — ${headline}` : headline },
    ];
    if (r.trades === 0) {
      items.push({
        kind: "generic",
        text: "Nothing closed in this window. Open positions are not results — read those with get_portfolio_context.",
      });
    }
    for (const s of r.bySetup) {
      items.push({
        kind: "generic",
        text:
          `${s.setup}: ${s.trades} trade${s.trades === 1 ? "" : "s"}, ${s.winRatePct}% win` +
          (s.avgR != null ? `, ${s.avgR >= 0 ? "+" : ""}${s.avgR}R` : "") +
          `, ${s.avgHoldDays}d held` +
          (s.avgGiveBackPts != null ? `, ${s.avgGiveBackPts.toFixed(1)}pts given back from the peak` : ""),
      });
    }
    if (r.byAnalyst.length > 1) {
      for (const a of r.byAnalyst) {
        items.push({
          kind: "generic",
          text: `${a.analyst}: ${a.trades} trade${a.trades === 1 ? "" : "s"}, ${a.winRatePct}% win${a.avgR != null ? `, ${a.avgR >= 0 ? "+" : ""}${a.avgR}R` : ""}`,
        });
      }
    }
    for (const t of r.recent) {
      items.push({
        kind: "ticker",
        ticker: t.symbol,
        tag: t.gainPct >= 0 ? "Win" : "Loss",
        text:
          `${t.direction} $${t.entry.toFixed(2)} → $${t.close.toFixed(2)} (${t.gainPct >= 0 ? "+" : ""}${t.gainPct}%` +
          (t.r != null ? `, ${t.r >= 0 ? "+" : ""}${t.r}R` : "") +
          `) · ${t.daysHeld}d · ${t.setup}` +
          (t.closeReason ? ` · closed ${t.closeReason.toLowerCase()}` : "") +
          (t.realizedPnl != null ? ` · ${t.realizedPnl >= 0 ? "+" : "−"}$${Math.abs(t.realizedPnl).toFixed(2)}` : ""),
      });
    }

    return { summary: headline, data: { items, results: r }, sources: [] };
  },
});
