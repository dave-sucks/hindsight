/**
 * thesis-timeline-utils — pure helpers behind the ThesisSheet Activity tab
 * (P1-33 slice 1). No React: kept out of ThesisTimelineSection.tsx so the
 * title-grammar / field-change / ladder-diff logic is unit-testable.
 *
 * The visual language (principal spec, 2026-08-20):
 *   - NO badges. Every row is one consistently-worded title in two tones:
 *     `primary` (medium weight — the core event) + `secondary` (light
 *     weight — the variable values). titleSegments() owns that grammar.
 *   - Colored rail dots carry the money semantics: green = bought,
 *     red = sold, amber = a proposal that did NOT trade (declined /
 *     expired / awaiting).
 *   - Stored `summary` strings are inconsistent legacy prose — the title
 *     is DERIVED here, never rendered verbatim.
 *
 *   - ladderChangeLines: the trigger ops the caller sent, one chip each
 *     ("Entry $183 → $190") — never a diff of two lists
 */

export type FieldChange = { from: unknown; to: unknown };

export interface TimelineUpdate {
  id: string;
  timestamp: string;
  type: string;
  summary: string;
  rationale: string | null;
  fieldChanges: Record<string, FieldChange> | null;
  priceAtTime: number | null;
  positionAtTime: {
    qty: number;
    avgCost: number;
    unrealizedPnL: number | null;
  } | null;
  triggerId: string | null;
  signalIds: string[];
  runId: string | null;
  tradeId: string | null;
}

// ── Proposal metadata (Order-derived rows) ───────────────────────────────────

function proposalMeta(u: TimelineUpdate): {
  side: "buy" | "sell" | null;
  quantity: number | null;
} {
  const fc = u.fieldChanges as
    | { proposal?: { to?: { intent?: unknown; quantity?: unknown } } }
    | null;
  const to = fc?.proposal?.to;
  const intent = to?.intent;
  const side =
    intent === "OPEN" || intent === "ADD"
      ? ("buy" as const)
      : intent === "CLOSE" || intent === "PARTIAL_CLOSE"
        ? ("sell" as const)
        : null;
  const quantity = typeof to?.quantity === "number" ? to.quantity : null;
  return { side, quantity };
}

/** Is this Proposed row still sitting in the approval queue? */
function isAwaiting(u: TimelineUpdate): boolean {
  const fc = u.fieldChanges as
    | { proposal?: { to?: { status?: unknown } } }
    | null;
  return fc?.proposal?.to?.status === "AWAITING_APPROVAL";
}

/** The order this row belongs to, when it's an Order-derived proposal row. */
export function proposalOrderId(u: TimelineUpdate): string | null {
  const m = u.id.match(/^order:([^:]+):/);
  return m?.[1] ?? null;
}

// ── Title grammar ────────────────────────────────────────────────────────────
// One consistent sentence shape per event: `primary` names the event (Bought /
// Sold / Trigger: / Reviewed / Updated…), `secondary` carries its variable
// values (shares, prices, levels). The renderer sets primary medium,
// secondary light @80%.

export interface TitleSegments {
  primary: string;
  secondary: string | null;
  /** Trailing medium-weight clause — the decision on trigger episodes
   * ("— passed", "— raised floor to $62.00"). */
  outcome?: string | null;
}

// Strips " on CYTK", " on $CYTK (HOLDING)" etc. from legacy summaries — the
// sheet is already scoped to one ticker, so naming it in every row is noise.
const TICKER_CLAUSE = /\s+on\s+\$?[A-Z][A-Z0-9.\-]{0,6}(\s*\([A-Z]+\))?/;

