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
  variant: "default" | "secondary" | "destructive" | "outline";
}

// ── Outcome chip ─────────────────────────────────────────────────────────────
// One at-a-glance verdict per row. Proposal outcomes, trigger fires, and
// buy/sell transitions get a chip; routine reviews/updates stay text-only.

export function outcomeChip(u: TimelineUpdate): OutcomeChip | null {
  const fc = u.fieldChanges ?? {};
  switch (u.type) {
    case "PROPOSAL_APPROVED":
      return { label: "Approved", variant: "default" };
    case "PROPOSAL_REJECTED":
      return { label: "Declined", variant: "destructive" };
    case "PROPOSAL_EXPIRED":
      return { label: "Expired", variant: "outline" };
    case "PROPOSAL_PENDING":
      return { label: "Awaiting review", variant: "outline" };
    case "TRIGGER_FIRED":
      return { label: "Trigger fired", variant: "secondary" };
    case "CLOSED":
      return { label: "Sold", variant: "secondary" };
    case "INVALIDATED":
      return { label: "Invalidated", variant: "destructive" };
    case "STATUS_CHANGED": {
      const to = fc.status?.to;
      if (to === "HOLDING") return { label: "Bought", variant: "default" };
      if (fc.retiredReason?.to === "SOLD")
        return { label: "Sold", variant: "secondary" };
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
  const lines: string[] = [];
  for (const t of to) {
    if (!t?.id) continue;
    const prev = fromById.get(t.id);
    if (!prev) {
      lines.push(`+ ${describeTriggerBrief(t)}`);
    } else if (
      JSON.stringify(prev.predicate) !== JSON.stringify(t.predicate) ||
      prev.action !== t.action
    ) {
      const before = safePredicateSentence(prev.predicate);
      const after = safePredicateSentence(t.predicate);
      if (before && after) {
        lines.push(
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
    if (t?.id && !toIds.has(t.id)) lines.push(`− ${describeTriggerBrief(t)}`);
  }
  return lines;
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
