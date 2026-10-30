/**
 * activity-feed.ts — a stock's one Activity list, and the newest 8 of it.
 *
 * The rule: the Activity tab shows the whole list, the Overview shows the
 * newest 8, and the next run on the stock reads the same 8 as they read in
 * the feed. One function builds the list, so no two surfaces can disagree:
 * the stock's saved Activity lines (`ThesisUpdate`) plus each proposal's
 * steps, built from its order (the Order table is the source of truth for
 * proposed / approved / declined / expired; its ThesisUpdate copies were
 * dropped ~78% of the time by a fire-and-forget bug and are never trusted).
 *
 * A paragraph lives in one place: the proposal's reason on its "Proposed"
 * step, your comment on a "Declined" step. An "Approved" or "Expired" step is
 * a title. (Until 2026-10-30 the Expired step carried the proposal's reason
 * again, so the tab showed "Its reason is the Expired line above".)
 *
 * Pure. The loaders are in activity-feed.server.ts (the routes) and
 * lib/agent/work-inputs.ts (the agents' read).
 */

/** How many of a stock's newest Activity lines the Overview shows and the next run reads. */
export const RECENT_ITEMS = 8;

/** One Activity line, as every surface reads it. */
export interface FeedItem {
  id: string;
  timestamp: Date;
  type: string;
  summary: string;
  rationale: string | null;
  fieldChanges: unknown;
  priceAtTime: number | null;
  positionAtTime: unknown;
  triggerId: string | null;
  signalIds: string[];
  runId: string | null;
  /** The run's mode when a run wrote the line; null otherwise. */
  runMode: string | null;
  tradeId: string | null;
}

/** A saved Activity line, as the loaders select it (a test's row may carry no id or summary). */
export interface StoredLine {
  id?: string;
  timestamp: Date;
  type: string;
  summary?: string | null;
  rationale?: string | null;
  fieldChanges?: unknown;
  priceAtTime?: number | null;
  positionAtTime?: unknown;
  triggerId?: string | null;
  signalIds?: string[];
  runId?: string | null;
  tradeId?: string | null;
  run?: { mode: string | null } | null;
  runMode?: string | null;
}

/** An order that went through the approval seam (`expiresAt` set), as the loaders select it. */
export interface ProposalOrder {
  id: string;
  status: string;
  intent: string | null;
  side: string;
  quantity: number | { toString(): string };
  symbol: string;
  rationale: string | null;
  rejectionMessage: string | null;
  expiresAt: Date | null;
  alpacaConfirmedAt: Date | null;
  filledPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
  positionId: string | null;
}

/** The steps of one proposal: a "Proposed" anchor, then its outcome when it has one. */
export function proposalSteps(o: ProposalOrder): FeedItem[] {
  const intent = o.intent ?? "OPEN";
  const quantity = Number(o.quantity);
  const qty = ` — ${o.side === "BUY" ? "buy" : "sell"} ${quantity} sh`;
  const base = {
    fieldChanges: {
      proposal: {
        from: { orderId: o.id, status: "AWAITING_APPROVAL" },
        to: { orderId: o.id, status: o.status, intent, quantity, userMessage: o.rejectionMessage },
      },
    },
    priceAtTime: null,
    positionAtTime: null,
    triggerId: null,
    signalIds: [] as string[],
    runId: null,
    runMode: null,
    tradeId: o.positionId,
  };
  const steps: FeedItem[] = [
    { ...base, id: `order:${o.id}:proposed`, timestamp: o.createdAt, type: "PROPOSAL_PROPOSED", summary: `Proposed ${intent} on ${o.symbol}${qty}`, rationale: o.rationale },
  ];
  if (o.status === "REJECTED") {
    steps.push({ ...base, id: `order:${o.id}:rejected`, timestamp: o.alpacaConfirmedAt ?? o.updatedAt, type: "PROPOSAL_REJECTED", summary: `Rejected ${intent} proposal on ${o.symbol}${qty}`, rationale: o.rejectionMessage ?? null });
  } else if (o.status === "EXPIRED") {
    steps.push({ ...base, id: `order:${o.id}:expired`, timestamp: o.expiresAt ?? o.updatedAt, type: "PROPOSAL_EXPIRED", summary: `${intent} proposal on ${o.symbol} expired without decision`, rationale: null });
  } else if (o.status !== "AWAITING_APPROVAL") {
    // PENDING / FILLED / CANCELLED after approval: the approve moment, with the real fill price when known.
    steps.push({ ...base, id: `order:${o.id}:approved`, timestamp: o.alpacaConfirmedAt ?? o.updatedAt, type: "PROPOSAL_APPROVED", summary: `Approved ${intent} on ${o.symbol}${qty}`, rationale: null, priceAtTime: o.filledPrice ?? null });
  }
  return steps;
}

