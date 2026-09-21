"use client";

/**
 * EarningsCard — THE earnings block, shared by the thesis sheet and the stock
 * page's Earnings tab. Same card shell as Analyst Consensus and Composite
 * Score: mono label top-left, verdict badge top-right, one visual, one legend.
 *
 * The visual is a dot plot of EPS: a hollow dot for what the street expected,
 * a filled dot for what the company printed (green above the estimate, red
 * below), a dashed line joining the two, and the upcoming quarter as an
 * estimate on its own. Under each column sits that quarter's verdict, so the
 * numbers are readable without hovering.
 *
 * Drawn by hand rather than with Recharts, for the same reason TickBar and
 * PriceGauge are: this is a fixed-height glyph with five columns, not a chart
 * anyone pans, zooms or resizes.
 *
 * What the vendor gives us (checked 2026-09-15, both plans we hold): the next
 * report's date/bell/estimates, and EPS actual vs estimate for the last FOUR
 * quarters. No past report dates, no revenue history, no post-report price
 * move — so none of those are designed for here. See docs/plans/MARKET_DATA.md.
 */

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EarningsResponse } from "@/lib/types/thesis-sheet";

/** $13.1B / $68.0M / $113.9K — the compact money the earnings surfaces use. */
export function compactMoney(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function eps(n: number | null): string {
  return n == null ? "—" : `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
}

function signedPct(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`;
}

/** "Oct 13 · before open · in 28 days" — the whole when, in one line. */
function reportWhen(iso: string, hour: string | null): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const now = new Date();
  const days = Math.round(
    (d.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000,
  );
  const when =
    days === 0 ? "today" : days === 1 ? "tomorrow" : days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
  const bell = hour === "bmo" ? "before open" : hour === "amc" ? "after close" : null;
  return [date, bell, when].filter(Boolean).join(" · ");
}

/** "Q2 '26" from a fiscal period end (YYYY-MM-DD) or an explicit quarter/year. */
function quarterLabel(period: string, quarter?: number | null, year?: number | null): string {
  if (quarter != null && year != null) return `Q${quarter} '${String(year).slice(2)}`;
  const [y, m] = period.split("-");
  const q = Math.ceil(Number(m) / 3);
  return `Q${q} '${y.slice(2)}`;
}

interface Column {
  key: string;
  label: string;
  estimate: number | null;
  actual: number | null;
  surprisePct: number | null;
  /** The upcoming report — estimate only, and its date instead of a verdict. */
  upcoming?: { when: string };
}

// ── The dot plot ─────────────────────────────────────────────────────────────
// One column per quarter, dots placed by value inside a fixed-height box.
// `pad` keeps the outermost dot off the edge so it never clips.

const PLOT_PAD = 0.12;

function DotPlot({ columns }: { columns: Column[] }) {
  const values = columns.flatMap((c) => [c.estimate, c.actual]).filter((v): v is number => v != null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  // Top of the box is the highest EPS, so a beat sits above its estimate.
  const y = (v: number) => (1 - PLOT_PAD * 2) * ((max - v) / span) * 100 + PLOT_PAD * 100;

  return (
    <div className="flex items-stretch">
      {columns.map((c) => {
        const beat = c.surprisePct != null && c.surprisePct >= 0;
        const detail = c.upcoming
          ? `${c.label} · reports ${c.upcoming.when}${c.estimate != null ? ` · street expects EPS ${eps(c.estimate)}` : ""}`
          : `${c.label} · EPS ${eps(c.actual)} vs ${eps(c.estimate)} expected${
              c.surprisePct != null ? ` · ${beat ? "Beat" : "Miss"} ${signedPct(c.surprisePct)}` : ""
            }`;
        return (
          <Tooltip key={c.key}>
            <TooltipTrigger
              render={
                <div className="flex-1 min-w-0 cursor-default rounded-sm px-1 py-1 hover:bg-accent/40 transition-colors" />
              }
            >
              <div className="relative h-20">
                {/* Dashed joiner — reads as the distance between expected and printed. */}
                {c.estimate != null && c.actual != null && (
                  <span
                    className="absolute left-1/2 w-px -translate-x-1/2 border-l border-dashed border-muted-foreground/40"
                    style={{
                      top: `${Math.min(y(c.estimate), y(c.actual))}%`,
                      height: `${Math.abs(y(c.actual) - y(c.estimate))}%`,
                    }}
                  />
                )}
                {c.estimate != null && (
                  <span
                    className="absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-muted-foreground/70 bg-card"
                    style={{ top: `${y(c.estimate)}%` }}
                  />
                )}
                {c.actual != null && (
                  <span
                    className={cn(
                      "absolute left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                      beat ? "bg-positive" : "bg-negative",
                    )}
                    style={{ top: `${y(c.actual)}%` }}
                  />
                )}
              </div>
              {/* The x-axis IS the verdict strip — label over result. */}
              <div className="mt-1 space-y-0.5 text-center">
                <p className="text-[10px] text-muted-foreground tabular-nums">{c.label}</p>
                {c.upcoming ? (
                  <p className="text-xs text-muted-foreground tabular-nums truncate">
                    {c.upcoming.when.split(" · ")[0]}
                  </p>
                ) : c.surprisePct != null ? (
                  <p
                    className={cn(
                      "text-xs tabular-nums",
                      beat ? "text-positive" : "text-negative",
                    )}
                  >
                    {beat ? "Beat" : "Miss"} {signedPct(c.surprisePct)}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">—</p>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {detail}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function EarningsCard({
  data,
  className,
}: {
  data: EarningsResponse;
  className?: string;
}) {
  const scored = data.recent.filter((q) => q.actual != null || q.estimate != null).slice(0, 4);
  if (!data.next && scored.length === 0) return null;

  // Oldest → newest, then the upcoming quarter on the right.
  const columns: Column[] = scored
    .slice()
    .reverse()
    .map((q) => ({
      key: q.period,
      label: quarterLabel(q.period),
      estimate: q.estimate,
      actual: q.actual,
      surprisePct: q.surprisePct,
    }));
  if (data.next) {
    columns.push({
      key: `next-${data.next.reportDate}`,
      label: quarterLabel(data.next.reportDate, data.next.quarter, data.next.year),
      estimate: data.next.epsEstimate,
      actual: null,
      surprisePct: null,
      upcoming: { when: reportWhen(data.next.reportDate, data.next.hour) },
    });
  }

  const withVerdict = scored.filter((q) => q.surprisePct != null);
  const beats = withVerdict.filter((q) => (q.surprisePct as number) >= 0).length;
  const record =
    withVerdict.length > 0
      ? {
          text: `Beat ${beats} of ${withVerdict.length}`,
          variant:
            beats * 2 > withVerdict.length
              ? ("positive" as const)
              : beats * 2 < withVerdict.length
                ? ("negative" as const)
                : ("secondary" as const),
        }
      : null;

  const next = data.next;
  const street = next
    ? [
        next.epsEstimate != null ? `EPS ${eps(next.epsEstimate)}` : null,
        next.revenueEstimate != null ? `revenue ${compactMoney(next.revenueEstimate)}` : null,
      ].filter(Boolean)
    : [];

  return (
    <Card className={className ?? "bg-muted/40 p-2 gap-4"}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Earnings</p>
        {record ? (
          <Badge variant={record.variant} className="font-normal tabular-nums">
            {record.text}
          </Badge>
        ) : null}
      </div>

      {next ? (
        <div className="space-y-0.5">
          <p className="text-sm">
            <span className="text-muted-foreground">Next report </span>
            <span className="font-medium tabular-nums">
              {reportWhen(next.reportDate, next.hour)}
            </span>
          </p>
          {street.length > 0 ? (
            <p className="text-xs text-muted-foreground tabular-nums">
              Street expects {street.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {columns.length > 0 ? (
        <div className="space-y-2">
          <DotPlot columns={columns} />
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full border border-muted-foreground/70 bg-card" />
              Expected
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-positive" />
              Beat
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-negative" />
              Miss
            </span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
