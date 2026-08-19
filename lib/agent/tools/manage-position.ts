/**
 * manage_position — replaces the binary close_position with a full suite of
 * position management actions. Every action writes a PositionManagementAction
 * audit record with a human-readable reason string.
 *
 * Actions:
 *   full_close          — exit the entire position
 *   partial_close       — sell close_pct% of current shares
 *   add_to_position     — add add_notional dollars to the position
 *   update_targets      — change targetPrice and/or stopLoss
 *   move_stop_to_breakeven — set stopLoss = avgCost
 *   set_trailing_stop   — switch exitStrategy to TRAILING with trail_pct
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { defineTool } from "@/lib/agent/define-tool";
import { PROPOSAL_RATIONALE_VOICE } from "@/lib/agent/proposal-rationale-voice";
import {
  enforceCloseReason,
  withCloseAuditNote,
} from "@/lib/agent/triggers/enforce-close-reason";
import type { ToolContext } from "@/lib/agent/tool-context";
import { prisma } from "@/lib/prisma";
import { getAccount, getOrder, getLatestPrice, closePositionPartial, placeMarketOrder } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { isExcluded } from "@/lib/agent/universe";
import type { ToolUIItem } from "@/lib/agent/tool-result";
import {
  maybeAwaitApproval,
  awaitingApprovalEnvelope,
} from "@/lib/proposals/maybe-await-approval";
import {
  scaleInCeiling,
  SCALE_IN_CEILING_MULTIPLE,
} from "@/lib/agent/position-sizing";

/**
 * Classify an Alpaca submit error — same shape as place_trade / closeOpenPosition.
 *
 *   "rejected"  — 4xx with a definitive "no". Mark Order REJECTED; Position
 *                 unchanged (we never mutated it).
 *   "uncertain" — Network/5xx/timeout. Leave Order PENDING; reconcile-orders
 *                 looks it up by client_order_id and adopts whatever Alpaca
 *                 actually has.
 */
function classifyAlpacaError(err: unknown): "rejected" | "uncertain" {
  const e = err as { statusCode?: number; status?: number; message?: string };
  const code = e?.statusCode ?? e?.status;
  if (typeof code === "number" && code >= 400 && code < 500) return "rejected";
  return "uncertain";
}

type ManagePositionStatus = "NO_POSITION" | "CLOSED" | "PARTIAL_CLOSE" | "ADDED" | "UPDATED" | "FAILED" | "PROPOSED" | "SUPPRESSED";

interface ManagePositionTicker {
  ticker: string;
  tag: string;
  summary: string;
  actionIcon: string;
}

interface ManagePositionData {
  success: boolean;
  ticker: string;
  action: string;
  status: ManagePositionStatus;
  message: string;
  tickers: ManagePositionTicker[];
  // Trade-as-Proposal — populated by proposal branches; ToolUIRenderer
  // reads this to dispatch the proposal kind to ProposalCard.
  // See docs/plans/TRADE_AS_PROPOSAL.md §6.1.
  items?: ToolUIItem[];
  // optional per-action fields
  direction?: string;
  entryPrice?: number;
  closePrice?: number;
  realizedPnl?: number;
  pnlPct?: number;
  outcome?: string;
  closedQty?: number;
  remainingQty?: number;
  fillPrice?: number;
  partialPnl?: number;
  addedQty?: number;
  newTotalQty?: number;
  newAvgCost?: number;
  newTargetPrice?: number | null;
  newStopLoss?: number | null;
  trailPct?: number;
  portfolioUpdate?: { remainingSlots: number; remainingBuyingPower: number; openPositionCount: number };
  // P1-28 suppressed-close branch.
  unapprovedExitCount?: number;
  cooldownUntil?: string;
}

type ManagePositionReturn = { summary: string; data: ManagePositionData; sources: never[] };

function makeReturn(summary: string, data: ManagePositionData): ManagePositionReturn {
  return { summary, data, sources: [] };
}

const schema = z.object({
  symbol: z.string().describe("Ticker symbol of the position to manage"),
  action: z.enum([
    "full_close",
    "partial_close",
    "add_to_position",
    "update_targets",
    "move_stop_to_breakeven",
  ]).describe("What to do with this position"),
  reason: z
    .string()
    .min(20)
    .describe(
      "Required: 1–3 sentences explaining your decision. Written to the audit log visible to the user, and surfaced as Order.rationale on the approval proposal for add / trim / move-stop actions. Be specific — cite the price, catalyst, and expected outcome." +
        PROPOSAL_RATIONALE_VOICE,
    ),

  // partial_close
  close_pct: z
    .number()
    .min(1)
    .max(99)
    .optional()
    .describe("For partial_close: percentage of the position to exit (1–99)"),

  // add_to_position
  add_notional: z
    .number()
    .positive()
    .optional()
    .describe("For add_to_position: dollar amount to add to the position"),

  // update_targets
  new_target_price: z.number().positive().optional().describe("New target price"),
  new_stop_loss: z.number().positive().optional().describe("New stop loss price"),

  // full_close reason code
  close_reason: z
    .enum(["TARGET", "STOP", "THESIS_INVALIDATED", "RISK_MANAGEMENT", "MANUAL"])
    .optional()
    .describe("For full_close or partial_close: the reason code for the exit"),
});

