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
// Single sentence per predicate — the right cell is just plain readable
// text in foreground. No SCREAMING_CASE reaches the user.

/** The full readable sentence for a predicate, e.g. "Price below $88". */
function predicateSentence(p: TriggerPredicate): string {
  switch (p.kind) {
    case "PRICE_BELOW":
      return `Price below $${p.level}`;
    case "PRICE_ABOVE":
      return `Price above $${p.level}`;
    case "PRICE_MOVE_PCT":
      return `Price ${p.direction === "UP" ? "up" : "down"} ${p.pct}% over ${p.window}`;
    case "VS_SMA":
      return `Price ${p.direction?.toLowerCase()} ${p.period}-day SMA`;
    case "RSI":
      return `RSI ${p.direction?.toLowerCase()} ${p.threshold}`;
    case "SIGNAL_TYPE": {
      const parts: string[] = [];
      if (p.sentiment) parts.push(p.sentiment.toLowerCase());
      const kind = p.signalType
        ? p.signalType.toLowerCase().replace(/_/g, " ")
        : "signal";
      parts.push(kind);
      let s = parts.join(" ");
      if (p.minUrgency) s += ` ≥${p.minUrgency.toLowerCase()} urgency`;
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    case "EARNINGS_BEAT":
      return p.minSurprisePct
        ? `Earnings beat ≥${p.minSurprisePct}%`
        : "Any earnings beat";
    case "EARNINGS_MISS":
      return p.minSurprisePct
        ? `Earnings miss ≥${p.minSurprisePct}%`
        : "Any earnings miss";
    case "GUIDANCE_CHANGE":
      return `Guidance ${p.direction?.toLowerCase()}`;
    case "FILING":
      return `${p.formType} filed`;
    case "TIME_ELAPSED":
      return `${p.days} days elapsed`;
    case "REVIEW_DATE_HIT":
      return "Review date hit";
    case "AND":
      return `All of ${(p.predicates ?? []).length} conditions`;
    case "OR":
      return `Any of ${(p.predicates ?? []).length} conditions`;
    default:
      return p.kind;
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

function actionTintClass(action: string): string {
  switch (action) {
    case "EXIT":
      return "bg-red-500/10 text-red-500";
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
      // 202 = event dispatched but tactical-run hasn't landed in time.
      // Treat as success — the run will appear in /runs shortly.
      if (!r.ok && r.status !== 202) {
        const body = await r.text();
        throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      }
      const out = (await r.json()) as {
        runId?: string | null;
        queued?: boolean;
        message?: string;
      };
      if (out.runId) {
        router.push(`/runs/${out.runId}`);
      } else if (out.queued) {
        setFireError(
          out.message ??
            "Trigger event dispatched. The tactical run will appear in your runs list shortly.",
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