function stripTicker(s: string): string {
  return s.replace(TICKER_CLAUSE, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * "Price above $817 — consider entry (signal: …)" → "Price above $817".
 * "Scheduled review due on CYTK (HOLDING)" → "Scheduled review due".
 * The action clause and deferral notes are dropped — the title names the
 * condition; the expanded rationale carries the rest.
 */
export function triggerPhrase(summary: string): string {
  let s = summary;
  s = s.replace(/\s*\(signal:[\s\S]*$/, "");
  const dash = s.lastIndexOf(" — ");
  if (dash > 0) s = s.slice(0, dash);
  return stripTicker(s).trim();
}

function fmtQty(quantity: number | null): string | null {
  if (quantity == null) return null;
  return `${quantity} share${quantity === 1 ? "" : "s"}`;
}

function fmtPrice(v: number | null | undefined): string | null {
  return typeof v === "number" ? `$${v.toFixed(2)}` : null;
}

function tradeSentence(u: TimelineUpdate): string | null {
  const { quantity } = proposalMeta(u);
  const qty = fmtQty(quantity);
  const fill = fmtPrice(u.priceAtTime);
  if (!qty) return null;
  return fill ? `${qty} at ${fill}` : qty;
}

/**
 * ── The ONE place a row is identified ───────────────────────────────────────
 *
 * A stored `type` is not an event. `STATUS_CHANGED` is four different things
 * (a position opened, a position sold, a name dropped, a name back on watch),
 * and `UPDATED` is two (a run wrote it, or you edited it from the trigger
 * popover). Every renderer downstream used to re-derive which one it was
 * looking at, so the same if-ladder lived in the title, in the dot, and in
 * the "does this show its prose" set.
 *
 * It happens once, here. Everything after this keys off `EventKind` alone —
 * one table lookup each, no nesting, no re-reading fieldChanges.
 */
export type EventKind =
  | "fired"
  | "reviewed"
  | "note"
  | "created"
  | "updated"
  | "edited-by-you"
  | "invalidated"
  | "superseded"
  | "opened"
  | "sold"
  | "dropped"
  | "back-to-watching"
  | "status"
  | "closed"
  | "bought"
  | "sold-fill"
  | "approved"
  | "declined"
  | "expired"
  | "proposed"
  | "unknown";

export function eventKind(u: TimelineUpdate): EventKind {
  const fc = u.fieldChanges ?? {};
  switch (u.type) {
    case "TRIGGER_FIRED":
      return "fired";
    case "REVIEWED":
      return "reviewed";
    // The principal's note, from chat (lib/agent/notes.ts).
    case "NOTE":
      return "note";
    case "CREATED":
      return "created";
    case "UPDATED":
      // Your own edits from the trigger popover: marked in fieldChanges, or (rows before 2026-10-06) by a [USER] tag on the note.
      return isYourEdit(u) ? "edited-by-you" : "updated";
    case "INVALIDATED":
      return "invalidated";
    case "SUPERSEDED":
      return "superseded";
    case "STATUS_CHANGED":
      if (fc.status?.to === "HOLDING") return "opened";
      if (fc.retiredReason?.to === "SOLD") return "sold";
      if (fc.retiredReason?.to === "DROPPED") return "dropped";
      if (fc.status?.to === "WATCHING") return "back-to-watching";
      return "status";
    case "CLOSED":
      return "closed";
    case "PROPOSAL_APPROVED": {
      const { side } = proposalMeta(u);
      return side === "buy" ? "bought" : side === "sell" ? "sold-fill" : "approved";
    }
    case "PROPOSAL_REJECTED":
      return "declined";
    case "PROPOSAL_EXPIRED":
      return "expired";
    case "PROPOSAL_PROPOSED":
      return "proposed";
    default:
      return "unknown";
  }
}

/**
 * kind → the two-tone sentence. One row per kind, read it like a table.
 * `secondary` is a function only because some kinds carry a value from the
 * row (a price, a share count); none of them branch on anything else.
 */
const TITLES: Record<EventKind, { primary: string; secondary: (u: TimelineUpdate) => string | null }> = {
  fired:              { primary: "Trigger:",         secondary: (u) => triggerPhrase(u.summary) },
  reviewed:           { primary: "Reviewed",         secondary: () => "no changes" },
  note:               { primary: "Note added",       secondary: (u) => stripTicker(u.summary) || null },
  created:            { primary: "Created",          secondary: (u) => stripTicker(u.summary) || null },
  updated:            { primary: "Updated",          secondary: updatedSecondary },
  "edited-by-you":    { primary: "Edited by you",    secondary: updatedSecondary },
  invalidated:        { primary: "Invalidated",      secondary: () => "belief broken" },
  superseded:         { primary: "Superseded",       secondary: () => "replaced by a newer thesis" },
  opened:             { primary: "Position opened",  secondary: () => "watching → holding" },
  sold:               { primary: "Position closed",  secondary: () => "retired — sold" },
  dropped:            { primary: "Archived",         secondary: () => "dropped from watch" },
  "back-to-watching": { primary: "Back to watching", secondary: () => null },
  status:             { primary: "Status changed",   secondary: statusSecondary },
  closed:             { primary: "Position closed",  secondary: closedSecondary },
  bought:             { primary: "Bought",           secondary: tradeSentence },
  "sold-fill":        { primary: "Sold",             secondary: tradeSentence },
  approved:           { primary: "Approved",         secondary: tradeSentence },
  declined:           { primary: "Declined",         secondary: proposalSideQty },
  expired:            { primary: "Expired",          secondary: (u) => proposalSideQty(u) ? `${proposalSideQty(u)} — no decision` : "no decision" },
  proposed:           { primary: "Proposed",         secondary: proposedSecondary },
  unknown:            { primary: "",                 secondary: () => null },
};

export function titleSegments(u: TimelineUpdate): TitleSegments {
  const kind = eventKind(u);
  if (kind === "unknown")
    return {
      // Legacy/unrecognised type — title-case it rather than invent grammar.
      primary: u.type.charAt(0) + u.type.slice(1).toLowerCase().replace(/_/g, " "),
      secondary: null,
    };
  const t = TITLES[kind];
  return { primary: t.primary, secondary: t.secondary(u) };
}

/** "buy 28 shares" — the side and size of a proposal. */
function proposalSideQty(u: TimelineUpdate): string | null {
  const { side, quantity } = proposalMeta(u);
  const qty = fmtQty(quantity);
  return side && qty ? `${side} ${qty}` : (qty ?? null);
}

function proposedSecondary(u: TimelineUpdate): string | null {
  const what = proposalSideQty(u);
  if (!isAwaiting(u)) return what;
  return `${what ?? ""}${what ? " — " : ""}awaiting your review`;
}

function statusSecondary(u: TimelineUpdate): string | null {
  const fc = u.fieldChanges ?? {};
  const from = fc.status?.from;
  const to = fc.status?.to;
  return from != null && to != null
    ? `${String(from).toLowerCase()} → ${String(to).toLowerCase()}`
    : null;
}

/** "Closed XENE position on approved proposal — STOP" → "stop". */
function closedSecondary(u: TimelineUpdate): string | null {
  const dash = u.summary.lastIndexOf("— ");
  if (dash === -1) return null;
  const tail = u.summary.slice(dash + 2).trim();
  return tail.length > 0 && tail.length <= 20 ? tail.toLowerCase() : null;
}

/**
 * Secondary clause for UPDATED titles: the compact list of what actually
 * moved — "target $80.00 → $95.00, stop $54.00 → $62.00, triggers".
 * Null when nothing derivable (pre-fix rows with empty diffs).
 */
export function updatedSecondary(u: TimelineUpdate): string | null {
  const fc = u.fieldChanges;
  if (!fc || typeof fc !== "object") return null;
  // ONE rule: this line says what the chips don't. A level move (entry /
  // target / stop) is written as a trigger op and already renders as a chip
  // under the title, so naming it here too prints the same change twice.
  const coveredByChips = ladderChangeLines(u).length > 0;
  const parts: string[] = [];
  for (const { key, label, fmt } of SCALAR_LINES) {
    const entry = fc[key];
    if (!entry || (coveredByChips && LEVEL_KEYS.has(key))) continue;
    parts.push(`${label.toLowerCase()} ${fmt(entry.from)} → ${fmt(entry.to)}`);
  }
  const scoring = fc.scoring;
  if (scoring) {
    const from = (scoring.from as { composite?: number } | null)?.composite;
    const to = (scoring.to as { composite?: number } | null)?.composite;
    if (from != null && to != null && from !== to)
      parts.push(`composite ${from} → ${to}`);
  }
  if (parts.length === 0 && RESEARCH_KEYS.some((k) => fc[k]))
    parts.push("research refreshed");
  return parts.length > 0 ? parts.join(", ") : null;
}

const RESEARCH_KEYS = [
  "snapshot",
  "bullCase",
  "bearCase",
  "recentCatalysts",
  "fundamentals",
  "latestEarnings",
  "catalystsAndEvents",
  "analystConsensus",
  "insiderTechnical",
  "researchData",
] as const;

// ── Rail dot ─────────────────────────────────────────────────────────────────
// Money semantics at a glance: green in, red out, amber for a proposal that
// did NOT trade (declined / expired), hollow amber for the Proposed anchor.
// Everything else gray. One row per kind — see `eventKind`.

export type DotKind =
  | "buy"
  | "sell"
  | "declined"
  | "open-ask"
  | "quiet"
  | "default";

const DOTS: Record<EventKind, DotKind> = {
  opened: "buy",
  bought: "buy",
  sold: "sell",
  "sold-fill": "sell",
  closed: "sell",
  declined: "declined",
  expired: "declined",
  proposed: "open-ask",
  approved: "default",
  fired: "default",
  reviewed: "default",
  note: "default",
  created: "default",
  updated: "default",
  "edited-by-you": "default",
  invalidated: "default",
  superseded: "default",
  dropped: "default",
  "back-to-watching": "default",
  status: "default",
  unknown: "default",
};

export function dotFor(u: TimelineUpdate): DotKind {
  return DOTS[eventKind(u)];
}

// ── Timeline assembly (grouping · clustering · spans) ────────────────────────
// Pure pipeline the component renders from. Rows arrive newest-first.

export type GroupItem = {
  kind: "group";
  /**
   * Every fire this review answered, newest first; always at least one.
   * A standing rung re-fires each day it holds, so one Monday review can be
   * the answer to Thursday's AND Friday's fire. Plural so the row can say
   * "×2 · fired Sep 16–17 · answered Sep 18" from the episode itself.
   */
  fires: TimelineUpdate[];
  response: TimelineUpdate;
  /** The proposal this episode staged, absorbed into the line — the fire's
   * decision then reads "— proposed buy", never "— passed". */
  proposal?: TimelineUpdate;
};

export type TimelineItem =
  | { kind: "event"; row: TimelineUpdate }
  | GroupItem
  /** ≥2 consecutive items that print the same sentence — see `foldKey`. */
  | { kind: "fold"; items: TimelineItem[] };

export type TimelineFilter = "all" | "money" | "triggers";

function rowMatchesFilter(row: TimelineUpdate, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "money")
    return (
      row.type.startsWith("PROPOSAL_") ||
      row.type === "STATUS_CHANGED" ||
      row.type === "CLOSED"
    );
  return (
    row.type === "TRIGGER_FIRED" ||
    // Keep the response rows too, so fire→decision episodes survive the
    // filter instead of collapsing to bare conditions.
    (row.triggerId != null &&
      (row.type === "UPDATED" || row.type === "REVIEWED"))
  );
}

/** Housekeeping fire ("Scheduled review due/overdue…"), not a market event. */
export function buildTimeline(
  rows: TimelineUpdate[],
  filter: TimelineFilter,
): TimelineItem[] {
  const filtered = rows.filter((r) => rowMatchesFilter(r, filter));

  // ONE pairing rule: a fire is answered by the next review that follows it.
  //
  // It used to also require the review to carry the same `triggerId` or
  // `runId` as the fire, which split the feed in two without meaning to.
  // A fire that wakes a tactical run is answered in the same second by that
  // run, with both ids on the row — those paired. A REVIEW fire waits
  // for the next daily review: nothing wakes, and the next
  // morning's run writes a real answer with no idea which fire it was
  // answering. Those never paired. ISRG fired "price below the 200-day"
  // nine times between Sep 15 and Sep 25 and not one of them joined the
  // five reviews that answered them, so the feed showed nine identical
  // template lines and hid five written paragraphs.
  //
  // Dropping the id test is what makes it one rule. The tactical case still
  // pairs — its answer is the next row either way.
  //
  // This is an inference: "the next review after it" is not the same as
  // "the run said so". It is the right one — the run did review the stock
  // that morning — but a review that ignored the fire is still credited.
  //
  // Proposal rows are skipped during the walk — a tactical that proposes a
  // sell writes Proposed BETWEEN the fire and its update_thesis close-out,
  // which broke plain adjacency (the Aug 19 HPE fire rendered unanswered).
  const consumedRows = new Set<number>();
  const firesForResponse = new Map<number, number[]>();
  const proposalForResponse = new Map<number, number>();
  for (let j = 0; j < filtered.length; j++) {
    const fire = filtered[j];
    if (fire.type !== "TRIGGER_FIRED") continue;
    // Walk newer rows, riding over proposal rows (a tactical that proposes
    // writes Proposed BETWEEN the fire and its close-out update). The first
    // Proposed we cross belongs to this episode — absorb it so the line
    // reads "— proposed buy" instead of the flatly wrong "— passed".
    let crossedProposal: number | null = null;
    for (let k = j - 1; k >= 0; k--) {
      const cand = filtered[k];
      // Another fire is not an answer — keep walking. Two fires of the same
      // rung on consecutive days are answered by the one review after them.
      if (cand.type === "TRIGGER_FIRED") continue;
      if (cand.type.startsWith("PROPOSAL_")) {
        if (
          cand.type === "PROPOSAL_PROPOSED" &&
          crossedProposal == null &&
          !consumedRows.has(k)
        )
          crossedProposal = k;
        continue;
      }
      if (cand.type === "UPDATED" || cand.type === "REVIEWED") {
        const claimed = firesForResponse.get(k);
        if (claimed) claimed.push(j);
        else firesForResponse.set(k, [j]);
        consumedRows.add(j);
        // Reference it for the verb only. The Proposed row stays in the
        // list as its own step: staging an order is a distinct moment
        // between the fire and the decision (principal, 2026-08-21).
        if (crossedProposal != null && !proposalForResponse.has(k))
          proposalForResponse.set(k, crossedProposal);
      }
      break; // nearest non-proposal row decides either way
    }
  }

  const items: TimelineItem[] = [];
  for (let i = 0; i < filtered.length; i++) {
    if (consumedRows.has(i)) continue; // renders inside its group
    const fireIdxs = firesForResponse.get(i);
    if (fireIdxs != null) {
      const proposalIdx = proposalForResponse.get(i);
      items.push({
        kind: "group",
        // Newest first, like every other list here.
        fires: [...fireIdxs].sort((a, b) => a - b).map((n) => filtered[n]),
        response: filtered[i],
        ...(proposalIdx != null ? { proposal: filtered[proposalIdx] } : {}),
      });
    } else {
      items.push({ kind: "event", row: filtered[i] });
    }
  }

  // ── The one clustering rule ───────────────────────────────────────────
  // Consecutive items that READ THE SAME fold into one "×N" row covering
  // their date range. Nothing about triggers, nothing about what is
  // "quiet" — if two rows in a row would print the same sentence, you only
  // want to be told once.
  //
  // This replaced two separate mechanisms that each folded a different
  // thing with its own rules: a "repeat" fold for identical trigger
  // episodes (the P1-37 re-fire wall) and a "cluster" fold for runs of
  // housekeeping rows ("5 quiet check-ins"). Both are this.
  const out: TimelineItem[] = [];
  let run: TimelineItem[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: "fold", items: run });
    else out.push(...run);
    run = [];
  };
  for (const item of items) {
    if (run.length > 0 && foldKey(run[0]) !== foldKey(item)) flush();
    run.push(item);
  }
  flush();
  return out;
}

