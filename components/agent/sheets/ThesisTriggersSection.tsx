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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoRow } from "@/components/ui/info-row";
import { ButtonGroup, ButtonGroupSeparator } from "@/components/ui/button-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Clock,
  DoorOpen,
  Eye,
  FileText,
  GitBranch,
  LineChart,
  Minus,
  Newspaper,
  Plus,
  Shield,
  TrendingDown,
  TrendingUp,
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

interface TriggersResponse {
  horizon: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
  targetSizePct: number | null;
  catalystDate: string | null;
  maxHoldDays: number | null;
  nextReviewAt: string | null;
  triggers: Trigger[];
}

// ── Predicate helpers ──────────────────────────────────────────────────
// Each trigger has ONE type icon + a human-readable type label + a value.
// Type label is what the predicate IS ("Price below", "Earnings miss",
// "Filing"). Value is the parameter ("$88", "≥3%", "8-K"). Uppercase
// PREDICATE_KINDS never reach the user.

function PredicateIcon({
  kind,
  className,
}: {
  kind: string;
  className?: string;
}) {
  const cls = className ?? "size-3.5";
  switch (kind) {
    case "PRICE_BELOW":
      return <ArrowDown className={cls} />;
    case "PRICE_ABOVE":
      return <ArrowUp className={cls} />;
    case "PRICE_MOVE_PCT":
      return <Activity className={cls} />;
    case "VS_SMA":
      return <LineChart className={cls} />;
    case "RSI":
      return <Activity className={cls} />;
    case "SIGNAL_TYPE":
      return <Newspaper className={cls} />;
    case "EARNINGS_BEAT":
      return <TrendingUp className={cls} />;
    case "EARNINGS_MISS":
      return <TrendingDown className={cls} />;
    case "GUIDANCE_CHANGE":
      return <AlertTriangle className={cls} />;
    case "FILING":
      return <FileText className={cls} />;
    case "TIME_ELAPSED":
      return <Clock className={cls} />;
    case "REVIEW_DATE_HIT":
      return <CalendarClock className={cls} />;
    case "AND":
    case "OR":
      return <GitBranch className={cls} />;
    default:
      return <Zap className={cls} />;
  }
}

/** Human-readable type label — the LEFT side of the pill. Sentence case, no SCREAMING_CASE. */
function predicateTypeLabel(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_BELOW":
      return "Price below";
    case "PRICE_ABOVE":
      return "Price above";
    case "PRICE_MOVE_PCT":
      return `Price move ${p.window ?? ""}`.trim();
    case "VS_SMA":
      return `${p.period}-day SMA`;
    case "RSI":
      return "RSI";
    case "SIGNAL_TYPE":
      return p.signalType
        ? `${p.signalType[0]}${p.signalType.slice(1).toLowerCase()}`
        : "Signal";
    case "EARNINGS_BEAT":
      return "Earnings beat";
    case "EARNINGS_MISS":
      return "Earnings miss";
    case "GUIDANCE_CHANGE":
      return "Guidance";
    case "FILING":
      return "Filing";
    case "TIME_ELAPSED":
      return "Time elapsed";
    case "REVIEW_DATE_HIT":
      return "Review due";
    case "AND":
      return "All of";
    case "OR":
      return "Any of";
    default:
      return p.kind;
  }
}

