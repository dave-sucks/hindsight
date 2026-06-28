"use client";

/**
 * ThesisTriggersSection — renders the structured triggers + scheduling
 * metadata for a thesis. Sits above ThesisTimelineSection in the sheet.
 *
 * Each trigger renders as a compact ButtonGroup split-pill:
 *   [ Action icon + label ] | [ predicate icon + value ]
 *
 * Hover (or click) opens a Popover with the rationale, last-fired
 * metadata, and the Test fire button — same pattern as the Monitor
 * info popovers on /intelligence.
 */
import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Zap, Clock, Loader2, Plus, Trash2 } from "lucide-react";
import { editableTriggerField } from "@/lib/agent/triggers/editable";
import { cn } from "@/lib/utils";

interface TriggerPredicate {
  kind: string;
  level?: number;
  pct?: number;
  direction?: string;
  window?: string;
  period?: number;
  threshold?: number;
  signalType?: string;
  sentiment?: string;
  minUrgency?: string;
  minSurprisePct?: number;
  formType?: string;
  days?: number;
  trailPct?: number;
  predicates?: TriggerPredicate[];
}

interface Trigger {
  id: string;
  predicate: TriggerPredicate;
  action: string;
  rationale: string;
  cooldownDays?: number;
  lastFiredAt?: string;
  /** "TACTICAL" (wake an agent) | "DIRECT" (close directly, no agent). Absent ⇒ TACTICAL. */
  fireMode?: "TACTICAL" | "DIRECT";
}

// Position info from /triggers — quantity + cost basis + days held only.
// Live-quote-derived fields (currentPrice / marketValue / unrealizedPnl)
// come from the separate /quote response (`QuoteResponse.positionPnl`)
// and are merged into the rendered PositionRow client-side.
export interface ThesisStatePosition {
  quantity: number;
  avgCost: number;
  openedAt: string;
  daysHeld: number;
  closed?: boolean;
  closedAt?: string | null;
  closePrice?: number | null;
  realizedPnl?: number | null;
  realizedPnlPct?: number | null;
  closeReason?: string | null;
  // Trade-as-Proposal — populated when this position has an
  // Order(AWAITING_APPROVAL) attached. Drives the "Awaiting your approval"
  // alert at the top of the sheet with inline [Approve][Reject] actions.
  // See docs/plans/TRADE_AS_PROPOSAL.md §6.
  pendingProposal?: {
    orderId: string;
    intent: "OPEN" | "ADD" | "CLOSE" | "PARTIAL_CLOSE";
    quantity: number;
    expiresAt: string | null;
    rationale: string | null;
  } | null;
}

export interface ThesisScoringDim {
  score: number;
  note?: string;
}
export interface ThesisScoring {
  trendStrength?: ThesisScoringDim;
  relativeStrength?: ThesisScoringDim;
  entryQuality?: ThesisScoringDim;
  catalystFreshness?: ThesisScoringDim;
}

