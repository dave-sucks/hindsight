/**
 * place_trade — migrated to defineTool().
 *
 * Places a paper trade on Alpaca and creates Position + Order + PositionEvent
 * + TradeDecision + RunEvent in a single DB transaction.
 */

import { z } from "zod";
import { isManagerRun } from "@/lib/agent/portfolio-manager/limits";
import { getSetup, isBinaryBet, preCatalystWindowLine } from "@/lib/agent/knowledge/setups";
import { loadSetupOverrides } from "@/lib/agent/knowledge/load-setup-overrides";
import { loadIndicatorSnapshots } from "@/lib/market-data/load-indicators";
import { loadFillChart } from "@/lib/proposals/fill-chart";
import { PLAYBOOK_UNREAD, buyAverageOf, playbookFloor } from "@/lib/agent/knowledge/playbooks";
import { loadPlaybook } from "@/lib/agent/knowledge/load-playbook";
import { recordBuyBlockedByFull } from "@/lib/agent/record-buy-blocked";
import { randomUUID } from "node:crypto";
import { defineTool } from "@/lib/agent/define-tool";
import { accountWide, analystOf, forTheStock } from "@/lib/agent/analyst-scope";
import { prisma } from "@/lib/prisma";
import { placeMarketOrder, getOrder, getLatestPrice, getAccount } from "@/lib/alpaca";
import { isExcluded } from "@/lib/agent/universe";
import { sendEmail } from "@/lib/email";
import { getEmailRecipients } from "@/lib/emails/recipients";
import { tradeOpenedHtml } from "@/lib/emails/trade-opened";
import {
  maybeAwaitApproval,
  awaitingApprovalEnvelope,
} from "@/lib/proposals/maybe-await-approval";
import { answers } from "@/lib/proposals/staged";
import { isInsideMorningBatch } from "@/lib/email-suppression";
import { armHeldLadderOnFill } from "@/lib/proposals/thesis-flips";
import {
  positionBand,
  entrySizeForConviction,
  noLegalFloor,
  saleRuleProblem,
  sizeByRisk,
  sizingStop,
} from "@/lib/agent/position-sizing";
import { loadAutoStop } from "@/lib/trading/auto-stop";
import { loadAccountRisk, industryOf } from "@/lib/agent/load-account-risk";
import type { ToolContext } from "@/lib/agent/tool-context";
import { heatLine, industryLine } from "@/lib/agent/portfolio-risk";
import { getThesisSnapshotText } from "@/lib/agent/thesis-narrative";
import { cashShortfall } from "@/lib/trading/manual-order-rules";
import { sendBuyFilled } from "@/lib/proposals/after-buy";

type TransactionClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * Classify an Alpaca submit error.
 *
 *   "rejected" — Alpaca returned a 4xx with a definitive "no" (validation,
 *                buying-power, market closed, symbol unknown). Safe to mark
 *                Order REJECTED and Position CANCELLED — Alpaca holds nothing.
 *   "uncertain" — Network failure, timeout, 5xx. The order may or may not
 *                 have landed. We must NOT mark anything as failed; leave
 *                 Order PENDING and let reconcile-orders look it up by
 *                 client_order_id.
 */
function classifyAlpacaError(err: unknown): "rejected" | "uncertain" {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const code = e?.statusCode ?? e?.status;
  if (typeof code === "number" && code >= 400 && code < 500) return "rejected";
  return "uncertain";
}

/** The principal's chat is the one caller that may name a dollar amount. */
const isPrincipalChat = (ctx: ToolContext) => ctx.runMode === "PRINCIPAL_CHAT";

/** "Sized by you: $11,222 — above the analyst's largest trade ($10,000)." */
export function sizedByPrincipalLine(notional: number, band: { floor: number; ceiling: number | null }): string {
  const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;
  if (band.ceiling != null && notional > band.ceiling) return `Sized by you: ${$(notional)} — above the analyst's largest trade (${$(band.ceiling)}).`;
  if (band.floor > 0 && notional < band.floor) return `Sized by you: ${$(notional)} — below the analyst's smallest trade (${$(band.floor)}).`;
  return `Sized by you: ${$(notional)}.`;
}

/** A refused buy: nothing is written, and the message names the fix. */
function blocked(ticker: string, direction: "LONG" | "SHORT", why: string, message: string) {
  return {
    summary: `Trade blocked: $${ticker} — ${why}`,
    data: { success: false, ticker, status: "FAILED" as const, direction, message, tickers: [{ ticker, tag: "Failed", summary: message, actionIcon: "failed" }] },
    sources: [],
  };
}

const placeTradeSchema = z.object({
    ticker: z.string(),
    direction: z.enum(["LONG", "SHORT"]),
    // The price it is placed at: the live quote, read by the tool (no model writes it); an Auto buy passes the fire's.
    entry_price: z.number(),
    // Every model call names the sale (schemaFor); an Auto-buy, which no model writes, comes without one.
    sell_if_below: z.number().optional(),
    sell_reason: z.string().optional(),
    // Principal chat only. Inside a run these two fields are not in the
    // schema at all — the analyst's rules size every buy, and a size the
    // model typed ($11,222 on PLTR, 2026-09-25) is what killed a fired buy.
    notional: z.number().optional().describe("The dollar amount you want. Omit it and the buy is sized by the analyst's rules (risk per trade over the stop distance, inside its smallest / largest trade)."),
    shares: z.number().optional().describe("A share count, if you want a specific one; prefer notional."),
    thesis_id: z.string().describe("The thesis this trade is for. Every trade links to one."),
    entry_rationale: z
      .string()
      .optional()
      .describe(
        "REQUIRED on every buy proposal, from a trigger run or the daily run: the reason the owner reads on the proposal and in the approval email. What the company is doing and why the stock is where it is today, then the buy: the price and the sell price. Skip only for a one-shot buy in the chat, where the thesis you just wrote is the reason. Write it by How you write.",
      ),
});

/**
 * The holding's sale comes with the buy: "Sell if below $X" is written at the fill from this price (or the
 * one the owner approves), never from a line the stock carried as a watch. It also sizes the buy. Left
 * out, the playbook's floor is priced from the chart (playbookFloor), or the buy is refused.
 */
