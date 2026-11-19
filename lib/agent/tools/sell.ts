/**
 * sell — sell all or part of a holding. A part goes through `changePosition`
 * (manage-position.ts); the whole holding through closeOpenPosition, which
 * flips the thesis. The model names no reason code: the stored label is the
 * protective trigger's that woke the run, else MANUAL (enforce-close-reason.ts).
 * Until 2026-11-18 these were close_position and manage_position(partial_close).
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { forHeldStock } from "@/lib/agent/analyst-scope";
import {
  collapseCloseReason,
  enforceCloseReason,
  withCloseAuditNote,
  type DeclaredCloseReason,
} from "@/lib/agent/triggers/enforce-close-reason";
import { prisma } from "@/lib/prisma";
import { getAccount } from "@/lib/alpaca";
import { getStockQuote } from "@/lib/actions/finnhub.actions";
import { recordProposalRunEvent } from "@/lib/proposals/maybe-await-approval";
import { answers } from "@/lib/proposals/staged";
import { changePosition } from "@/lib/agent/tools/manage-position";

const schema = z.object({
  ticker: z.string().describe("The stock to sell."),
  percent: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .describe("How much of the holding to sell, 1–100; left out, all of it, or on a run a trim trigger woke, that trim's size."),
  belief_survived: z
    .boolean()
    .optional()
    .describe("On a sale of the whole holding: true if why we own it still holds and we sell on price (the stock goes back on watch), false if it broke (the thesis retires)."),
  // Read by closeOpenPosition / changePosition as the sale's reason (Order.rationale).
  note: z
    .string()
    .optional()
    .describe("Why you're selling, by How you write: what happened to the company and the stock, then the sale; the owner reads it on the proposal and in the approval email."),
});

export const sell = defineTool({
  description: "Sells all or part of a holding; with the approval switch on, the sale waits for the owner. Code sets the sale's label from the trigger that fired.",
  schema,
  // A run's note on the stock is the sale's reason (lib/proposals/auto-writeup.ts); only your chat gives it its own words.
  schemaFor: (ctx) => (ctx.runMode === "PRINCIPAL_CHAT" ? schema : ctx.runStock ? schema.omit({ note: true, ticker: true }) : schema.omit({ note: true })),
  // A one-stock run sells its own stock.
  fromRun: (ctx) => (ctx.runStock ? { ticker: ctx.runStock.ticker } : null),
  ui: "tool-ui" as const,
  gateLog: "sell",
  groupId: "Executing",

  progressLabel: (args) => `Selling ${args.percent && args.percent < 100 ? `${args.percent}% of ` : ""}$${args.ticker.toUpperCase()}`,

  execute: async (args, ctx) => {
    const ticker = args.ticker.toUpperCase().trim();
    // Left out on a run a trim woke, the part is that trim's size (as manage_position's was).
    const part = args.percent ?? (ctx.firedTrim?.ticker === ticker ? ctx.firedTrim.pct : 100);
    if (part < 100) return changePosition({ symbol: ticker, action: "partial_close", close_pct: part, reason: args.note }, ctx);
    // The label: the protective trigger's that woke this run, else the model's belief call (DAV-192).
    const declared: DeclaredCloseReason = ctx.protectiveExitReason ?? (args.belief_survived === false ? "THESIS_INVALIDATED" : "MANUAL");
    // A protective fire's sale reads as a stop or a target everywhere the label is read (get_theses,
    // the sold-name recycle rule, the close email); enforceCloseReason keeps that rule in one place.
    const declaredStored = collapseCloseReason(declared);
    try {
      // The Master Chat sells for the stock's holder, in its book (analyst-scope.ts).
      const held = await forHeldStock(ctx, ticker);
      if (held.question) {
        return { summary: held.question, data: { success: false, ticker, reason: declaredStored, status: "FAILED" as const, message: held.question, tickers: [{ ticker, tag: "Which?", summary: held.question, actionIcon: "failed" }] }, sources: [] };
      }
      ctx = held.ctx;
      // ── PROMOTED guard (P1-21) ─────────────────────────────────────────
      // A PROMOTED thesis was an ACTIVE paper position that the user just
      // graduated PAPER→LIVE. The paper position got force-closed at
      // promotion; the thesis itself sits awaiting first-live-run re-entry.
      // A sale on a PROMOTED row is always wrong: there's no
      // position to close. Without this guard, an orphan HELD-template
      // EXIT trigger from before P1-21's template regen could spawn a
      // tactical EXIT run that falls through to the "no position found"
      // branch — recoverable but noisy. Refuse with a clear instruction
      // pointing the agent at the legal next moves.
      if (ctx.analystId) {
        const promotedThesis = await prisma.thesis.findFirst({
          where: {
            ticker,
            status: "PROMOTED",
            researchRun: { agentConfigId: ctx.analystId },
          },
          select: { id: true },
        });
        if (promotedThesis) {
          const msg =
            `Cannot close ${ticker}: this thesis is PROMOTED (no open position to close — the paper position was force-closed when the analyst was promoted PAPER→LIVE). ` +
            `Either call place_trade to re-enter live (place_trade auto-flips PROMOTED→ACTIVE), or call watch_again to defer re-entry until its buy trigger fires.`;
          return {
            summary: `Cannot close $${ticker} — thesis is PROMOTED`,
            data: {
              success: false,
              ticker,
              reason: declaredStored,
              status: "FAILED" as const,
              message: msg,
              tickers: [{ ticker, tag: "Promoted", summary: msg, actionIcon: "failed" }],
            },
            sources: [],
          };
        }
      }

      // Scope strictly by analystId when available. Without this filter,
      // a single user with multiple analysts holding the same ticker would
      // return whichever Position prisma picks first — i.e., one analyst
      // could close another analyst's position. Captured the 2026-04-30
      // EDT/EVT NVDA cross-contamination pattern. Falls back to user-only
      // scope only when ctx.analystId is missing (legacy/manual paths).
      // Also scoped by environment — a LIVE run never operates on a PAPER
      // position (and vice versa). get_portfolio_context already filters
      // by env, but the model could synthesize a sale from prior
      // memory, so the lookup itself enforces it.
      const runEnvironment = ctx.runEnvironment ?? "PAPER";
      const position = await prisma.position.findFirst({
        where: {
          userId: ctx.userId,
          symbol: ticker,
          status: "OPEN",
          environment: runEnvironment,
          ...(ctx.analystId ? { analystId: ctx.analystId } : {}),
        },
        include: { analyst: { select: { name: true } } },
      });

      if (!position) {
        const noPosMsg = `No open position in ${ticker}. No action taken.`;
        return {
          summary: `No position to close: $${ticker}`,
          data: {
            success: true,
            ticker,
            reason: declaredStored,
            status: "NO_POSITION" as const,
            message: noPosMsg,
            tickers: [{ ticker, tag: "N/A", summary: noPosMsg, actionIcon: "failed" }],
          },
          sources: [],
        };
      }

      // ── The label (DAV-263) ────────────────────────────────────────────
      // STOP or TARGET only when the trigger that woke this run says so; any
      // other sale is the agent's call.
      const quote = await getStockQuote(ticker).catch(() => null);
      const enforced = enforceCloseReason({
        declared,
        protective: ctx.protectiveExitReason,
        triggerLabel: ctx.protectiveExitTriggerLabel,
        beliefSurvived: args.belief_survived,
      });
      // The model's own words for this exit, for narration + audit strings.
      const intent = enforced.declared;
      const reason: "TARGET" | "STOP" | "MANUAL" = enforced.stored;
      if (enforced.corrected) {
        console.info(
          `[tool] sell sale-label auto-corrected for ${ticker}: ${enforced.declared} → ${enforced.stored}`,
        );
      }

      const { closeOpenPosition } = await import("@/lib/actions/closeTrade.actions");
      // The sale's reason is the analyst's notes or nothing; a corrected label goes to the reply and the run's event.
      const agentAuditReason = args.note?.trim() || undefined;
      const label = enforced.corrected
        ? { declared_reason: enforced.declared, label_auto_corrected: true, label_note: enforced.auditNote }
        : {};
      // P1-35: `belief_survived` rides through to the thesis flip (stamped on
      // the Order first, so it survives the approval gate on LIVE). A
      // THESIS_INVALIDATED intent is a structural break by definition — never
      // let an attestation contradict it and resurrect a dead thesis. The
      // guard keys off what the agent DECLARED, so a protective correction
      // can't step over it (DAV-192).
      const beliefSurvived = enforced.beliefSurvived;
      const outcome = await closeOpenPosition(
        position.id,
        reason,
        undefined,
        "agent",
        agentAuditReason,
        ctx.runId,
        beliefSurvived,
        // A trigger run woken by this stock's sale: the proposal stays open while that trigger holds.
        // The Portfolio Manager's sale waits for the owner whatever the switches say.
        { triggerIds: answers(ctx.firedTrigger, ticker, "SELL"), proposedPrice: quote?.c != null && quote.c > 0 ? quote.c : null, ...(ctx.runMode === "PORTFOLIO_MANAGER" ? { propose: true } : {}) },
      );
      const expiresAt = outcome.kind === "proposed" ? (outcome.proposal.expiresAt?.toISOString() ?? null) : null;

      // Trade-as-Proposal — when the Account requires approval for sells in this environment,
      // closeOpenPosition stages the close as Order(AWAITING_APPROVAL) and
      // returns kind:"proposed". Return a proposal-shaped tool envelope so
      // the chat renders "Awaiting your approval." The approve handler at
      // POST /api/proposals/[orderId]/approve runs the rest of the close
      // flow (Alpaca submit + fill polling + ThesisUpdate CLOSED) when the
      // user clicks Approve. See docs/plans/TRADE_AS_PROPOSAL.md.
      if (outcome.kind === "proposed") {
        await recordProposalRunEvent({
          runId: ctx.runId,
          type: "position_close_proposed",
          ticker,
          orderId: outcome.proposal.orderId,
          title: `Proposed closing ${position.direction} ${ticker}`,
          payload: { reason, ...label },
        });
        return {
          summary: `Close proposed: $${ticker}`,
          data: {
            success: true,
            ticker,
            reason: reason,
            shares: position.quantity,
            status: "PROPOSED" as const,
            fillStatus: "AWAITING_APPROVAL" as const,
            direction: position.direction,
            entryPrice: position.avgCost,
            orderId: outcome.proposal.orderId,
            positionId: outcome.proposal.positionId,
            expiresAt,
            rationale: outcome.proposal.rationale,
            ...label,
            message: [
              `Proposed close of ${position.direction} ${position.quantity} shares of ${ticker}. Awaiting your approval (${expiresAt ? "expires in 24h" : "open until answered, or until the stock closes back past the line"}).`,
              ctx.runMode === "PRINCIPAL_CHAT" ? "" : "Your note on this stock, through write_note, is what the owner reads on the proposal.",
              enforced.auditNote,
            ].filter(Boolean).join(" "),
            items: [
              {
                kind: "proposal" as const,
                orderId: outcome.proposal.orderId,
                ticker,
                direction: position.direction as "LONG" | "SHORT",
                action: "CLOSE" as const,
                shares: position.quantity,
                estimatedPrice: position.avgCost,
                estimatedCost: position.quantity * position.avgCost,
                expiresAt,
                rationale: outcome.proposal.rationale,
              },
            ],
          },
          sources: [{ provider: "Hindsight", title: `Proposal close ${ticker}` }],
        };
      }
      // outcome.kind === "closed" — proceed with the existing close-out flow.
      const result = outcome;

      const analystId = ctx.analystId || position.analystId;
      const fillNote = result.fillStatus === "PENDING" ? " (close order pending fill)" : "";
      const reasoningNote = withCloseAuditNote(
        args.note
          ? `Closed ${position.direction} position: ${intent}. ${args.note}. P&L: $${result.realizedPnl.toFixed(2)} (${result.outcome})${fillNote}`
          : `Closed ${position.direction} position: ${intent}. P&L: $${result.realizedPnl.toFixed(2)} (${result.outcome})${fillNote}`,
        enforced,
      );

      try {
        await prisma.tradeDecision.create({
          data: {
            runId: ctx.runId,
            analystId,
            userId: ctx.userId,
            accountId: ctx.accountId,
            symbol: ticker,
            decision: "EXIT",
            reasoning: reasoningNote,
            positionId: position.id,
            orderId: result.orderId,
          },
        });
      } catch (decisionErr) {
        console.warn("[tool] sell TradeDecision write failed:", decisionErr);
      }

      if (ctx.runId) {
        try {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "position_closed",
              title: `Closed ${position.direction} ${ticker}`,
              message: `Closed ${position.quantity} shares at $${result.closePrice.toFixed(2)} — ${result.outcome} ($${result.realizedPnl.toFixed(2)})`,
              payload: {
                ticker,
                direction: position.direction,
                shares: position.quantity,
                entry_price: position.avgCost,
                close_price: result.closePrice,
                realized_pnl: result.realizedPnl,
                outcome: result.outcome,
                reason: reason,
                // DAV-192: keep the agent's own label next to the stored one
                // so a corrected sale is legible in the run feed.
                declared_reason: enforced.declared,
                label_auto_corrected: enforced.corrected,
                label_note: enforced.auditNote,
                notes: args.note ?? null,
              } as object,
            },
          });
        } catch (evtErr) {
          console.warn("[tool] sell RunEvent write failed:", evtErr);
        }
      }

      // Thesis ACTIVE → CLOSED flip + CLOSED audit row now happens inside
      // closeOpenPosition's FILLED-close branch (lib/proposals/thesis-flips.ts
      // → closeThesisForPosition), so every close path — agent, an
      // Auto-sell, and manual UI — flips identically. The audit row
      // (type CLOSED, awaited inside closeOpenPosition before it returns)
      // still satisfies the tactical-run close-out gate, which looks for any
      // non-TRIGGER_FIRED ThesisUpdate row. See P1-18.

      const pnlPct = position.avgCost > 0
        ? (result.realizedPnl / (position.avgCost * position.quantity)) * 100
        : 0;

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
        console.warn("[tool] sell portfolio update fetch failed:", portfolioErr);
      }

      const isPending = result.fillStatus === "PENDING";
      const pnlSign = result.realizedPnl >= 0 ? "+" : "";
      const closeMessage = isPending
        ? `Close order submitted for ${position.direction} ${position.quantity} shares of ${ticker} — awaiting Alpaca fill (estimated price $${result.closePrice.toFixed(2)})`
        : `Closed ${position.direction} ${position.quantity} shares of ${ticker} at $${result.closePrice.toFixed(2)}. ${result.outcome}: $${pnlSign}${result.realizedPnl.toFixed(2)}`;

      const isWin = result.realizedPnl >= 0;
      const closeActionIcon = isPending ? "sell" : (isWin ? "closed-win" : "closed-loss");
      const tickerSummary = isPending
        ? `Close order submitted — ${position.direction} ${position.quantity} shares, awaiting fill`
        : `Closed ${position.direction} @ $${result.closePrice.toFixed(2)} — ${result.outcome} ${pnlSign}$${result.realizedPnl.toFixed(2)} (${Math.round(pnlPct * 100) / 100}%)`;

      return {
        summary: isPending
          ? `Close submitted (pending): $${ticker}`
          : `Closed $${ticker}: ${result.outcome} ${pnlSign}$${result.realizedPnl.toFixed(2)}`,
        data: {
          success: true,
          ticker,
          reason: reason,
          shares: position.quantity,
          status: isPending ? ("PENDING" as const) : ("CLOSED" as const),
          fillStatus: result.fillStatus,
          direction: position.direction,
          entryPrice: position.avgCost,
          closePrice: result.closePrice,
          realizedPnl: result.realizedPnl,
          pnlPct: Math.round(pnlPct * 100) / 100,
          outcome: result.outcome,
          orderId: result.orderId,
          alpacaOrderId: result.alpacaOrderId,
          placedAt: result.placedAt.toISOString(),
          filledAt: result.filledAt?.toISOString() ?? null,
          ...label,
          message: [closeMessage, enforced.auditNote].filter(Boolean).join(" "),
          ...(portfolioUpdate ? { portfolioUpdate } : {}),
          tickers: [{ ticker, tag: "Closed", summary: tickerSummary, actionIcon: closeActionIcon }],
        },
        sources: [{ provider: "Alpaca", title: `Close ${ticker}` }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Position close failed";
      console.error(`[tool] sell FAILED for ${ticker}: ${msg}`);
      return {
        summary: `Close failed: $${ticker}`,
        data: {
          success: false,
          ticker,
          reason: declaredStored,
          status: "FAILED" as const,
          message: msg,
          tickers: [{ ticker, tag: "Failed", summary: msg, actionIcon: "failed" }],
        },
        sources: [],
      };
    }
  },
});
