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
 *   - fieldChangeLines: exact "Target $80.00 → $95.00" from → to lines
 *     (expanded view)
 *   - triggerDiffLines: per-rung ladder diff, id-churn cancelled, tolerant
 *     of the legacy non-array shapes older rows carry
 */

import { predicateSentence } from "@/lib/agent/triggers/format";
import type { Trigger } from "@/lib/agent/triggers/types";

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
  s = s.replace(/\s*—\s*deferred to the next daily review\s*$/, "");
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

export function titleSegments(u: TimelineUpdate): TitleSegments {
  const fc = u.fieldChanges ?? {};
  switch (u.type) {
    case "TRIGGER_FIRED":
      return { primary: "Trigger:", secondary: triggerPhrase(u.summary) };

    case "REVIEWED":
      return { primary: "Reviewed", secondary: "no changes" };

    case "CREATED":
      return { primary: "Created", secondary: stripTicker(u.summary) || null };

    case "UPDATED": {
      // Principal edits from the trigger popover are tagged [USER].
      const isPrincipal = u.rationale?.startsWith("[USER]") ?? false;
      return {
        primary: isPrincipal ? "Edited by you" : "Updated",
        secondary: updatedSecondary(u),
      };
    }

    case "INVALIDATED":
      return { primary: "Invalidated", secondary: "belief broken" };

    case "SUPERSEDED":
      return { primary: "Superseded", secondary: "replaced by a newer thesis" };

    case "STATUS_CHANGED": {
      const to = fc.status?.to;
      if (to === "HOLDING")
        return { primary: "Position opened", secondary: "watching → holding" };
      if (fc.retiredReason?.to === "SOLD")
        return { primary: "Position closed", secondary: "retired — sold" };
      if (fc.retiredReason?.to === "DROPPED")
        return { primary: "Archived", secondary: "dropped from watch" };
      if (to === "WATCHING")
        return { primary: "Back to watching", secondary: null };
      return {
        primary: "Status changed",
        secondary:
          fc.status?.from != null && to != null
            ? `${String(fc.status.from).toLowerCase()} → ${String(to).toLowerCase()}`
            : null,
      };
    }

    case "CLOSED":
      return { primary: "Position closed", secondary: closedSecondary(u) };

    case "PROPOSAL_APPROVED": {
      const { side } = proposalMeta(u);
      const sentence = tradeSentence(u);
      if (side === "buy") return { primary: "Bought", secondary: sentence };
      if (side === "sell") return { primary: "Sold", secondary: sentence };
      return { primary: "Approved", secondary: sentence };
    }

    case "PROPOSAL_REJECTED": {
      const { side, quantity } = proposalMeta(u);
      const qty = fmtQty(quantity);
      return {
        primary: "Declined",
        secondary: side && qty ? `${side} ${qty}` : (qty ?? null),
      };
    }

    case "PROPOSAL_EXPIRED": {
      const { side, quantity } = proposalMeta(u);
      const qty = fmtQty(quantity);
      return {
        primary: "Expired",
        secondary:
          side && qty ? `${side} ${qty} — no decision` : "no decision",
      };
    }

    case "PROPOSAL_PROPOSED": {
      const { side, quantity } = proposalMeta(u);
      const qty = fmtQty(quantity);
      const what = side && qty ? `${side} ${qty}` : (qty ?? null);
      const awaiting = isAwaiting(u);
      return {
        primary: "Proposed",
        secondary: awaiting
          ? `${what ?? ""}${what ? " — " : ""}awaiting your review`
          : what,
      };
    }

    default:
      // Unknown/legacy type — title-case it rather than invent grammar.
      return {
        primary:
          u.type.charAt(0) + u.type.slice(1).toLowerCase().replace(/_/g, " "),
        secondary: null,
      };
  }
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
  const parts: string[] = [];
  for (const { key, label, fmt } of SCALAR_LINES) {
    const entry = fc[key];
    if (!entry) continue;
    parts.push(`${label.toLowerCase()} ${fmt(entry.from)} → ${fmt(entry.to)}`);
  }
  const scoring = fc.scoring;
  if (scoring) {
    const from = (scoring.from as { composite?: number } | null)?.composite;
    const to = (scoring.to as { composite?: number } | null)?.composite;
    if (from != null && to != null && from !== to)
      parts.push(`composite ${from} → ${to}`);
  }
  if (fc.triggers && triggerDiffLines(fc.triggers).length > 0)
    parts.push("triggers");
  if (
    RESEARCH_KEYS.some((k) => fc[k]) &&
    parts.length === 0 // research alone; otherwise the level moves lead
  )
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
// Everything else gray.

export type RailDot = "buy" | "sell" | "proposal" | "proposed" | null;

export function railDot(u: TimelineUpdate): RailDot {
  const fc = u.fieldChanges ?? {};
  if (u.type === "CLOSED") return "sell";
  if (u.type === "STATUS_CHANGED") {
    if (fc.status?.to === "HOLDING") return "buy";
    if (fc.retiredReason?.to === "SOLD") return "sell";
    return null;
  }
  if (u.type === "PROPOSAL_APPROVED") return proposalMeta(u).side;
  if (u.type === "PROPOSAL_PROPOSED") return "proposed";
  if (u.type === "PROPOSAL_REJECTED" || u.type === "PROPOSAL_EXPIRED")
    return "proposal";
  return null;
}

// ── Timeline assembly (grouping · clustering · spans) ────────────────────────
// Pure pipeline the component renders from. Rows arrive newest-first.

export type GroupItem = {
  kind: "group";
  fire: TimelineUpdate;
  response: TimelineUpdate;
};

export type TimelineItem =
  | { kind: "event"; row: TimelineUpdate }
  | GroupItem
  /** ≥2 consecutive identical trigger episodes (same condition, same
   * decision) folded into one line — the P1-37 re-fire wall. */
  | { kind: "repeat"; episodes: GroupItem[] }
  | { kind: "cluster"; items: TimelineItem[] };

export type TimelineFilter = "all" | "money" | "triggers";

function rowMatchesFilter(row: TimelineUpdate, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "money")
    return (
      row.type.startsWith("PROPOSAL_") ||
      row.type === "STATUS_CHANGED" ||
      row.type === "CLOSED"
    );
  return row.type === "TRIGGER_FIRED";
}