/**
 * What makes two consecutive rows "the same row twice": the sentence they
 * print. Derived from the rendered title, so nothing can read identically
 * on screen and fail to fold, or fold while reading differently.
 *
 * A row with its own prose never folds — the writing is the point, and two
 * paragraphs are not one row said twice.
 */
function foldKey(item: TimelineItem): string {
  if (item.kind === "fold") return `fold:${item.items.length}`;
  const row = toRow(item);
  if (row.description) return `unique:${row.key}`;
  const t = row.title;
  return `${t.primary}|${t.secondary ?? ""}|${t.outcome ?? ""}`;
}

/** Newest timestamp an item covers (drives month headers). */
export function itemTimestamp(item: TimelineItem): string {
  if (item.kind === "event") return item.row.timestamp;
  if (item.kind === "group") return item.response.timestamp;
  return itemTimestamp(item.items[0]);
}

/**
 * Rail segments to tint amber: every segment between a Proposed anchor and
 * its outcome row (same orderId), stringing the approval lifecycle into one
 * visually-connected episode. Returns indices i where the line UNDER
 * display item i is part of a span.
 */
export function proposalSpanSegments(items: TimelineItem[]): Set<number> {
  const byOrder = new Map<string, number[]>();
  items.forEach((item, idx) => {
    if (item.kind !== "event") return;
    const oid = proposalOrderId(item.row);
    if (!oid) return;
    const arr = byOrder.get(oid);
    if (arr) arr.push(idx);
    else byOrder.set(oid, [idx]);
  });
  const segments = new Set<number>();
  for (const idxs of byOrder.values()) {
    if (idxs.length < 2) continue;
    const lo = Math.min(...idxs);
    const hi = Math.max(...idxs);
    for (let i = lo; i < hi; i++) segments.add(i);
  }
  return segments;
}