export interface TriggersResponse {
  thesisId: string;
  ticker: string;
  status: string;
  // When the thesis row was created — anchors the "started watching"
  // vertical marker on the sheet's price chart.
  createdAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  invalidatedAt: string | null;
  invalidReason: string | null;
  // P1-24 B3: reason a thesis reached RETIRED — "SOLD"|"INVALIDATED"|
  // "DROPPED"|"REPLACED"|null. Drives the terminal-status banner.
  retiredReason: string | null;
  horizon: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  targetSizePct: number | null;
  catalystDate: string | null;
  maxHoldDays: number | null;
  nextReviewAt: string | null;
  triggers: Trigger[];
  position: ThesisStatePosition | null;
  // Structural belief — load-bearing fields the trade-evaluator + tactical
  // agent read. Surfaced to the sheet so the user can see what the agent
  // actually committed to.
  coreBelief: string | null;
  keyAssumptions: string[];
  invalidationConds: string[];
  // 4-dim composite scoring + the /10 sum. Composite is the SINGLE
  // conviction number (PR-9 collapsed the legacy `confidenceScore` int
  // onto this). Both place_trade gates read from here.
  scoring: ThesisScoring | null;
  scoringComposite: number | null;
  // ── Conviction Expression v4 (writer-side) ──────────────────────────
  // See docs/plans/CONVICTION_EXPRESSION.md §3-§4. Tier verdict +
  // one-sentence rationale + the writer's contrarian take. Null on
  // PASS / PENDING / pre-v4 legacy rows. The conviction badge in
  // ThesisSheet header keys off `conviction`; tooltip shows
  // `convictionRationale`; the variantView callout block keys off
  // `variantView` (rendered only when present).
  conviction: "STRONG" | "HIGH" | "MEDIUM" | "LOW" | null;
  convictionRationale: string | null;
  variantView: string | null;
  // ── Conviction Expression v4 (reader-side resolver §6) ──────────────
  // Read-time computed envelope. Live price + trigger evaluation +
  // supersession + actionability rollup. Drives the actionability
  // state pill in the sheet header. Optional because the field is
  // server-computed in /api/theses/:id/triggers only — the pre-fetched
  // sheetState path (P2-19) doesn't have it.
  resolved?: {
    currentPrice: number | null;
    entryQualityScore: number | null;
    triggerState: "ENTER_FIRED" | "ENTER_WAITING" | "EXIT_FIRED" | "NONE";
    triggerDetail: string | null;
    actionability:
      | "ENTER_NOW"
      | "WAIT_FOR_TRIGGER"
      | "PENDING_CATALYST"
      | "ACTIVE_HOLD"
      | "STALE_PAST_CATALYST"
      | "SUPERSEDED"
      | "PROMOTED_DECIDE_TODAY"
      | "DEAD";
    supersededBy: string | null;
    staleness: "FRESH" | "STALE";
    resolvedAt: string;
    quoteAgeMs: number | null;
  } | null;
  // ── V2 9-section narrative dossier (PR-9 flat schema) ────────────────
  // The 9 first-class JSONB columns that replaced the `researchSections`
  // blob. Three retypes of legacy fields (snapshot ↔ reasoningSummary,
  // bullCase ↔ thesisBullets, bearCase ↔ riskFlags) + 6 new sections.
  // Each section is either text-with-citations or bullets-with-citations
  // (see ResearchTextSection / ResearchBulletSection). All nullable —
  // legacy rows have the 3 retyped sections populated with empty
  // citations; the 6 new sections are null until V2 refresh.
  snapshot: ResearchTextSection | null;
  recentCatalysts: ResearchTextSection | null;
  fundamentals: ResearchTextSection | null;
  latestEarnings: ResearchBulletSection | null;
  catalystsAndEvents: ResearchBulletSection | null;
  bullCase: ResearchBulletSection | null;
  bearCase: ResearchBulletSection | null;
  analystConsensus: ResearchTextSection | null;
  insiderTechnical: ResearchTextSection | null;
  researchUpdatedAt: string | null;
  // Provenance: where the thesis came from + the analyst's one-line
  // rationale + the Signal rows that informed it.
  sourceKind: string | null;
  sourceRationale: string | null;
  sourceSignalIds: string[];
  // Direction-flip chain pointer. When non-null, this thesis supersedes
  // an earlier thesis on the same ticker; renders as a "Replaces #abc"
  // chip near the StatusPill.
  parentThesisId: string | null;
}

// Response shape from /api/theses/:id/quote — split from /triggers on
// 2026-05-19 because the inline Finnhub call was blocking everything
// else on the sheet for ~1-2s. The sheet now fires both endpoints in
// parallel; this one trickles in whenever Finnhub does and refines only
// the price header + position PnL fields.
export interface QuoteResponse {
  currentPrice: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  positionPnl: {
    currentPrice: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number | null;
  } | null;
}

// `sourcesUsed` column is Json — agents write `[{provider, title, url}]`
// at mint, but the column is permissive (some old rows have other shapes
// or null entries). Type loosely + render defensively.
export type ThesisSourcesUsedItem = {
  provider?: string;
  title?: string;
  url?: string;
  publishedAt?: string;
};
export type ThesisSourcesUsed = ThesisSourcesUsedItem[] | unknown;

