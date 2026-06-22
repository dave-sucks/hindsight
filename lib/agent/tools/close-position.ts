/**
 * close_position — migrated to defineTool().
 *
 * Closes an existing open position via Alpaca and records EXIT decision
 * + RunEvent + thesis lifecycle transition in the DB.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { getAccount } from "@/lib/alpaca";

export const closePosition = defineTool({
  description:
    "Explicitly close an existing open position by symbol. " +
    "This tool performs one action only: closing the position. " +
    "Call this during the execution phase when your analysis indicates a position should be exited.",
  schema: z.object({
    ticker: z.string().describe("Ticker symbol of the position to close"),
    reason: z
      .enum(["TARGET", "STOP", "MANUAL"])
      .default("MANUAL")
      .describe("TARGET if hit price target, STOP if risk management, MANUAL for portfolio rebalancing"),
    notes: z.string().optional().describe("Optional notes explaining the close decision"),
  }),
  ui: "tool-ui" as const,
  groupId: "Executing",

  progressLabel: (args) => `Closing $${args.ticker.toUpperCase()} position`,

  execute: async (args, ctx) => {
    const ticker = args.ticker.toUpperCase().trim();
    try {
      // ── PROMOTED guard (P1-21) ─────────────────────────────────────────
      // A PROMOTED thesis was an ACTIVE paper position that the user just
      // graduated PAPER→LIVE. The paper position got force-closed at
      // promotion; the thesis itself sits awaiting first-live-run re-entry.
      // close_position on a PROMOTED row is always wrong: there's no
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
            `Either call place_trade to re-enter live (place_trade auto-flips PROMOTED→ACTIVE), or call update_thesis(change_status="WATCHING", rationale=...) to defer re-entry until the next ENTER trigger fires.`;
          return {
            summary: `Cannot close $${ticker} — thesis is PROMOTED`,
            data: {
              success: false,
              ticker,
              reason: args.reason,
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
      // by env, but the model could synthesize close_position from prior
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
            reason: args.reason,
            status: "NO_POSITION" as const,
            message: noPosMsg,
            tickers: [{ ticker, tag: "N/A", summary: noPosMsg, actionIcon: "failed" }],
          },
          sources: [],
        };
      }

      const { closeOpenPosition } = await import("@/lib/actions/closeTrade.actions");
      const agentAuditReason = args.notes
        ? args.notes
        : `${position.direction} position in ${ticker} closed by agent — reason: ${args.reason}.`;
      const outcome = await closeOpenPosition(position.id, args.reason, undefined, "agent", agentAuditReason, ctx.runId);

      // Trade-as-Proposal — when the Account requires approval for sells in this environment,
      // closeOpenPosition stages the close as Order(AWAITING_APPROVAL) and
      // returns kind:"proposed". Return a proposal-shaped tool envelope so
      // the chat renders "Awaiting your approval." The approve handler at
      // POST /api/proposals/[orderId]/approve runs the rest of the close
      // flow (Alpaca submit + fill polling + ThesisUpdate CLOSED) when the
      // user clicks Approve. See docs/plans/TRADE_AS_PROPOSAL.md.
      if (outcome.kind === "proposed") {
        return {
          summary: `Close proposed: $${ticker}`,
          data: {
            success: true,
            ticker,
            reason: args.reason,
            shares: position.quantity,
            status: "PROPOSED" as const,
            fillStatus: "AWAITING_APPROVAL" as const,
            direction: position.direction,
            entryPrice: position.avgCost,
            orderId: outcome.proposal.orderId,
            positionId: outcome.proposal.positionId,
            expiresAt: outcome.proposal.expiresAt.toISOString(),
            rationale: outcome.proposal.rationale,
            message: `Proposed close of ${position.direction} ${position.quantity} shares of ${ticker}. Awaiting your approval (expires in 24h).`,
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
                expiresAt: outcome.proposal.expiresAt.toISOString(),
                rationale: outcome.proposal.rationale,
              },
            ],
          },
          sources: [{ provider: "Hindsight", title: `Proposal close ${ticker}` }],
        };
      }
      // Rejected-exit cooldown (P1-28) — the user recently rejected this same
      // discretionary close and nothing material changed, so closeOpenPosition
      // neither proposed nor executed. Return a clean, non-error result the
      // agent reads as "leave it; the user already said no." NOT an error —
      // the agent DID call a tool, so the narration gate stays satisfied.
      if (outcome.kind === "suppressed") {
        const { unapprovedExitCount, cooldownUntil } = outcome.suppressed;
        return {
          summary: `Held $${ticker} — exit declined ${unapprovedExitCount}× recently`,
          data: {
            success: true,
            ticker,
            status: "SUPPRESSED" as const,
            unapprovedExitCount,
            cooldownUntil: cooldownUntil.toISOString(),
            message:
              `Did not re-propose closing ${ticker}. The user has declined this exit ` +
              `${unapprovedExitCount}× recently (rejected or left to expire); re-proposal is on ` +
              `cooldown until ${cooldownUntil.toISOString().slice(0, 10)} unless the thesis ` +
              `materially changes (a STOP/TARGET trigger or new evidence). Treat it as a soft no and keep holding.`,
            items: [
              {
                kind: "ticker" as const,
                ticker,
                tag: "Held",
                text: `Exit declined ${unapprovedExitCount}× — not re-proposed (cooldown)`,
                actionIcon: "hold" as const,
              },
            ],
          },
          sources: [],
        };
      }
      // outcome.kind === "closed" — proceed with the existing close-out flow.
      const result = outcome;

      const analystId = ctx.analystId || position.analystId;
      const fillNote = result.fillStatus === "PENDING" ? " (close order pending fill)" : "";
      const reasoningNote = args.notes
        ? `Closed ${position.direction} position: ${args.reason}. ${args.notes}. P&L: $${result.realizedPnl.toFixed(2)} (${result.outcome})${fillNote}`
        : `Closed ${position.direction} position: ${args.reason}. P&L: $${result.realizedPnl.toFixed(2)} (${result.outcome})${fillNote}`;

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
        console.warn("[tool] close_position TradeDecision write failed:", decisionErr);
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
                reason: args.reason,
                notes: args.notes ?? null,
              } as object,
            },
          });
        } catch (evtErr) {
          console.warn("[tool] close_position RunEvent write failed:", evtErr);
        }
      }

      // Thesis ACTIVE → CLOSED flip + CLOSED audit row now happens inside
      // closeOpenPosition's FILLED-close branch (lib/proposals/thesis-flips.ts
      // → closeThesisForPosition), so every close path — agent, the
      // price-monitor cron, and manual UI — flips identically. The audit row
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
        console.warn("[tool] close_position portfolio update fetch failed:", portfolioErr);
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
          reason: args.reason,
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
          message: closeMessage,
          ...(portfolioUpdate ? { portfolioUpdate } : {}),
          tickers: [{ ticker, tag: "Closed", summary: tickerSummary, actionIcon: closeActionIcon }],
        },
        sources: [{ provider: "Alpaca", title: `Close ${ticker}` }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Position close failed";
      console.error(`[tool] close_position FAILED for ${ticker}: ${msg}`);
      return {
        summary: `Close failed: $${ticker}`,
        data: {
          success: false,
          ticker,
          reason: args.reason,
          status: "FAILED" as const,
          message: msg,
          tickers: [{ ticker, tag: "Failed", summary: msg, actionIcon: "failed" }],
        },
        sources: [],
      };
    }
  },
});
