"use server";

/**
 * Close a paper trade.
 * Stub — implemented in DAV-34.
 */
export async function closeTrade(
  _tradeId: string,
  _reason: "TARGET" | "STOP" | "TIME" | "MANUAL",
  _currentPrice: number
): Promise<void> {
  // DAV-34 implements: closePosition on Alpaca, calculate P&L,
  // update Trade.status, write CLOSED TradeEvent
  throw new Error("closeTrade not yet implemented — see DAV-34");
}