// Deep-research section payload — see docs/plans/THESIS_RESEARCH_V2.md §4.4.
// Two content shapes coexist (text-with-citations OR bullet list). Keys are
// optional because the synthesis model may omit sections that don't apply.
export interface ResearchCitation {
  url?: string;
  title?: string;
  domain?: string;
  kind?: "STRUCTURED" | "WEB" | string;
}
export interface ResearchTextSection {
  text: string;
  citations?: ResearchCitation[];
}
export interface ResearchBullet {
  text: string;
  citation?: ResearchCitation;
}
export interface ResearchBulletSection {
  bullets: ResearchBullet[];
}
export interface ThesisResearchSections {
  snapshot?: ResearchTextSection;
  recentCatalysts?: ResearchTextSection;
  fundamentals?: ResearchTextSection;
  latestEarnings?: ResearchBulletSection;
  catalystsAndEvents?: ResearchBulletSection;
  bullCase?: ResearchBulletSection;
  bearCase?: ResearchBulletSection;
  analystConsensusSynthesis?: ResearchTextSection;
  insiderTechnicalSetup?: ResearchTextSection;
  // Allow unknown extra keys; the renderer ignores them. Lets the synthesis
  // model add new sections without a UI deploy.
  [extra: string]: ResearchTextSection | ResearchBulletSection | undefined;
}

// ── Predicate helpers ──────────────────────────────────────────────────
// `predicateSentence` and `actionLabel` live in lib/agent/triggers/format
// (single source — server-side producer + sheet banner + trigger pills
// all read from the same module).

import {
  predicateSentence as sharedPredicateSentence,
  actionGroupLabel,
  fireModeLabel,
} from "@/lib/agent/triggers/format";
import {
  isDirectEligiblePredicate,
  type TriggerPredicate as SharedTriggerPredicate,
} from "@/lib/agent/triggers/types";

function predicateSentence(p: TriggerPredicate): string {
  return sharedPredicateSentence(p as SharedTriggerPredicate);
}

/**
 * Split a predicate into a left-side "kind" label and a right-side value
 * for the two-cell trigger pill (2026-05-20 redesign):
 *   [ price above ][ $149 ]
 *   [ time elapsed ][ 14 days ]
 *   [ earnings beat ][ ≥3% ]
 *
 * Returns `value: null` when there's no value half (e.g. REVIEW_DATE_HIT,
 * EARNINGS_BEAT with no minimum surprise pct); the pill collapses to a
 * single cell in that case.
 */
function predicateKindValue(p: TriggerPredicate): {
  kind: string;
  value: string | null;
} {
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  switch (p.kind) {
    case "PRICE_ABOVE":
      return { kind: "price above", value: `$${p.level ?? "?"}` };
    case "PRICE_BELOW":
      return { kind: "price below", value: `$${p.level ?? "?"}` };
    case "TRAILING_STOP":
      return { kind: "trailing stop", value: `${p.trailPct ?? "?"}%` };
    case "PRICE_MOVE_PCT":
      return {
        kind: `price ${p.direction === "UP" ? "up" : "down"} ${p.window ?? ""}`.trim(),
        value: `${p.pct ?? "?"}%`,
      };
    case "VS_SMA":
      return {
        kind: `${p.period ?? "?"}-day SMA`,
        value: p.direction ? p.direction.toLowerCase() : null,
      };
    case "RSI":
      return {
        kind: `RSI ${p.direction ? p.direction.toLowerCase() : ""}`.trim(),
        value: p.threshold != null ? String(p.threshold) : null,
      };
    case "SIGNAL_TYPE": {
      const valueParts = [
        p.signalType ? p.signalType.toLowerCase().replace(/_/g, " ") : null,
        p.sentiment ? p.sentiment.toLowerCase() : null,
        p.minUrgency ? `≥${p.minUrgency.toLowerCase()}` : null,
      ].filter((v): v is string => Boolean(v));
      return { kind: "signal", value: valueParts.join(" · ") || null };
    }
    case "EARNINGS_BEAT":
      return {
        kind: "earnings beat",
        value: p.minSurprisePct ? `≥${p.minSurprisePct}%` : null,
      };
    case "EARNINGS_MISS":
      return {
        kind: "earnings miss",
        value: p.minSurprisePct ? `≥${p.minSurprisePct}%` : null,
      };
    case "GUIDANCE_CHANGE":
      return {
        kind: "guidance",
        value: p.direction ? p.direction.toLowerCase() : null,
      };
    case "FILING":
      return { kind: "filing", value: p.formType ?? null };
    case "TIME_ELAPSED":
      return {
        kind: "time elapsed",
        value: p.days != null ? plural(p.days, "day") : null,
      };
    case "REVIEW_DATE_HIT":
      return { kind: "review date hit", value: null };
    case "AND":
      return {
        kind: "all of",
        value: `${p.predicates?.length ?? 0} predicates`,
      };
    case "OR":
      return {
        kind: "any of",
        value: `${p.predicates?.length ?? 0} predicates`,
      };
    default:
      return { kind: predicateSentence(p), value: null };
  }
}