/** Housekeeping fire ("Scheduled review due/overdue…"), not a market event. */
function isHousekeepingFire(row: TimelineUpdate): boolean {
  return row.type === "TRIGGER_FIRED" && /scheduled review/i.test(row.summary);
}

/**
 * An item nobody needs until they ask: a standalone Reviewed-no-changes, a
 * housekeeping fire, or a housekeeping fire whose nested response was
 * Reviewed. REAL fires (price/trail/earnings) never count as quiet even
 * when held — "fired BUT HELD" is exactly the story the timeline exists
 * to tell.
 */
export function isQuietItem(item: TimelineItem): boolean {
  if (item.kind === "cluster") return true;
  if (item.kind === "repeat") return false;
  if (item.kind === "group")
    return isHousekeepingFire(item.fire) && item.response.type === "REVIEWED";
  const r = item.row;
  return r.type === "REVIEWED" || isHousekeepingFire(r);
}

/**
 * Assemble the display list: filter → nest fire+response pairs → fold
 * consecutive quiet items (≥2) into clusters.
 *
 * Nesting rule: a TRIGGER_FIRED immediately followed (newer, adjacent) by
 * the UPDATED/REVIEWED row that answered it — same triggerId, or same
 * runId. Adjacent-only, so out-of-order interleavings never mis-nest.
 */