function proposalOrderId(fieldChanges: unknown): string | null {
  const fc = fieldChanges as { proposal?: { from?: { orderId?: unknown }; to?: { orderId?: unknown } } } | null;
  const oid = fc?.proposal?.to?.orderId ?? fc?.proposal?.from?.orderId;
  return typeof oid === "string" ? oid : null;
}

/** A saved line in the feed's shape. */
export function toFeedItem(u: StoredLine): FeedItem {
  return {
    id: u.id ?? `${u.type}:${u.timestamp.getTime()}`,
    timestamp: u.timestamp,
    type: u.type,
    summary: u.summary ?? "",
    rationale: u.rationale ?? null,
    fieldChanges: u.fieldChanges ?? {},
    priceAtTime: u.priceAtTime ?? null,
    positionAtTime: u.positionAtTime ?? null,
    triggerId: u.triggerId ?? null,
    signalIds: u.signalIds ?? [],
    runId: u.runId ?? null,
    runMode: u.runMode ?? u.run?.mode ?? null,
    tradeId: u.tradeId ?? null,
  };
}

/**
 * The feed: the saved lines and the proposals' steps, newest first. A saved
 * PROPOSAL_* copy of an order the steps cover is dropped. A run's note on a
 * proposal it made (the note row stamped with the order as its `tradeId`,
 * lib/proposals/auto-writeup.ts) is one line with the proposal: the
 * "Proposed" step carries the note, the run and the trigger it answered.
 * `limit` cuts the merged list; a caller that wants the newest N loads at
 * least N of each.
 */
export function activityFeed(args: { updates: StoredLine[]; orders: ProposalOrder[]; limit?: number }): FeedItem[] {
  const covered = new Set(args.orders.map((o) => o.id));
  const noteFor = new Map<string, FeedItem>();
  const kept: FeedItem[] = [];
  for (const u of args.updates) {
    const item = toFeedItem(u);
    if (u.type.startsWith("PROPOSAL_")) {
      const oid = proposalOrderId(u.fieldChanges);
      if (oid != null && covered.has(oid)) continue;
    } else if ((u.type === "UPDATED" || u.type === "REVIEWED") && item.tradeId && covered.has(item.tradeId) && !noteFor.has(item.tradeId)) {
      noteFor.set(item.tradeId, item);
      continue;
    }
    kept.push(item);
  }
  const steps = args.orders.flatMap(proposalSteps).map((s) => {
    const note = s.type === "PROPOSAL_PROPOSED" ? noteFor.get(s.tradeId === null ? "" : proposalOrderId(s.fieldChanges) ?? "") : undefined;
    return note ? { ...s, rationale: note.rationale, runId: note.runId, runMode: note.runMode, triggerId: note.triggerId, priceAtTime: note.priceAtTime } : s;
  });
  const merged = [...kept, ...steps].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return args.limit != null ? merged.slice(0, args.limit) : merged;
}

/** The newest 8 of a feed: what the Overview shows and the next run reads. */
export function recentItems(feed: FeedItem[]): FeedItem[] {
  return feed.slice(0, RECENT_ITEMS);
}

/** The feed item as the sheet's JSON carries it (timestamps as ISO strings). */
export function serializeFeedItem(item: FeedItem) {
  return { ...item, timestamp: item.timestamp.toISOString(), fieldChanges: (item.fieldChanges ?? null) as Record<string, { from: unknown; to: unknown }> | null };
}