/** Long-form description for the hover popover. */
function predicateDescription(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_ABOVE":
      return `Fires when last quote crosses above $${p.level}.`;
    case "PRICE_BELOW":
      return `Fires when last quote crosses below $${p.level}.`;
    case "TRAILING_STOP":
      return `Exits when price falls ${p.trailPct}% below its peak since entry. Trails up as the position runs.`;
    case "PRICE_MOVE_PCT":
      return `Fires when price moves ${p.direction === "UP" ? "+" : "−"}${p.pct}% over ${p.window}.`;
    case "VS_SMA":
      return `Fires when price moves ${p.direction?.toLowerCase()} the ${p.period}-day SMA.`;
    case "RSI":
      return `Fires when RSI moves ${p.direction?.toLowerCase()} ${p.threshold}.`;
    case "SIGNAL_TYPE":
      return `Fires on a ${p.signalType} signal${p.sentiment ? ` with ${p.sentiment.toLowerCase()} sentiment` : ""}${p.minUrgency ? ` at urgency ≥ ${p.minUrgency.toLowerCase()}` : ""}.`;
    case "EARNINGS_BEAT":
      return p.minSurprisePct
        ? `Fires on an earnings beat of at least ${p.minSurprisePct}%.`
        : "Fires on any earnings beat.";
    case "EARNINGS_MISS":
      return p.minSurprisePct
        ? `Fires on an earnings miss of at least ${p.minSurprisePct}%.`
        : "Fires on any earnings miss.";
    case "GUIDANCE_CHANGE":
      return `Fires when company issues ${p.direction?.toLowerCase()} guidance revision.`;
    case "FILING":
      return `Fires when a ${p.formType} is filed.`;
    case "TIME_ELAPSED":
      return `Fires once ${p.days} days have passed since the thesis was created.`;
    case "REVIEW_DATE_HIT":
      return "Fires when the thesis's nextReviewAt date is reached.";
    case "AND":
      return `Composite: ALL of ${(p.predicates ?? []).length} sub-predicates must be true.`;
    case "OR":
      return `Composite: ANY of ${(p.predicates ?? []).length} sub-predicates triggers.`;
    default:
      return p.kind;
  }
}

// ── Action label helper ────────────────────────────────────────────────
// Action (EXIT / ENTER / ADD / TRIM / MOVE_STOP / REVIEW) is surfaced via
// the section grouping (ENTER IF / EXIT IF / REVIEW IF) above each pill
// group + as the label inside the popover. Used to live as an inline
// icon on every pill; removed in the 2026-05-20 pill redesign.

// ── Date formatters ─────────────────────────────────────────────────────

function fmtFiredAt(iso?: string): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Trigger pill — 2 cells separated by a real border ─────────────────
// Restyled 2026-05-20:  [ kind ][ value ]
//   - Cell 1 (kind): faint muted bg, muted-foreground text
//     ("price above" / "time elapsed" / "earnings beat" / etc.)
//   - Cell 2 (value): no bg, plain foreground text ("$149" / "14 days")
//   - Smaller font (text-xs), shorter row (h-7)
//   - No action icon — action info is communicated via the section
//     grouping (ENTER IF / EXIT IF / REVIEW IF) above
//   - Value-less predicates (REVIEW_DATE_HIT, EARNINGS_BEAT without min%)
//     render the kind cell only.

