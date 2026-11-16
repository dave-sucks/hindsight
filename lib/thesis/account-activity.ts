/**
 * account-activity.ts — the homepage Activity: the account's stocks' Activity
 * lists (activity-feed.ts), merged, and cut by one filter to the trades and
 * the changes of watch status, beside the attempts that never became a
 * proposal (lib/portfolio/attempt-outcomes.ts). A line is kept, and named, by
 * its stored fields alone (its type, its status change, its order's intent
 * and status), never by its words. The loader is account-activity.server.ts.
 */
import { titleSegments } from "@/components/agent/sheets/thesis-timeline-utils";
import { asTimelineUpdate } from "@/lib/agent/stock-context";
import type { FeedItem } from "@/lib/thesis/activity-feed";
import type { AttemptLine } from "@/lib/portfolio/attempt-outcomes";

/** How many lines the homepage gets; the first 40 show until "Show more". */
export const ACCOUNT_ITEMS = 150;

export type AccountActivityKind =
  // A trade: a proposal's steps, and every fill.
  | "proposed" | "approved" | "bought" | "added" | "sold" | "trimmed" | "declined" | "expired" | "withdrawn"
  // A change of watch status.
  | "watching" | "stopped-watching" | "holding" | "closed" | "passed"
  // An attempt that never became a proposal: the analyst held, a rule blocked it, or the run broke.
  | "held" | "blocked" | "failed";

export interface AccountActivityLine {
  id: string;
  kind: AccountActivityKind;
  ticker: string;
  timestamp: string;
  /** A trade as the stock's Activity tab titles it; a change of status in the words written on it. */
  text: string;
  /** The paragraph on the line, for the hover: the proposal's reason, your comment on a decline, why a watch ended. */
  detail: string | null;
  /** A sale's gain on the cost it sold from. */
  gain: { dollar: number; pct: number } | null;
  /** A proposal still waiting for you. */
  waiting: boolean;
  /** The trade the line belongs to; the row opens it. */
  positionId: string | null;
  /** The run an attempt was made in; the row opens it. */
  runId: string | null;
  /** An attempt names itself: "Held, not sold", "Buy blocked", "Thesis research blocked". */
  label: string | null;
}

const ATTEMPT: Record<AttemptLine["kind"], AccountActivityKind> = { PASSED: "held", BLOCKED: "blocked", FAILED: "failed" };

/** An attempt as the homepage shows it: its own label, and its reason (the analyst's note, the refusal, or the failure) as written. */
export function attemptActivityLine(a: Pick<AttemptLine, "id" | "kind" | "ticker" | "label" | "reason" | "at"> & { runId: string | null }): AccountActivityLine {
  return { id: a.id, kind: ATTEMPT[a.kind], ticker: a.ticker, timestamp: a.at.toISOString(), text: a.reason, detail: a.reason, gain: null, waiting: false, positionId: null, runId: a.runId, label: a.label };
}

const STEP: Record<string, AccountActivityKind> = {
  PROPOSAL_PROPOSED: "proposed",
  PROPOSAL_REJECTED: "declined",
  PROPOSAL_EXPIRED: "expired",
  PROPOSAL_WITHDRAWN: "withdrawn",
};
const FILL: Record<string, AccountActivityKind> = { OPEN: "bought", ADD: "added", CLOSE: "sold", PARTIAL_CLOSE: "trimmed" };

type Fields = {
  proposal?: { to?: { status?: unknown; intent?: unknown; side?: unknown; userMessage?: unknown } };
  status?: { from?: unknown; to?: unknown };
};

/** The one filter: what a line is on the homepage, or null when it is not a trade or a change of watch status. */
export function accountActivityKind(item: Pick<FeedItem, "type" | "fieldChanges">): AccountActivityKind | null {
  const fc = (item.fieldChanges ?? {}) as Fields;
  if (STEP[item.type]) return STEP[item.type];
  if (item.type === "PROPOSAL_APPROVED" || item.type === "ORDER_FILLED") {
    const to = fc.proposal?.to;
    return to?.status === "FILLED" ? FILL[String(to.intent)] ?? null : "approved";
  }
  const { from, to } = fc.status ?? {};
  if (to === "HOLDING") return "holding";
  if (from === "HOLDING" && to === "RETIRED") return "closed";
  if (to === "WATCHING") return "watching";
  if (to === "PASSED") return "passed";
  if (to === "RETIRED" && (from === "WATCHING" || from === "PROMOTED")) return "stopped-watching";
  return null;
}

/** A sale's gain: its fill against the position's cost, in dollars and percent. */
export function saleGain(item: Pick<FeedItem, "priceAtTime" | "positionAtTime" | "fieldChanges">): AccountActivityLine["gain"] {
  const cost = item.positionAtTime as { qty?: number; avgCost?: number } | null;
  if (item.priceAtTime == null || !cost?.qty || !cost.avgCost) return null;
  // Selling closes a long; buying back closes a short.
  const sign = (item.fieldChanges as Fields | null)?.proposal?.to?.side === "BUY" ? -1 : 1;
  const per = (item.priceAtTime - cost.avgCost) * sign;
  return { dollar: per * cost.qty, pct: (per / cost.avgCost) * 100 };
}

/** One line of a stock's Activity as the homepage shows it, or null when the filter leaves it out. */
export function accountActivityLine(item: FeedItem, ticker: string): AccountActivityLine | null {
  const kind = accountActivityKind(item);
  if (!kind) return null;
  const fc = (item.fieldChanges ?? {}) as Fields;
  const t = titleSegments(asTimelineUpdate(item));
  const title = [t.primary, t.secondary].filter(Boolean).join(" ");
  const comment = typeof fc.proposal?.to?.userMessage === "string" ? fc.proposal.to.userMessage.trim() : "";
  const written = comment || item.rationale?.trim() || null;
  const trade = item.type.startsWith("PROPOSAL_") || item.type === "ORDER_FILLED";
  return {
    id: item.id,
    kind,
    ticker,
    timestamp: item.timestamp.toISOString(),
    text: trade ? title : written ?? title,
    detail: written,
    gain: kind === "sold" || kind === "trimmed" ? saleGain(item) : null,
    waiting: kind === "proposed" && fc.proposal?.to?.status === "AWAITING_APPROVAL",
    positionId: trade ? item.tradeId : null,
    runId: null,
    label: null,
  };
}