const withSale = <T extends z.ZodObject>(schema: T) =>
  schema.extend({
    sell_if_below: z
      .number()
      .positive()
      .optional()
      .describe("The holding's sell price: once bought, it sells below this price (a SHORT covers above it). It sizes the buy (the risk ÷ the distance to it). Leave it out for the playbook's floor, which code prices from today's chart; name one, under structure on the chart and never a round number, when the playbook has none or you see a better one. The owner sees it on the proposal and can change it."),
    sell_reason: z.string().min(1).optional().describe("Why the sell price sits there, in one sentence: the structure it is under. Required with sell_if_below; it becomes the note on the holding's \"Sell if below\" trigger."),
  });

/** A buy's default floor: its thesis's playbook key on today's chart (playbookFloor). A short's cover has no key. */
async function priceTheFloor(a: { thesisId: string; ticker: string; entry: number; direction: string; accountId: string }): Promise<{ price: number } | { refused: string; noLegalFloor?: true }> {
  if (a.direction !== "LONG") return { refused: "A short's cover price has no playbook key." };
  const thesis = await prisma.thesis.findUnique({ where: { id: a.thesisId }, select: { setupId: true, horizon: true } });
  const setup = thesis?.setupId ? getSetup(thesis.setupId, await loadSetupOverrides(a.accountId)) : undefined;
  if (!setup) return { refused: `$${a.ticker} has no playbook, so there is no floor to price.` };
  const [chart, snapshots, templates] = await Promise.all([loadFillChart(a.ticker), loadIndicatorSnapshots([a.ticker]).catch(() => null), loadPlaybook(a.accountId, setup.id)]);
  const atr = snapshots?.get(a.ticker)?.atr14 ?? null;
  if (setup.sale.floor?.orHigher && "atrUnderBuyAverage" in setup.sale.floor.orHigher && templates == null) return { refused: `${PLAYBOOK_UNREAD}, so its buy trigger's average can't be read.` };
  return playbookFloor({ setup, horizon: thesis?.horizon ?? null, entry: a.entry, chart, atr: atr != null ? Math.round(atr * 100) / 100 : null, buyAverage: buyAverageOf(templates) });
}