function TriggerPill({
  trigger,
  thesisId,
  direction,
  editable,
  held,
  onChanged,
}: {
  trigger: Trigger;
  thesisId: string;
  direction: "LONG" | "SHORT" | null;
  editable: boolean;
  held: boolean;
  onChanged?: () => void;
}) {
  const { kind, value } = predicateKindValue(trigger.predicate);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            className="inline-flex h-7 cursor-pointer items-stretch overflow-hidden rounded-md border border-border text-xs transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {/* Cell 1 — kind label, faint muted background */}
        <div
          className={cn(
            "flex items-center px-2 bg-muted/30 text-muted-foreground",
            value ? "border-r border-border" : "",
          )}
        >
          {kind}
        </div>

        {/* Cell 2 — value, no background, foreground text */}
        {value ? (
          <div className="flex items-center px-2 text-foreground">{value}</div>
        ) : null}
      </PopoverTrigger>

      <TriggerPopoverContent
        trigger={trigger}
        thesisId={thesisId}
        direction={direction}
        editable={editable}
        held={held}
        onChanged={onChanged}
      />
    </Popover>
  );
}

/**
 * Popover content as a consistent label / input / save form (replacing the
 * old sentence-led layout). Every trigger renders the same shape:
 *   • a small field label + a full-width input (editable when the predicate
 *     exposes a numeric value AND the thesis is editable; read-only otherwise)
 *   • the explainer sentence + the writer's rationale
 *   • fired / cooldown metadata as small badges
 *   • Save / Cancel, shown only once the value is changed
 */
