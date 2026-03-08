"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import {
  placeMarketOrder,
  getOrder,
  getLatestPrice,
} from "@/lib/alpaca";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateTradeInput {
  thesisId: string;
  ticker: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  shares: number;
  targetPrice?: number;
  stopLoss?: number;
  exitStrategy: "PRICE_TARGET" | "TIME_BASED" | "TRAILING" | "MANUAL";
  exitDate?: string; // ISO date string, only for TIME_BASED
  trailingStopPct?: number; // only for TRAILING
  notes?: string;
}

export interface CreateTradeResult {
  tradeId: string;
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

export async function createTrade(
  input: CreateTradeInput
): Promise<CreateTradeResult> {
  // 1. Auth check
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { tradeId: "", alpacaOrderId: "", fillPrice: 0, error: "Not authenticated" };
  }

  // 2. Max open positions check
  const agentConfig = await prisma.agentConfig.findUnique({
    where: { userId: user.id },
  });
  const maxOpenPositions = agentConfig?.maxOpenPositions ?? 5;

  const openCount = await prisma.trade.count({
    where: { userId: user.id, status: "OPEN" },
  });

  if (openCount >= maxOpenPositions) {
    return {
      tradeId: "",
      alpacaOrderId: "",
      fillPrice: 0,
      error: `Max open positions reached (${maxOpenPositions}). Close a trade before opening a new one.`,
    };
  }

  // 3. Place Alpaca paper order
  let alpacaOrder;
  try {
    alpacaOrder = await placeMarketOrder({
      symbol: input.ticker,
      qty: input.shares,
      side: input.direction === "LONG" ? "buy" : "sell",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Alpaca order failed";
    return { tradeId: "", alpacaOrderId: "", fillPrice: 0, error: msg };
  }

  // 4. Wait for fill (or use entry price if market closed)
  let fillPrice = input.entryPrice;
  try {
    fillPrice = await waitForFill(alpacaOrder.id, input.ticker, input.entryPrice);
  } catch (err) {
    // Cancelled/rejected — bail out, don't write DB
    const msg = err instanceof Error ? err.message : "Order failed";
    return { tradeId: "", alpacaOrderId: alpacaOrder.id, fillPrice: 0, error: msg };
  }

  // 5. Write Trade to Prisma
  const trade = await prisma.trade.create({
    data: {
      thesisId: input.thesisId,
      userId: user.id,
      ticker: input.ticker,
      direction: input.direction,
      status: "OPEN",
      entryPrice: fillPrice,
      shares: input.shares,
      targetPrice: input.targetPrice ?? null,
      stopLoss: input.stopLoss ?? null,
      exitStrategy: input.exitStrategy,
      exitDate: input.exitDate ? new Date(input.exitDate) : null,
      trailingStopPct: input.trailingStopPct ?? null,
      alpacaOrderId: alpacaOrder.id,
      notes: input.notes ?? null,
    },
  });

  // 6. Write PLACED TradeEvent
  await prisma.tradeEvent.create({
    data: {
      tradeId: trade.id,
      eventType: "PLACED",
      description: `${input.direction} ${input.shares} shares of ${input.ticker} placed via Alpaca Paper at $${fillPrice.toFixed(2)}`,
      priceAt: fillPrice,
    },
  });

  return {
    tradeId: trade.id,
    alpacaOrderId: alpacaOrder.id,
    fillPrice,
  };
}
