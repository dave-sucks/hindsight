"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import {
  placeMarketOrder,
  getOrder,
  getLatestPrice,
} from "@/lib/alpaca";
import { sendEmail } from "@/lib/email";
import { tradePlacedHtml } from "@/lib/emails/trade-placed";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenPositionInput {
  thesisId: string;
  analystId: string;        // FK to AgentConfig — which analyst is trading
  ticker: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  shares: number;
  targetPrice?: number;
  stopLoss?: number;
  exitStrategy: "PRICE_TARGET" | "TIME_BASED" | "TRAILING" | "MANUAL";
  exitDate?: string;        // ISO date string, only for TIME_BASED
  trailingStopPct?: number; // only for TRAILING
  researchRunId?: string;   // When set, writes a RunEvent + TradeDecision
}

export interface OpenPositionResult {
  positionId: string;
  orderId: string;
  alpacaOrderId: string;
  fillPrice: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Poll Alpaca until order is filled or timeout (max 10s).
 * When market is closed orders stay "accepted" — we fall back to entryPrice.
 */
async function waitForFill(
  orderId: string,
  symbol: string,
  fallbackPrice: number,
  maxMs = 10_000
): Promise<number> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const order = await getOrder(orderId);
    if (order.status === "filled" && order.filled_avg_price) {
      return parseFloat(order.filled_avg_price);
    }
    if (
      order.status === "cancelled" ||
      order.status === "expired" ||
      order.status === "rejected"
    ) {
      throw new Error(`Alpaca order ${order.status}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  // Market closed or fill took too long — use latest market price as fill estimate
  try {
    return await getLatestPrice(symbol);
  } catch {
    return fallbackPrice;
  }
}

// ─── Server Action ────────────────────────────────────────────────────────────

export async function openPosition(
  input: OpenPositionInput
): Promise<OpenPositionResult> {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { positionId: "", orderId: "", alpacaOrderId: "", fillPrice: 0, error: "Not authenticated" };
  }

  // 2. Check for existing open position in this ticker (across all analysts)
  const existingPosition = await prisma.position.findFirst({
    where: { userId: user.id, symbol: input.ticker, status: "OPEN" },
    select: { id: true },
  });

  if (existingPosition) {
    return {
      positionId: "",
      orderId: "",
      alpacaOrderId: "",
      fillPrice: 0,
      error: `Already holding an open position in ${input.ticker}. Cannot open duplicate positions.`,
    };
  }

  // 3. Max open positions check for this analyst
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { id: input.analystId },
    select: { maxOpenPositions: true },
  });
  const maxOpenPositions = agentConfig?.maxOpenPositions ?? 5;

  const openCount = await prisma.position.count({
    where: { analystId: input.analystId, status: "OPEN" },
  });

  if (openCount >= maxOpenPositions) {
    return {
      positionId: "",
      orderId: "",
      alpacaOrderId: "",
      fillPrice: 0,
      error: `Max open positions reached (${maxOpenPositions}). Close a position before opening a new one.`,
    };
  }

  // 4. Place Alpaca paper order
  let alpacaOrder;
  try {
    alpacaOrder = await placeMarketOrder({
      symbol: input.ticker,
      qty: input.shares,
      side: input.direction === "LONG" ? "buy" : "sell",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Alpaca order failed";
    return { positionId: "", orderId: "", alpacaOrderId: "", fillPrice: 0, error: msg };
  }

  // 5. Wait for fill (or use entry price if market closed)
  let fillPrice = input.entryPrice;
  try {
    fillPrice = await waitForFill(alpacaOrder.id, input.ticker, input.entryPrice);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Order failed";
    return { positionId: "", orderId: alpacaOrder.id, alpacaOrderId: alpacaOrder.id, fillPrice: 0, error: msg };
  }

  // 6. Create Position
  const position = await prisma.position.create({
    data: {
      analystId: input.analystId,
      userId: user.id,
      symbol: input.ticker,
      direction: input.direction,
      status: "OPEN",
      quantity: input.shares,
      avgCost: fillPrice,
      targetPrice: input.targetPrice ?? null,
      stopLoss: input.stopLoss ?? null,
      exitStrategy: input.exitStrategy,
      exitDate: input.exitDate ? new Date(input.exitDate) : null,
      trailingStopPct: input.trailingStopPct ?? null,
    },
  });

  // 7. Create Order (with fill data — paper trading fills immediately)
  const order = await prisma.order.create({
    data: {
      positionId: position.id,
      userId: user.id,
      symbol: input.ticker,
      side: input.direction === "LONG" ? "BUY" : "SELL",
      orderType: "MARKET",
      quantity: input.shares,
      status: "FILLED",
      filledPrice: fillPrice,
      filledQty: input.shares,
      filledAt: new Date(),
      alpacaOrderId: alpacaOrder.id,
    },
  });

  // 8. Write OPENED PositionEvent
  await prisma.positionEvent.create({
    data: {
      positionId: position.id,
      eventType: "OPENED",
      description: `${input.direction} ${input.shares} shares of ${input.ticker} placed via Alpaca Paper at $${fillPrice.toFixed(2)}`,
      priceAt: fillPrice,
    },
  });

  // 9. Write TradeDecision linking thesis → position → order
  if (input.researchRunId) {
    await prisma.tradeDecision.create({
      data: {
        runId: input.researchRunId,
        analystId: input.analystId,
        userId: user.id,
        symbol: input.ticker,
        decision: "BUY",
        reasoning: `${input.direction} ${input.shares} shares at $${fillPrice.toFixed(2)}`,
        thesisId: input.thesisId,
        positionId: position.id,
        orderId: order.id,
      },
    });

    // 10. Write RunEvent so trade appears on run page reload
    await prisma.runEvent.create({
      data: {
        runId: input.researchRunId,
        type: "trade_placed",
        title: `Trade placed: ${input.direction} ${input.ticker}`,
        message: `${input.direction} ${input.shares} shares of ${input.ticker} at $${fillPrice.toFixed(2)}`,
        payload: {
          ticker: input.ticker,
          direction: input.direction,
          entry: fillPrice,
          target_price: input.targetPrice ?? null,
          stop_loss: input.stopLoss ?? null,
          shares: input.shares,
          position_id: position.id,
          order_id: order.id,
        } as object,
      },
    });
  }

  // 11. Send trade-placed email alert (fire-and-forget)
  if (user.email) {
    const thesis = await prisma.thesis.findUnique({
      where: { id: input.thesisId },
      select: { signalTypes: true, confidenceScore: true, reasoningSummary: true },
    });
    sendEmail({
      to: user.email,
      subject: `${input.direction === "LONG" ? "📈" : "📉"} Agent placed trade: ${input.direction} ${input.ticker}`,
      html: tradePlacedHtml({
        ticker: input.ticker,
        direction: input.direction as "LONG" | "SHORT",
        entryPrice: fillPrice,
        shares: input.shares,
        targetPrice: input.targetPrice,
        stopLoss: input.stopLoss,
        signalTypes: thesis?.signalTypes ?? [],
        confidenceScore: thesis?.confidenceScore,
        reasoningSummary: thesis?.reasoningSummary,
        tradeId: position.id, // Use position ID for trade link
      }),
    });
  }

  return {
    positionId: position.id,
    orderId: order.id,
    alpacaOrderId: alpacaOrder.id,
    fillPrice,
  };
}

// ─── Legacy createTrade wrapper (for old UI code paths during migration) ─────

export interface CreateTradeInput {
  thesisId: string;
  ticker: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  shares: number;
  targetPrice?: number;
  stopLoss?: number;
  exitStrategy: "PRICE_TARGET" | "TIME_BASED" | "TRAILING" | "MANUAL";
  exitDate?: string;
  trailingStopPct?: number;
  notes?: string;
  researchRunId?: string;
}

export interface CreateTradeResult {
  tradeId: string;
  alpacaOrderId: string;
  fillPrice: number;
  error?: string;
}

/**
 * Legacy wrapper — maps old createTrade interface to new openPosition.
 * Used by TradeReviewSheet and other UI components until Phase 2 migration.
 */
export async function createTrade(input: CreateTradeInput): Promise<CreateTradeResult> {
  // Find the analyst linked to this thesis
  const thesis = await prisma.thesis.findUnique({
    where: { id: input.thesisId },
    select: { researchRun: { select: { agentConfigId: true } } },
  });

  const analystId = thesis?.researchRun?.agentConfigId;
  if (!analystId) {
    return { tradeId: "", alpacaOrderId: "", fillPrice: 0, error: "Could not determine analyst for this thesis" };
  }

  const result = await openPosition({
    thesisId: input.thesisId,
    analystId,
    ticker: input.ticker,
    direction: input.direction,
    entryPrice: input.entryPrice,
    shares: input.shares,
    targetPrice: input.targetPrice,
    stopLoss: input.stopLoss,
    exitStrategy: input.exitStrategy,
    exitDate: input.exitDate,
    trailingStopPct: input.trailingStopPct,
    researchRunId: input.researchRunId,
  });

  return {
    tradeId: result.positionId,
    alpacaOrderId: result.alpacaOrderId,
    fillPrice: result.fillPrice,
    error: result.error,
  };
}