function TriggerPopoverContent({
  trigger,
  thesisId,
  direction,
  editable,
  held,
  onChanged,
}: {
  trigger: Trigger;
  thesisId: string;
  direction: "LONG" | "SHORT" | null;
  editable: boolean;
  /** Thesis is HOLDING (has an open position) — gates the DIRECT fire-mode control. */
  held: boolean;
  onChanged?: () => void;
}) {
  const field = editableTriggerField(
    trigger.predicate as unknown as SharedTriggerPredicate,
  );
  const canEdit = editable && field != null;

  // The stop trigger is convertible to/from a trailing stop. LONG stops are a
  // PRICE_BELOW EXIT, SHORT stops a PRICE_ABOVE EXIT; a TRAILING_STOP is already
  // converted. (A LONG take-profit is PRICE_ABOVE — direction keeps us off it.)
  const stopKind = direction === "SHORT" ? "PRICE_ABOVE" : "PRICE_BELOW";
  const isTrailing = trigger.predicate.kind === "TRAILING_STOP";
  // The toggle only belongs on the EXIT stop trigger (fixed or trailing) — never
  // on a take-profit or a non-EXIT trigger that merely carries a price predicate.
  const isStopTrigger =
    trigger.action === "EXIT" &&
    (isTrailing || trigger.predicate.kind === stopKind);
  const { kind: kindLabel, value: displayValue } = predicateKindValue(
    trigger.predicate,
  );
  const fieldLabel = `${actionGroupLabel(trigger.action)} · ${kindLabel}`;

  const initial = field?.value != null ? String(field.value) : "";
  const [val, setVal] = useState(initial);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Resync the input when the underlying stored value changes (an external
  // refresh, or this trigger's value after a save). `initial` only changes when
  // field.value changes — NOT while the user types — so this never clobbers an
  // in-progress edit, it just prevents a stale value lingering after a refetch.
  useEffect(() => {
    setVal(initial);
  }, [initial]);

  const parsed = Number(val);
  const dirty =
    canEdit && val.trim() !== "" && Number.isFinite(parsed) && parsed !== field?.value;

  async function save() {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/theses/${thesisId}/triggers/${trigger.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: parsed }),
        },
      );
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  async function setTrailing(next: boolean) {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}/triggers/${trigger.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trailing: next }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  async function setFireMode(next: "TACTICAL" | "DIRECT") {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}/triggers/${trigger.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fireMode: next }),
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  async function remove() {
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(`/api/theses/${thesisId}/triggers/${trigger.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  // DIRECT (close without an agent) is only meaningful on a price/trailing
  // EXIT trigger of a held position — mirror applyTriggerFireModeChange. A
  // judgment-bearing EXIT (earnings, signal, etc.) keeps the TACTICAL path,
  // so we don't offer the control there.
  const showFireMode =
    editable &&
    trigger.action === "EXIT" &&
    held &&
    isDirectEligiblePredicate(trigger.predicate.kind);
  const fireMode = trigger.fireMode ?? "TACTICAL";

  return (
    <PopoverContent side="left" align="start" className="w-72 space-y-3">
      {/* Label + full-width input (editable or read-only) */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {fieldLabel}
        </p>
        {canEdit ? (
          <div className="flex items-center gap-1.5">
            {field?.prefix ? (
              <span className="text-sm text-muted-foreground">{field.prefix}</span>
            ) : null}
            <Input
              type="number"
              inputMode="decimal"
              value={val}
              min={field?.min}
              step={field?.step}
              onChange={(e) => setVal(e.target.value)}
              disabled={pending}
            />
            {field?.suffix ? (
              <span className="text-sm text-muted-foreground">{field.suffix}</span>
            ) : null}
          </div>
        ) : (
          <Input value={displayValue ?? kindLabel} readOnly disabled />
        )}
      </div>

      {/* Trailing toggle — only on the stop trigger. Flips fixed ↔ trailing. */}
      {editable && isStopTrigger ? (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Trailing stop
          </span>
          <Switch
            checked={isTrailing}
            onCheckedChange={(v) => void setTrailing(v)}
            disabled={pending}
          />
        </div>
      ) : null}

      {/* On fire — TACTICAL (wake an agent) vs DIRECT (close directly, no
          agent; still approval-gated). EXIT triggers on a held position only. */}
      {showFireMode ? (
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            On fire
          </span>
          <Select
            value={fireMode}
            onValueChange={(v) => void setFireMode(v as "TACTICAL" | "DIRECT")}
            disabled={pending}
          >
            <SelectTrigger size="sm">
              <SelectValue>{fireModeLabel(fireMode)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TACTICAL">{fireModeLabel("TACTICAL")}</SelectItem>
              <SelectItem value="DIRECT">{fireModeLabel("DIRECT")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {/* Explainer + rationale */}
      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">
          {predicateDescription(trigger.predicate)}
        </p>
        {trigger.rationale ? (
          <p className="text-foreground leading-relaxed">{trigger.rationale}</p>
        ) : null}
      </div>

      {/* Metadata badges */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">
          <Zap className="size-3" />
          {trigger.lastFiredAt ? `Fired ${fmtFiredAt(trigger.lastFiredAt)}` : "Never fired"}
        </Badge>
        {trigger.cooldownDays ? (
          <Badge variant="secondary">
            <Clock className="size-3" />
            {trigger.cooldownDays}d cooldown
          </Badge>
        ) : null}
      </div>

      {err ? <p className="text-xs text-destructive">{err}</p> : null}

      {/* Footer: Remove on the left (always available when editable), Save/Cancel
          on the right once the value is changed. */}
      {editable ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void remove()}
            disabled={pending}
          >
            <Trash2 className="size-3" />
            Remove
          </Button>
          {dirty ? (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setVal(initial);
                  setErr(null);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={pending}>
                {pending ? <Loader2 className="size-3 animate-spin" /> : null}
                Save
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </PopoverContent>
  );
}

// ── Trigger grouping ────────────────────────────────────────────────────
// Each TriggerAction gets its own group — Buy if / Add if / Trim if /
// Move stop if / Exit if / Review if. Action verbs come from the shared
// actionGroupLabel helper so the popover title and the section header
// stay in sync. Groups with zero triggers don't render.

const TRIGGER_ACTION_ORDER: ReadonlyArray<string> = [
  "ENTER",
  "ADD",
  "REVIEW",
  "MOVE_STOP",
  "TRIM",
  "EXIT",
];

function TriggerGroups({
  triggers,
  thesisId,
  direction,
  editable,
  held,
  onChanged,
}: {
  triggers: Trigger[];
  thesisId: string;
  direction: "LONG" | "SHORT" | null;
  editable: boolean;
  held: boolean;
  onChanged?: () => void;
}) {
  const grouped = new Map<string, Trigger[]>();
  for (const t of triggers) {
    const arr = grouped.get(t.action) ?? [];
    arr.push(t);
    grouped.set(t.action, arr);
  }

  return (
    <div className="space-y-1.5">
      {TRIGGER_ACTION_ORDER.map((action) => {
        const items = grouped.get(action) ?? [];
        if (items.length === 0) return null;
        return (
          <div
            key={action}
            className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
          >
            <span className="text-sm text-muted-foreground shrink-0">
              {actionGroupLabel(action)}
            </span>
            {items.map((t) => (
              <TriggerPill
                key={t.id}
                trigger={t}
                thesisId={thesisId}
                direction={direction}
                editable={editable}
                held={held}
                onChanged={onChanged}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Add-trigger form ────────────────────────────────────────────────────
// A ghost "+" that opens a Popover form: action + predicate type + value
// (+ fire mode on a held EXIT). Mints a new Price/Trailing trigger on any
// action group — the gap-filler for theses missing an Exit stop / Enter /
// etc. POSTs to /api/theses/:id/triggers; the backend validates against the
// same Zod schema the agent uses and mirrors canonical stop/target levels.

const PRED_TYPE_LABEL: Record<string, string> = {
  PRICE_ABOVE: "Price above",
  PRICE_BELOW: "Price below",
  TRAILING_STOP: "Trailing %",
};

type AddPredType = "PRICE_ABOVE" | "PRICE_BELOW" | "TRAILING_STOP";

function AddTriggerPopover({
  thesisId,
  held,
  onChanged,
}: {
  thesisId: string;
  held: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<string>("EXIT");
  const [predType, setPredType] = useState<AddPredType>("PRICE_BELOW");
  const [val, setVal] = useState("");
  const [fireMode, setFireMode] = useState<"TACTICAL" | "DIRECT">("DIRECT");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Trailing stops are EXIT-only and need an open position to trail.
  const trailingAllowed = action === "EXIT" && held;
  const showFireMode = action === "EXIT" && held;
  const isTrailing = predType === "TRAILING_STOP";

  // If trailing is selected but no longer allowed (action moved off EXIT, or
  // unheld), fall back to a price level so we never submit an invalid combo.
  useEffect(() => {
    if (isTrailing && !trailingAllowed) setPredType("PRICE_BELOW");
  }, [isTrailing, trailingAllowed]);

  // Default fire mode by action — EXIT → DIRECT, else TACTICAL. Mirrors the
  // server-side defaultFireModeForAction (can't import it here: defaults.ts
  // pulls node:crypto, which breaks the client bundle).
  useEffect(() => {
    setFireMode(action === "EXIT" ? "DIRECT" : "TACTICAL");
  }, [action]);

  const num = Number(val);
  const valid =
    val.trim() !== "" &&
    Number.isFinite(num) &&
    num > 0 &&
    (!isTrailing || num < 100);

  async function save() {
    if (!valid) return;
    setPending(true);
    setErr(null);
    const predicate = isTrailing
      ? { kind: "TRAILING_STOP", trailPct: num }
      : { kind: predType, level: num };
    try {
      const res = await fetch(`/api/theses/${thesisId}/triggers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          predicate,
          fireMode: action === "EXIT" ? fireMode : undefined,
        }),
      });
      if (!res.ok) {
        // Route returns { error } JSON; fall back to status text.
        let msg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) msg = body.error;
        } catch {
          /* non-JSON body */
        }
        throw new Error(msg);
      }
      setOpen(false);
      setVal("");
      setErr(null);
      setPending(false);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm">
            <Plus className="size-3" />
            Add trigger
          </Button>
        }
      />
      <PopoverContent side="left" align="start" className="w-72 space-y-3">
        {/* Action */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Action
          </span>
          <Select
            value={action}
            onValueChange={(v) => {
              if (typeof v === "string") setAction(v);
            }}
            disabled={pending}
          >
            <SelectTrigger size="sm">
              <SelectValue>{actionGroupLabel(action)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_ACTION_ORDER.map((a) => (
                <SelectItem key={a} value={a}>
                  {actionGroupLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Predicate type */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Condition
          </span>
          <Select
            value={predType}
            onValueChange={(v) => setPredType(v as AddPredType)}
            disabled={pending}
          >
            <SelectTrigger size="sm">
              <SelectValue>{PRED_TYPE_LABEL[predType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PRICE_ABOVE">{PRED_TYPE_LABEL.PRICE_ABOVE}</SelectItem>
              <SelectItem value="PRICE_BELOW">{PRED_TYPE_LABEL.PRICE_BELOW}</SelectItem>
              {trailingAllowed ? (
                <SelectItem value="TRAILING_STOP">
                  {PRED_TYPE_LABEL.TRAILING_STOP}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>

        {/* Value */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isTrailing ? "Trail %" : "Price"}
          </span>
          <div className="flex items-center gap-1.5">
            {isTrailing ? null : (
              <span className="text-sm text-muted-foreground">$</span>
            )}
            <Input
              type="number"
              inputMode="decimal"
              value={val}
              min={0}
              step={isTrailing ? 0.5 : 0.01}
              onChange={(e) => setVal(e.target.value)}
              disabled={pending}
            />
            {isTrailing ? (
              <span className="text-sm text-muted-foreground">%</span>
            ) : null}
          </div>
        </div>

        {/* Fire mode (held EXIT only) */}
        {showFireMode ? (
          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              On fire
            </span>
            <Select
              value={fireMode}
              onValueChange={(v) => setFireMode(v as "TACTICAL" | "DIRECT")}
              disabled={pending}
            >
              <SelectTrigger size="sm">
                <SelectValue>{fireModeLabel(fireMode)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TACTICAL">{fireModeLabel("TACTICAL")}</SelectItem>
                <SelectItem value="DIRECT">{fireModeLabel("DIRECT")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {err ? <p className="text-xs text-destructive">{err}</p> : null}

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={pending || !valid}>
            {pending ? <Loader2 className="size-3 animate-spin" /> : null}
            Add
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Main section ────────────────────────────────────────────────────────

interface Props {
  thesisId: string;
  /** Pre-fetched response. When omitted, the section fetches itself. */
  data?: TriggersResponse | null;
  /** Thesis direction — disambiguates the stop trigger for the trailing toggle. */
  direction?: "LONG" | "SHORT" | null;
  /** When true, value-bearing triggers become editable in the popover. */
  editable?: boolean;
  /** Called after a successful trigger-value edit so the parent can refresh. */
  onChanged?: () => void;
}

export function ThesisTriggersSection({
  thesisId,
  data: dataProp,
  direction = null,
  editable = false,
  onChanged,
}: Props) {
  const [internalData, setInternalData] = useState<TriggersResponse | null>(
    null,
  );
  const data = dataProp !== undefined ? dataProp : internalData;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dataProp !== undefined) return;
    let cancelled = false;
    fetch(`/api/theses/${thesisId}/triggers`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as TriggersResponse;
        if (!cancelled) setInternalData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [thesisId, dataProp]);

  if (error) {
    return (
      <p className="text-xs text-muted-foreground">
        Couldn&apos;t load triggers: {error}
      </p>
    );
  }

  if (data == null) {
    return <p className="text-xs text-muted-foreground">Loading triggers…</p>;
  }

  // HOLDING ⇒ has an open position. Gates the DIRECT fire-mode + trailing
  // options (both need a live position to act on).
  const held = data.status === "HOLDING";

  return (
    <div className="space-y-2">
      {data.triggers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No triggers attached.{" "}
          {editable
            ? "Add one below, or set a horizon when minting to auto-attach the baseline."
            : "Set a horizon when minting this thesis to auto-attach the baseline."}
        </p>
      ) : (
        <TriggerGroups
          triggers={data.triggers}
          thesisId={thesisId}
          direction={direction}
          editable={editable}
          held={held}
          onChanged={onChanged}
        />
      )}
      {editable ? (
        <AddTriggerPopover thesisId={thesisId} held={held} onChanged={onChanged} />
      ) : null}
    </div>
  );
}
