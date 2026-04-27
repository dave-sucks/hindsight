/**
 * Thesis detail page — durable thesis + unified activity timeline.
 *
 * Renders one Thesis row plus its full ThesisUpdate history newest-first.
 * Each timeline entry shows the diff inline ("Target $200 → $247.35"),
 * the rationale, the price/position context AT THE TIME, and chips
 * linking back to the run/signals that produced it.
 *
 * Design rules followed (CLAUDE.md):
 *   - ShadCN only, no custom classes on primitives.
 *   - tabular-nums on every numeric value.
 *   - Card + p-6 + identical border for every block.
 *   - Empty/loading states present.
 *   - Positive/negative colors via text-emerald-500 / text-red-500.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StockLogo } from "@/components/StockLogo";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  Pencil,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Helpers ────────────────────────────────────────────────────────────

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "ACTIVE":
      return "default";
    case "WATCHING":
      return "secondary";
    case "INVALIDATED":
    case "CLOSED":
      return "destructive";
    case "SUPERSEDED":
      return "outline";
    default:
      return "outline";
  }
}

function UpdateIcon({ type }: { type: string }) {
  switch (type) {
    case "CREATED":
      return <Plus className="h-3.5 w-3.5" />;
    case "UPDATED":
      return <Pencil className="h-3.5 w-3.5" />;
    case "TRIGGER_FIRED":
      return <Zap className="h-3.5 w-3.5 text-amber-500" />;
    case "REVIEWED":
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
    case "ACTED":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case "INVALIDATED":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "CLOSED":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "SUPERSEDED":
      return <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return <Clock className="h-3.5 w-3.5" />;
  }
}

// ── Diff renderer ──────────────────────────────────────────────────────
// fieldChanges is { fieldName: { from, to } }. Render each as a one-line
// "fieldName: from → to" entry. For array fields we just show "updated"
// — a full array diff is too much for the timeline; the viewer can drill
// into the underlying ThesisUpdate row if they need it.

function FieldChangeLine({
  field,
  change,
}: {
  field: string;
  change: { from: unknown; to: unknown };
}) {
  const renderVal = (v: unknown): string => {
    if (v == null) return "—";
    if (typeof v === "number") return v.toString();
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return `[${v.length}]`;
    return "(object)";
  };
  const isArray = Array.isArray(change.from) || Array.isArray(change.to);
  const label = field
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase());
  if (isArray) {
    return (
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}:</span> updated
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground tabular-nums">
      <span className="font-medium text-foreground">{label}:</span>{" "}
      {renderVal(change.from)} → {renderVal(change.to)}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default async function ThesisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const thesis = await prisma.thesis.findFirst({
    where: { id, userId: user.id },
    include: {
      researchRun: { select: { id: true, agentConfig: { select: { id: true, name: true } } } },
      updates: {
        orderBy: { timestamp: "desc" },
        take: 100,
      },
      parentThesis: { select: { id: true, ticker: true, status: true, createdAt: true } },
      childTheses: {
        select: { id: true, ticker: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!thesis) notFound();

  const triggers = Array.isArray(thesis.triggers) ? (thesis.triggers as Array<{
    id?: string;
    predicate: { kind: string };
    action: string;
    rationale: string;
    cooldownDays?: number;
    lastFiredAt?: string;
  }>) : [];

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <StockLogo ticker={thesis.ticker} size="md" />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            {thesis.ticker}
            <Badge variant={statusVariant(thesis.status)}>{thesis.status}</Badge>
            {thesis.horizon ? (
              <Badge variant="outline">{thesis.horizon}</Badge>
            ) : null}
            <Badge
              variant={
                thesis.direction === "PASS"
                  ? "outline"
                  : thesis.direction === "LONG"
                    ? "default"
                    : "destructive"
              }
            >
              {thesis.direction}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {thesis.researchRun?.agentConfig?.name ?? "Manual"} ·{" "}
            {fmtDate(thesis.createdAt)}
          </p>
        </div>
      </div>

      {/* Belief + Reasoning */}
      <Card>
        <CardContent className="p-6 space-y-4">
          {thesis.coreBelief ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Core Belief
              </p>
              <p className="mt-1 text-sm">{thesis.coreBelief}</p>
            </div>
          ) : null}
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Reasoning Summary
            </p>
            <p className="mt-1 text-sm">{thesis.reasoningSummary}</p>
          </div>

          {thesis.thesisBullets.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Thesis Bullets
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {thesis.thesisBullets.map((b, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">·</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {thesis.keyAssumptions.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Key Assumptions
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {thesis.keyAssumptions.map((a, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">·</span>
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {thesis.invalidationConds.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Invalidation Conditions
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {thesis.invalidationConds.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">·</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {thesis.riskFlags.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Risk Flags
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {thesis.riskFlags.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Pricing + Sizing */}
      <Card>
        <CardContent className="p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Pricing & Sizing
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Entry</p>
              <p className="text-sm font-medium tabular-nums">
                {fmtUsd(thesis.entryPrice)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Target</p>
              <p className="text-sm font-medium tabular-nums">
                {fmtUsd(thesis.targetPrice)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Stop</p>
              <p className="text-sm font-medium tabular-nums">
                {fmtUsd(thesis.stopLoss)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Confidence</p>
              <p className="text-sm font-medium tabular-nums">
                {thesis.confidenceScore}/100
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Target Size</p>
              <p className="text-sm font-medium tabular-nums">
                {thesis.targetSizePct != null
                  ? `${thesis.targetSizePct.toFixed(1)}%`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hold</p>
              <p className="text-sm font-medium">{thesis.holdDuration}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Catalyst Date</p>
              <p className="text-sm font-medium">
                {fmtDate(thesis.catalystDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Next Review</p>
              <p className="text-sm font-medium">
                {fmtDate(thesis.nextReviewAt)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Triggers */}
      {triggers.length > 0 ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Triggers ({triggers.length})
            </p>
            <div className="mt-4 space-y-3">
              {triggers.map((t, i) => (
                <div
                  key={t.id ?? i}
                  className="flex items-start gap-3 rounded-md border p-3"
                >
                  <Badge variant="outline">{t.action}</Badge>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium">{t.predicate.kind}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.rationale}
                    </p>
                    {t.cooldownDays ? (
                      <p className="text-xs text-muted-foreground">
                        Cooldown: {t.cooldownDays}d
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Activity Timeline */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Activity ({thesis.updates.length})
            </p>
            {thesis.parentThesis ? (
              <Link
                href={`/theses/${thesis.parentThesis.id}`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Prior thesis
              </Link>
            ) : null}
          </div>

          {thesis.updates.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No activity recorded yet.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {thesis.updates.map((u, idx) => {
                const fieldChanges =
                  u.fieldChanges && typeof u.fieldChanges === "object"
                    ? (u.fieldChanges as Record<
                        string,
                        { from: unknown; to: unknown }
                      >)
                    : {};
                const positionAtTime = u.positionAtTime as {
                  qty: number;
                  avgCost: number;
                  unrealizedPnL: number | null;
                } | null;
                return (
                  <div key={u.id} className="flex gap-3">
                    {/* Rail */}
                    <div className="flex flex-col items-center">
                      <div
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-full border bg-background",
                        )}
                      >
                        <UpdateIcon type={u.type} />
                      </div>
                      {idx < thesis.updates.length - 1 ? (
                        <div className="w-px flex-1 bg-border" />
                      ) : null}
                    </div>
                    {/* Body */}
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{u.type}</Badge>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmtDateTime(u.timestamp)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium">{u.summary}</p>
                      {u.rationale ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {u.rationale}
                        </p>
                      ) : null}
                      {Object.keys(fieldChanges).length > 0 ? (
                        <div className="mt-2 space-y-0.5">
                          {Object.entries(fieldChanges).map(([field, ch]) => (
                            <FieldChangeLine
                              key={field}
                              field={field}
                              change={ch}
                            />
                          ))}
                        </div>
                      ) : null}
                      {(u.priceAtTime != null || positionAtTime) ? (
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground tabular-nums">
                          {u.priceAtTime != null ? (
                            <span>Price {fmtUsd(u.priceAtTime)}</span>
                          ) : null}
                          {positionAtTime ? (
                            <span>
                              Position {positionAtTime.qty} @{" "}
                              {fmtUsd(positionAtTime.avgCost)}
                              {positionAtTime.unrealizedPnL != null ? (
                                <span
                                  className={cn(
                                    positionAtTime.unrealizedPnL >= 0
                                      ? "text-emerald-500"
                                      : "text-red-500",
                                    "ml-1",
                                  )}
                                >
                                  ({positionAtTime.unrealizedPnL >= 0 ? "+" : ""}
                                  {fmtUsd(positionAtTime.unrealizedPnL)})
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {u.signalIds.length > 0 || u.runId ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {u.runId ? (
                            <Link
                              href={`/runs/${u.runId}`}
                              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                            >
                              run {u.runId.slice(-6)}
                            </Link>
                          ) : null}
                          {u.signalIds.length > 0 ? (
                            <span className="text-xs text-muted-foreground">
                              · {u.signalIds.length} signal
                              {u.signalIds.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Child theses (replacements) */}
          {thesis.childTheses.length > 0 ? (
            <>
              <Separator className="my-6" />
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Replaced by
                </p>
                <div className="mt-2 space-y-1">
                  {thesis.childTheses.map((c) => (
                    <Link
                      key={c.id}
                      href={`/theses/${c.id}`}
                      className="flex items-center gap-2 text-sm hover:underline underline-offset-4"
                    >
                      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                      <span className="text-muted-foreground tabular-nums">
                        {fmtDate(c.createdAt)}
                      </span>
                      <span>{c.ticker}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
