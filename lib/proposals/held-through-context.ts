/**
 * Held-through context for the NO-AGENT sell proposals (DAV-194).
 *
 * Lane 1 (#518) made the daily sell ask on a held-through stock worth
 * reading — which day of the breach it is, the principal's own reject note,
 * the recent low with a suggested place for the line. But that enrichment
 * only reached proposals written by an AGENT run (the prompt reads
 * `heldThroughFloor` off get_theses). A floor set to fire automatically
 * (DIRECT mode) skips the agent, so its daily card was the trigger's
 * original rationale verbatim — identical day over day, exactly the nag
 * Lane 1 was built to fix (SNOW's card, 2026-08-18 run review; MU's trail
 * as of 2026-08-19).
 *
 * What a "real decline" is now lives in ONE place —
 * `lib/agent/declined-sale.ts` — and this module, `get_theses` and
 * `complete_run` all read it from there. It used to be written out twice,
 * with a comment here asking the next person to keep the copies in sync;
 * DAV-315 needed a third reader and collapsed them instead.
 *
 * The note NEVER blocks the sale: any failure returns null and the
 * proposal goes out with the trigger's own rationale, same as before.
 */

import { prisma } from "@/lib/prisma";
import { getBars } from "@/lib/alpaca";
import {
  DECLINED_SALE_WINDOW_DAYS,
  declinedSaleWhere,
  foldDeclines,
} from "@/lib/agent/declined-sale";

/** Re-exported so the historic import path keeps working. */
export const HELD_THROUGH_WINDOW_DAYS = DECLINED_SALE_WINDOW_DAYS;

/**
 * Pure composition — one plain-language paragraph appended to the proposal
 * rationale. Null when there's nothing held-through to say (first ask =
 * the trigger's own rationale already carries the story).
 */
export function buildHeldThroughNote(args: {
  declineCount: number;
  rejectMessage: string | null;
  /** Recent low for LONG / recent high for SHORT; null when unavailable. */
  recentExtreme: number | null;
  direction: string | null;
}): string | null {
  const { declineCount, rejectMessage, recentExtreme, direction } = args;
  if (declineCount <= 0) return null;
  const isLong = direction !== "SHORT";
  // In plain words (lib/agent/voice.ts): this is read on the proposal.
  const times = declineCount === 1 ? "once" : declineCount === 2 ? "twice" : `${declineCount} times`;
  const nth = ["Second", "Third", "Fourth", "Fifth"][declineCount - 1];
  const parts: string[] = [
    `${nth ? `${nth} ask` : `Ask ${declineCount + 1}`}: you declined it or let it expire ${times} in the last ${HELD_THROUGH_WINDOW_DAYS} days, and it's still ${isLong ? "below" : "above"} the line.`,
  ];
  if (rejectMessage) {
    parts.push(`Your last note: "${rejectMessage.slice(0, 200)}".`);
  }
  if (recentExtreme != null && recentExtreme > 0) {
    parts.push(
      isLong
        ? `The recent low is $${recentExtreme.toFixed(2)}; to keep holding, decline and move the line just under it.`
        : `The recent high is $${recentExtreme.toFixed(2)}; to keep holding, decline and move the line just over it.`,
    );
  }
  return parts.join(" ");
}

/**
 * Fetch + compose for one open position. Best-effort by design — a context
 * failure logs and returns null; it must never delay or block a protective
 * close proposal.
 */
export async function heldThroughNoteForPosition(args: {
  positionId: string;
  ticker: string;
  direction: string | null;
}): Promise<string | null> {
  const { positionId, ticker, direction } = args;
  try {
    const declines = await prisma.order.findMany({
      where: { positionId, ...declinedSaleWhere(new Date()) },
      select: { createdAt: true, rejectionMessage: true, status: true, expiresAt: true, updatedAt: true },
    });
    const folded = foldDeclines(declines);
    if (!folded) return null;

    // Recent low (LONG) / high (SHORT) over the window — the number that
    // helps the principal pick a better line while declining. Optional.
    let recentExtreme: number | null = null;
    try {
      const nowMs = Date.now();
      const start = new Date(nowMs - HELD_THROUGH_WINDOW_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const end = new Date(nowMs).toISOString().slice(0, 10);
      const bars = await getBars(ticker, { start, end });
      const isLong = direction !== "SHORT";
      const extremes = bars
        .map((b) => (isLong ? b.low ?? b.close : b.high ?? b.close))
        .filter((v): v is number => typeof v === "number" && v > 0);
      if (extremes.length > 0) {
        recentExtreme = isLong ? Math.min(...extremes) : Math.max(...extremes);
      }
    } catch {
      // bars unavailable → note goes out without the level suggestion
    }

    return buildHeldThroughNote({
      declineCount: folded.declineCount,
      rejectMessage: folded.rejectMessage,
      recentExtreme,
      direction,
    });
  } catch (err) {
    console.warn(
      `[held-through-context] lookup failed for position=${positionId} ${ticker}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