/**
 * The decision clause for a trigger episode, lowercase, one phrase.
 *
 * ONE ordered table, read top to bottom, first match wins. It looks only at
 * what the REVIEW did — never at what kind of trigger fired. The old version
 * asked whether the fire was an entry fire and said "passed" if it was and
 * "held" if it wasn't: two words for the one fact that nothing changed, and
 * a rule you had to hold in your head per row. One word now.
 *
 * Reading it is the whole spec:
 *   proposed buy/sell  the review staged an order
 *   archived           the stock left the book (RETIRED / PASSED)
 *   plan set down      the review removed rungs — ISRG Sep 23 took off the
 *                      buy, the floor AND the target and used to read
 *                      "held", i.e. the month's biggest decision rendered
 *                      as nothing happening
 *   levels moved       a price level changed
 *   no change          the review looked and left it alone
 */
export function outcomePhrase(
  response: TimelineUpdate,
  proposal?: TimelineUpdate,
): string {
  if (proposal) {
    const fc = proposal.fieldChanges as
      | { proposal?: { to?: { intent?: unknown } } }
      | null;
    const intent = fc?.proposal?.to?.intent;
    const side =
      intent === "OPEN" || intent === "ADD"
        ? "buy"
        : intent === "CLOSE" || intent === "PARTIAL_CLOSE"
          ? "sell"
          : "trade";
    return `proposed ${side}`;
  }

  const fc = response.fieldChanges ?? {};
  const ops = ladderChangeLines(response);
  const removed = ops.filter((o) => o.kind === "remove");

  // Read top to bottom, first match wins.
  if (fc.status?.to === "RETIRED" || fc.status?.to === "PASSED")
    return "archived";

  // Taking the buy / floor / target off is setting the plan down. Dropping
  // only review rungs is not — the plan still stands, it just gets looked at
  // less (CEG's "Removed: Any earnings beat → review" cleanup).
  if (removed.length > 0 && !removed.every(isReviewRung)) return "plan set down";

  // One word for every plan change, whether a price level moved or a rung's
  // cadence / fire mode / predicate did. They were two ("levels moved" and
  // "plan changed") and they are the same event to a reader — the chips
  // under the title already say which fields moved.
  if (
    ops.length > 0 ||
    LEVEL_FIELDS.some((k) => fc[k] != null) ||
    fc.triggers != null ||
    fc.nextReviewAt != null
  )
    return "updated";

  // The plan is untouched but the argument was rewritten — the cases, the
  // snapshot, the conviction score.
  if (RESEARCH_KEYS.some((k) => fc[k] != null) || fc.scoring != null || fc.conviction != null)
    return "thesis refreshed";

  return "no change";
}

