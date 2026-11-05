/**
 * activity-feed.ts — a stock's one Activity list, and the newest 8 of it.
 *
 * The rule: the Activity tab shows the whole list, the Overview shows the
 * newest 8, and the next run on the stock reads the same 8 as they read in
 * the feed. One function builds the list, so no two surfaces can disagree:
 * the stock's saved Activity lines (`ThesisUpdate`) plus each proposal's
 * steps, built from its order (the Order table is the source of truth for
 * proposed / approved / declined / expired; its ThesisUpdate copies were
 * dropped ~78% of the time by a fire-and-forget bug, so only the price a
 * Declined or Expired copy recorded is read from them).
 *
 * A paragraph lives in one place: the proposal's reason on its "Proposed"
 * step, your comment on a "Declined" step. An "Approved" or "Expired" step is
 * a title. (Until 2026-10-30 the Expired step carried the proposal's reason
 * again, so the tab showed "Its reason is the Expired line above".)
 *
 * Pure. The loaders are in activity-feed.server.ts (the routes) and
 * lib/agent/work-inputs.ts (the agents' read).
 */

/** How many of a stock's newest Activity lines the next run reads (the Activity tab marks where they end). */
export const RECENT_ITEMS = 8;
/** How many of a stock's newest written-up lines the Overview shows as Agent insights. */
export const NOTED_ITEMS = 5;

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
  /** The rule the line answered or fired on, as it stood then; null on proposal steps and on lines saved before 2026-11-03. */
  triggerAction: string | null;
  triggerCondition: unknown;
  signalIds: string[];
  runId: string | null;
  /** The run's mode when a run wrote the line; null otherwise. */
  runMode: string | null;
  tradeId: string | null;
  /** A review's verdict (STRONGER / UNCHANGED / WEAKER / BROKEN) and its one line; null when it gave none. */
  verdict: string | null;
  verdictLine: string | null;
  /** The earlier line this note answers, and when that line was written. */
  answersUpdateId: string | null;
  answersAt: Date | null;
  /** On a Proposed step, the run's note it carries: the saved line a later note can answer. */
  noteId: string | null;
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
  triggerAction?: string | null;
  triggerCondition?: unknown;
  signalIds?: string[];
  runId?: string | null;
  tradeId?: string | null;
  run?: { mode: string | null } | null;
  runMode?: string | null;
  verdict?: string | null;
  verdictLine?: string | null;
  answersUpdateId?: string | null;
  answers?: { timestamp: Date } | null;
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
    triggerAction: null,
    triggerCondition: null,
    signalIds: [] as string[],
    runId: null,
    runMode: null,
    tradeId: o.positionId,
    verdict: null,
    verdictLine: null,
    answersUpdateId: null,
    answersAt: null,
    noteId: null,
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
    triggerAction: u.triggerAction ?? null,
    triggerCondition: u.triggerCondition ?? null,
    signalIds: u.signalIds ?? [],
    runId: u.runId ?? null,
    runMode: u.runMode ?? u.run?.mode ?? null,
    tradeId: u.tradeId ?? null,
    verdict: u.verdict ?? null,
    verdictLine: u.verdictLine ?? null,
    answersUpdateId: u.answersUpdateId ?? null,
    answersAt: u.answers?.timestamp ?? null,
    noteId: null,
  };
}

/**
 * The feed: the saved lines and the proposals' steps, newest first. A saved
 * PROPOSAL_* copy of an order the steps cover is dropped. A run's note on a
 * proposal it made (the note row stamped with the order as its `tradeId`,
 * lib/proposals/auto-writeup.ts) is one line with the proposal: the
 * "Proposed" step carries the note, the run and the trigger it answered.
 * A dropped Declined or Expired copy gives its step the price it recorded.
 * `limit` cuts the merged list; a caller that wants the newest N loads at
 * least N of each.
 */
export function activityFeed(args: { updates: StoredLine[]; orders: ProposalOrder[]; limit?: number }): FeedItem[] {
  const covered = new Set(args.orders.map((o) => o.id));
  const noteFor = new Map<string, FeedItem>();
  const priceFor = new Map<string, number>();
  const kept: FeedItem[] = [];
  for (const u of args.updates) {
    const item = toFeedItem(u);
    if (u.type.startsWith("PROPOSAL_")) {
      const oid = proposalOrderId(u.fieldChanges);
      if (oid != null && covered.has(oid)) {
        const key = `${oid}:${u.type}`;
        if ((u.type === "PROPOSAL_REJECTED" || u.type === "PROPOSAL_EXPIRED") && item.priceAtTime != null && !priceFor.has(key)) priceFor.set(key, item.priceAtTime);
        continue;
      }
    } else if ((u.type === "UPDATED" || u.type === "REVIEWED") && item.tradeId && covered.has(item.tradeId) && !noteFor.has(item.tradeId)) {
      noteFor.set(item.tradeId, item);
      continue;
    }
    kept.push(item);
  }
  const steps = args.orders.flatMap(proposalSteps).map((s) => {
    const oid = proposalOrderId(s.fieldChanges) ?? "";
    const note = s.type === "PROPOSAL_PROPOSED" ? noteFor.get(oid) : undefined;
    if (note) {
      const { rationale, runId, runMode, triggerId, triggerAction, triggerCondition, priceAtTime, verdict, verdictLine, answersUpdateId, answersAt } = note;
      return { ...s, rationale, runId, runMode, triggerId, triggerAction, triggerCondition, priceAtTime, verdict, verdictLine, answersUpdateId, answersAt, noteId: note.id };
    }
    const price = priceFor.get(`${oid}:${s.type}`);
    return price != null ? { ...s, priceAtTime: price } : s;
  });
  const merged = [...kept, ...steps].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return args.limit != null ? merged.slice(0, args.limit) : merged;
}

/** The newest 8 of a feed: what the next run reads. */
export function recentItems(feed: FeedItem[]): FeedItem[] {
  return feed.slice(0, RECENT_ITEMS);
}

/**
 * Whether a line carries a paragraph someone wrote: an analyst's note, the
 * owner's note, or the owner's words on a proposal. A trigger fire's
 * rationale is the check's figures ("200-day $941.20; price $884.83"), not a
 * write-up, so a fire never counts.
 */
export function hasWrittenParagraph(item: Pick<FeedItem, "type" | "rationale" | "fieldChanges">): boolean {
  if (item.type === "TRIGGER_FIRED") return false;
  if (item.rationale?.trim()) return true;
  const msg = (item.fieldChanges as { proposal?: { to?: { userMessage?: unknown } } } | null | undefined)?.proposal?.to?.userMessage;
  return typeof msg === "string" && msg.trim().length > 0;
}

/**
 * The Overview's Agent insights: the newest 5 lines with a written paragraph
 * (the owner's choice, 2026-11-04: the view shows the helpful notes, not every
 * line). The agents' read is `recentItems`, untouched by this.
 */
export function notedItems(feed: FeedItem[]): FeedItem[] {
  return feed.filter(hasWrittenParagraph).slice(0, NOTED_ITEMS);
}

/** The feed item as the sheet's JSON carries it (timestamps as ISO strings). */
export function serializeFeedItem(item: FeedItem) {
  return { ...item, timestamp: item.timestamp.toISOString(), fieldChanges: (item.fieldChanges ?? null) as Record<string, { from: unknown; to: unknown }> | null };
}
