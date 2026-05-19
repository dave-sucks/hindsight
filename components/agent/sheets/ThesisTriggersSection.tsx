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
import {
  DoorOpen,
  Eye,
  LogIn,
  Minus,
  Plus,
  Shield,
  Zap,
} from "lucide-react";
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

export interface ThesisStatePosition {
  quantity: number;
  avgCost: number;
  openedAt: string;
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
  daysHeld: number;
}

export interface ThesisStateRecentFire {
  id: string;
  timestamp: string;
  summary: string;
  rationale: string | null;
  triggerId: string | null;
  runId: string | null;
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
  recentFire: ThesisStateRecentFire | null;
  // Structural belief — load-bearing fields the trade-evaluator + tactical
  // agent read. Surfaced to the sheet so the user can see what the agent
  // actually committed to (vs the prose-layer thesisBullets / riskFlags).
  coreBelief: string | null;
  keyAssumptions: string[];
  invalidationConds: string[];
  // 4-dim composite scoring + the /10 sum. Present on rows minted with the
  // post-2026-04-25 scoring rubric; null on older rows.
  scoring: ThesisScoring | null;
  scoringComposite: number | null;
  // Deep-research synthesis (THESIS_RESEARCH_V2 Phase 1). Null on legacy
  // rows + on every row minted before the thesis-writer agent ships. Shape
  // is intentionally loose — sections keyed by name with `text + citations`
  // OR `bullets[]` content. The accordion renderer walks whatever keys it
  // finds and skips any it doesn't recognize.
  researchSections: ThesisResearchSections | null;
  researchUpdatedAt: string | null;
  // Phase 1.5 (PR-6) — surfaced so the sheet can render them.
  // confidenceScore is the analyst's overall 0-100 trade conviction;
  // distinct from scoring.composite (which is the 4-dim setup grade).
  // Both gate `place_trade`. Phase 2 collapses these onto one number.
  confidenceScore: number;
  // Provenance: where the thesis came from + the analyst's one-line
  // rationale + the Signal rows that informed it.
  sourceKind: string | null;
  sourceRationale: string | null;
  sourceSignalIds: string[];
  // Analyst-cited sources (web URLs / reports) — mirrors the favicon
  // strip on `/stocks/[symbol]`. Distinct from researchSections.citations
  // which are per-section inline citations from the V2 deep-research
  // synthesis model.
  sourcesUsed: ThesisSourcesUsed;
  // Direction-flip chain pointer. When non-null, this thesis supersedes
  // an earlier thesis on the same ticker; renders as a "Replaces #abc"
  // chip near the StatusPill.
  parentThesisId: string | null;
  // Live quote from the API call — drives the price header below the
  // company name. Null when the quote feed couldn't resolve.
  currentPrice: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
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

// ── Action helpers ──────────────────────────────────────────────────────
// Action is what the trigger DOES when it fires — EXIT, REVIEW, ADD,
// TRIM, MOVE_STOP. It does NOT belong on the pill (pill describes the
// WHEN, not the WHAT). Action surfaces in the popover only. The dot
// color in the popover header carries the visual signal.

function ActionIcon({
  action,
  className,
}: {
  action: string;
  className?: string;
}) {
  const cls = className ?? "size-3.5";
  switch (action) {
    case "EXIT":
      return <DoorOpen className={cls} />;
    case "ENTER":
      return <LogIn className={cls} />;
    case "ADD":
      return <Plus className={cls} />;
    case "TRIM":
      return <Minus className={cls} />;
    case "MOVE_STOP":
      return <Shield className={cls} />;
    case "REVIEW":
    default:
      return <Eye className={cls} />;
  }
}

function actionTintClass(action: string): string {
  switch (action) {
    case "EXIT":
      return "bg-red-500/10 text-red-500";
    case "ENTER":
      return "bg-emerald-500/10 text-emerald-500";
    case "ADD":
      return "bg-emerald-500/10 text-emerald-500";
    case "TRIM":
      return "bg-amber-500/10 text-amber-500";
    case "MOVE_STOP":
      return "bg-blue-500/10 text-blue-500";
    case "REVIEW":
    default:
      return "bg-muted text-muted-foreground";
  }
}

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
// Structure:  [ action icon ] │ [ predicate sentence ]
//
// One outer rounded outline. The divider is `border-r` on cell 1 — real
// border, no floating separator. Cell 2 is plain foreground text reading
// like a sentence ("Price below $88"). Action color comes from the
// tinted background on cell 1.

function TriggerPill({
  trigger,
  firing,
  onTestFire,
}: {
  trigger: Trigger;
  firing: boolean;
  onTestFire: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            className="inline-flex h-8 cursor-pointer items-stretch overflow-hidden rounded-md border border-border bg-background text-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {/* Cell 1 — action icon, tinted bg, real right border as divider */}
        <div
          className={cn(
            "flex items-center justify-center border-r border-border px-2",
            actionTintClass(trigger.action),
          )}
        >
          <ActionIcon action={trigger.action} className="size-4" />
        </div>

        {/* Cell 2 — readable sentence in foreground */}
        <div className="flex items-center px-3 text-foreground">
          {predicateSentence(trigger.predicate)}
        </div>
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
      {/* Header — same shape as the pill, scaled up */}
      <div className="flex items-stretch border-b border-border">
        <div
          className={cn(
            "flex items-center justify-center border-r border-border px-3",
            actionTintClass(trigger.action),
          )}
        >
          <ActionIcon action={trigger.action} className="size-4" />
        </div>
        <div className="flex flex-1 items-center px-3 py-2 text-sm font-medium">
          {predicateSentence(trigger.predicate)}
        </div>
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
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
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
          <SectionHeader>Schedule</SectionHeader>
          <div className="flex flex-col gap-1">
            {data.horizon ? (
              <>
                <InfoRow label="Horizon" value={data.horizon} />
                {HORIZON_DESCRIPTIONS[data.horizon] ? (
                  <p className="text-xs text-muted-foreground leading-relaxed -mt-1 pb-1">
                    {HORIZON_DESCRIPTIONS[data.horizon]}
                  </p>
                ) : null}
              </>
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
  return (
    <div className="flex items-center gap-2">
      {icon}
      <p className="text-sm font-medium">{children}</p>
      {count != null ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}
        </span>
      ) : null}
    </div>
  );
}