/** A rung whose only job is to wake a review — not part of the buy/sell plan. */
function isReviewRung(o: LadderChange): boolean {
  return /→\s*review\b|review (every|above|below)/i.test(o.text);
}

/** Plan levels whose movement counts as "levels moved". */
const LEVEL_FIELDS = ["entryPrice", "targetPrice", "stopLoss"] as const;

/**
 * One-sentence title for a trigger episode:
 *   Trigger: Price above $255 — passed
 *   Trigger: Price above $186.45 — proposed buy
 * "Trigger:" and the decision render medium; the condition renders light.
 */
export function groupTitle(
  fire: TimelineUpdate,
  response: TimelineUpdate,
  proposal?: TimelineUpdate,
): TitleSegments {
  return {
    primary: "Trigger:",
    secondary: triggerPhrase(fire.summary),
    outcome: `— ${outcomePhrase(response, proposal)}`,
  };
}

/** "Aug 13 – 17" / "Jul 29 – Aug 2" / "Aug 13" for a newest+oldest pair. */
export function dateRangeLabel(newestTs: string, oldestTs: string): string {
  const newest = new Date(newestTs);
  const oldest = new Date(oldestTs);
  const fmt = (d: Date) =>
    d.toLocaleString("en-US", { month: "short", day: "numeric" });
  if (fmt(newest) === fmt(oldest)) return fmt(newest);
  if (newest.getMonth() === oldest.getMonth())
    return `${oldest.toLocaleString("en-US", { month: "short" })} ${oldest.getDate()} – ${newest.getDate()}`;
  return `${fmt(oldest)} – ${fmt(newest)}`;
}

