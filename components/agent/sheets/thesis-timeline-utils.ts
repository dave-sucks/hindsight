/**
 * thesis-timeline-utils — pure helpers behind the ThesisSheet Activity tab
 * (P1-33 slice 1). No React: kept out of ThesisTimelineSection.tsx so the
 * outcome-chip / field-change / ladder-diff logic is unit-testable.
 *
 *   - outcomeChip: one at-a-glance verdict per row (Bought / Sold /
 *     Declined / Approved / Expired / Trigger fired / Level moved)
 *   - fieldChangeLines: exact "Target $80.00 → $95.00" from → to lines
 *   - triggerDiffLines: per-rung ladder diff ("floor 64 → 71"), tolerant
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

export interface OutcomeChip {
  label: string;
  variant:
    | "default"
    | "secondary"
    | "destructive"
    | "outline"
    | "positive"
    | "negative"
    | "warning";
}

/** Buy-side vs sell-side of a proposal, off the intent stored with it. */
function proposalSide(u: TimelineUpdate): "buy" | "sell" | null {
  const fc = u.fieldChanges as
    | { proposal?: { to?: { intent?: unknown } } }
    | null;
  const intent = fc?.proposal?.to?.intent;
  if (intent === "OPEN" || intent === "ADD") return "buy";
  if (intent === "CLOSE" || intent === "PARTIAL_CLOSE") return "sell";
  return null;
}

// ── Outcome chip ─────────────────────────────────────────────────────────────
// One at-a-glance verdict per row, in the money-color language the rest of
// the app uses: green = money deployed (buys), red = money pulled (sells),
// amber = a trigger demanding attention. Proposal outcomes, trigger fires,
// and buy/sell transitions get a chip; routine reviews/updates stay
// text-only.

export function outcomeChip(u: TimelineUpdate): OutcomeChip | null {
  const fc = u.fieldChanges ?? {};
  switch (u.type) {
    case "PROPOSAL_APPROVED": {
      const side = proposalSide(u);
      if (side === "buy") return { label: "Approved buy", variant: "positive" };
      if (side === "sell")
        return { label: "Approved sell", variant: "negative" };
      return { label: "Approved", variant: "default" };
    }
    case "PROPOSAL_REJECTED":
      return { label: "Declined", variant: "destructive" };
    case "PROPOSAL_EXPIRED":
      return { label: "Expired", variant: "outline" };
    case "PROPOSAL_PENDING":
      return { label: "Awaiting review", variant: "outline" };
    case "TRIGGER_FIRED":
      return { label: "Trigger fired", variant: "warning" };
    case "CLOSED":
      return { label: "Sold", variant: "negative" };
    case "INVALIDATED":
      return { label: "Invalidated", variant: "destructive" };
    case "STATUS_CHANGED": {
      const to = fc.status?.to;
      if (to === "HOLDING") return { label: "Bought", variant: "positive" };
      if (fc.retiredReason?.to === "SOLD")
        return { label: "Sold", variant: "negative" };
      if (to === "RETIRED") return { label: "Retired", variant: "outline" };
      return null;
    }
    case "UPDATED":
      if (fc.targetPrice || fc.stopLoss)
        return { label: "Level moved", variant: "secondary" };
      return null;
    default:
      return null;
  }
}

/**
 * Rail-dot emphasis for the row: "buy" (green) when money went in, "sell"
 * (red) when money came out, null for everything else (gray dot). The
 * current-run amber pulse in the component overrides all of these.
 */
export function railDot(u: TimelineUpdate): "buy" | "sell" | null {
  const fc = u.fieldChanges ?? {};
  if (u.type === "CLOSED") return "sell";
  if (u.type === "STATUS_CHANGED") {
    if (fc.status?.to === "HOLDING") return "buy";
    if (fc.retiredReason?.to === "SOLD") return "sell";
    return null;
  }
  if (u.type === "PROPOSAL_APPROVED") return proposalSide(u);
  return null;
}

// ── Field-change lines ───────────────────────────────────────────────────────
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