export const placeTrade = defineTool({
  description:
    "Place a trade on Alpaca for a thesis, at the live price.",
  schema: placeTradeSchema,
  // A run's model never sees a size field. The analyst's rules size the
  // buy; there is one way to size a buy (DAV-317).
  // A run's note on the stock (update_thesis, after the buy) is the proposal's reason; only your chat gives the buy its own words.
  // No model names the price (the tool reads the live quote); a trigger run's stock and thesis are code's (fromRun).
  schemaFor: (ctx) =>
    withSale(
      isPrincipalChat(ctx)
        ? placeTradeSchema.omit({ entry_price: true })
        : ctx.runMode === "INTRADAY_TACTICAL"
          ? placeTradeSchema.omit({ notional: true, shares: true, entry_rationale: true, entry_price: true, ticker: true, thesis_id: true })
          : placeTradeSchema.omit({ notional: true, shares: true, entry_rationale: true, entry_price: true }),
    ),
  fromRun: (ctx) => (ctx.runStock ? { ticker: ctx.runStock.ticker, thesis_id: ctx.runStock.thesisId } : null),
  ui: "tool-ui" as const,
  gateLog: "place_trade",
  groupId: "Executing",

  progressLabel: (args) => {
    const t = args.ticker.toUpperCase();
    const verb = args.direction === "LONG" ? "Buying" : "Shorting";
    const size = args.notional
      ? ` $${Math.round(args.notional).toLocaleString()}`
      : args.shares
        ? ` ${args.shares} shares of`
        : "";
    return `${verb}${size} ${t}`;
  },

  execute: async (given, ctx) => {
    // Normalize ticker to uppercase — model sometimes passes lowercase/mixed case,
    // which bypasses the duplicate check and hits Alpaca with a 422.
    const ticker = given.ticker.toUpperCase().trim();
    // A market order: the price it sizes and expects to pay is the live quote now.
    let args = given;
    if (!(args.entry_price > 0)) {
      const quote = await getLatestPrice(ticker, ctx.alpacaCreds).catch(() => null);
      if (quote == null || !Number.isFinite(quote) || quote <= 0) {
        return blocked(ticker, args.direction, "no live price", `Trade blocked: no live price for $${ticker}. Call place_trade again once a quote comes back.`);
      }
      args = { ...args, entry_price: quote };
    }

    // An account-wide run buys for the thesis's own analyst, under its rules, pinned or not (analyst-scope.ts).
    if (accountWide(ctx)) {
      const owner = await prisma.thesis.findFirst({ where: { id: args.thesis_id, userId: ctx.userId }, select: { researchRun: { select: { agentConfigId: true } } } });
      ctx = await forTheStock(ctx, owner ? analystOf(owner) : null);
    }
    const effectiveAnalystId: string | undefined = ctx.analystId;
    try {
      // 0a. Universe exclusion check — hard reject
      // exclusionList is the hard block dimension of Universe. The analyst's
      // system prompt already narrates Universe but we don't trust the model
      // to always respect it — this is the backstop.
      if (isExcluded(ticker, { exclusionList: ctx.exclusionList })) {
        const blockedMsg = `$${ticker} is on this analyst's exclusion list — cannot trade.`;
        return {
          summary: `Trade blocked: $${ticker} — excluded`,
          data: {
            success: false,
            ticker,
            status: "FAILED" as const,
            direction: args.direction,
            message: blockedMsg,
            tickers: [{ ticker, tag: "Failed", summary: blockedMsg, actionIcon: "failed" }],
          },
          sources: [],
        };
      }

      // 0a.5. Trading-paused gate — `AgentConfig.enabled === false` means
      // NO NEW TRADES from any code path. The morning cron already filters on
      // `enabled: true`, but tactical runs (fired by the trigger evaluator)
      // and principal-chat sessions don't. Without this gate, disabling an
      // analyst stops the morning routine but still allows trigger-fired
      // tactical runs to call place_trade. This guard makes "disabled"
      // mean what it says.
      //
      // Close_position remains UNGATED — existing positions stay manageable
      // (stops auto-fire, manual exits work, trims/adds via manage_position
      // ALSO ungated because they assume an existing position). Only NEW
      // entries via place_trade are blocked.
      //
      // Filed under: real-life compliance need 2026-05-28 — a paused analyst
      // must NOT enter new positions while the user works out disclosure
      // requirements. See the upcoming "trade-as-proposal" workstream for
      // the durable answer.
      if (effectiveAnalystId) {
        const analystEnabledCheck = await prisma.agentConfig.findUnique({
          where: { id: effectiveAnalystId },
          select: { enabled: true, name: true, tradingEnvironment: true, accountId: true },
        });
        // A buy is for an analyst on the run's own account, and lands in that analyst's own book.
        // A run opened before a promote or demote would buy in the old one (2026-11-19).
        if (analystEnabledCheck?.accountId && analystEnabledCheck.accountId !== ctx.accountId) {
          return blocked(ticker, args.direction, "not this account's analyst", `Trade blocked: that analyst is not on this account.`);
        }
        const runBook = ctx.runEnvironment ?? "PAPER";
        const analystBook = analystEnabledCheck?.tradingEnvironment;
        if ((analystBook === "PAPER" || analystBook === "LIVE") && analystBook !== runBook) {
          const name = (b: string) => (b === "LIVE" ? "Live" : "Paper");
          return blocked(ticker, args.direction, "wrong book", `Trade blocked: this run was opened on ${name(runBook)} and ${analystEnabledCheck?.name} now trades on ${name(analystBook)}. Start a new run to buy it.`);
        }
        if (analystEnabledCheck && !analystEnabledCheck.enabled) {
          const blockedMsg =
            `Trade blocked: analyst "${analystEnabledCheck.name}" is disabled — ` +
            `new trades are paused. Existing positions remain manageable ` +
            `(stops fire, exits work). Re-enable the analyst in settings to ` +
            `resume entries.`;
          return {
            summary: `Trade blocked: $${ticker} — analyst paused`,
            data: {
              success: false,
              ticker,
              status: "FAILED" as const,
              direction: args.direction,
              message: blockedMsg,
              tickers: [{ ticker, tag: "Paused", summary: blockedMsg, actionIcon: "failed" }],
            },
            sources: [],
          };
        }
      }

      // 0. Check for existing open position (scoped to this analyst only).
      // Trade-as-Proposal: include PENDING_APPROVAL so the agent can't
      // propose a duplicate while one is awaiting the user's decision. A
      // pending proposal counts as committed exposure for dedup purposes.
      const existingPosition = await prisma.position.findFirst({
        where: {
          userId: ctx.userId,
          analystId: effectiveAnalystId ?? undefined,
          symbol: ticker,
          status: { in: ["OPEN", "PENDING_APPROVAL"] },
        },
        select: { id: true, symbol: true, status: true },
      });

      if (existingPosition) {
        const blockedMsg =
          existingPosition.status === "PENDING_APPROVAL"
            ? `A buy proposal on ${ticker} is already awaiting user approval. Cannot propose a duplicate.`
            : `Already holding an open position in ${ticker}. Cannot open duplicate positions for this analyst.`;
        return {
          summary: `Trade blocked: $${ticker} — duplicate position`,
          data: {
            success: false,
            ticker,
            status: "FAILED" as const,
            direction: args.direction,
            message: blockedMsg,
            tickers: [{ ticker, tag: "Failed", summary: blockedMsg, actionIcon: "failed" }],
          },
          sources: [],
        };
      }

      // 0b. Analyst config guardrails — maxOpenPositions,
      // maxPositionSize. Previously these were advisory (passed to the
      // prompt) and the model could ignore them. Now they're hard gates:
      // a violation returns a FAILED trade result. This protects the
      // paper book from the model overriding its own stated rules.

      // ── Guardrail 0: thesis direction is committed (LONG or SHORT) ──
      // An UNRESEARCHED seed is a user/builder/editor watchlist entry
      // awaiting first research. It has no triggers and no belief.
      // place_trade on such a row would create an open position with no
      // exit plan AND violate the legal (direction, status) pairs. The
      // agent must promote the seed → LONG/SHORT via update_thesis first.
      //
      // An unresearched seed is direction=null. This gate is an ALLOWLIST —
      // it rejects ANYTHING that is not exactly 'LONG' or 'SHORT'. A
      // null-direction seed must NEVER become trade-eligible. Regression:
      // place-trade.test.ts "rejects a null-direction (unresearched) seed".
      {
        const directionCheck = await prisma.thesis.findUnique({
          where: { id: args.thesis_id },
          select: { direction: true },
        });

        // Note: there is NO staleness gate here. Research-age decisions
        // belong to the REVIEW flow, not the TRADE flow — the agent's
        // prompt teaches it to refresh stale research during review, and
        // the per-horizon REVIEW cadence drives that work deterministically.
        // See docs/plans/REVIEW_REFRESH_CADENCE.md (P1-1).

        if (
          directionCheck &&
          directionCheck.direction !== "LONG" &&
          directionCheck.direction !== "SHORT"
        ) {
          const msg =
            `$${ticker}: cannot place_trade on an unresearched watchlist seed (direction is not committed to LONG/SHORT). It is a seed awaiting first research — no buy, no floor, no committed view. ` +
            `Its view comes from the writer: dispatch_thesis_research on $${ticker}, then wait_for_thesis_refresh. ` +
            `Once it is LONG or SHORT, place_trade on the same thesis_id.`;
          return {
            summary: `Trade blocked: $${ticker} — thesis has no committed direction (send it to the Writer first)`,
            data: {
              success: false,
              ticker,
              status: "FAILED" as const,
              direction: args.direction,
              message: msg,
              tickers: [{ ticker, tag: "Failed", summary: msg, actionIcon: "failed" }],
            },
            sources: [],
          };
        }
      }

      // ── Guardrail 2: open position count < maxOpenPositions ────────
      // Trade-as-Proposal: count PENDING_APPROVAL too. A pending proposal
      // commits a slot — the user shouldn't see the agent propose a 6th
      // trade while 5 unapproved buys are already queued against the cap.
      if (ctx.maxOpenPositions != null && effectiveAnalystId) {
        const openCount = await prisma.position.count({
          where: {
            analystId: effectiveAnalystId,
            status: { in: ["OPEN", "PENDING_APPROVAL"] },
          },
        });
        if (openCount >= ctx.maxOpenPositions) {
          const blockedMsg = `Trade blocked: this analyst already has ${openCount} open position${openCount !== 1 ? "s" : ""}, which is its limit of ${ctx.maxOpenPositions}. Replacing a holding is the owner's decision: in your note on $${ticker}, name the holding it would replace and why this is the better use of the money, or say it waits for room.`;
          // The same block as always — plus one line where a person looks
          // (DAV-286: ISRG was blocked here twice with nothing on screen).
          if (!ctx.dryRun) {
            await recordBuyBlockedByFull({ ticker, analystId: effectiveAnalystId, open: openCount, max: ctx.maxOpenPositions, runId: ctx.runId });
          }
          return {
            summary: `Trade blocked: $${ticker} — at max open positions`,
            data: {
              success: false,
              ticker,
              status: "FAILED" as const,
              direction: args.direction,
              message: blockedMsg,
              tickers: [{ ticker, tag: "Failed", summary: blockedMsg, actionIcon: "failed" }],
            },
            sources: [],
          };
        }
      }

      // ── Guardrail 3: the sale against entry_price and the live price ──
      // The holding's sale is the price this call names (sell_if_below), or the
      // playbook's floor priced from the chart, never a line on the thesis: a
      // watch's lines end the watch and never sell. For a LONG it sits BELOW the
      // price and for a SHORT above it; one already crossed would sell on the
      // first trigger check after the fill. Quote failure skips the live check
      // (the entry check is the static fallback).
      let stop: number | null = args.sell_if_below != null && args.sell_if_below > 0 ? args.sell_if_below : null;
      if (stop != null && !args.sell_reason?.trim()) {
        return blocked(ticker, args.direction, "the sell price has no reason", `Trade blocked: sell_if_below $${stop.toFixed(2)} needs its sell_reason, the structure it sits under, in one sentence. Send both, or leave sell_if_below out for the playbook's floor.`);
      }
      // None named: the playbook's floor, priced from today's chart and held to its sale rules; else the run names it.
      if (stop == null) {
        const floor = await priceTheFloor({ thesisId: args.thesis_id, ticker, entry: args.entry_price, direction: args.direction, accountId: ctx.accountId });
        if ("refused" in floor) return blocked(ticker, args.direction, "no floor", floor.noLegalFloor ? `Trade blocked: ${floor.refused}` : `Trade blocked: ${floor.refused} Name the floor (sell_if_below) under structure on the chart, with its reason.`);
        stop = floor.price;
      }
      if (stop != null) {
        let livePrice: number | null = null;
        try {
          const p = await getLatestPrice(ticker, ctx.alpacaCreds);
          livePrice = Number.isFinite(p) && p > 0 ? p : null;
        } catch (quoteErr) {
          console.warn(`[place_trade] live-price check skipped for ${ticker}: ${quoteErr instanceof Error ? quoteErr.message : quoteErr}`);
        }
        const long = args.direction === "LONG";
        const crossed = (price: number) => (long ? stop >= price : stop <= price);
        const at = crossed(args.entry_price) ? { what: "the buy price", price: args.entry_price } : livePrice != null && crossed(livePrice) ? { what: "the current price", price: livePrice } : null;
        if (at) {
          return blocked(ticker, args.direction, "the sale is past the price", `Trade blocked: the sale $${stop.toFixed(2)} is at or ${long ? "above" : "below"} ${at.what} $${at.price.toFixed(2)} — for a ${args.direction} sell_if_below must be ${long ? "BELOW" : "ABOVE"} it. Name a sale under structure on the other side of the price, then call place_trade again.`);
        }
      }

      // The analyst's dollar limits: smallest trade to largest trade, and no
      // more than most in one stock (positionBand, lib/agent/position-sizing.ts).
      // Nothing is refused for size any more: a run's model can't send one
      // (the field isn't in its schema), and the principal's own number is
      // honored with a line when it sits outside the band.
      const band = positionBand({
        minPositionSize: ctx.minPositionSize,
        maxPositionSize: ctx.maxPositionSize,
        maxPositionTotal: ctx.maxPositionTotal,
      });

      // 1. Resolve qty — prefer notional (dollar amount), fall back to shares.
      // With no size from the agent, the risk rule decides (DAV-251):
      // shares = equity × riskPct × conviction ÷ the stop distance, clamped
      // to the analyst's dollar limits. Whatever path sized it, the reply and the
      // run's event carry the arithmetic plus the open-risk, industry and regime
      // lines — lines the agent reads, never refusals, never on the proposal.
      const [sizingThesis, sizingAnalyst, accountRisk, autoStop] = await Promise.all([
        prisma.thesis.findUnique({
          where: { id: args.thesis_id },
          select: { conviction: true, horizon: true, setupId: true, catalystDate: true },
        }),
        effectiveAnalystId
          ? prisma.agentConfig.findUnique({ where: { id: effectiveAnalystId }, select: { riskPct: true } })
          : Promise.resolve(null),
        loadAccountRisk({
          accountId: ctx.accountId,
          environment: ctx.runEnvironment ?? "PAPER",
          creds: ctx.alpacaCreds,
        }).catch(() => null),
        effectiveAnalystId ? loadAutoStop(effectiveAnalystId) : Promise.resolve(null),
      ]);
      // A bet into a dated binary event is half the risk (DAV-328). The
      // answer is `isBinaryBet` — one function for the entry and the add.
      // The old test here wanted the setup to be PRE_CATALYST or unnamed, so
      // AIR, KMX and JBL (CATALYST rows wearing the PEAD setup) were sized
      // in full the day before their print.
      const binary = sizingThesis ? isBinaryBet(sizingThesis) : false;
      // The setup's sale rules, on the sale: the 06:30 snapshot's ATR, the account's overrides.
      const setup = stop != null && sizingThesis?.setupId ? getSetup(sizingThesis.setupId, await loadSetupOverrides(ctx.accountId)) : undefined;
      if (setup && stop != null) {
        const atr = (await loadIndicatorSnapshots([ticker]).catch(() => null))?.get(ticker)?.atr14 ?? null;
        const none = noLegalFloor({ setup, horizon: sizingThesis?.horizon ?? null, entry: args.entry_price, atr: atr != null ? Math.round(atr * 100) / 100 : null });
        if (none) return blocked(ticker, args.direction, "no legal floor", `Trade blocked: ${none}.`);
        const bad = saleRuleProblem({ setup, horizon: sizingThesis?.horizon ?? null, entry: args.entry_price, stop, atr: atr != null ? Math.round(atr * 100) / 100 : null });
        if (bad) return blocked(ticker, args.direction, "the sale breaks its playbook's rule", `Trade blocked: ${bad}. Then call place_trade again.`);
      }
      // Sized off the sale this call names; stop when buying on: off the wider of it and the setting's line.
      const riskStop = stop != null ? sizingStop({ entry: args.entry_price, stop, direction: args.direction, autoStop }) : null;
      const riskSized =
        accountRisk?.equity != null && riskStop
          ? sizeByRisk({
              equity: accountRisk.equity,
              riskPct: sizingAnalyst?.riskPct,
              conviction: sizingThesis?.conviction,
              entry: args.entry_price,
              stop: riskStop.stop,
              direction: args.direction,
              binary,
              regime: accountRisk.regime?.regime ?? null,
              band,
            })
          : null;

      let resolvedShares: number | undefined;
      let resolvedNotional: number | undefined;
      const sizingNotes: string[] = [];
      // Only the principal's chat may name a size. A size a run's model
      // passed anyway (an older prompt, a direct call) is ignored, not
      // refused — the rules size the buy and the reply says so.
      const principalNotional =
        isPrincipalChat(ctx) && args.notional != null && args.notional > 0
          ? args.notional
          : isPrincipalChat(ctx) && args.shares != null && args.shares > 0
            ? args.shares * args.entry_price
            : null;
      if (principalNotional != null) {
        resolvedNotional = args.notional != null && args.notional > 0 ? args.notional : undefined;
        resolvedShares =
          args.shares != null && args.shares > 0 && resolvedNotional == null
            ? args.shares
            : Math.max(1, Math.floor(principalNotional / args.entry_price));
        sizingNotes.push(sizedByPrincipalLine(principalNotional, band));
      } else if (riskSized) {
        resolvedShares = riskSized.shares;
        resolvedNotional = riskSized.notional;
        sizingNotes.push(riskSized.line, ...(riskStop?.line ? [riskStop.line] : []));
      } else {
        // No usable stop distance or no equity reading: the band, placed by
        // conviction (the pre-DAV-251 rule), and the reply says why.
        resolvedNotional = entrySizeForConviction({ conviction: sizingThesis?.conviction, band });
        resolvedShares = Math.max(1, Math.floor(resolvedNotional / args.entry_price));
        sizingNotes.push(
          `Sized from the analyst's band by conviction ($${Math.round(resolvedNotional).toLocaleString()}) — ` +
            (accountRisk?.equity == null ? "account equity unavailable" : stop == null ? "no sell price came with the buy" : "no usable stop distance") +
            ", so the risk rule couldn't run.",
        );
      }
      if (accountRisk?.open && accountRisk.equity) {
        const perShare = !riskStop ? 0 : args.direction === "SHORT" ? riskStop.stop - args.entry_price : args.entry_price - riskStop.stop;
        const addedRisk = Math.max(0, perShare) * (resolvedShares ?? 0);
        sizingNotes.push(heatLine(accountRisk.open, accountRisk.equity, addedRisk));
        const ind = industryLine(accountRisk.open, await industryOf(ticker), ticker);
        if (ind) sizingNotes.push(ind);
      }
      // A buy no analyst placed (an Auto trigger) is paid from cash, never margin, as the Trade button's is.
      const short = ctx.payFromCash !== undefined ? cashShortfall(resolvedNotional ?? (resolvedShares ?? 1) * args.entry_price, ctx.payFromCash) : null;
      if (short) {
        return {
          summary: `Trade blocked: $${ticker} — not enough cash`,
          data: { success: false, ticker, status: "FAILED" as const, direction: args.direction, message: `Trade blocked: ${short}`, tickers: [{ ticker, tag: "Failed", summary: short, actionIcon: "failed" }] },
          sources: [],
        };
      }
      if (accountRisk?.regime) sizingNotes.push(accountRisk.regime.line);
      // Where the event date sits against a pre-catalyst setup's buying
      // window (DAV-338): a line the agent reads, never a refusal.
      const windowLine = sizingThesis ? preCatalystWindowLine(sizingThesis) : null;
      if (windowLine) sizingNotes.push(windowLine);

      // ── Workstream B: DB-first write path ────────────────────────────────
      // Old flow: Alpaca first, then DB. A crash between the two left an
      // invisible Alpaca position with no DB attribution. New flow: DB first
      // with a server-generated idempotencyKey, then Alpaca with that key as
      // client_order_id. If the Alpaca call doesn't return cleanly, the
      // PENDING Order row is recoverable by reconcile-orders looking it up
      // by client_order_id.

      const analystId = effectiveAnalystId;
      if (!analystId) {
        throw new Error(`Cannot place trade: thesis ${args.thesis_id} names no analyst on this account.`);
      }

      const finalShares = resolvedShares ?? 1;
      const idempotencyKey = randomUUID();
      const placedAt = new Date();

      // 2. DB tx: create the row of record. avgCost starts at the entry guess
      // and is corrected to the real fill price in step 4.
      const positionEnvironment = ctx.runEnvironment ?? "PAPER";

      const { position, order } = await prisma.$transaction(async (tx: TransactionClient) => {
        const pos = await tx.position.create({
          data: {
            analystId,
            userId: ctx.userId,
            accountId: ctx.accountId,
            environment: positionEnvironment,
            symbol: ticker,
            direction: args.direction,
            status: "OPEN",
            quantity: finalShares,
            avgCost: args.entry_price,
            stopLoss: stop,
            stopReason: args.sell_reason?.trim() || null,
            // The risk taken — never moves; the scorecard's R (DAV-248).
            initialStop: stop,
            // Per-thesis triggers (lib/agent/triggers/*) own ALL exit logic now.
            // The stop EXIT trigger (price-below from the horizon defaults) and
            // any added Target-Price / Movement-Amount EXIT fire via the trigger
            // evaluator's 5-min cron — there's no parallel auto-close path. The
            // legacy exitStrategy="TRAILING" side-channel was removed; this
            // column stays "MANUAL" for legacy-row tolerance only.
            exitStrategy: "MANUAL",
            initialQty: finalShares,
          },
        });

        const ord = await tx.order.create({
          data: {
            positionId: pos.id,
            userId: ctx.userId,
            environment: positionEnvironment,
            symbol: ticker,
            side: args.direction === "LONG" ? "BUY" : "SELL",
            orderType: "MARKET",
            quantity: finalShares,
            status: "PENDING",
            alpacaOrderId: null,
            idempotencyKey,
            intent: "OPEN",
            // First-class thesis link (P1-33 Activity tab) — the proposal
            // audit trail reads from Order, keyed by this.
            thesisId: args.thesis_id,
            createdAt: placedAt,
          },
        });

        await tx.positionEvent.create({
          data: {
            positionId: pos.id,
            eventType: "OPENED",
            description: `${args.direction} ${finalShares} shares of ${ticker} submitted at ~$${args.entry_price.toFixed(2)} (idem=${idempotencyKey.slice(0, 8)})`,
            priceAt: args.entry_price,
          },
        });

        await tx.tradeDecision.create({
          data: {
            runId: ctx.runId,
            analystId,
            userId: ctx.userId,
            accountId: ctx.accountId,
            symbol: ticker,
            decision: "INITIATE",
            reasoning: `${args.direction} ${finalShares} shares — submitting market order (${stop != null ? `the sale at $${stop.toFixed(2)}` : "no sell price"})`,
            thesisId: args.thesis_id,
            positionId: pos.id,
            orderId: ord.id,
          },
        });

        if (ctx.runId) {
          await tx.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "trade_placed",
              title: `Trade submitted: ${args.direction} ${ticker}`,
              message: `${args.direction} ${finalShares} shares of ${ticker}`,
              payload: {
                ticker,
                direction: args.direction,
                entry: args.entry_price,
                stop_loss: stop,
                shares: finalShares,
                position_id: pos.id,
                order_id: ord.id,
                idempotency_key: idempotencyKey,
                sizing: sizingNotes,
              } as object,
            },
          });
        }

        return { position: pos, order: ord };
      });

      // ── Trade-as-Proposal seam ────────────────────────────────────────────
      // The DB rows exist. If the Account requires approval for buys,
      // maybeAwaitApproval flips Position→PENDING_APPROVAL + Order→
      // AWAITING_APPROVAL, sends the proposal email, and returns the
      // awaiting envelope. Tool returns early; nothing below this point
      // executes (no Alpaca submit, no polling, no thesis flip). When the
      // user clicks Approve, /api/proposals/[orderId]/approve picks up
      // from here — calls the same placeMarketOrder, relies on the
      // reconcile-orders cron for fill. When approval is OFF, this returns
      // null and the rest of the tool runs exactly as today.
      // See docs/plans/TRADE_AS_PROPOSAL.md.
      {
        // The proposal's reason: your chat's words when it gave them; a run's
        // note on the stock lands here at the end of the run
        // (lib/proposals/auto-writeup.ts). Never the thesis snapshot: that is
        // the writer's overview, not why we are buying now (NVTS, 2026-06-04).
        // The sizing lines go to the agent's reply and the run's event, never
        // on the proposal.
        const proposalRationale: string | null = args.entry_rationale?.trim() || null;
        const awaiting = await maybeAwaitApproval({
          accountId: ctx.accountId,
          positionId: position.id,
          orderId: order.id,
          intent: "OPEN",
          always: isManagerRun(ctx),
          environment: positionEnvironment,
          rationale: proposalRationale,
          triggerIds: answers(ctx.firedTrigger, ticker, "BUY"),
          proposedPrice: args.entry_price,
        });
        if (awaiting?.state === "awaiting_approval") {
          return {
            summary: `Proposed: ${args.direction} ${finalShares} $${ticker}`,
            data: {
              success: true,
              ticker,
              status: "PROPOSED" as const,
              direction: args.direction,
              ...awaitingApprovalEnvelope({
                awaiting,
                ticker,
                direction: args.direction,
                intent: "OPEN",
                shares: finalShares,
                estimatedPrice: args.entry_price,
              }),
              sizing: sizingNotes,
            },
            sources: [{ provider: "Hindsight", title: `Proposal ${ticker}` }],
          };
        }
      }

      // 3. Submit to Alpaca with client_order_id = idempotencyKey.
      let alpacaOrderId: string | null = null;
      let submitOutcome: "ok" | "rejected" | "uncertain" = "ok";
      try {
        const alpacaOrder = await placeMarketOrder({
          symbol: ticker,
          ...(resolvedNotional != null ? { notional: resolvedNotional } : { qty: resolvedShares }),
          side: args.direction === "LONG" ? "buy" : "sell",
          clientOrderId: idempotencyKey,
        }, ctx.alpacaCreds, positionEnvironment);
        alpacaOrderId = alpacaOrder.id;
        await prisma.order.update({
          where: { id: order.id },
          data: {
            alpacaOrderId,
            alpacaSubmittedAt: placedAt,
            alpacaConfirmedAt: new Date(),
          },
        });
      } catch (submitErr) {
        submitOutcome = classifyAlpacaError(submitErr);
        const msg = submitErr instanceof Error ? submitErr.message : String(submitErr);
        if (submitOutcome === "rejected") {
          // Definitive no from Alpaca. Mark Order REJECTED and Position
          // CANCELLED so the book doesn't carry a phantom OPEN row.
          console.warn(
            `[place_trade] Alpaca rejected order for ${ticker} (idem=${idempotencyKey.slice(0, 8)}): ${msg}`,
          );
          await prisma.$transaction([
            prisma.order.update({
              where: { id: order.id },
              data: { status: "REJECTED", alpacaSubmittedAt: placedAt, alpacaConfirmedAt: new Date() },
            }),
            prisma.position.update({
              where: { id: position.id },
              data: { status: "CANCELLED", closedAt: new Date(), closeReason: "MANUAL" },
            }),
            prisma.positionEvent.create({
              data: {
                positionId: position.id,
                eventType: "CLOSED",
                description: `Alpaca rejected: ${msg}`,
                priceAt: args.entry_price,
              },
            }),
          ]);
          return {
            summary: `Trade rejected: $${ticker}`,
            data: {
              success: false,
              ticker,
              status: "FAILED" as const,
              direction: args.direction,
              message: `Alpaca rejected: ${msg}`,
              tickers: [{ ticker, tag: "Rejected", summary: msg, actionIcon: "failed" }],
            },
            sources: [],
          };
        }
        // Uncertain — network/5xx/timeout. Order may or may not have landed.
        // Leave Order PENDING; reconcile-orders looks it up by client_order_id.
        console.error(
          `CRITICAL-SYNC-UNCERTAIN [place_trade] Alpaca submit uncertain for ${ticker} (idem=${idempotencyKey.slice(0, 8)}): ${msg}. Reconcile will recover by client_order_id.`,
        );
        await prisma.order.update({
          where: { id: order.id },
          data: { alpacaSubmittedAt: placedAt },
        });
        return {
          summary: `Trade submitted (status uncertain): $${ticker}`,
          data: {
            success: true,
            ticker,
            status: "PENDING" as const,
            fillStatus: "PENDING" as const,
            direction: args.direction,
            shares: finalShares,
            entryPrice: args.entry_price,
            stopLoss: stop,
            positionId: position.id,
            orderId: order.id,
            alpacaOrderId: null,
            placedAt: placedAt.toISOString(),
            filledAt: null,
            message: `Submission status uncertain (${msg}). Reconcile cron will resolve via client_order_id.`,
            tickers: [{ ticker, tag: "Pending", summary: "Awaiting reconcile", actionIcon: "buy" }],
          },
          sources: [{ provider: "Alpaca", title: `Trade ${ticker} (pending)` }],
        };
      }

      // 4. Poll up to 5s for fill, then promote to FILLED + correct avgCost.
      let fillPrice = args.entry_price;
      let fillQty: number | null = null;
      let didFill = false;
      let filledAt: Date | null = null;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && alpacaOrderId) {
        const probed = await getOrder(alpacaOrderId, ctx.alpacaCreds);
        if (probed.status === "filled" && probed.filled_avg_price) {
          fillPrice = parseFloat(probed.filled_avg_price);
          // Alpaca's filled_qty is ground truth — notional orders fill
          // fractionally, and Math.floor(notional/fillPrice) under-reports
          // the actual qty, leaking the fraction as an Alpaca-only orphan
          // when we later close at the DB's truncated qty (AGL-2026-05-12).
          fillQty = probed.filled_qty ? parseFloat(probed.filled_qty) : null;
          didFill = true;
          filledAt = probed.filled_at ? new Date(probed.filled_at) : new Date();
          break;
        }
        if (["cancelled", "expired", "rejected"].includes(probed.status)) {
          // Cancelled-with-partial-fill: Alpaca took some shares before killing
          // the rest. Adopt the partial fill via the didFill path below.
          // Without this the DB marks CANCELLED while Alpaca keeps the shares
          // (the NVDA-2026-05-11 orphan).
          const partialQty = parseFloat(probed.filled_qty ?? "0");
          const partialPrice = probed.filled_avg_price ? parseFloat(probed.filled_avg_price) : 0;
          if (partialQty > 0 && partialPrice > 0) {
            fillPrice = partialPrice;
            fillQty = partialQty;
            didFill = true;
            filledAt = probed.filled_at ? new Date(probed.filled_at) : new Date();
            break;
          }
          await prisma.$transaction([
            prisma.order.update({
              where: { id: order.id },
              data: { status: "CANCELLED", alpacaConfirmedAt: new Date() },
            }),
            prisma.position.update({
              where: { id: position.id },
              data: { status: "CANCELLED", closedAt: new Date(), closeReason: "MANUAL" },
            }),
          ]);
          return {
            summary: `Trade ${probed.status}: $${ticker}`,
            data: {
              success: false,
              ticker,
              status: "FAILED" as const,
              direction: args.direction,
              message: `Alpaca order ${probed.status}`,
              tickers: [{ ticker, tag: probed.status, summary: `Alpaca ${probed.status}`, actionIcon: "failed" }],
            },
            sources: [],
          };
        }
        await new Promise((r) => setTimeout(r, 1_000));
      }

      if (didFill) {
        // Trust Alpaca's filled_qty (fractional for notional orders). Fall
        // back to the local share count only if Alpaca didn't return it.
        const finalSharesAfterFill =
          fillQty != null && fillQty > 0
            ? fillQty
            : (resolvedShares ?? finalShares);
        await prisma.$transaction([
          prisma.order.update({
            where: { id: order.id },
            data: {
              status: "FILLED",
              filledPrice: fillPrice,
              filledQty: finalSharesAfterFill,
              filledAt: filledAt ?? new Date(),
            },
          }),
          prisma.position.update({
            where: { id: position.id },
            data: {
              avgCost: fillPrice,
              quantity: finalSharesAfterFill,
              initialQty: finalSharesAfterFill,
            },
          }),
          prisma.positionEvent.create({
            data: {
              positionId: position.id,
              eventType: "OPENED",
              description: `Filled: ${args.direction} ${finalSharesAfterFill} shares at $${fillPrice.toFixed(2)}`,
              priceAt: fillPrice,
            },
          }),
        ]);
      } else {
        // Order accepted but not filled within poll window — leave PENDING.
        // reconcile-orders will pick it up via alpacaOrderId.
        try {
          fillPrice = await getLatestPrice(args.ticker, ctx.alpacaCreds);
        } catch {
          /* keep entry_price */
        }
      }

      // A PROMOTED row (the first live run's re-entry) flips to HOLDING in armHeldLadderOnFill below, as a watch does.

      // suppress unused warning if a path doesn't read submitOutcome
      void submitOutcome;

      // Watchlist-collapse: WATCHING → ACTIVE promotion is the new "graduation."
      // The thesis row's status flip is what takes it off the watchlist view
      // (which is just `Thesis WHERE status='WATCHING'`). Write a PROMOTED
      // audit row so the run summary's "Promoted (now active)" bucket can
      // derive from ThesisUpdate.
      //
      // Also regenerate triggers for the HELD-side template. Pre-A2 the
      // WATCHING-side triggers (which include an ENTER predicate on the
      // breakout level) stayed in place after promotion — so every day
      // price ticked above the (now-stale) ENTER level the trigger
      // evaluator fired another ENTER tactical run on a position the
      // analyst already held. 2026-05-19 audit: 35 of 36 ENTER tactical
      // runs over 14 days fired on already-held tickers (AVGO 8×, GOOGL
      // 7×, etc.). HELD templates have stops, target-hit REVIEW, and
      // per-horizon hygiene — no ENTER, because you can't enter what
      // you already hold.
      // ONE implementation, shared with the approval path
      // (promoteThesisOnApproval). Fail-soft inside.
      await armHeldLadderOnFill({
        analystId,
        ticker,
        fillPrice,
        targetPrice: null,
        stopLoss: stop,
        stopReason: args.sell_reason,
        positionId: position.id,
        runId: ctx.runId,
        via: "place_trade",
      });
      // Filled now: the run after the fill puts on the holding's triggers. A fill that lands later is the reconciler's.
      if (didFill) await sendBuyFilled(order.id);

      // Fetch post-trade portfolio context (non-fatal)
      let portfolioUpdate: { remainingSlots: number; remainingBuyingPower: number; openPositionCount: number } | null = null;
      try {
        // Trade-as-Proposal: count PENDING_APPROVAL positions toward the
        // slot total so the agent's view of remainingSlots is accurate.
        const currentOpenCount = await prisma.position.count({
          where: { analystId, status: { in: ["OPEN", "PENDING_APPROVAL"] } },
        });
        const postAccount = await getAccount(ctx.alpacaCreds);
        portfolioUpdate = {
          remainingSlots: (ctx.maxOpenPositions ?? 5) - currentOpenCount,
          remainingBuyingPower: parseFloat(postAccount.buying_power),
          openPositionCount: currentOpenCount,
        };
      } catch (portfolioErr) {
        console.warn("[tool] place_trade portfolio update fetch failed:", portfolioErr);
      }

      // Trade-opened alert — fire-and-forget. Only emails when the order
      // actually filled (avgCost is meaningful then). Two gates:
      //   1. AgentConfig.emailAlerts — owner opt-out per analyst.
      //   2. isInsideMorningBatch — suppress for trades inside the 10 AM
      //      morning cron's MORNING_PLAN runs; the 11 AM daily digest
      //      will consolidate them. Off-cycle trades (tactical, discovery,
      //      manual user clicks outside the morning window) still fire
      //      immediate emails per call.
      // Never blocks or fails the trade path.
      if (didFill) {
        const emailedShares = resolvedShares ?? finalShares;
        const emailedAvgCost = fillPrice;
        void (async () => {
          try {
            // Fetch the run mode to decide morning-batch suppression.
            const run = ctx.runId
              ? await prisma.researchRun.findUnique({
                  where: { id: ctx.runId },
                  select: { mode: true },
                })
              : null;
            if (isInsideMorningBatch(run?.mode)) {
              return; // digest will cover it
            }
            const config = await prisma.agentConfig.findUnique({
              where: { id: analystId },
              select: { emailAlerts: true, name: true },
            });
            if (!config?.emailAlerts) return;
            // Every account member subscribed to TRADE_ACTIVITY gets the
            // alert (default: all members; per-member opt-out on
            // /settings/team). Falls back to the placing user only when
            // the account has no membership rows.
            const recipients = await getEmailRecipients(
              ctx.accountId,
              "TRADE_ACTIVITY",
              { fallbackUserId: ctx.userId },
            );
            if (recipients.length === 0) return;
            const thesis = await prisma.thesis.findUnique({
              where: { id: args.thesis_id },
              select: { snapshot: true },
            });
            const verb = args.direction === "LONG" ? "📈 Bought" : "📉 Shorted";
            const livePrefix = positionEnvironment === "LIVE" ? "[LIVE] " : "";
            const subject = `${livePrefix}${verb} ${ticker} — ${config.name}`;
            const html = tradeOpenedHtml({
              ticker,
              direction: args.direction,
              qty: emailedShares,
              avgCost: emailedAvgCost,
              currentPrice: fillPrice,
              stopLoss: stop,
              analystName: config.name,
              thesisSummary: thesis ? (getThesisSnapshotText(thesis) || null) : null,
              environment: positionEnvironment,
              positionId: position.id,
              openedAt: position.openedAt ?? new Date(),
            });
            await Promise.all(
              recipients.map((to) => sendEmail({ to, subject, html })),
            );
          } catch (err) {
            console.warn(
              "[place_trade] trade-opened email failed:",
              err instanceof Error ? err.message : err,
            );
          }
        })();
      }

      const message = didFill
        ? `${args.direction} ${finalShares} shares of ${ticker} filled at $${fillPrice.toFixed(2)}`
        : `${args.direction} ${finalShares} shares of ${ticker} submitted to Alpaca — awaiting fill (current price $${fillPrice.toFixed(2)})`;

      const tickerTag = args.direction === "LONG" ? "Long" : "Short";
      const tickerSummary = didFill
        ? `Placed ${args.direction} ${finalShares} shares @ $${fillPrice.toFixed(2)} — ${stop != null ? `the sale at $${stop.toFixed(2)}` : "no sell price"}`
        : `Order submitted (pending): ${args.direction} ${finalShares} shares @ $${fillPrice.toFixed(2)}`;

      return {
        summary: didFill
          ? `Placed order: ${args.direction} ${finalShares} $${ticker} @ $${fillPrice.toFixed(2)}`
          : `Order submitted (pending): ${args.direction} ${finalShares} $${ticker}`,
        data: {
          success: true,
          ticker,
          status: didFill ? ("FILLED" as const) : ("PENDING" as const),
          fillStatus: didFill ? ("FILLED" as const) : ("PENDING" as const),
          direction: args.direction,
          shares: finalShares,
          entryPrice: fillPrice,
          stopLoss: stop,
          positionId: position.id,
          orderId: order.id,
          alpacaOrderId,
          placedAt: placedAt.toISOString(),
          filledAt: filledAt ? filledAt.toISOString() : null,
          message,
          sizing: sizingNotes,
          ...(portfolioUpdate ? { portfolioUpdate } : {}),
          tickers: [{ ticker, tag: tickerTag, summary: tickerSummary, actionIcon: "buy" }],
        },
        sources: [{ provider: "Alpaca", title: `Trade ${ticker}` }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Trade placement failed";
      console.error(`[tool] place_trade FAILED for ${ticker}: ${msg}`);
      return {
        summary: `Trade failed: $${ticker}`,
        data: {
          success: false,
          ticker,
          status: "FAILED" as const,
          direction: args.direction,
          message: msg,
          tickers: [{ ticker, tag: "Failed", summary: msg, actionIcon: "failed" }],
        },
        sources: [],
      };
    }
  },
});
