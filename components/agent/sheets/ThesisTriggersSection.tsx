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
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/info-row";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { InboxUnreadIcon } from "@hugeicons/core-free-icons";
import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";

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
  closedAt: string | null;
  closeReason: string | null;
  invalidatedAt: string | null;
  invalidReason: string | null;
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
  actionLabel as sharedActionLabel,
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

function actionLabel(action: string): string {
  // Shared module returns lowercase verb phrases; capitalize for pill display.
  const phrase = sharedActionLabel(action);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

// ── Horizon descriptions ────────────────────────────────────────────────
// One-liner exit policy per horizon. Sourced from the schema comment in
// prisma/schema.prisma:159-164 — keep in sync if the comments change.
// Surfaces below the Horizon row in the Schedule section so the reader
// doesn't need to know the enum semantics.

const HORIZON_DESCRIPTIONS: Record<string, string> = {
  CATALYST:
    "Exit on the catalyst event (good or bad), or 30 days past the catalyst date.",
  TARGET:
    "Open-ended hold. Exit only at target, stop, or thesis invalidation.",
  TRADE:
    "Bounded short-term trade. Exit on stop, target, or maxHoldDays reached.",
  COMPOUNDER:
    "Multi-year hold. Exits only when invalidation triggers fire — never auto-exits on time.",
};

// ── Date formatters ─────────────────────────────────────────────────────

function fmtRelativeOrDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = Date.now();
  const diffDays = Math.round((date.getTime() - now) / 86_400_000);
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (diffDays === 0) return `${dateStr} (today)`;
  if (diffDays > 0) return `${dateStr} (in ${diffDays}d)`;
  return `${dateStr} (${Math.abs(diffDays)}d ago)`;
}

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
  firing,
  onTestFire,
}: {
  trigger: Trigger;
  firing: boolean;
  onTestFire: () => void;
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
        firing={firing}
        onTestFire={onTestFire}
      />
    </Popover>
  );
}

function TriggerPopoverContent({
  trigger,
  firing,
  onTestFire,
}: {
  trigger: Trigger;
  firing: boolean;
  onTestFire: () => void;
}) {
  return (
    <PopoverContent side="left" align="start" className="w-72 p-0">
      {/* Plain title — kind + value as a single sentence, lives at the
          same indent as the body text. Replaces the 2-cell grid header
          that mirrored the pill (2026-05-20) — too much visual weight
          for what's really just a heading. */}
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <p className="text-sm font-medium text-foreground">
          {predicateSentence(trigger.predicate)}
        </p>
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
          <span>Action</span>
          <span className="text-foreground">
            {actionLabel(trigger.action)}
          </span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
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

        <Button
          size="sm"
          variant="outline"
          onClick={onTestFire}
          disabled={firing}
          className="w-full"
        >
          <Zap className="size-3" />
          {firing ? "Firing…" : "Test fire"}
        </Button>
      </div>
    </PopoverContent>
  );
}

// ── Trigger grouping ────────────────────────────────────────────────────
// Triggers are grouped by intent so the eye reads the trigger pile as a
// status board, not a flat chip cloud:
//   EXIT IF    — terminal actions that close the position
//   ENTER IF   — actions that open or scale into a position
//   REVIEW IF  — re-evaluate triggers (the agent looks again, decides)
//
// Action → group mapping:
//   EXIT, TRIM       → EXIT IF
//   ADD              → ENTER IF
//   MOVE_STOP, REVIEW (default) → REVIEW IF
//
// NOTE on watching-vs-held trigger semantics: the current
// `triggers/defaults.ts` templates assume a held position and emit
// EXIT triggers for stop-loss. For a WATCHING (non-held) thesis,
// EXIT triggers don't make sense — there's nothing to exit. The right
// shape for a watching/LONG thesis is ENTER triggers (PRICE_ABOVE
// breakout level → review for INITIATE). Until that backend fix lands,
// the grouping below shows the templates as written, including any
// EXIT triggers on watching theses. See docs/SESSION_AUDIT_2026_05_06.md.

const TRIGGER_GROUPS: ReadonlyArray<{
  key: "EXIT" | "ENTER" | "REVIEW";
  label: string;
  actions: ReadonlySet<string>;
}> = [
  {
    key: "ENTER",
    label: "Enter if",
    actions: new Set(["ENTER", "ADD"]),
  },
  {
    key: "EXIT",
    label: "Exit if",
    actions: new Set(["EXIT", "TRIM"]),
  },
  {
    key: "REVIEW",
    label: "Review if",
    actions: new Set(["REVIEW", "MOVE_STOP"]),
  },
];

function groupOf(action: string): "EXIT" | "ENTER" | "REVIEW" {
  for (const g of TRIGGER_GROUPS) {
    if (g.actions.has(action)) return g.key;
  }
  return "REVIEW";
}