export const managePosition = defineTool({
  description:
    "Manage an existing open position with nuanced actions beyond binary buy/sell. " +
    "Use this instead of close_position for any position management: partial exits, " +
    "target/stop updates, or adding to a winning position. " +
    "Every action is audit-logged with your reason.",
  schema,
  ui: "tool-ui" as const,
  groupId: "Executing",

  progressLabel: (args) => {
    const t = args.symbol.toUpperCase();
    switch (args.action) {
      case "full_close":
        return `Closing the ${t} position`;
      case "partial_close":
        return `Trimming ${t}${args.close_pct ? ` by ${args.close_pct}%` : ""}`;
      case "add_to_position":
        return `Adding to the ${t} position`;
      case "update_targets":
        return `Updating ${t} target and stop`;
      case "move_stop_to_breakeven":
        return `Moving ${t} stop to breakeven`;
      default:
        return `Managing the ${t} position`;
    }
  },

  execute: async (args: z.infer<typeof schema>, ctx: ToolContext): Promise<ManagePositionReturn> => {
    const ticker = args.symbol.toUpperCase().trim();

    // Scope by environment so a LIVE run never operates on a PAPER position
    // (and vice versa) — they live in different Alpaca accounts.
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
      return {
        summary: `No open position in ${ticker}`,
        data: {
          success: false,
          ticker,
          action: args.action,
          status: "NO_POSITION" as const,
          message: `No open position in ${ticker}. No action taken.`,
          tickers: [{ ticker, tag: "N/A", summary: `No open position in ${ticker}`, actionIcon: "failed" }],
        },
        sources: [],
      };
    }

    const analystId = ctx.analystId || position.analystId;
    const creds =
      ctx.alpacaCreds ??
      (await resolveAlpacaCredentials(ctx.userId, runEnvironment)) ??
      undefined;

    try {
      switch (args.action) {
        // ── FULL CLOSE ──────────────────────────────────────────────────────
        case "full_close": {
          // ── Sale-label enforcement (DAV-192) ────────────────────────────
          // full_close is a real sale, identical in effect to close_position,
          // so it inherits the same rule: when this tactical run was woken by
          // a protective/price EXIT trigger, the stored label is that
          // trigger's STOP/TARGET tag rather than the model's `close_reason`.
          // Without this, a protective fire closed through THIS tool landed as
          // MANUAL and went invisible to every rule that keys off the label —
          // the exact dodge DAV-192 closes, and a hole the model could walk
          // through just by preferring one close tool over the other.
          // Auto-correct, never refuse; the note lands in the audit trail.
          const enforced = enforceCloseReason({
            declared: args.close_reason ?? "MANUAL",
            protective: ctx.protectiveExitReason,
            triggerLabel: ctx.protectiveExitTriggerLabel,
          });
          const closeReasonCode = enforced.stored;
          const closeAuditReason = withCloseAuditNote(args.reason, enforced);
          if (enforced.corrected) {
            console.info(
              `[tool] manage_position full_close sale-label auto-corrected for ${ticker}: ${enforced.declared} → ${enforced.stored}`,
            );
          }

          const { closeOpenPosition } = await import("@/lib/actions/closeTrade.actions");
          const outcome = await closeOpenPosition(
            position.id,
            closeReasonCode,
            creds,
            "agent",
            closeAuditReason,
            ctx.runId,
            // manage_position collects no belief attestation, so this is
            // undefined on an ordinary close (→ terminal RETIRED, unchanged).
            // A declared THESIS_INVALIDATED forces `false` so the corrected
            // STOP label can never route a structurally-broken name back to
            // the watchlist.
            enforced.beliefSurvived,
          );

          // Trade-as-Proposal — when the Account requires approval for sells in this environment,
          // the helper stages an Order(AWAITING_APPROVAL) instead of
          // submitting to Alpaca. Return a proposal envelope; the approve
          // handler runs the rest of the close flow on user click. See
          // docs/plans/TRADE_AS_PROPOSAL.md.
          if (outcome.kind === "proposed") {
            return {
              summary: `Close proposed: $${ticker}`,
              data: {
                success: true, ticker, action: args.action, status: "PROPOSED" as const,
                direction: position.direction,
                entryPrice: position.avgCost,
                message: `Proposed close of ${position.direction} ${position.quantity} shares of ${ticker} (${closeReasonCode}). Awaiting your approval (expires in 24h).`,
                tickers: [],
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
              sources: [],
            };
          }
          // Rejected-exit cooldown (P1-28) — user recently rejected this same
          // discretionary close and nothing material changed. Return a clean
          // non-error "did not re-propose" result (the agent DID call a tool,
          // so the narration gate stays satisfied).
          if (outcome.kind === "suppressed") {
            const { unapprovedExitCount, cooldownUntil } = outcome.suppressed;
            return {
              summary: `Held $${ticker} — exit declined ${unapprovedExitCount}× recently`,
              data: {
                success: true,
                ticker,
                action: args.action,
                status: "SUPPRESSED" as const,
                unapprovedExitCount,
                cooldownUntil: cooldownUntil.toISOString(),
                message:
                  `Did not re-propose closing ${ticker}. The user has declined this exit ` +
                  `${unapprovedExitCount}× recently (rejected or left to expire); re-proposal is on ` +
                  `cooldown until ${cooldownUntil.toISOString().slice(0, 10)} unless the thesis ` +
                  `materially changes (a STOP/TARGET trigger or new evidence). Treat it as a soft no and keep holding.`,
                tickers: [
                  {
                    ticker,
                    tag: "Held",
                    summary: `Exit declined ${unapprovedExitCount}× — not re-proposed (cooldown)`,
                    actionIcon: "hold",
                  },
                ],
              },
              sources: [],
            };
          }
          // outcome.kind === "closed" — finalize the close audit + return.
          const result = outcome;

          const pnlSign = result.realizedPnl >= 0 ? "+" : "";
          const pnlPct = position.avgCost > 0
            ? (result.realizedPnl / (position.avgCost * position.quantity)) * 100
            : 0;

          if (ctx.runId) {
            await prisma.runEvent.create({
              data: {
                runId: ctx.runId,
                type: "position_closed",
                title: `Closed ${position.direction} ${ticker}`,
                message: `Closed ${position.quantity} shares at $${result.closePrice.toFixed(2)} — ${result.outcome} ($${pnlSign}${result.realizedPnl.toFixed(2)})`,
                payload: {
                  ticker,
                  direction: position.direction,
                  shares: position.quantity,
                  entry_price: position.avgCost,
                  close_price: result.closePrice,
                  realized_pnl: result.realizedPnl,
                  outcome: result.outcome,
                  reason: closeReasonCode,
                  // DAV-192: the agent's own label kept alongside the stored
                  // one so a corrected sale is legible in the run feed.
                  declared_reason: enforced.declared,
                  label_auto_corrected: enforced.corrected,
                  audit_reason: closeAuditReason,
                } as object,
              },
            });
          }

          // Thesis ACTIVE → CLOSED flip + CLOSED audit row now happens inside
          // closeOpenPosition's FILLED-close branch (closeThesisForPosition),
          // shared with close_position, the price-monitor cron, and manual UI
          // closes so every path flips identically. The awaited CLOSED row
          // still satisfies the tactical-run close-out gate. See P1-18.

          return {
            summary: `Closed $${ticker}: ${result.outcome} ${pnlSign}$${result.realizedPnl.toFixed(2)}`,
            data: {
              success: true,
              ticker,
              action: args.action,
              status: "CLOSED" as const,
              direction: position.direction,
              entryPrice: position.avgCost,
              closePrice: result.closePrice,
              realizedPnl: result.realizedPnl,
              pnlPct: Math.round(pnlPct * 100) / 100,
              outcome: result.outcome,
              message: `Closed ${position.direction} ${position.quantity} shares of ${ticker} at $${result.closePrice.toFixed(2)}. ${result.outcome}: ${pnlSign}$${result.realizedPnl.toFixed(2)}`,
              tickers: [{ ticker, tag: "Closed", summary: `${result.outcome} ${pnlSign}$${result.realizedPnl.toFixed(2)} (${Math.round(pnlPct * 100) / 100}%)`, actionIcon: result.realizedPnl >= 0 ? "closed-win" : "closed-loss" }],
            },
            sources: [],
          };
        }

        // ── PARTIAL CLOSE ───────────────────────────────────────────────────
        case "partial_close": {
          const pct = args.close_pct ?? 50;
          const closeQty = Math.max(1, Math.floor(position.quantity * (pct / 100)));

          if (closeQty >= position.quantity) {
            return {
              summary: `Partial close would exit entire position — use full_close instead`,
              data: {
                success: false, ticker, action: args.action, status: "FAILED" as const,
                message: "Partial close percentage would close the entire position. Use full_close.",
                tickers: [{ ticker, tag: "Failed", summary: "Use full_close to exit entirely", actionIcon: "failed" }],
              },
              sources: [],
            };
          }

          const closeSide: "buy" | "sell" = position.direction === "LONG" ? "sell" : "buy";

          const idempotencyKey = randomUUID();
          const placedAt = new Date();

          // 1. DB tx — create PENDING order, do not mutate Position yet.
          const order = await prisma.order.create({
            data: {
              positionId: position.id,
              userId: ctx.userId,
              environment: position.environment,
              symbol: ticker,
              side: closeSide.toUpperCase(),
              orderType: "MARKET",
              quantity: closeQty,
              status: "PENDING",
              alpacaOrderId: null,
              idempotencyKey,
              intent: "PARTIAL_CLOSE",
              createdAt: placedAt,
            },
          });

          // ── Trade-as-Proposal seam ──
          // Sells flow through requireApprovalSells{Live,Paper}. When on,
          // maybeAwaitApproval flips Order → AWAITING_APPROVAL + sends
          // email; we return early before reaching Alpaca. When off,
          // null is returned and the partial-close submit runs as today.
          {
            const awaiting = await maybeAwaitApproval({
              accountId: ctx.accountId,
              positionId: position.id,
              orderId: order.id,
              intent: "PARTIAL_CLOSE",
              environment: position.environment as "PAPER" | "LIVE",
              rationale: args.reason,
            });
            // PARTIAL_CLOSE is never subject to the P1-28 CLOSE-only cooldown,
            // so awaiting is only ever awaiting_approval | null here.
            if (awaiting?.state === "awaiting_approval") {
              return {
                summary: `Partial close proposed: ${ticker} (-${pct}%)`,
                data: {
                  success: true, ticker, action: args.action, status: "PROPOSED" as const,
                  closedQty: closeQty,
                  remainingQty: position.quantity - closeQty,
                  fillPrice: position.avgCost,
                  partialPnl: 0,
                  tickers: [],
                  ...awaitingApprovalEnvelope({
                    awaiting,
                    ticker,
                    direction: position.direction as "LONG" | "SHORT",
                    intent: "PARTIAL_CLOSE",
                    shares: closeQty,
                    estimatedPrice: position.avgCost,
                  }),
                },
                sources: [],
              };
            }
          }

          // 2. Submit to Alpaca with client_order_id = idempotencyKey.
          let alpacaOrderId: string | null = null;
          try {
            const alpacaOrder = await closePositionPartial(ticker, closeQty, closeSide, creds, idempotencyKey);
            alpacaOrderId = alpacaOrder.id;
            await prisma.order.update({
              where: { id: order.id },
              data: { alpacaOrderId, alpacaSubmittedAt: placedAt, alpacaConfirmedAt: new Date() },
            });
          } catch (submitErr) {
            const outcome = classifyAlpacaError(submitErr);
            const msg = submitErr instanceof Error ? submitErr.message : String(submitErr);
            if (outcome === "rejected") {
              await prisma.order.update({
                where: { id: order.id },
                data: { status: "REJECTED", alpacaSubmittedAt: placedAt, alpacaConfirmedAt: new Date() },
              });
              return {
                summary: `Partial close rejected: ${ticker}`,
                data: {
                  success: false, ticker, action: args.action, status: "FAILED" as const,
                  message: `Alpaca rejected partial close: ${msg}`,
                  tickers: [{ ticker, tag: "Rejected", summary: msg, actionIcon: "failed" }],
                },
                sources: [],
              };
            }
            // Uncertain — leave PENDING, reconcile will recover via clientOrderId.
            console.error(
              `CRITICAL-SYNC-UNCERTAIN [manage_position:partial_close] ${ticker} (idem=${idempotencyKey.slice(0, 8)}): ${msg}. Reconcile will recover.`,
            );
            await prisma.order.update({
              where: { id: order.id },
              data: { alpacaSubmittedAt: placedAt },
            });
            return {
              summary: `Partial close pending: ${ticker} (status uncertain)`,
              data: {
                success: true, ticker, action: args.action, status: "PARTIAL_CLOSE" as const,
                closedQty: closeQty,
                remainingQty: position.quantity - closeQty,
                fillPrice: position.avgCost,
                partialPnl: 0,
                message: `Partial close submitted but status uncertain (${msg}). Reconcile cron will resolve.`,
                tickers: [{ ticker, tag: "Pending", summary: "Awaiting reconcile", actionIcon: "hold" }],
              },
              sources: [],
            };
          }

          // 3. Poll up to 5s for fill.
          let fillPrice: number | null = null;
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline && alpacaOrderId) {
            const polled = await getOrder(alpacaOrderId, creds);
            if (polled.status === "filled" && polled.filled_avg_price) {
              fillPrice = parseFloat(polled.filled_avg_price);
              break;
            }
            if (["cancelled", "expired", "rejected"].includes(polled.status)) {
              await prisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELLED", alpacaConfirmedAt: new Date() },
              });
              return {
                summary: `Partial close ${polled.status}: ${ticker}`,
                data: {
                  success: false, ticker, action: args.action, status: "FAILED" as const,
                  message: `Alpaca partial close ${polled.status}`,
                  tickers: [{ ticker, tag: polled.status, summary: `Alpaca ${polled.status}`, actionIcon: "failed" }],
                },
                sources: [],
              };
            }
            await new Promise((r) => setTimeout(r, 1_000));
          }

          // 4a. Still pending — leave Order PENDING, Position unchanged.
          if (fillPrice == null) {
            const lastPrice = await getLatestPrice(ticker, creds).catch(() => position.avgCost);
            return {
              summary: `Partial close pending: ${ticker} (${closeQty} shares awaiting fill)`,
              data: {
                success: true, ticker, action: args.action, status: "PARTIAL_CLOSE" as const,
                closedQty: closeQty,
                remainingQty: position.quantity - closeQty,
                fillPrice: lastPrice,
                partialPnl: 0,
                message: `Partial close submitted (${closeQty} shares of ${ticker}) — awaiting Alpaca fill.`,
                tickers: [{ ticker, tag: "Pending", summary: `${closeQty} shares awaiting fill`, actionIcon: "hold" }],
              },
              sources: [],
            };
          }

          // 4b. Filled — finalize the partial close.
          const newQty = position.quantity - closeQty;
          const partialPnl = position.direction === "LONG"
            ? (fillPrice - position.avgCost) * closeQty
            : (position.avgCost - fillPrice) * closeQty;
          const pnlSign = partialPnl >= 0 ? "+" : "";

          await prisma.$transaction(async (tx) => {
            await tx.position.update({
              where: { id: position.id },
              data: { quantity: newQty },
            });

            await tx.order.update({
              where: { id: order.id },
              data: {
                status: "FILLED",
                filledPrice: fillPrice!,
                filledQty: closeQty,
                filledAt: new Date(),
              },
            });

            await tx.positionEvent.create({
              data: {
                positionId: position.id,
                eventType: "PARTIAL_CLOSE",
                description: `Partial close: sold ${closeQty} of ${position.quantity} shares (${pct}%) at $${fillPrice!.toFixed(2)}. P&L on portion: ${pnlSign}$${partialPnl.toFixed(2)}. Remaining: ${newQty} shares.`,
                priceAt: fillPrice!,
                pnlAt: partialPnl,
              },
            });

            await tx.positionManagementAction.create({
              data: {
                positionId: position.id,
                runId: ctx.runId ?? null,
                actionType: "PARTIAL_CLOSE",
                source: "agent",
                prevQty: position.quantity,
                newQty,
                reason: args.reason,
                alpacaOrderId,
                fillPrice: fillPrice!,
                fillQty: closeQty,
              },
            });

            if (ctx.runId) {
              await tx.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "position_modified",
                  title: `Partial close: ${ticker}`,
                  message: `Sold ${closeQty} of ${position.quantity} shares (${pct}%) at $${fillPrice!.toFixed(2)}. ${pnlSign}$${partialPnl.toFixed(2)} realized. ${newQty} shares remain.`,
                  payload: { ticker, action: "partial_close", closeQty, newQty, fillPrice, partialPnl, pct } as object,
                },
              });
            }

            await tx.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId,
                userId: ctx.userId,
                accountId: ctx.accountId,
                symbol: ticker,
                decision: "PARTIAL_EXIT",
                reasoning: args.reason,
                positionId: position.id,
                orderId: order.id,
              },
            });
          });

          return {
            summary: `Partial close ${ticker}: sold ${pct}% (${closeQty} shares) ${pnlSign}$${partialPnl.toFixed(2)}`,
            data: {
              success: true,
              ticker,
              action: args.action,
              status: "PARTIAL_CLOSE" as const,
              closedQty: closeQty,
              remainingQty: newQty,
              fillPrice,
              partialPnl,
              message: `Sold ${closeQty} shares of ${ticker} at $${fillPrice.toFixed(2)}. ${pnlSign}$${partialPnl.toFixed(2)} realized. ${newQty} shares remain.`,
              tickers: [{ ticker, tag: `Partial (-${pct}%)`, summary: `Sold ${closeQty} shares @ $${fillPrice.toFixed(2)}. ${pnlSign}$${partialPnl.toFixed(2)} realized.`, actionIcon: partialPnl >= 0 ? "closed-win" : "closed-loss" }],
            },
            sources: [],
          };
        }

        // ── ADD TO POSITION ──────────────────────────────────────────────────
        case "add_to_position": {
          const notional = args.add_notional;
          if (!notional) {
            return {
              summary: `add_notional required for add_to_position`,
              data: {
                success: false, ticker, action: args.action, status: "FAILED" as const,
                message: "add_notional is required for add_to_position.",
                tickers: [{ ticker, tag: "Failed", summary: "Missing add_notional", actionIcon: "failed" }],
              },
              sources: [],
            };
          }

          // ── PR #359 gate parity: exclusion + enabled ────────────────────
          // add_to_position is a buy that increases dollar exposure — must
          // honor the same hard gates place_trade enforces for new entries.
          // Historically this branch bypassed them, so a disabled analyst
          // could still grow its book via adds. See docs/plans/TRADE_AS_PROPOSAL.md §13.

          // Exclusion list — hard reject for any add on an excluded name.
          if (isExcluded(ticker, { exclusionList: ctx.exclusionList })) {
            const blockedMsg = `$${ticker} is on this analyst's exclusion list — cannot add to the position.`;
            return {
              summary: `Add blocked: $${ticker} — excluded`,
              data: {
                success: false, ticker, action: args.action, status: "FAILED" as const,
                message: blockedMsg,
                tickers: [{ ticker, tag: "Failed", summary: blockedMsg, actionIcon: "failed" }],
              },
              sources: [],
            };
          }

          // Enabled — a paused analyst cannot grow its exposure. Existing
          // positions stay manageable via partial_close / full_close / stops;
          // only NEW dollar exposure is blocked.
          if (ctx.analystId) {
            const analystEnabledCheck = await prisma.agentConfig.findUnique({
              where: { id: ctx.analystId },
              select: { enabled: true, name: true },
            });
            if (analystEnabledCheck && !analystEnabledCheck.enabled) {
              const blockedMsg =
                `Add blocked: analyst "${analystEnabledCheck.name}" is disabled — ` +
                `new dollar exposure is paused. Existing positions remain ` +
                `manageable (trims, exits, stops fire). Re-enable the analyst ` +
                `in settings to resume adds and new entries.`;
              return {
                summary: `Add blocked: $${ticker} — analyst paused`,
                data: {
                  success: false, ticker, action: args.action, status: "FAILED" as const,
                  message: blockedMsg,
                  tickers: [{ ticker, tag: "Paused", summary: blockedMsg, actionIcon: "failed" }],
                },
                sources: [],
              };
            }
          }

          // ── Scale-in ceiling (docs/plans/SCALE_INTO_WINNERS.md, PR1) ──────
          // A held winner may grow to SCALE_IN_CEILING_MULTIPLE × the normal
          // per-entry cap. Base cap mirrors place_trade's effective cap and
          // respects realMaxPosition on LIVE — previously this branch used a
          // flat maxPositionSize × 1.5 and ignored realMaxPosition entirely,
          // so a LIVE add could grow past the live per-position cap. Fixed.
          const scaleCeiling = scaleInCeiling({
            environment: position.environment,
            maxPositionSize: ctx.maxPositionSize,
            realMaxPosition: ctx.realMaxPosition,
          });
          const currentValue = position.avgCost * position.quantity;
          if (currentValue + notional > scaleCeiling) {
            return {
              summary: `Add would exceed the ${SCALE_IN_CEILING_MULTIPLE}× scale-in ceiling`,
              data: {
                success: false, ticker, action: args.action, status: "FAILED" as const,
                message: `Adding $${notional} to the current $${currentValue.toFixed(0)} position would exceed this analyst's ${SCALE_IN_CEILING_MULTIPLE}× scale-in ceiling ($${scaleCeiling.toFixed(0)}). A held winner may grow to ${SCALE_IN_CEILING_MULTIPLE}× the normal per-entry cap — trim or wait rather than adding beyond it.`,
                tickers: [{ ticker, tag: "Failed", summary: "Exceeds scale-in ceiling", actionIcon: "failed" }],
              },
              sources: [],
            };
          }

          const idempotencyKey = randomUUID();
          const placedAt = new Date();
          const addSide: "buy" | "sell" = position.direction === "LONG" ? "buy" : "sell";
          // Approximate share count for the PENDING row; corrected to real fill qty below.
          const approxQty = Math.max(1, Math.floor(notional / position.avgCost));

          // 1. DB tx — create PENDING order, do not mutate Position yet.
          const order = await prisma.order.create({
            data: {
              positionId: position.id,
              userId: ctx.userId,
              environment: position.environment,
              symbol: ticker,
              side: addSide.toUpperCase(),
              orderType: "MARKET",
              quantity: approxQty,
              status: "PENDING",
              alpacaOrderId: null,
              idempotencyKey,
              intent: "ADD",
              createdAt: placedAt,
            },
          });

          // ── Trade-as-Proposal seam ──
          // Adds increase exposure, so requireApprovalBuys{Live,Paper} gates them.
          // When on, the helper flips the just-created Order →
          // AWAITING_APPROVAL + sends email; we return early before Alpaca.
          {
            const awaiting = await maybeAwaitApproval({
              accountId: ctx.accountId,
              positionId: position.id,
              orderId: order.id,
              intent: "ADD",
              environment: position.environment as "PAPER" | "LIVE",
              rationale: args.reason,
            });
            // ADD is risk-increasing, never subject to the CLOSE cooldown.
            if (awaiting?.state === "awaiting_approval") {
              return {
                summary: `Add proposed: ${ticker} +$${notional}`,
                data: {
                  success: true, ticker, action: args.action, status: "PROPOSED" as const,
                  addedQty: approxQty,
                  newTotalQty: position.quantity + approxQty,
                  fillPrice: position.avgCost,
                  newAvgCost: position.avgCost,
                  tickers: [],
                  ...awaitingApprovalEnvelope({
                    awaiting,
                    ticker,
                    direction: position.direction as "LONG" | "SHORT",
                    intent: "ADD",
                    shares: approxQty,
                    estimatedPrice: position.avgCost,
                    estimatedCost: notional,
                  }),
                },
                sources: [],
              };
            }
          }

          // 2. Submit to Alpaca with client_order_id = idempotencyKey.
          let alpacaOrderId: string | null = null;
          try {
            const addOrder = await placeMarketOrder({
              symbol: ticker,
              side: addSide,
              notional,
              clientOrderId: idempotencyKey,
            }, creds);
            alpacaOrderId = addOrder.id;
            await prisma.order.update({
              where: { id: order.id },
              data: { alpacaOrderId, alpacaSubmittedAt: placedAt, alpacaConfirmedAt: new Date() },
            });
          } catch (submitErr) {
            const outcome = classifyAlpacaError(submitErr);
            const msg = submitErr instanceof Error ? submitErr.message : String(submitErr);
            if (outcome === "rejected") {
              await prisma.order.update({
                where: { id: order.id },
                data: { status: "REJECTED", alpacaSubmittedAt: placedAt, alpacaConfirmedAt: new Date() },
              });
              return {
                summary: `Add rejected: ${ticker}`,
                data: {
                  success: false, ticker, action: args.action, status: "FAILED" as const,
                  message: `Alpaca rejected add: ${msg}`,
                  tickers: [{ ticker, tag: "Rejected", summary: msg, actionIcon: "failed" }],
                },
                sources: [],
              };
            }
            console.error(
              `CRITICAL-SYNC-UNCERTAIN [manage_position:add_to_position] ${ticker} (idem=${idempotencyKey.slice(0, 8)}): ${msg}. Reconcile will recover.`,
            );
            await prisma.order.update({
              where: { id: order.id },
              data: { alpacaSubmittedAt: placedAt },
            });
            return {
              summary: `Add pending: ${ticker} (status uncertain)`,
              data: {
                success: true, ticker, action: args.action, status: "ADDED" as const,
                addedQty: approxQty,
                newTotalQty: position.quantity + approxQty,
                fillPrice: position.avgCost,
                newAvgCost: position.avgCost,
                message: `Add submitted but status uncertain (${msg}). Reconcile cron will resolve.`,
                tickers: [{ ticker, tag: "Pending", summary: "Awaiting reconcile", actionIcon: "hold" }],
              },
              sources: [],
            };
          }

          // 3. Poll up to 5s for fill.
          let fillPrice: number | null = null;
          let fillQty: number | null = null;
          const deadline = Date.now() + 5_000;
          while (Date.now() < deadline && alpacaOrderId) {
            const polled = await getOrder(alpacaOrderId, creds);
            if (polled.status === "filled" && polled.filled_avg_price && polled.filled_qty) {
              fillPrice = parseFloat(polled.filled_avg_price);
              fillQty = parseFloat(polled.filled_qty);
              break;
            }
            if (["cancelled", "expired", "rejected"].includes(polled.status)) {
              await prisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELLED", alpacaConfirmedAt: new Date() },
              });
              return {
                summary: `Add ${polled.status}: ${ticker}`,
                data: {
                  success: false, ticker, action: args.action, status: "FAILED" as const,
                  message: `Alpaca add ${polled.status}`,
                  tickers: [{ ticker, tag: polled.status, summary: `Alpaca ${polled.status}`, actionIcon: "failed" }],
                },
                sources: [],
              };
            }
            await new Promise((r) => setTimeout(r, 1_000));
          }

          // 4a. Still pending — Position unchanged; reconcile will pick it up.
          if (fillPrice == null || fillQty == null) {
            return {
              summary: `Add pending: ${ticker} (awaiting fill)`,
              data: {
                success: true, ticker, action: args.action, status: "ADDED" as const,
                addedQty: approxQty,
                newTotalQty: position.quantity + approxQty,
                fillPrice: position.avgCost,
                newAvgCost: position.avgCost,
                message: `Add submitted ($${notional} of ${ticker}) — awaiting Alpaca fill.`,
                tickers: [{ ticker, tag: "Pending", summary: `$${notional} awaiting fill`, actionIcon: "hold" }],
              },
              sources: [],
            };
          }

          // 4b. Filled — update Position with real fill price/qty.
          const newTotalQty = position.quantity + fillQty;
          const newAvgCost = ((position.avgCost * position.quantity) + (fillPrice * fillQty)) / newTotalQty;

          await prisma.$transaction(async (tx) => {
            await tx.position.update({
              where: { id: position.id },
              data: { quantity: newTotalQty, avgCost: newAvgCost },
            });

            await tx.order.update({
              where: { id: order.id },
              data: {
                status: "FILLED",
                quantity: fillQty!,
                filledPrice: fillPrice!,
                filledQty: fillQty!,
                filledAt: new Date(),
              },
            });

            await tx.positionEvent.create({
              data: {
                positionId: position.id,
                eventType: "ADDED",
                description: `Added ${fillQty} shares at $${fillPrice!.toFixed(2)}. New position: ${newTotalQty} shares @ avg $${newAvgCost.toFixed(2)}.`,
                priceAt: fillPrice!,
              },
            });

            await tx.positionManagementAction.create({
              data: {
                positionId: position.id,
                runId: ctx.runId ?? null,
                actionType: "ADD_TO_POSITION",
                source: "agent",
                prevQty: position.quantity,
                newQty: newTotalQty,
                reason: args.reason,
                alpacaOrderId,
                fillPrice: fillPrice!,
                fillQty: fillQty!,
              },
            });

            if (ctx.runId) {
              await tx.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "position_modified",
                  title: `Added to ${ticker}`,
                  message: `Added ${fillQty} shares at $${fillPrice!.toFixed(2)}. Now ${newTotalQty} shares @ avg $${newAvgCost.toFixed(2)}.`,
                  payload: { ticker, action: "add_to_position", addedQty: fillQty, newTotalQty, fillPrice, newAvgCost } as object,
                },
              });
            }

            await tx.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId,
                userId: ctx.userId,
                accountId: ctx.accountId,
                symbol: ticker,
                decision: "ADD",
                reasoning: args.reason,
                positionId: position.id,
                orderId: order.id,
              },
            });
          });

          return {
            summary: `Added to ${ticker}: +${fillQty} shares @ $${fillPrice.toFixed(2)}. Now ${newTotalQty} shares.`,
            data: {
              success: true, ticker, action: args.action, status: "ADDED" as const,
              addedQty: fillQty, newTotalQty, fillPrice, newAvgCost,
              message: `Added ${fillQty} shares of ${ticker} at $${fillPrice.toFixed(2)}. Position is now ${newTotalQty} shares at avg cost $${newAvgCost.toFixed(2)}.`,
              tickers: [{ ticker, tag: "Added", summary: `+${fillQty} shares @ $${fillPrice.toFixed(2)}. ${newTotalQty} total.`, actionIcon: "buy" }],
            },
            sources: [],
          };
        }

        // ── UPDATE TARGETS ───────────────────────────────────────────────────
        case "update_targets": {
          if (!args.new_target_price && !args.new_stop_loss) {
            return {
              summary: `No target or stop provided`,
              data: {
                success: false, ticker, action: args.action, status: "FAILED" as const,
                message: "Provide new_target_price and/or new_stop_loss.",
                tickers: [{ ticker, tag: "Failed", summary: "Missing target/stop values", actionIcon: "failed" }],
              },
              sources: [],
            };
          }

          const updateData: Record<string, number> = {};
          if (args.new_target_price) updateData.targetPrice = args.new_target_price;
          if (args.new_stop_loss) updateData.stopLoss = args.new_stop_loss;

          await prisma.$transaction(async (tx) => {
            await tx.position.update({ where: { id: position.id }, data: updateData });

            await tx.positionEvent.create({
              data: {
                positionId: position.id,
                eventType: "TARGET_UPDATED",
                description: [
                  args.new_target_price ? `Target: $${position.targetPrice?.toFixed(2) ?? "—"} → $${args.new_target_price.toFixed(2)}` : null,
                  args.new_stop_loss ? `Stop: $${position.stopLoss?.toFixed(2) ?? "—"} → $${args.new_stop_loss.toFixed(2)}` : null,
                ].filter(Boolean).join(" · "),
                priceAt: null,
              },
            });

            await tx.positionManagementAction.create({
              data: {
                positionId: position.id,
                runId: ctx.runId ?? null,
                actionType: "UPDATE_TARGETS",
                source: "agent",
                prevTargetPrice: position.targetPrice ?? null,
                newTargetPrice: args.new_target_price ?? null,
                prevStopLoss: position.stopLoss ?? null,
                newStopLoss: args.new_stop_loss ?? null,
                reason: args.reason,
              },
            });

            if (ctx.runId) {
              await tx.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "position_modified",
                  title: `Updated targets: ${ticker}`,
                  message: args.reason,
                  payload: { ticker, action: "update_targets", prevTarget: position.targetPrice, newTarget: args.new_target_price, prevStop: position.stopLoss, newStop: args.new_stop_loss } as object,
                },
              });
            }
          });

          const changes = [
            args.new_target_price ? `target $${args.new_target_price.toFixed(2)}` : null,
            args.new_stop_loss ? `stop $${args.new_stop_loss.toFixed(2)}` : null,
          ].filter(Boolean).join(", ");

          return {
            summary: `Updated ${ticker}: ${changes}`,
            data: {
              success: true, ticker, action: args.action, status: "UPDATED" as const,
              newTargetPrice: args.new_target_price ?? position.targetPrice,
              newStopLoss: args.new_stop_loss ?? position.stopLoss,
              message: `Updated ${ticker} — ${changes}. Reason: ${args.reason}`,
              tickers: [{ ticker, tag: "Updated", summary: `Set ${changes}`, actionIcon: "hold" }],
            },
            sources: [],
          };
        }

        // ── MOVE STOP TO BREAKEVEN ────────────────────────────────────────────
        case "move_stop_to_breakeven": {
          const prevStop = position.stopLoss;
          const newStop = position.avgCost;

          await prisma.$transaction(async (tx) => {
            await tx.position.update({
              where: { id: position.id },
              data: { stopLoss: newStop },
            });

            await tx.positionEvent.create({
              data: {
                positionId: position.id,
                eventType: "STOP_MOVED",
                description: `Stop moved to breakeven: $${prevStop?.toFixed(2) ?? "—"} → $${newStop.toFixed(2)} (avg cost)`,
                priceAt: null,
              },
            });

            await tx.positionManagementAction.create({
              data: {
                positionId: position.id,
                runId: ctx.runId ?? null,
                actionType: "MOVE_STOP_TO_BREAKEVEN",
                source: "agent",
                prevStopLoss: prevStop ?? null,
                newStopLoss: newStop,
                reason: args.reason,
              },
            });

            if (ctx.runId) {
              await tx.runEvent.create({
                data: {
                  runId: ctx.runId,
                  type: "position_modified",
                  title: `Stop → breakeven: ${ticker}`,
                  message: `Moved ${ticker} stop to breakeven at $${newStop.toFixed(2)}. ${args.reason}`,
                  payload: { ticker, action: "move_stop_to_breakeven", prevStop, newStop } as object,
                },
              });
            }
          });

          return {
            summary: `${ticker}: stop moved to breakeven $${newStop.toFixed(2)}`,
            data: {
              success: true, ticker, action: args.action, status: "UPDATED" as const,
              newStopLoss: newStop,
              message: `Stop loss moved to breakeven ($${newStop.toFixed(2)}) for ${ticker}. Trade now risk-free.`,
              tickers: [{ ticker, tag: "BE stop", summary: `Stop at $${newStop.toFixed(2)} (breakeven)`, actionIcon: "hold" }],
            },
            sources: [],
          };
        }

        default:
          return {
            summary: `Unknown action`,
            data: {
              success: false, ticker, action: args.action, status: "FAILED" as const,
              message: `Unknown action: ${args.action}`,
              tickers: [{ ticker, tag: "Failed", summary: "Unknown action", actionIcon: "failed" }],
            },
            sources: [],
          };
      }
    } catch (err) {
      // Refresh portfolio context for the error response
      let portfolioUpdate: { remainingSlots: number; remainingBuyingPower: number; openPositionCount: number } | null = null;
      try {
        const currentOpenCount = await prisma.position.count({ where: { analystId, status: "OPEN" } });
        const postAccount = await getAccount(creds);
        portfolioUpdate = {
          remainingSlots: (ctx.maxOpenPositions ?? 5) - currentOpenCount,
          remainingBuyingPower: parseFloat(postAccount.buying_power),
          openPositionCount: currentOpenCount,
        };
      } catch { /* non-fatal */ }

      const msg = err instanceof Error ? err.message : "manage_position failed";
      console.error(`[tool] manage_position FAILED for ${ticker} (${args.action}): ${msg}`);
      return {
        summary: `manage_position failed: ${ticker}`,
        data: {
          success: false, ticker, action: args.action, status: "FAILED" as const,
          message: msg,
          ...(portfolioUpdate ? { portfolioUpdate } : {}),
          tickers: [{ ticker, tag: "Failed", summary: msg, actionIcon: "failed" }],
        },
        sources: [],
      };
    }
  },
});