/**
 * The conditions an episode covers: each distinct one once, with "×N" when
 * that rung asked more than once. A morning review answers every fire since
 * the previous review and those are not always the same rung, so the row
 * names what it actually covers instead of borrowing the first fire's
 * condition for all of them.
 */
function conditionList(fires: TimelineUpdate[]): string {
  const counts = new Map<string, number>();
  for (const f of fires) {
    const phrase = triggerPhrase(f.summary);
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([phrase, n]) => (n > 1 ? `${phrase} ×${n}` : phrase))
    .join(", ");
}

/** Month header label — "August", with the year when it isn't this year. */
export function monthLabel(timestamp: string, now = new Date()): string {
  const d = new Date(timestamp);
  const month = d.toLocaleString("en-US", { month: "long" });
  return d.getFullYear() === now.getFullYear()
    ? month
    : `${month} ${d.getFullYear()}`;
}

// ── Field-change lines (expanded view) ───────────────────────────────────────
// Exact from → to for the scalar plan fields. The trigger ops carry their
// own lines ("Stop $64 → $71"), so the level columns yield to them.

const LEVEL_KEYS = new Set(["targetPrice", "stopLoss", "entryPrice"]);

const SCALAR_LINES: Array<{
  key: string;
  label: string;
  fmt: (v: unknown) => string;
}> = [
  { key: "targetPrice", label: "Target", fmt: fmtLevel },
  { key: "stopLoss", label: "Stop", fmt: fmtLevel },
  { key: "entryPrice", label: "Entry", fmt: fmtLevel },
  { key: "conviction", label: "Conviction", fmt: fmtPlain },
  { key: "horizon", label: "Horizon", fmt: fmtPlain },
];

function fmtLevel(v: unknown): string {
  return typeof v === "number" ? `$${v.toFixed(2)}` : "—";
}

function fmtPlain(v: unknown): string {
  return v == null ? "—" : String(v);
}

/**
 * One chip per trigger op. `fieldChanges.triggerOps.to` is the list of ops
 * the caller sent, stored verbatim with the line the feed shows. Rows from
 * before ops (a `triggers` from/to diff) render no chips — their summary
 * still says what happened.
 */
export type LadderChange = {
  kind: "add" | "remove" | "edit" | "not-applied";
  text: string;
};

/** The trigger ops on a row, [] when it has none. */
export function ladderChangeLines(u: TimelineUpdate): LadderChange[] {
  const ops = u.fieldChanges?.triggerOps?.to;
  if (!Array.isArray(ops)) return [];
  return ops.flatMap((o) => {
    const { op, text } = (o ?? {}) as { op?: unknown; text?: unknown };
    if (typeof text !== "string" || !text) return [];
    const kind = op === "add" ? "add" : op === "remove" ? "remove" : "edit";
    return [{ kind, text } as LadderChange];
  });
}


/**
 * What a call asked for and did not get, one chip each, from the row's
 * `fieldChanges.notApplied` (update_thesis): "Not applied: back to
 * watching — the position is still open". Kept apart from the trigger ops,
 * so a row that changed nothing still reads "no change".
 */
export function notAppliedLines(u: TimelineUpdate): LadderChange[] {
  const list = (u.fieldChanges as { notApplied?: { to?: unknown } } | null)?.notApplied?.to;
  if (!Array.isArray(list)) return [];
  return list.flatMap((e) => {
    const { field, to, why } = (e ?? {}) as { field?: unknown; to?: unknown; why?: unknown };
    if (typeof field !== "string") return [];
    const reason = typeof why === "string" && why ? ` — ${why}` : "";
    return [{ kind: "not-applied" as const, text: `Not applied: ${askedFor(field, to)}${reason}` }];
  });
}

function askedFor(field: string, to: unknown): string {
  const price = typeof to === "number" ? ` $${to}` : "";
  const word = typeof to === "string" ? to.toLowerCase() : null;
  if (field === "change_status") return to === "WATCHING" ? "back to watching" : to === "INVALIDATED" ? "invalidate" : to === "ARCHIVED" ? "drop the stock" : "status change";
  if (field === "direction") return to === "PASS" ? "pass" : word ? `flip to ${word}` : "direction change";
  if (field === "conviction") return word ? `conviction ${word}` : "conviction";
  if (field === "entry_price") return `buy at${price}`;
  if (field === "target_price") return `target${price}`;
  if (field === "stop_loss") return `stop${price}`;
  if (field === "triggers") return "trigger changes";
  return field.replace(/_/g, " ");
}