function TriggerGroups({
  triggers,
  firing,
  onTestFire,
}: {
  triggers: Trigger[];
  firing: string | null;
  onTestFire: (id: string) => void;
}) {
  const grouped = new Map<"EXIT" | "ENTER" | "REVIEW", Trigger[]>();
  for (const t of triggers) {
    const k = groupOf(t.action);
    const arr = grouped.get(k) ?? [];
    arr.push(t);
    grouped.set(k, arr);
  }

  return (
    <div className="space-y-3">
      {TRIGGER_GROUPS.map(({ key, label }) => {
        const items = grouped.get(key) ?? [];
        if (items.length === 0) return null;
        return (
          <div key={key} className="space-y-1.5">
            <p className="text-sm text-muted-foreground">{label}</p>
            <div className="flex flex-wrap gap-1.5">
              {items.map((t) => (
                <TriggerPill
                  key={t.id}
                  trigger={t}
                  firing={firing === t.id}
                  onTestFire={() => onTestFire(t.id)}
                />
              ))}
            </div>
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
  const router = useRouter();
  const [internalData, setInternalData] = useState<TriggersResponse | null>(
    null,
  );
  const data = dataProp !== undefined ? dataProp : internalData;
  const [error, setError] = useState<string | null>(null);
  const [firing, setFiring] = useState<string | null>(null);
  const [fireError, setFireError] = useState<string | null>(null);
  const [fireQueued, setFireQueued] = useState<string | null>(null);

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

  async function testFire(triggerId: string) {
    setFireError(null);
    setFireQueued(null);
    setFiring(triggerId);
    try {
      const r = await fetch(`/api/admin/triggers/fire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thesisId, triggerId }),
      });
      // 202 = event dispatched but tactical-run hasn't landed in time.
      // Treat as success — the run will appear in /runs shortly.
      if (!r.ok && r.status !== 202) {
        const body = await r.text();
        throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      const out = (await r.json()) as {
        runId?: string | null;
        queued?: boolean;
      };
      if (out.runId) {
        router.push(`/runs/${out.runId}`);
      } else if (out.queued) {
        setFireQueued(
          "Trigger fired. The tactical run is queued — it will appear in your runs list in a few seconds.",
        );
      }
    } catch (e) {
      setFireError(e instanceof Error ? e.message : String(e));
    } finally {
      setFiring(null);
    }
  }

  if (error) {
    return (
      <div className="space-y-2">
        <SectionHeader icon={<HugeiconsIcon icon={InboxUnreadIcon} className="size-4 text-foreground" />}>
          Triggers
        </SectionHeader>
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t load triggers: {error}
        </p>
      </div>
    );
  }

  if (data == null) {
    return (
      <div className="space-y-2">
        <SectionHeader icon={<HugeiconsIcon icon={InboxUnreadIcon} className="size-4 text-foreground" />}>
          Triggers
        </SectionHeader>
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const hasSchedule =
    data.horizon != null ||
    data.nextReviewAt != null ||
    data.targetSizePct != null ||
    data.catalystDate != null ||
    data.maxHoldDays != null;

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <SectionHeader
          icon={<HugeiconsIcon icon={InboxUnreadIcon} className="size-4 text-foreground" />}
          count={data.triggers.length}
        >
          Triggers
        </SectionHeader>
        {data.triggers.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No triggers attached. Set a horizon when minting this thesis to
            auto-attach the baseline.
          </p>
        ) : (
          <TriggerGroups
            triggers={data.triggers}
            firing={firing}
            onTestFire={testFire}
          />
        )}
        {fireError ? (
          <p className="text-xs text-red-500">Test fire failed: {fireError}</p>
        ) : null}
        {fireQueued ? (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{fireQueued}</span>
            <button
              type="button"
              onClick={() => router.push("/runs")}
              className="shrink-0 text-foreground underline-offset-2 hover:underline"
            >
              Open runs →
            </button>
          </div>
        ) : null}
      </div>

      {hasSchedule ? (
        <div className="space-y-2">
          {/* "Schedule" SectionHeader removed 2026-05-19 — the InfoRows
              are self-evident (Horizon, Next review, Target size, etc.)
              and the explicit section label was visual noise. */}
          <div className="flex flex-col gap-1">
            {data.horizon ? (
              <InfoRow
                label="Horizon"
                value={data.horizon}
                description={HORIZON_DESCRIPTIONS[data.horizon] ?? undefined}
              />
            ) : null}
            {data.nextReviewAt ? (
              <InfoRow
                label="Next review"
                value={fmtRelativeOrDate(data.nextReviewAt)}
                mono
              />
            ) : null}
            {data.targetSizePct != null ? (
              <InfoRow
                label="Target size"
                value={`${data.targetSizePct}% of portfolio`}
                mono
              />
            ) : null}
            {data.catalystDate ? (
              <InfoRow
                label="Catalyst date"
                value={fmtRelativeOrDate(data.catalystDate)}
                mono
              />
            ) : null}
            {data.maxHoldDays != null ? (
              <InfoRow
                label="Max hold"
                value={`${data.maxHoldDays} days`}
                mono
                border={false}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────────

function SectionHeader({
  icon,
  count,
  children,
}: {
  icon?: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  // Unified with the ThesisSheet's other section headers (2026-05-19) —
  // xs-uppercase-tracking eyebrow pattern shared across the app.
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <p className="text-xs font-mono uppercase tracking-wide">{children}</p>
      {count != null ? (
        <span className="text-xs tabular-nums">{count}</span>
      ) : null}
    </div>
  );
}