/** The value/parameter — RIGHT side of the pill. Light font. */
function predicateValue(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_BELOW":
    case "PRICE_ABOVE":
      return `$${p.level}`;
    case "PRICE_MOVE_PCT":
      return `${p.direction === "UP" ? "+" : "−"}${p.pct}%`;
    case "VS_SMA":
      return p.direction?.toLowerCase() ?? "";
    case "RSI":
      return `${p.direction?.toLowerCase()} ${p.threshold}`;
    case "SIGNAL_TYPE": {
      const parts: string[] = [];
      if (p.sentiment) parts.push(p.sentiment.toLowerCase());
      if (p.minUrgency) parts.push(`≥${p.minUrgency.toLowerCase()}`);
      return parts.join(" · ") || "any";
    }
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
      return p.minSurprisePct ? `≥${p.minSurprisePct}%` : "any";
    case "GUIDANCE_CHANGE":
      return p.direction?.toLowerCase() ?? "";
    case "FILING":
      return p.formType ?? "";
    case "TIME_ELAPSED":
      return `${p.days}d`;
    case "REVIEW_DATE_HIT":
      return "—";
    case "AND":
    case "OR":
      return `${(p.predicates ?? []).length}`;
    default:
      return "";
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

function actionDotClass(action: string): string {
  switch (action) {
    case "EXIT":
      return "bg-red-500";
    case "ADD":
      return "bg-emerald-500";
    case "TRIM":
      return "bg-amber-500";
    case "MOVE_STOP":
      return "bg-blue-500";
    case "REVIEW":
    default:
      return "bg-muted-foreground/60";
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case "EXIT":
      return "Exit position";
    case "ADD":
      return "Scale in";
    case "TRIM":
      return "Trim position";
    case "MOVE_STOP":
      return "Move stop";
    case "REVIEW":
    default:
      return "Review";
  }
}

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

// ── Trigger pill (ButtonGroup + Popover) ────────────────────────────────
// Structure:
//   [ icon · Type label ] | [ value ]
//
// Both halves use the same `secondary` ButtonGroupText background — the
// ButtonGroupSeparator is a clean full-height divider, no floating bar
// effect. Type label uses medium weight, value uses regular. Action
// (EXIT / REVIEW / ADD / etc.) lives only in the popover.

function TriggerPill({
  trigger,
  firing,
  onTestFire,
}: {
  trigger: Trigger;
  firing: boolean;
  onTestFire: () => void;
}) {
  const value = predicateValue(trigger.predicate);
  return (
    <Popover>
      <PopoverTrigger
        render={<ButtonGroup className="cursor-pointer" />}
      >
        <Badge
          variant="secondary"
          className="rounded-r-none gap-1.5 font-medium"
        >
          <PredicateIcon
            kind={trigger.predicate.kind}
            className="size-3 text-muted-foreground"
          />
          {predicateTypeLabel(trigger.predicate)}
        </Badge>
        {value ? (
          <>
            <ButtonGroupSeparator />
            <Badge
              variant="secondary"
              className="rounded-l-none font-normal text-muted-foreground tabular-nums"
            >
              {value}
            </Badge>
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-72 space-y-3">
        {/* Header — type label + value, just like the pill */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-sm">
            <PredicateIcon
              kind={trigger.predicate.kind}
              className="size-4 text-muted-foreground"
            />
            <span className="font-medium">
              {predicateTypeLabel(trigger.predicate)}
            </span>
            {value ? (
              <span className="text-muted-foreground tabular-nums ml-auto">
                {value}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {predicateDescription(trigger.predicate)}
          </p>
        </div>

        {/* Action row — what happens when this fires */}
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-2">
          <span
            className={cn(
              "size-1.5 rounded-full shrink-0",
              actionDotClass(trigger.action),
            )}
          />
          <ActionIcon
            action={trigger.action}
            className="size-3.5 text-muted-foreground"
          />
          <span className="text-xs font-medium">
            {actionLabel(trigger.action)}
          </span>
        </div>

        {trigger.rationale ? (
          <p className="text-xs leading-relaxed">{trigger.rationale}</p>
        ) : null}

        <Separator />

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
          <span className="text-muted-foreground">Last fired</span>
          <span className="text-foreground tabular-nums text-right">
            {fmtFiredAt(trigger.lastFiredAt)}
          </span>
          {trigger.cooldownDays ? (
            <>
              <span className="text-muted-foreground">Cooldown</span>
              <span className="text-foreground tabular-nums text-right">
                {trigger.cooldownDays}d
              </span>
            </>
          ) : null}
        </div>

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
      </PopoverContent>
    </Popover>
  );
}

// ── Main section ────────────────────────────────────────────────────────

interface Props {
  thesisId: string;
}

export function ThesisTriggersSection({ thesisId }: Props) {
  const router = useRouter();
  const [data, setData] = useState<TriggersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [firing, setFiring] = useState<string | null>(null);
  const [fireError, setFireError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/theses/${thesisId}/triggers`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = (await r.json()) as TriggersResponse;
        if (!cancelled) setData(json);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [thesisId]);

  async function testFire(triggerId: string) {
    setFireError(null);
    setFiring(triggerId);
    try {
      const r = await fetch(`/api/admin/triggers/fire`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ thesisId, triggerId }),
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      const out = (await r.json()) as { runId?: string };
      if (out.runId) {
        router.push(`/runs/${out.runId}`);
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
        <SectionHeader icon={<Zap className="size-4 text-muted-foreground" />}>
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
        <SectionHeader icon={<Zap className="size-4 text-muted-foreground" />}>
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
          icon={<Zap className="size-4 text-muted-foreground" />}
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
          <div className="flex flex-wrap gap-1.5">
            {data.triggers.map((t) => (
              <TriggerPill
                key={t.id}
                trigger={t}
                firing={firing === t.id}
                onTestFire={() => testFire(t.id)}
              />
            ))}
          </div>
        )}
        {fireError ? (
          <p className="text-xs text-red-500">Test fire failed: {fireError}</p>
        ) : null}
      </div>

      {hasSchedule ? (
        <div className="space-y-2">
          <SectionHeader>Schedule</SectionHeader>
          <div className="flex flex-col gap-1">
            {data.horizon ? (
              <InfoRow label="Horizon" value={data.horizon} />
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
