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

// ── Title grammar ────────────────────────────────────────────────────────────
// One consistent sentence shape per event: `primary` names the event (Bought /
// Sold / Trigger: / Reviewed / Updated…), `secondary` carries its variable
// values (shares, prices, levels). The renderer sets primary medium,
// secondary light @80%.

export interface TitleSegments {
  primary: string;
  secondary: string | null;
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

    case "PROPOSAL_PENDING": {
      const { side, quantity } = proposalMeta(u);
      const qty = fmtQty(quantity);
      return {
        primary: "Awaiting approval",
        secondary: side && qty ? `${side} ${qty}` : (qty ?? null),
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
// did NOT trade (declined / expired / still waiting). Everything else gray.

export type RailDot = "buy" | "sell" | "proposal" | null;

export function railDot(u: TimelineUpdate): RailDot {
  const fc = u.fieldChanges ?? {};
  if (u.type === "CLOSED") return "sell";
  if (u.type === "STATUS_CHANGED") {
    if (fc.status?.to === "HOLDING") return "buy";
    if (fc.retiredReason?.to === "SOLD") return "sell";
    return null;
  }
  if (u.type === "PROPOSAL_APPROVED") return proposalMeta(u).side;
  if (
    u.type === "PROPOSAL_REJECTED" ||
    u.type === "PROPOSAL_EXPIRED" ||
    u.type === "PROPOSAL_PENDING"
  )
    return "proposal";
  return null;
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

export function fieldChangeLines(u: TimelineUpdate): string[] {
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
  if (fc.triggers) lines.push(...triggerDiffLines(fc.triggers));
  return lines;
}

/** The principal's written note on a declined proposal, when present. */
export function proposalUserMessage(u: TimelineUpdate): string | null {
  const fc = u.fieldChanges as
    | { proposal?: { to?: { userMessage?: unknown } } }
    | null;
  const msg = fc?.proposal?.to?.userMessage;
  return typeof msg === "string" && msg.trim().length > 0 ? msg : null;
}
