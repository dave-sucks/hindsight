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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { ButtonGroup } from "@/components/ui/button-group";
import { Clock, Loader2, Plus, Trash2, Calendar } from "lucide-react";
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
  /** Position row id — drives the sheet's "View trade →" link. Optional
   *  because the pre-fetched sheetState path (P2-19) doesn't carry it. */
  id?: string;
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
  // Company name + exchange from the Finnhub profile — thesis rows rarely
  // store them, so the sheet header reads them off the quote to show the full
  // name + "TICKER · EXCHANGE" instead of the ticker twice.
  companyName?: string | null;
  exchange?: string | null;
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
    case "PRICE_MOVE_PCT": {
      // Daily move (window 1D) reads as a clean "up / down" — the standard
      // "stock is up/down X% today" alert. Multi-day windows append the span.
      const dir = p.direction === "UP" ? "up" : "down";
      const win = p.window && p.window !== "1D" ? ` ${p.window}` : "";
      return { kind: `${dir}${win}`, value: `${p.pct ?? "?"}%` };
    }
    case "GAIN_FROM_ENTRY":
      // Cumulative move vs the position's entry (avg cost) — distinct from
      // the daily "up/down" above: "up from entry 10%" is the milestone.
      return {
        kind: `${p.direction === "UP" ? "up" : "down"} from entry`,
        value: `${p.pct ?? "?"}%`,
      };
    case "TRAILING_FROM_HIGH":
      // Give-back off the tracked peak — "Exit if · off the high · 8%".
      return { kind: "off the high", value: `${p.pct ?? "?"}%` };
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
    case "PRICE_MOVE_PCT":
      return p.window === "1D"
        ? `Fires when the stock is ${p.direction === "UP" ? "up" : "down"} ${p.pct}% on the day (vs prior close).`
        : `Fires when price moves ${p.direction === "UP" ? "+" : "−"}${p.pct}% over ${p.window}.`;
    case "GAIN_FROM_ENTRY":
      return p.direction === "UP"
        ? `Fires when the position is up ${p.pct}% from entry (avg cost) — the cumulative gain milestone.`
        : `Fires when the position is down ${p.pct}% from entry (avg cost) — drawdown attention.`;
    case "TRAILING_FROM_HIGH":
      return `Fires when price gives back ${p.pct}% from its high since entry. The high ratchets up as the position runs.`;
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

  const { kind: kindLabel, value: displayValue } = predicateKindValue(
    trigger.predicate,
  );
  // Sentence title in foreground — "Exit if price below", "Review if up".
  const fieldLabel = `${actionGroupLabel(trigger.action)} ${kindLabel}`;

  // Input-group adornments. Price → leading "$"; movement / gain-from-entry
  // → leading direction + trailing "%"; time-based → leading calendar icon
  // (read-only). Trailing-from-high has no direction (the give-back is
  // orientation-aware by thesis direction), so it gets the plain % input.
  const pk = trigger.predicate.kind;
  const moveDir =
    pk === "PRICE_MOVE_PCT" || pk === "GAIN_FROM_ENTRY"
      ? trigger.predicate.direction === "UP"
        ? "Up"
        : "Down"
      : null;
  const leadingText = field?.prefix ?? moveDir;
  const trailingText = field?.suffix ?? null;
  const leadingIcon = pk === "TIME_ELAPSED" || pk === "REVIEW_DATE_HIT";

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
    <PopoverContent side="left" align="start" className="w-72 space-y-2.5">
      {/* Title (sentence, foreground) + full-width input group */}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{fieldLabel}</p>
        <InputGroup>
          {leadingIcon ? (
            <InputGroupAddon>
              <Calendar />
            </InputGroupAddon>
          ) : leadingText ? (
            <InputGroupAddon>
              <InputGroupText>{leadingText}</InputGroupText>
            </InputGroupAddon>
          ) : null}
          {canEdit ? (
            <InputGroupInput
              type="number"
              inputMode="decimal"
              value={val}
              min={field?.min}
              step={field?.step}
              onChange={(e) => setVal(e.target.value)}
              disabled={pending}
            />
          ) : (
            <InputGroupInput value={displayValue ?? kindLabel} readOnly disabled />
          )}
          {canEdit && trailingText ? (
            <InputGroupAddon align="inline-end">
              <InputGroupText>{trailingText}</InputGroupText>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>

      {/* On fire — Trigger Tactical Run (agent decides) vs Automatically
          Exit (no agent; still approval-gated). EXIT triggers on a held
          position only. */}
      {showFireMode ? (
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            On fire
          </span>
          <Select
            value={fireMode}
            onValueChange={(v) => void setFireMode(v as "TACTICAL" | "DIRECT")}
            disabled={pending}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue>{fireModeLabel(fireMode, trigger.action)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TACTICAL">
                {fireModeLabel("TACTICAL", trigger.action)}
              </SelectItem>
              <SelectItem value="DIRECT">
                {fireModeLabel("DIRECT", trigger.action)}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {/* One-paragraph explainer: what it does (foreground) + the writer's
          rationale (muted), flowing together. */}
      <p className="text-xs leading-relaxed">
        <span className="text-foreground">
          {predicateDescription(trigger.predicate)}
        </span>
        {trigger.rationale ? (
          <span className="text-muted-foreground"> {trigger.rationale}</span>
        ) : null}
      </p>

      {/* Last fired — plain text, only when it has fired (a badge here grew
          too wide next to the cooldown + delete chips). */}
      {trigger.lastFiredAt ? (
        <p className="text-xs text-muted-foreground">
          Fired {fmtFiredAt(trigger.lastFiredAt)}
        </p>
      ) : null}

      {/* Chips — cooldown + delete (icon only). */}
      {trigger.cooldownDays || editable ? (
        <div className="flex items-center gap-1.5">
          {trigger.cooldownDays ? (
            <Badge variant="secondary">
              <Clock className="size-3" />
              {trigger.cooldownDays}d cooldown
            </Badge>
          ) : null}
          {editable ? (
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto"
              onClick={() => void remove()}
              disabled={pending}
              aria-label="Remove trigger"
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}

      {err ? <p className="text-xs text-destructive">{err}</p> : null}

      {/* Save / Cancel — only once the value is changed. */}
      {dirty ? (
        <div className="flex justify-end gap-2">
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
// A ghost "+" that opens a Dialog (modal — safer than a popover on mobile)
// mirroring the Price-alert modal:
//   • Action      — Enter / Exit / Review / …
//   • Criterion   — Target Price (a fixed $ level) | Movement Amount (a % move)
//                   | Gain from entry (± % vs avg cost) | Trailing from high
//                   (% give-back off the peak) — the last two on HELD only
//   • Direction   — above/below (price)  ·  up/down (movement, gain)
//   • Value       — $ level  ·  % move
//   • On fire     — tactical vs direct (held EXIT only)
// Target Price → PRICE_ABOVE / PRICE_BELOW (fires at a level).
// Movement Amount → PRICE_MOVE_PCT (fires on a ±% DAILY move vs prior close).
// Gain from entry → GAIN_FROM_ENTRY (cumulative ±% vs the position's avgCost).
// Trailing from high → TRAILING_FROM_HIGH (give-back % off Position.peakPrice;
//   no direction — orientation follows the thesis direction).
// The position-scoped kinds (gain / trail) evaluate false with no open
// position, so the form only offers them when the thesis is HOLDING —
// applyTriggerAdd rejects them un-held as the backend backstop.
// All fire through the same evaluator → trigger pipeline as every trigger.

type AddCriterion = "PRICE" | "MOVE" | "GAIN" | "TRAIL";

function AddTriggerDialog({
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
  const [criterion, setCriterion] = useState<AddCriterion>("PRICE");
  const [dir, setDir] = useState<string>("BELOW"); // ABOVE/BELOW · UP/DOWN
  const [val, setVal] = useState("");
  const [fireMode, setFireMode] = useState<"TACTICAL" | "DIRECT">("DIRECT");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isMove = criterion === "MOVE";
  const isGain = criterion === "GAIN";
  const isTrail = criterion === "TRAIL";
  /** %-valued criteria share the % input adornment + 0.5 step. */
  const isPct = isMove || isGain || isTrail;
  const showFireMode = action === "EXIT" && held;

  // Criterion options — the position-scoped kinds (gain from entry, trailing
  // from high) only exist on a held thesis (no position → the predicate
  // evaluates false forever), so un-held keeps the original two.
  const criterionOptions: ReadonlyArray<{ v: AddCriterion; l: string }> = held
    ? [
        { v: "PRICE", l: "$ Price" },
        { v: "MOVE", l: "% Move" },
        { v: "GAIN", l: "% Gain" },
        { v: "TRAIL", l: "% Trail" },
      ]
    : [
        { v: "PRICE", l: "$ Price" },
        { v: "MOVE", l: "% Movement" },
      ];

  const dirOptions =
    isMove || isGain
      ? [
          { v: "UP", l: "Up" },
          { v: "DOWN", l: "Down" },
        ]
      : [
          { v: "ABOVE", l: "Above" },
          { v: "BELOW", l: "Below" },
        ];

  // Keep `dir` valid for the selected criterion (price uses ABOVE/BELOW,
  // movement/gain use UP/DOWN — gain defaults UP, the milestone case).
  // Reset to a sensible default on criterion switch. TRAIL has no direction.
  useEffect(() => {
    if (criterion === "GAIN") setDir("UP");
    else if (criterion === "MOVE") setDir("DOWN");
    else if (criterion === "PRICE") setDir("BELOW");
  }, [criterion]);

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
    // Daily-move and trail are give-back/-move fractions — ≥100% is nonsense.
    // Gain from entry CAN exceed 100 (up 150% from entry is a real milestone).
    (!(isMove || isTrail) || num < 100) &&
    // Zod floors the trail at 1% (sub-1% off the peak re-fires on noise).
    (!isTrail || num >= 1);

  async function save() {
    if (!valid) return;
    setPending(true);
    setErr(null);
    const predicate = isGain
      ? { kind: "GAIN_FROM_ENTRY", pct: num, direction: dir }
      : isTrail
        ? { kind: "TRAILING_FROM_HIGH", pct: num }
        : isMove
          ? { kind: "PRICE_MOVE_PCT", pct: num, direction: dir, window: "1D" }
          : { kind: dir === "ABOVE" ? "PRICE_ABOVE" : "PRICE_BELOW", level: num };
    try {
      const res = await fetch(`/api/theses/${thesisId}/triggers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          predicate,
          // Only send fireMode when the control was actually shown (held EXIT) —
          // don't post a DIRECT the user never saw. Backend still coerces, but
          // the request should match the UI.
          fireMode: showFireMode ? fireMode : undefined,
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Plus className="size-3" />
            Add trigger
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add trigger</DialogTitle>
        </DialogHeader>
        <div className="space-y-2.5">
        {/* Action — full width */}
        <div className="space-y-1">
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
            <SelectTrigger className="w-full">
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

        {/* Criterion — full-width segmented tabs (graph date-range style) */}
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Criterion
          </span>
          <div className="flex items-center gap-0.5 rounded-md border p-0.5">
            {criterionOptions.map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setCriterion(o.v)}
                disabled={pending}
                className={cn(
                  "flex-1 rounded px-2 py-1 text-xs transition-colors",
                  criterion === o.v
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>

        {/* Direction select + value input as one full-width button group:
            [ Above ▾ | $ ____ ]  ·  [ Up ▾ | ____ % ]. Trailing from high
            has no direction (orientation follows the thesis direction), so
            the group collapses to the % input alone. */}
        <ButtonGroup className="w-full">
          {isTrail ? null : (
            <Select
              value={dir}
              onValueChange={(v) => {
                if (typeof v === "string") setDir(v);
              }}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue>
                  {dirOptions.find((o) => o.v === dir)?.l ?? ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {dirOptions.map((o) => (
                  <SelectItem key={o.v} value={o.v}>
                    {o.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <InputGroup>
            {isPct ? null : (
              <InputGroupAddon>
                <InputGroupText>$</InputGroupText>
              </InputGroupAddon>
            )}
            <InputGroupInput
              type="number"
              inputMode="decimal"
              value={val}
              min={isTrail ? 1 : 0}
              step={isPct ? 0.5 : 0.01}
              placeholder={isTrail ? "8" : isGain ? "10" : isMove ? "5" : "0.00"}
              onChange={(e) => setVal(e.target.value)}
              disabled={pending}
            />
            {isPct ? (
              <InputGroupAddon align="inline-end">
                <InputGroupText>%</InputGroupText>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </ButtonGroup>

        <p className="text-xs text-muted-foreground">
          {isGain
            ? `Fires when the position is ${dir === "UP" ? "up" : "down"} this much from entry (avg cost) — cumulative, not a single day.`
            : isTrail
              ? "Fires when price gives back this much from its high since entry. The high ratchets up as the position runs."
              : isMove
                ? `Fires when the stock is ${dir === "UP" ? "up" : "down"} this much on the day (vs prior close).`
                : `Fires when the last quote crosses ${dir === "ABOVE" ? "above" : "below"} your price.`}
        </p>

        {/* On fire (held EXIT only) — full width, our verbs */}
        {showFireMode ? (
          <div className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              On fire
            </span>
            <Select
              value={fireMode}
              onValueChange={(v) => setFireMode(v as "TACTICAL" | "DIRECT")}
              disabled={pending}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{fireModeLabel(fireMode, action)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TACTICAL">
                  {fireModeLabel("TACTICAL", action)}
                </SelectItem>
                <SelectItem value="DIRECT">
                  {fireModeLabel("DIRECT", action)}
                </SelectItem>
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
        </div>
      </DialogContent>
    </Dialog>
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
  /**
   * When true, show ONLY the inline-editable triggers (price levels + % moves)
   * and hide the rest (earnings / filing / time / signal). Used in compact
   * contexts like the reject dialog where the read-only triggers are just
   * noise. Add-trigger still works (it only mints price/% anyway).
   */
  editableOnly?: boolean;
  /**
   * Bump to force a refetch in self-fetch mode (no `data` prop) — e.g. after an
   * inline edit. Keeps the current list visible during the refetch (no remount
   * flash), unlike a `key` change. Ignored when `data` is controlled.
   */
  refreshKey?: number;
  /** Called after a successful trigger-value edit so the parent can refresh. */
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
  }, [thesisId, dataProp, refreshKey]);

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

  // In editableOnly mode, show just the price-level + % triggers (the ones
  // that actually have an inline-editable value); hide read-only kinds.
  const shownTriggers = editableOnly
    ? data.triggers.filter(
        (t) =>
          editableTriggerField(
            t.predicate as unknown as SharedTriggerPredicate,
          ) != null,
      )
    : data.triggers;

  return (
    <div className="space-y-2">
      {shownTriggers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {editableOnly
            ? "No price or % triggers yet. Add one below."
            : editable
              ? "No triggers attached. Add one below, or set a horizon when minting to auto-attach the baseline."
              : "No triggers attached. Set a horizon when minting this thesis to auto-attach the baseline."}
        </p>
      ) : (
        <TriggerGroups
          triggers={shownTriggers}
          thesisId={thesisId}
          direction={direction}
          editable={editable}
          held={held}
          onChanged={onChanged}
        />
      )}
      {editable ? (
        <AddTriggerDialog thesisId={thesisId} held={held} onChanged={onChanged} />
      ) : null}
    </div>
  );
}
