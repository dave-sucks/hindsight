/**
 * place_trade — migrated to defineTool().
 *
 * Places a paper trade on Alpaca and creates Position + Order + PositionEvent
 * + TradeDecision + RunEvent in a single DB transaction.
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { placeMarketOrder, getOrder, getLatestPrice, getAccount } from "@/lib/alpaca";
import { isExcluded } from "@/lib/agent/universe";
import { sendEmail, getUserEmail } from "@/lib/email";
import { getOwnerUserId } from "@/lib/auth/account";
import { tradeOpenedHtml } from "@/lib/emails/trade-opened";
import { isInsideMorningBatch } from "@/lib/email-suppression";
import {
  defaultTriggersForHorizon,
  applyTriggerCooldownDefaults,
  type Horizon,
} from "@/lib/agent/triggers/defaults";
import type { Trigger } from "@/lib/agent/triggers/types";
import {
  getThesisComposite,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

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

export const placeTrade = defineTool({
  description:
    "Place a paper trade on Alpaca. The trade will be executed immediately. Requires thesis_id from record_thesis. Will fail if any analyst already holds an open position in this ticker.",
  schema: z.object({
    ticker: z.string(),
    company_name: z.string().optional().describe("Company name from get_stock_data"),
    exchange: z.string().optional().describe("Exchange from get_stock_data, e.g. NASDAQ"),
    direction: z.enum(["LONG", "SHORT"]),
    entry_price: z.number(),
    target_price: z.number(),
    stop_loss: z.number(),
    notional: z.number().optional().describe("Dollar amount to invest (e.g. 5000 for $5,000). Preferred over shares — just pass your position size budget directly."),
    shares: z.number().optional().describe("Number of shares. Only use if you need a specific share count; prefer notional instead."),
    thesis_id: z.string().describe("REQUIRED — the thesis_id returned by record_thesis. Every trade must link to a thesis."),
    analyst_id: z
      .string()
      .optional()
      .describe(
        "Principal-chat only: which analyst is placing the trade. Required when the run isn't already scoped to one analyst (e.g. /chat). Within an analyst run, leave undefined — the run's analyst is used.",
      ),
  }),
  ui: "tool-ui" as const,
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

  execute: async (args, ctx) => {
    // Normalize ticker to uppercase — model sometimes passes lowercase/mixed case,
    // which bypasses the duplicate check and hits Alpaca with a 422.
    const ticker = args.ticker.toUpperCase().trim();

    // P0-9a: ctx.analystId wins for daily/tactical runs (it's always set from
    // the ResearchRun). args.analyst_id is the principal-chat fallback for
    // contexts where no run is scoped to one analyst.
    const effectiveAnalystId: string | undefined = ctx.analystId ?? args.analyst_id;
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
          select: { enabled: true, name: true },
        });
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

      // 0. Check for existing open position (scoped to this analyst only)
      const existingPosition = await prisma.position.findFirst({
        where: { userId: ctx.userId, analystId: effectiveAnalystId ?? undefined, symbol: ticker, status: "OPEN" },
        select: { id: true, symbol: true },
      });

      if (existingPosition) {
        const blockedMsg = `Already holding an open position in ${ticker}. Cannot open duplicate positions for this analyst.`;
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

      // 0b. Analyst config guardrails — minConfidence, maxOpenPositions,
      // maxPositionSize. Previously these were advisory (passed to the
      // prompt) and the model could ignore them. Now they're hard gates:
      // a violation returns a FAILED trade result. This protects the
      // paper book from the model overriding its own stated rules.

      // ── Guardrail 0: thesis direction is committed (not PENDING) ────
      // A PENDING thesis is a user/builder/editor seed awaiting first
      // research. It has no target/stop/triggers/belief. place_trade on
      // a PENDING row would create an open position with no exit plan AND
      // violate the legal (direction, status) pairs (PENDING + ACTIVE is
      // not legal). Agent must promote PENDING → LONG/SHORT via
      // update_thesis first.
      {
        const directionCheck = await prisma.thesis.findUnique({
          where: { id: args.thesis_id },
          select: {
            direction: true,
          },
        });

        // Note: there is NO staleness gate here. Research-age decisions
        // belong to the REVIEW flow, not the TRADE flow — the agent's
        // prompt teaches it to refresh stale research during review, and
        // the per-horizon REVIEW cadence drives that work deterministically.
        // See docs/plans/REVIEW_REFRESH_CADENCE.md (P1-1).

        if (directionCheck && directionCheck.direction === "PENDING") {
          const msg =
            `$${ticker}: cannot place_trade on a PENDING thesis. PENDING is a user/builder/editor seed awaiting first research — no target, no stop, no committed view. ` +
            `Promote it first: call update_thesis(thesis_id="${args.thesis_id}", direction: "${args.direction}", horizon: ..., entry_price: ..., target_price: ..., stop_loss: ..., core_belief: ..., key_assumptions: [...], invalidation_conditions: [...]) ` +
            `to commit. Then retry place_trade on the same thesis_id once the structural fields are set.`;
          return {
            summary: `Trade blocked: $${ticker} — thesis is PENDING (promote via update_thesis first)`,
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

      // ── Guardrail 1: thesis composite score ≥ minConfidence ────────
      // PR-9 dropped the legacy `confidenceScore` int — `scoring.composite`
      // (a /10 setup grade with 4-dim breakdown) is the single conviction
      // number. Analyst configs still store `minConfidence` on the legacy
      // 0-100 scale; we convert composite ×10 for comparison so existing
      // configs (e.g. `minConfidence: 70`) keep their semantics.
      if (ctx.minConfidence != null) {
        const thesis = await prisma.thesis.findUnique({
          where: { id: args.thesis_id },
          select: { scoring: true, direction: true },
        });
        const composite = getThesisComposite(thesis ?? { scoring: null });
        const compositeOn100Scale = composite != null ? composite * 10 : null;
        if (thesis && (compositeOn100Scale == null || compositeOn100Scale < ctx.minConfidence)) {
          const compositeLabel =
            composite != null ? `${composite}/10 (=${compositeOn100Scale}%)` : "unscored";
          const blockedMsg = `Trade blocked: thesis composite ${compositeLabel} is below this analyst's minimum (${ctx.minConfidence}%). Raise the composite via update_thesis with a fresh 4-dim scoring, or skip the trade.`;
          return {
            summary: `Trade blocked: $${ticker} — below min composite`,
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

      // ── Guardrail 2: open position count < maxOpenPositions ────────
      if (ctx.maxOpenPositions != null && effectiveAnalystId) {
        const openCount = await prisma.position.count({
          where: {
            analystId: effectiveAnalystId,
            status: "OPEN",
          },
        });
        if (openCount >= ctx.maxOpenPositions) {
          const blockedMsg = `Trade blocked: this analyst already has ${openCount} open position${openCount !== 1 ? "s" : ""}, at its ${ctx.maxOpenPositions}-slot cap. Close something first.`;
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

      // ── Guardrail 3: target/stop ordering vs entry_price ───────────
      // For LONG, target must be ABOVE entry and stop BELOW entry.
      // For SHORT, target must be BELOW entry and stop ABOVE entry.
      // Without this, the model can pass stale numbers from an old
      // WATCHING thesis (target set when price was lower) and the
      // first price-monitor tick after fill closes the position
      // because `currentPrice >= targetPrice` is satisfied at avgCost.
      {
        const entry = args.entry_price;
        const tgt = args.target_price;
        const stp = args.stop_loss;
        let bad: string | null = null;
        if (args.direction === "LONG") {
          if (tgt <= entry) {
            bad = `target $${tgt.toFixed(2)} is at or below entry $${entry.toFixed(2)} — for a LONG, target must be ABOVE entry`;
          } else if (stp >= entry) {
            bad = `stop $${stp.toFixed(2)} is at or above entry $${entry.toFixed(2)} — for a LONG, stop must be BELOW entry`;
          }
        } else {
          if (tgt >= entry) {
            bad = `target $${tgt.toFixed(2)} is at or above entry $${entry.toFixed(2)} — for a SHORT, target must be BELOW entry`;
          } else if (stp <= entry) {
            bad = `stop $${stp.toFixed(2)} is at or below entry $${entry.toFixed(2)} — for a SHORT, stop must be ABOVE entry`;
          }
        }
        if (bad) {
          const blockedMsg = `Trade blocked: ${bad}. Recompute target and stop relative to the current price, then call place_trade again.`;
          return {
            summary: `Trade blocked: $${ticker} — invalid target/stop`,
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

      // ── Guardrail 4: live-price check vs target/stop ───────────────
      // Even if entry_price/target/stop are internally consistent,
      // the model may have used a stale entry estimate (e.g. last
      // night's close, or an old thesis's entry level). If the live
      // market price has already crossed target or stop, the
      // price-monitor will close the position on its next tick —
      // refuse here instead. Quote failure is non-fatal (the
      // ordering guardrail above is the static fallback).
      try {
        const livePrice = await getLatestPrice(ticker, ctx.alpacaCreds);
        if (Number.isFinite(livePrice) && livePrice > 0) {
          let bad: string | null = null;
          if (args.direction === "LONG") {
            if (livePrice >= args.target_price) {
              bad = `current price $${livePrice.toFixed(2)} is at or above target $${args.target_price.toFixed(2)} — a LONG would close on the next price tick`;
            } else if (livePrice <= args.stop_loss) {
              bad = `current price $${livePrice.toFixed(2)} is at or below stop $${args.stop_loss.toFixed(2)} — a LONG would close on the next price tick`;
            }
          } else {
            if (livePrice <= args.target_price) {
              bad = `current price $${livePrice.toFixed(2)} is at or below target $${args.target_price.toFixed(2)} — a SHORT would close on the next price tick`;
            } else if (livePrice >= args.stop_loss) {
              bad = `current price $${livePrice.toFixed(2)} is at or above stop $${args.stop_loss.toFixed(2)} — a SHORT would close on the next price tick`;
            }
          }
          if (bad) {
            const blockedMsg = `Trade blocked: ${bad}. Recompute target and stop relative to the current price, then call place_trade again.`;
            return {
              summary: `Trade blocked: $${ticker} — target/stop already breached at live price`,
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
      } catch (quoteErr) {
        console.warn(
          `[place_trade] live-price guardrail skipped for ${ticker}: ${quoteErr instanceof Error ? quoteErr.message : quoteErr}`,
        );
      }

      // ── Guardrail 5: requested notional ≤ effective per-position cap ───
      // PAPER → maxPositionSize. LIVE → min(maxPositionSize, realMaxPosition)
      // so a forgotten realMaxPosition can't accidentally uncap a live order.
      // Only checks when the model explicitly sized the trade (notional or
      // shares). If neither is set, the fallback path below uses the same
      // effective cap as the budget so no violation is possible.
      const isLiveRun = ctx.runEnvironment === "LIVE";
      const effectiveCap =
        isLiveRun && ctx.realMaxPosition != null
          ? Math.min(ctx.maxPositionSize ?? Infinity, ctx.realMaxPosition)
          : ctx.maxPositionSize;
      if (effectiveCap != null && Number.isFinite(effectiveCap)) {
        const requestedNotional =
          args.notional != null && args.notional > 0
            ? args.notional
            : args.shares != null && args.shares > 0
              ? args.shares * args.entry_price
              : null;
        if (requestedNotional != null && requestedNotional > effectiveCap) {
          const capLabel = isLiveRun && ctx.realMaxPosition != null
            ? "live per-position cap"
            : "max position size";
          const blockedMsg = `Trade blocked: requested $${Math.round(requestedNotional).toLocaleString()} exceeds this analyst's ${capLabel} ($${effectiveCap.toLocaleString()}). Scale it down.`;
          return {
            summary: `Trade blocked: $${ticker} — exceeds ${capLabel}`,
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

      // 1. Resolve qty — prefer notional (dollar amount), fall back to shares
      // Server-side calculation removes a cognitive step from the model.
      let resolvedShares: number | undefined;
      let resolvedNotional: number | undefined;
      if (args.notional != null && args.notional > 0) {
        resolvedNotional = args.notional;
        // Compute shares for DB record (approximate — actual fill may differ)
        resolvedShares = Math.max(1, Math.floor(args.notional / args.entry_price));
      } else if (args.shares != null && args.shares > 0) {
        resolvedShares = args.shares;
      } else {
        // Final fallback: use the effective cap (LIVE = realMaxPosition,
        // PAPER = maxPositionSize) so a sizeless place_trade on a live
        // analyst can't blow past the per-position ceiling.
        const fallbackCap =
          effectiveCap != null && Number.isFinite(effectiveCap)
            ? effectiveCap
            : ctx.maxPositionSize ?? 5000;
        resolvedNotional = fallbackCap;
        resolvedShares = Math.max(1, Math.floor(fallbackCap / args.entry_price));
      }

      // ── Workstream B: DB-first write path ────────────────────────────────
      // Old flow: Alpaca first, then DB. A crash between the two left an
      // invisible Alpaca position with no DB attribution. New flow: DB first
      // with a server-generated idempotencyKey, then Alpaca with that key as
      // client_order_id. If the Alpaca call doesn't return cleanly, the
      // PENDING Order row is recoverable by reconcile-orders looking it up
      // by client_order_id.

      const analystId = effectiveAnalystId;
      if (!analystId) {
        throw new Error("Cannot place trade without an analyst ID. Pass analyst_id (principal chat) or ensure the run is linked to an analyst.");
      }
      // Belt-and-suspenders: if the agent overrides via args.analyst_id,
      // confirm the analyst belongs to the user.
      if (args.analyst_id && args.analyst_id !== ctx.analystId) {
        const owner = await prisma.agentConfig.findFirst({
          where: { id: args.analyst_id, userId: ctx.userId },
          select: { id: true },
        });
        if (!owner) {
          throw new Error(`Analyst ${args.analyst_id} not found or not yours.`);
        }
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
            targetPrice: args.target_price,
            stopLoss: args.stop_loss,
            // Per-thesis triggers (lib/agent/triggers/*) own exit logic now.
            // The agent's PRICE_BELOW level: stop EXIT trigger from the
            // horizon defaults fires via the trigger evaluator's 5-min cron;
            // there's no parallel auto-close path. Opt into TRAILING via
            // manage_position.set_trailing_stop when the agent wants peak-
            // relative exits. See docs/MORNING_RUN_V2_DESIGN.md Fix #0.
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
            reasoning: `${args.direction} ${finalShares} shares — submitting market order (target $${args.target_price.toFixed(2)}, stop $${args.stop_loss.toFixed(2)})`,
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
                target_price: args.target_price,
                stop_loss: args.stop_loss,
                shares: finalShares,
                position_id: pos.id,
                order_id: ord.id,
                idempotency_key: idempotencyKey,
              } as object,
            },
          });
        }

        return { position: pos, order: ord };
      });

      // 3. Submit to Alpaca with client_order_id = idempotencyKey.
      let alpacaOrderId: string | null = null;
      let submitOutcome: "ok" | "rejected" | "uncertain" = "ok";
      try {
        const alpacaOrder = await placeMarketOrder({
          symbol: ticker,
          ...(resolvedNotional != null ? { notional: resolvedNotional } : { qty: resolvedShares }),
          side: args.direction === "LONG" ? "buy" : "sell",
          clientOrderId: idempotencyKey,
        }, ctx.alpacaCreds);
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
            targetPrice: args.target_price,
            stopLoss: args.stop_loss,
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

      // ── PROMOTED → ACTIVE auto-transition ──────────────────────────────
      // If the thesis was PROMOTED (first-live-run re-entry), flip it to
      // ACTIVE now that we have an open live position. Belt-and-suspenders
      // — the agent SHOULD have called update_thesis(change_status: ACTIVE)
      // first, but if it skipped that step the trade itself is the explicit
      // intent to enter and we shouldn't leave the thesis in PROMOTED with
      // a live position attached.
      //
      // Fires on both FILLED and PENDING paths. On PENDING the close hasn't
      // landed but the agent committed to the entry; reconcile-orders will
      // either confirm or cancel the order, and either outcome is consistent
      // with ACTIVE (a cancellation rolls back via the existing close path).
      try {
        const promotedThesis = await prisma.thesis.findUnique({
          where: { id: args.thesis_id },
          select: { id: true, status: true },
        });
        if (promotedThesis && promotedThesis.status === "PROMOTED") {
          await prisma.thesis.update({
            where: { id: promotedThesis.id },
            data: { status: "ACTIVE", promotedAt: null },
          });
        }
      } catch (err) {
        console.warn(
          `[place_trade] PROMOTED → ACTIVE auto-transition failed for thesis ${args.thesis_id}:`,
          err instanceof Error ? err.message : err,
        );
      }

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
      try {
        const watchingThesis = await prisma.thesis.findFirst({
          where: {
            ticker,
            status: "WATCHING",
            researchRun: { agentConfigId: analystId },
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            direction: true,
            horizon: true,
            entryPrice: true,
            targetPrice: true,
            stopLoss: true,
            maxHoldDays: true,
            catalystDate: true,
            triggers: true,
          },
        });
        if (watchingThesis) {
          // Compute the new HELD trigger set. Only when horizon is known
          // can we pick a template; otherwise we leave the existing
          // trigger array alone (drop only ENTER triggers manually to
          // avoid the recurring-fire bug at minimum).
          const horizon = watchingThesis.horizon as Horizon | null;
          let nextTriggers: Trigger[] | undefined;
          if (horizon) {
            // Use the trade arguments as ground truth — entry/target/stop
            // from `args` reflect what was actually executed, not the
            // (now-behind-us) WATCHING levels.
            const heldDefaults = defaultTriggersForHorizon(
              horizon,
              {
                entryPrice: args.entry_price,
                targetPrice: args.target_price,
                stopLoss: args.stop_loss,
                maxHoldDays: watchingThesis.maxHoldDays ?? null,
                catalystDate: watchingThesis.catalystDate ?? null,
                direction: watchingThesis.direction as "LONG" | "SHORT",
              },
              "HELD",
            );
            nextTriggers = applyTriggerCooldownDefaults(heldDefaults);
          } else {
            // No horizon → drop ENTER-action triggers from the existing
            // array so the WATCHING-side ENTER doesn't keep firing on
            // the held position. Conservative fallback.
            const existing = (watchingThesis.triggers as unknown as Trigger[] | null) ?? [];
            nextTriggers = existing.filter((t) => t.action !== "ENTER");
          }

          await prisma.thesis.update({
            where: { id: watchingThesis.id },
            data: {
              status: "ACTIVE",
              triggers: (nextTriggers ?? []) as unknown as object,
            },
          });
          await prisma.thesisUpdate.create({
            data: {
              thesisId: watchingThesis.id,
              type: "STATUS_CHANGED",
              summary: `Promoted ${ticker} ${watchingThesis.direction} WATCHING → ACTIVE on place_trade`,
              rationale: `Position opened (id ${position.id}). Watchlist row archived; live position now active. Triggers regenerated for HELD-side ${horizon ?? "(no-horizon)"} template.`,
              fieldChanges: {
                status: { from: "WATCHING", to: "ACTIVE" },
                triggers: { from: "WATCHING-set", to: "HELD-set" },
              },
              runId: ctx.runId,
              tradeId: position.id,
            },
          });
        }
      } catch (err) {
        console.warn(`[tool] place_trade WATCHING→ACTIVE promotion failed:`, err instanceof Error ? err.message : err);
      }

      // Fetch post-trade portfolio context (non-fatal)
      let portfolioUpdate: { remainingSlots: number; remainingBuyingPower: number; openPositionCount: number } | null = null;
      try {
        const currentOpenCount = await prisma.position.count({ where: { analystId, status: "OPEN" } });
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
      //   2. isInsideMorningBatch — suppress for trades inside the 8 AM
      //      morning cron's MORNING_PLAN runs; the 10 AM daily digest
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
            // Send to the account OWNER, not the user that placed the trade.
            // For solo OWNER they're the same; for team workspaces an EDITOR
            // placing a trade still pings the OWNER (canonical inbox).
            const ownerUserId = await getOwnerUserId(ctx.accountId);
            const toEmail = await getUserEmail(ownerUserId ?? ctx.userId);
            if (!toEmail) return;
            const thesis = await prisma.thesis.findUnique({
              where: { id: args.thesis_id },
              select: { snapshot: true },
            });
            const verb = args.direction === "LONG" ? "📈 Bought" : "📉 Shorted";
            const livePrefix = positionEnvironment === "LIVE" ? "[LIVE] " : "";
            await sendEmail({
              to: toEmail,
              subject: `${livePrefix}${verb} ${ticker} — ${config.name}`,
              html: tradeOpenedHtml({
                ticker,
                direction: args.direction,
                qty: emailedShares,
                avgCost: emailedAvgCost,
                stopLoss: args.stop_loss,
                targetPrice: args.target_price,
                analystName: config.name,
                thesisSummary: thesis ? (getThesisSnapshotText(thesis) || null) : null,
              }),
            });
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
        ? `Placed ${args.direction} ${finalShares} shares @ $${fillPrice.toFixed(2)} — target $${args.target_price.toFixed(2)}, stop $${args.stop_loss.toFixed(2)}`
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
          targetPrice: args.target_price,
          stopLoss: args.stop_loss,
          positionId: position.id,
          orderId: order.id,
          alpacaOrderId,
          placedAt: placedAt.toISOString(),
          filledAt: filledAt ? filledAt.toISOString() : null,
          message,
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