export function buildTimeline(
  rows: TimelineUpdate[],
  filter: TimelineFilter,
): TimelineItem[] {
  const filtered = rows.filter((r) => rowMatchesFilter(r, filter));

  const items: TimelineItem[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const row = filtered[i];
    const next = filtered[i + 1]; // older neighbor
    if (
      next != null &&
      next.type === "TRIGGER_FIRED" &&
      (row.type === "UPDATED" || row.type === "REVIEWED") &&
      ((row.triggerId != null && row.triggerId === next.triggerId) ||
        (row.runId != null && row.runId === next.runId))
    ) {
      items.push({ kind: "group", fire: next, response: row });
      i++; // consume the fire
      continue;
    }
    items.push({ kind: "event", row });
  }

  // Fold consecutive IDENTICAL trigger episodes (same condition, same
  // decision) into one repeat row — a stuck ENTER rung re-fires every day
  // (P1-37) and was rendering as a wall of "Trigger: Price above $255 —
  // passed" pairs.
  const sig = (g: GroupItem) =>
    `${triggerPhrase(g.fire.summary)}|${outcomePhrase(g.fire, g.response)}`;
  const deduped: TimelineItem[] = [];
  let run: GroupItem[] = [];
  const flushRun = () => {
    if (run.length >= 2) deduped.push({ kind: "repeat", episodes: run });
    else deduped.push(...run);
    run = [];
  };
  for (const item of items) {
    if (item.kind === "group" && !isQuietItem(item)) {
      if (run.length > 0 && sig(run[0]) !== sig(item)) flushRun();
      run.push(item);
    } else {
      flushRun();
      deduped.push(item);
    }
  }
  flushRun();

  // Fold runs of quiet items.
  const out: TimelineItem[] = [];
  let quietRun: TimelineItem[] = [];
  const flush = () => {
    if (quietRun.length >= 2) out.push({ kind: "cluster", items: quietRun });
    else out.push(...quietRun);
    quietRun = [];
  };
  for (const item of deduped) {
    if (
      item.kind !== "cluster" &&
      item.kind !== "repeat" &&
      isQuietItem(item)
    )
      quietRun.push(item);
    else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
}

/** Newest timestamp an item covers (drives month headers). */
export function itemTimestamp(item: TimelineItem): string {
  if (item.kind === "event") return item.row.timestamp;
  if (item.kind === "group") return item.response.timestamp;
  if (item.kind === "repeat") return item.episodes[0].response.timestamp;
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
 * The decision clause for a trigger episode, lowercase, one phrase:
 * entry fires that didn't buy are "passed"; held-side fires that didn't
 * sell are "held"; a raised stop is "raised floor to $X"; terminal is
 * "archived". Consistent by construction — never the agent's prose.
 */
export function outcomePhrase(
  fire: TimelineUpdate,
  response: TimelineUpdate,
): string {
  const isEntryFire = /consider entry|— enter\b/i.test(fire.summary);
  const passHold = isEntryFire ? "passed" : "held";
  if (response.type === "REVIEWED") return passHold;
  const fc = response.fieldChanges ?? {};
  if (fc.status?.to === "RETIRED" || fc.status?.to === "PASSED")
    return "archived";
  const stop = fc.stopLoss;
  if (
    stop &&
    typeof stop.from === "number" &&
    typeof stop.to === "number" &&
    stop.to > stop.from
  )
    return `raised floor to $${stop.to.toFixed(2)}`;
  return passHold;
}

/**
 * One-sentence title for a trigger episode:
 *   Trigger: Price above $255 — passed
 * "Trigger:" and the decision render medium; the condition renders light.
 */
export function groupTitle(
  fire: TimelineUpdate,
  response: TimelineUpdate,
): TitleSegments {
  return {
    primary: "Trigger:",
    secondary: triggerPhrase(fire.summary),
    outcome: `— ${outcomePhrase(fire, response)}`,
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

function oldestTimestamp(item: TimelineItem): string {
  if (item.kind === "event") return item.row.timestamp;
  if (item.kind === "group") return item.fire.timestamp;
  if (item.kind === "repeat")
    return item.episodes[item.episodes.length - 1].fire.timestamp;
  return oldestTimestamp(item.items[item.items.length - 1]);
}

/** "5 quiet check-ins" + the date range they cover. */
export function clusterLabel(items: TimelineItem[]): {
  label: string;
  range: string;
} {
  const n = items.length;
  const range = dateRangeLabel(
    itemTimestamp(items[0]),
    oldestTimestamp(items[items.length - 1]),
  );
  return { label: `${n} quiet check-in${n === 1 ? "" : "s"}`, range };
}

/** Right-rail label for a repeat row: the span the re-fires covered. */
export function repeatRange(episodes: GroupItem[]): string {
  return dateRangeLabel(
    episodes[0].response.timestamp,
    episodes[episodes.length - 1].fire.timestamp,
  );
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
// Exact from → to for the scalar plan fields, plus a per-rung diff of the
// trigger ladder. This is the "floor 64 → 71" rendering P1-33 asks for.

const SCALAR_LINES: Array<{
  key: string;
  label: string;
  fmt: (v: unknown) => string;
}> = [
  { key: "targetPrice", label: "Target", fmt: fmtLevel },
  { key: "stopLoss", label: "Stop", fmt: fmtLevel },
  { key: "entryPrice", label: "Entry", fmt: fmtLevel },
  {
    key: "targetSizePct",
    label: "Size",
    fmt: (v) => (typeof v === "number" ? `${v}%` : "—"),
  },
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
 * predicateSentence has no default case — legacy rung shapes (pre-predicate
 * `condition` objects, retired kinds) return undefined or throw. Fall back
 * to null so callers can substitute a bare kind string rather than render
 * "undefined".
 */
function safePredicateSentence(p: Trigger["predicate"]): string | null {
  try {
    const s = predicateSentence(p);
    return typeof s === "string" && s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

function describeTriggerBrief(t: Trigger): string {
  const sentence =
    safePredicateSentence(t.predicate) ??
    (t.predicate as { kind?: string } | undefined)?.kind ??
    "trigger";
  return `${sentence} → ${t.action?.toLowerCase() ?? "review"}`;
}

/**
 * Per-rung diff of a triggers fieldChange. Keyed by trigger id: added,
 * removed, and changed rungs (predicate or action moved — rationale,
 * cooldown, and lastFiredAt churn is deliberately ignored as noise).
 * Older rows store non-array shapes here (counts, notes) — those render
 * nothing rather than guessing.
 */
export function triggerDiffLines(entry: FieldChange): string[] {
  const from = Array.isArray(entry.from) ? (entry.from as Trigger[]) : null;
  const to = Array.isArray(entry.to) ? (entry.to as Trigger[]) : null;
  if (!from || !to) return [];
  const fromById = new Map(from.filter((t) => t?.id).map((t) => [t.id, t]));
  const toIds = new Set(to.filter((t) => t?.id).map((t) => t.id));

  const changed: string[] = [];
  const added: Trigger[] = [];
  const removed: Trigger[] = [];
  for (const t of to) {
    if (!t?.id) continue;
    const prev = fromById.get(t.id);
    if (!prev) {
      added.push(t);
    } else if (
      JSON.stringify(prev.predicate) !== JSON.stringify(t.predicate) ||
      prev.action !== t.action
    ) {
      const before = safePredicateSentence(prev.predicate);
      const after = safePredicateSentence(t.predicate);
      if (before && after) {
        changed.push(
          `${before} → ${after}${
            prev.action !== t.action
              ? ` (${prev.action.toLowerCase()} → ${t.action.toLowerCase()})`
              : ""
          }`,
        );
      }
      // Unknown predicate shape on either side — skip rather than lie.
    }
  }
  for (const t of from) {
    if (t?.id && !toIds.has(t.id)) removed.push(t);
  }

  // Cancel id-churn. Agents wholesale-replace the ladder and routinely mint
  // FRESH ids for rungs whose condition + action didn't move, so an id-keyed
  // diff lists the entire ladder twice ("+ Earnings beat ≥5% → review" and
  // "− Earnings beat ≥5% → review" — the Aug 12 EME rows). A rung removed
  // and re-added with identical content is not a change; pair those off and
  // keep only what actually moved. Rationale/cooldown churn stays invisible
  // by design.
  const sig = (t: Trigger) => `${JSON.stringify(t.predicate)}|${t.action}`;
  const removedBySig = new Map<string, Trigger[]>();
  for (const t of removed) {
    const k = sig(t);
    const bucket = removedBySig.get(k);
    if (bucket) bucket.push(t);
    else removedBySig.set(k, [t]);
  }
  const realAdded = added.filter((t) => {
    const bucket = removedBySig.get(sig(t));
    if (bucket && bucket.length > 0) {
      bucket.pop();
      return false;
    }
    return true;
  });
  const realRemoved = Array.from(removedBySig.values()).flat();

  return [
    ...realAdded.map((t) => `+ ${describeTriggerBrief(t)}`),
    ...changed,
    ...realRemoved.map((t) => `− ${describeTriggerBrief(t)}`),
  ];
}

/** Scalar plan-field lines only — the trigger-ladder diff is separate
 * (rendered as rung chips, not text). */
export function scalarChangeLines(u: TimelineUpdate): string[] {
  const fc = u.fieldChanges;
  if (!fc || typeof fc !== "object") return [];
  const lines: string[] = [];
  for (const { key, label, fmt } of SCALAR_LINES) {
    const entry = fc[key];
    if (!entry) continue;
    lines.push(`${label} ${fmt(entry.from)} → ${fmt(entry.to)}`);
  }
  const scoring = fc.scoring;
  if (scoring) {
    const from = (scoring.from as { composite?: number } | null)?.composite;
    const to = (scoring.to as { composite?: number } | null)?.composite;
    if (from != null && to != null && from !== to)
      lines.push(`Composite ${from} → ${to}/10`);
  }
  return lines;
}

/** The ladder diff for a row, [] when it has none. */
export function ladderChangeLines(u: TimelineUpdate): string[] {
  const entry = u.fieldChanges?.triggers;
  return entry ? triggerDiffLines(entry) : [];
}

export function fieldChangeLines(u: TimelineUpdate): string[] {
  return [...scalarChangeLines(u), ...ladderChangeLines(u)];
}

/** The principal's written note on a declined proposal, when present. */
export function proposalUserMessage(u: TimelineUpdate): string | null {
  const fc = u.fieldChanges as
    | { proposal?: { to?: { userMessage?: unknown } } }
    | null;
  const msg = fc?.proposal?.to?.userMessage;
  return typeof msg === "string" && msg.trim().length > 0 ? msg : null;
}
