import { prisma } from "@/lib/prisma";

/**
 * Tickers for which this analyst has a PENDING buy proposal — a Position in
 * `PENDING_APPROVAL` (staged by place_trade, awaiting the user's approval).
 *
 * Used to suppress ENTER needsAction (P1-25 Change 4). Once a buy is proposed,
 * the agent has already expressed the entry; re-flagging ENTER on the next run
 * would make it re-attempt place_trade (rejected by the PENDING_APPROVAL dedup
 * guard at place-trade.ts:168-187) and nag complete_run. A pending entry
 * resolves to OPEN (approved) or CANCELLED (rejected/expired) — either way it
 * drops out of this set, so the ENTER becomes live again on the next run.
 */
export async function getPendingEntryTickers(
  analystId: string,
): Promise<Set<string>> {
  const rows = await prisma.position.findMany({
    where: { analystId, status: "PENDING_APPROVAL" },
    select: { symbol: true },
  });
  return new Set(rows.map((r) => r.symbol));
}
