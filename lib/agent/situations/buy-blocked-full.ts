/**
 * A buy fired (or is true now) on a stock we don't hold while its analyst is
 * full. Rule: `buyBlockedByFull` (moved from capacity.ts), as get_theses
 * computed it: the buy's own last fire within a week, or the lead a buy true
 * now (./facts.ts).
 */
import { isFull, type AnalystCapacity } from "@/lib/agent/capacity";
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export interface BuyBlockedByFull {
  /** Plain words for the row: the limit, when the buy fired, and the question. */
  text: string;
  firedAt: string | null;
}

/** How long a fired buy stays "wants in" on a full analyst. */
export const FIRED_BUY_WANTS_IN_DAYS = 7;

/**
 * A watched stock whose buy fired recently (or is live now) while its
 * analyst is full. That is a portfolio decision — is this better than what
 * we hold? — and it belongs on the row, not buried in a rationale.
 */
export function buyBlockedByFull(
  row: {
    ticker: string;
    status: string | null;
    /** The stock's own buy trigger's last fire, ISO. */
    enterLastFiredAt?: string | null;
    /** True when the buy condition is true on the live price right now. */
    enterLiveNow?: boolean;
  },
  capacity: AnalystCapacity | null | undefined,
  now: Date,
): BuyBlockedByFull | null {
  if (row.status !== "WATCHING" || !isFull(capacity)) return null;
  const fired = row.enterLastFiredAt ? new Date(row.enterLastFiredAt) : null;
  const recent = fired != null && (now.getTime() - fired.getTime()) / 86_400_000 <= FIRED_BUY_WANTS_IN_DAYS;
  if (!recent && !row.enterLiveNow) return null;
  const c = capacity!;
  const when = recent ? `fired ${fired!.toISOString().slice(0, 10)}` : "is live now";
  return {
    firedAt: recent ? fired!.toISOString() : null,
    text: `$${row.ticker}'s buy ${when} and this analyst is full (${c.open} of ${c.max}${c.held.length ? `: ${c.held.map((t) => `$${t}`).join(", ")}` : ""}). This is a portfolio decision, not a quiet day: name which held stock $${row.ticker} would replace and why it is better, or write "full — waiting" on this row with the reason. Do not call place_trade for it while the analyst is full.`,
  };
}

export const buyBlockedFull: SituationDefinition<"BUY_BLOCKED_FULL"> = {
  code: "BUY_BLOCKED_FULL",
  order: 4,
  appliesTo: "watched",
  entry: "row",
  guidance: "",
  lists: () => true,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    if (!facts.blocked) return { active: false };
    const items = itemsFor(facts, "BUY_BLOCKED_FULL");
    const reached = stock.resolved?.actionability === "ENTER_NOW";
    return {
      active: true,
      data: {
        flag: firstFlag(items),
        fires: items.map((i) => i.ref),
        blocked: facts.blocked,
        ...(reached ? { levelReached: { triggerDetail: stock.resolved?.triggerDetail ?? null } } : {}),
      },
    };
  },
};
