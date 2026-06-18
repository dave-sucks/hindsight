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
  predicates?: TriggerPredicate[];
}

interface Trigger {
  id: string;
  predicate: TriggerPredicate;
  action: string;
  rationale: string;
  cooldownDays?: number;
  lastFiredAt?: string;
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
} from "@/lib/agent/triggers/format";
import type { TriggerPredicate as SharedTriggerPredicate } from "@/lib/agent/triggers/types";

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

function TriggerPill({ trigger }: { trigger: Trigger }) {
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

      <TriggerPopoverContent trigger={trigger} />
    </Popover>
  );
}

function TriggerPopoverContent({
  trigger,
}: {
  trigger: Trigger;
}) {
  // Title now includes the action verb so the reader gets the full
  // "what fires + what we do" in one line: "Buy if price above $178",
  // "Exit if price below $14.50", "Review if 7 days elapsed".
  const titleSentence = `${actionGroupLabel(trigger.action)} ${predicateSentence(
    trigger.predicate,
  ).toLowerCase()}`;
  return (
    <PopoverContent side="left" align="start" className="w-72 p-0">
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <p className="text-sm font-medium text-foreground">{titleSentence}</p>
      </div>

      <div className="space-y-3 p-3 text-xs">
        <div className="space-y-1">
          <p className="text-muted-foreground">
            {predicateDescription(trigger.predicate)}
          </p>
          {trigger.rationale ? (
            <p className="text-foreground leading-relaxed">
              {trigger.rationale}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between text-muted-foreground border-t border-border pt-3">
          <span>Last fired</span>
          <span className="text-foreground tabular-nums">
            {fmtFiredAt(trigger.lastFiredAt)}
          </span>
        </div>
        {trigger.cooldownDays ? (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Cooldown</span>
            <span className="text-foreground tabular-nums">
              {trigger.cooldownDays}d
            </span>
          </div>
        ) : null}
      </div>
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

function TriggerGroups({ triggers }: { triggers: Trigger[] }) {
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
              <TriggerPill key={t.id} trigger={t} />
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
  /** Pre-fetched response. When omitted, the section fetches itself. */
  data?: TriggersResponse | null;
}

export function ThesisTriggersSection({ thesisId, data: dataProp }: Props) {
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

  if (data.triggers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No triggers attached. Set a horizon when minting this thesis to
        auto-attach the baseline.
      </p>
    );
  }

  return <TriggerGroups triggers={data.triggers} />;
}
