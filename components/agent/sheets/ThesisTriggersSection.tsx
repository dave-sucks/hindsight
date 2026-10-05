"use client";

/**
 * ThesisTriggersSection — a stock's triggers on the thesis sheet: one row of
 * pills per action ("Buy if", "Sell if", …) and, under them, Add trigger.
 * A pill opens its trigger in a popover: editable for the stock's own
 * trigger, locked for an analyst or account rule it inherits.
 * docs/plans/TRIGGER_TYPES.md §7.
 */
import { useEffect, useState } from "react";
import { editableTriggerParts } from "@/lib/agent/triggers/editable";
import { actionGroupLabel } from "@/lib/agent/triggers/format";
import type { TriggerPredicate as SharedTriggerPredicate } from "@/lib/agent/triggers/types";
import { AddTrigger } from "@/components/agent/triggers/TriggerDialog";
import { TriggerPill } from "@/components/agent/triggers/TriggerPill";

// The thesis-sheet contract types (the /triggers payload shape) live in
// lib/types/thesis-sheet — the server route + state builders + hooks speak
// the same shape. Re-exported here so existing component-side import paths
// keep working; new code should import from the lib module.
export type {
  TriggerPredicate,
  Trigger,
  ThesisStatePosition,
  ThesisPendingProposal,
  ThesisScoringDim,
  ThesisScoring,
  ThesisDossier,
  QuoteResponse,
  ResolvedEnvelope,
  ThesisSourcesUsedItem,
  ThesisSourcesUsed,
  ResearchCitation,
  ResearchTextSection,
  ResearchBullet,
  ResearchBulletSection,
  ThesisResearchSections,
} from "@/lib/types/thesis-sheet";
import type { Trigger, ThesisDossier } from "@/lib/types/thesis-sheet";

type Level = "THESIS" | "ANALYST" | "ACCOUNT";

// One row per action — Buy if / Add if / Review if / Trim if / Sell if.
// Rows with no triggers don't render.
const TRIGGER_ACTION_ORDER: ReadonlyArray<string> = ["ENTER", "ADD", "REVIEW", "MOVE_STOP", "TRIM", "EXIT"];

/** The pill rows. A pill opens its trigger in a popover. */
export function TriggerGroups({
  triggers,
  editable,
  held,
  analystId,
  endpointBase,
  onChanged,
  level = "THESIS",
}: {
  triggers: Trigger[];
  /** Kept for callers that pass it; the pills read the stored condition. */
  direction?: "LONG" | "SHORT" | null;
  editable: boolean;
  held: boolean;
  analystId?: string | null;
  endpointBase: string;
  onChanged?: () => void;
  level?: Level;
}) {
  const grouped = new Map<string, Trigger[]>();
  for (const t of triggers) grouped.set(t.action, [...(grouped.get(t.action) ?? []), t]);

  return (
    <div className="space-y-1.5">
      {TRIGGER_ACTION_ORDER.map((action) => {
        const items = grouped.get(action) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={action} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span className="shrink-0 text-sm text-muted-foreground">{actionGroupLabel(action, level === "THESIS" ? held : undefined)}</span>
            {items.map((t) => (
              <TriggerPill
                key={t.id}
                trigger={t}
                level={level}
                held={held}
                editable={editable}
                endpointBase={endpointBase}
                analystId={analystId}
                onChanged={onChanged}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main section ────────────────────────────────────────────────────────

interface Props {
  thesisId: string;
  /** Pre-fetched durable dossier. When omitted, the section fetches itself. */
  data?: ThesisDossier | null;
  /** Thesis direction. */
  direction?: "LONG" | "SHORT" | null;
  /** When true, the stock's own triggers can be added, changed and deleted. */
  editable?: boolean;
  /**
   * When true, show ONLY the stock's own triggers that carry a number (price
   * levels and % moves) and hide the rest. Used in compact contexts like the
   * reject dialog, where the read-only triggers are just noise.
   */
  editableOnly?: boolean;
  /**
   * Bump to force a refetch in self-fetch mode (no `data` prop) — e.g. after an
   * inline edit. Keeps the current list visible during the refetch (no remount
   * flash), unlike a `key` change. Ignored when `data` is controlled.
   */
  refreshKey?: number;
  /** Called after a successful trigger change so the parent can refresh. */
  onChanged?: () => void;
}

export function ThesisTriggersSection({
  thesisId,
  data: dataProp,
  direction = null,
  editable = false,
  editableOnly = false,
  refreshKey,
  onChanged,
}: Props) {
  const [internalData, setInternalData] = useState<ThesisDossier | null>(null);
  const data = dataProp !== undefined ? dataProp : internalData;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dataProp !== undefined) return;
    let cancelled = false;
    fetch(`/api/theses/${thesisId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as ThesisDossier;
        if (!cancelled) setInternalData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [thesisId, dataProp, refreshKey]);

  if (error) {
    return <p className="text-xs text-muted-foreground">Couldn&apos;t load triggers: {error}</p>;
  }

  if (data == null) {
    return <p className="text-xs text-muted-foreground">Loading triggers…</p>;
  }

  // HOLDING ⇒ has an open position: a sale can sell, and the position's
  // variables (our entry, the high since we bought) exist.
  const held = data.status === "HOLDING";
  const endpointBase = `/api/theses/${thesisId}/triggers`;

  // In editableOnly mode, show just the stock's own triggers with a number.
  const shownTriggers = editableOnly
    ? data.triggers.filter(
        (t) => !t.inherited && editableTriggerParts(t.predicate as unknown as SharedTriggerPredicate).length > 0,
      )
    : data.triggers;

  return (
    <div className="space-y-3">
      {shownTriggers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {editableOnly
            ? "No price or % triggers yet. Add one below."
            : editable
              ? "No triggers yet. Add one below."
              : "No triggers attached."}
        </p>
      ) : (
        <TriggerGroups
          triggers={shownTriggers}
          direction={direction}
          editable={editable}
          held={held}
          analystId={data.analystId}
          endpointBase={endpointBase}
          onChanged={onChanged}
        />
      )}
      {editable ? (
        <div>
          <AddTrigger level="THESIS" held={held} endpointBase={endpointBase} onChanged={onChanged} />
        </div>
      ) : null}
    </div>
  );
}