/** The principal's written note on a declined proposal, when present. */
export function proposalUserMessage(u: TimelineUpdate): string | null {
  const fc = u.fieldChanges as
    | { proposal?: { to?: { userMessage?: unknown } } }
    | null;
  const msg = fc?.proposal?.to?.userMessage;
  return typeof msg === "string" && msg.trim().length > 0 ? msg : null;
}

// ── The row view-model — ONE shape, rendered one way ─────────────────────────
// Every timeline item (event / trigger episode / ×N repeat / quiet cluster)
// maps into this before rendering, so the component has no per-type branches
// left. Variants live here as data, not as JSX conditionals.
//
//   dot          which of the six rail marks
//   title        two-tone sentence (+ optional medium outcome clause)
//   chips        sub-metadata (ladder rung changes) — ALWAYS visible,
//                ALWAYS chips. Scalars are never repeated here; they're
//                already in title.secondary.
//   description  prose, clamped to 2 lines; `showDescription` decides
//                whether it's visible before any click, per type.
//   fold         true for the roll-up rows whose whole surface is a control

export interface TimelineRow {
  key: string;
  /** Underlying ThesisUpdate type ("" for fold rows) — lets the caller
   * target a specific row (e.g. merging provenance into CREATED). */
  type: string;
  dot: DotKind;
  title: TitleSegments;
  chips: LadderChange[];
  /** Quote at the moment of the event. Null when unknown, and null on
   * trade rows whose title already carries the fill price. */
  price: number | null;
  description: string | null;
  /** Description is the principal's own words → quote styling. */
  quoted: boolean;
  /** Per-type constant: is the description visible before any click? */
  showDescription: boolean;
  /**
   * When it happened, already worded — a relative stamp for a single moment
   * ("3h", "Mon 11:56 AM"), a span for an episode ("fired Sep 16 – 17 ·
   * answered Sep 18") or for a fold ("Aug 13 – 17"). ONE field: the row used
   * to carry a raw timestamp and a pre-built range and the component had to
   * know which kinds used which.
   */
  when: string;
  runId: string | null;
  /** Order id — drives the dashed proposal span. */
  orderId: string | null;
  /** Fold row (×N roll-up): the row itself is the control. */
  fold: boolean;
  /**
   * A member of an expanded row, shown small. Nothing produces these by
   * itself — the section splices them in under the row you opened, so you
   * can see the individual fires and the review behind a roll-up.
   */
  child?: boolean;
  /** This row has member events to reveal, so it opens even with no prose. */
  members?: boolean;
}

/**
 * Kinds whose prose earns its place without a click. Everything else is
 * title-only until asked. One set, keyed the same way as the title and the
 * dot — see `eventKind`.
 */
const PROSE_VISIBLE = new Set<EventKind>([
  // Your own note on the stock — it is the row.
  "note",
  "created",
  "updated",
  "edited-by-you",
  "invalidated",
  // Every transaction shows its reasoning — proposals included
  // (principal, 2026-08-21). Only bare triggers and reviews stay
  // title-only until asked.
  "closed",
  "opened",
  "sold",
  "dropped",
  "back-to-watching",
  "status",
  "proposed",
  "bought",
  "sold-fill",
  "approved",
  "declined",
  "expired",
]);

/** A review row that recorded nothing — same "no change" as an episode's. */
const REVIEW_KINDS = new Set<EventKind>(["updated", "edited-by-you", "reviewed"]);
function isSilentReview(u: TimelineUpdate): boolean {
  return REVIEW_KINDS.has(eventKind(u)) && outcomePhrase(u) === "no change";
}

/** An edit you made by hand: the trigger popover marks it in fieldChanges; older rows carry a [USER] tag on the note. */
export function isYourEdit(u: { rationale?: string | null; fieldChanges?: unknown }): boolean {
  const source = (u.fieldChanges as Record<string, { to?: unknown } | undefined> | null | undefined)?.source;
  return source?.to === "USER" || (u.rationale?.startsWith("[USER]") ?? false);
}

/** The prose for a row + whether it's the principal's own words. */
function describe(u: TimelineUpdate): { text: string | null; quoted: boolean } {
  const note = proposalUserMessage(u);
  if (note) return { text: note, quoted: true };
  const r = u.rationale?.trim();
  if (!r) return { text: null, quoted: false };
  // Principal UI edits carry a [USER] marker the title already reflects.
  return { text: r.replace(/^\[USER\]\s*/, ""), quoted: false };
}

/** Map any timeline item to the single render shape. */
export function toRow(item: TimelineItem): TimelineRow {
  if (item.kind === "event") {
    const u = item.row;
    const { text, quoted } = describe(u);
    return {
      key: u.id,
      type: u.type,
      dot: dotFor(u),
      title: titleSegments(u),
      chips: [...ladderChangeLines(u), ...notAppliedLines(u)],
      // A Bought/Sold title already reads "… at $832.84" — don't repeat it.
      price: u.type === "PROPOSAL_APPROVED" ? null : u.priceAtTime,
      description: text,
      quoted,
      // A review's own row follows the same rule as an episode's: if it
      // changed nothing, its paragraph is the agent restating the thesis and
      // stays collapsed. A transaction row is never collapsed this way — its
      // write-up is the only place that reasoning appears.
      showDescription: PROSE_VISIBLE.has(eventKind(u)) && !isSilentReview(u),
      when: relativeTimestamp(u.timestamp),
      runId: u.runId,
      orderId: proposalOrderId(u),
      fold: false,
    };
  }

  if (item.kind === "group") {
    // The episode's prose is the agent's close-out reasoning; its chips are
    // whatever the response actually changed.
    const { text, quoted } = describe(item.response);
    const lead = item.fires[0];
    const outcome = outcomePhrase(item.response, item.proposal);
    return {
      key: `g:${lead.id}`,
      type: "TRIGGER_FIRED",
      dot: "default",
      title: {
        primary: "Trigger:",
        secondary: conditionList(item.fires),
        outcome: `— ${outcome}`,
      },
      chips: [...ladderChangeLines(item.response), ...notAppliedLines(item.response)],
      price: lead.priceAtTime ?? item.response.priceAtTime,
      description: text,
      quoted,
      // Prose shows when the review changed something AND nothing else on
      // screen is already saying it. Two cases stay collapsed (one click
      // away either way):
      //   • "no change" — the paragraph is the agent restating the thesis.
      //   • a staged proposal — the Proposed row right below carries the
      //     write-up, so the episode would print it twice.
      showDescription:
        outcome !== "no change" && !outcome.startsWith("proposed "),
      members: true,
      // An episode spans two moments. Showing only the fire is what made the
      // sheet header ("written Sep 28") disagree with the feed ("Fri") on the
      // same paragraph — and it is the answer's date you are looking for.
      when: relativeTimestamp(item.response.timestamp),
      runId: lead.runId ?? item.response.runId,
      orderId: null,
      fold: false,
    };
  }

  // ── The fold row ──
  // N consecutive rows that print the same sentence. It borrows the first
  // one's title and dot and adds "×N" — there is no separate vocabulary for
  // a folded trigger versus a folded check-in, because there is no longer a
  // separate mechanism.
  const first = toRow(item.items[0]);
  const n = item.items.length;
  return {
    key: `f:${first.key}`,
    type: first.type,
    dot: first.dot,
    title: {
      ...first.title,
      secondary: `${first.title.secondary ?? ""}${first.title.secondary ? " " : ""}×${n}`,
    },
    chips: [],
    price: null,
    description: null,
    quoted: false,
    showDescription: false,
    when: relativeTimestamp(itemTimestamp(item)),
    runId: null,
    orderId: null,
    fold: true,
  };
}

/**
 * A paragraph is never printed twice in a row.
 *
 * A proposal's life — Proposed, then Expired or Declined, and the episode
 * that staged it — each carries the ORIGINAL rationale, so ISRG showed "I am
 * buying $ISRG here because the stock has confirmed the entry level…" on
 * three rows. They are not adjacent (the episode sits between the Proposed
 * and the Expired), so this is once per feed, not once in a row. Later
 * copies keep their title, date and dot; only the repeated text goes.
 */
export function dropRepeatedProse(rows: TimelineRow[]): TimelineRow[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    const text = r.description?.replace(/\s+/g, " ").trim();
    if (!text) return r;
    if (seen.has(text)) return { ...r, description: null, showDescription: false };
    seen.add(text);
    return r;
  });
}

/**
 * The rows behind one episode: each fire that asked, then the review that
 * answered. The summary line is enough — this is the audit trail under a
 * roll-up, not a second feed.
 */
export function episodeMembers(g: GroupItem): TimelineRow[] {
  return [...g.fires, g.response].map((u) => ({
    ...toRow({ kind: "event", row: u }),
    key: `m:${u.id}`,
    description: null,
    showDescription: false,
    child: true,
  }));
}

// ── Relative timestamps ──────────────────────────────────────────────────────
// Back-to-back "Aug 12, 9:45 AM" rows are unreadable when a thesis logs a
// dozen events a day (principal, 2026-08-21). Precision decays with age:
// today is relative, the last week keeps a weekday + clock, older rows are
// just a date.

export function relativeTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const ms = now.getTime() - d.getTime();
  if (!Number.isFinite(d.getTime())) return "";
  const mins = Math.floor(ms / 60_000);
  const time = d.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;

  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${Math.floor(mins / 60)}h`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

  const days = Math.floor(ms / 86_400_000);
  if (days < 7)
    return `${d.toLocaleString("en-US", { weekday: "short" })} ${time}`;

  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleString("en-US", { month: "short", day: "numeric" })
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}
