"use client";

import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Minus } from "lucide-react";
import type { RunEventItem } from "@/components/research/RunTimeline";

// ─── Types ────────────────────────────────────────────────────────────────────

type CandidateInfo = {
  ticker: string;
  score?: number;
  sources?: string[];
};

type ThesisSummary = {
  id: string;
  ticker: string;
  direction: string;
  confidenceScore: number;
};

type TradeDecision = {
  ticker: string;
  direction?: string;
  tradeId?: string;
  type: "executed" | "rejected";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractCandidates(events: RunEventItem[]): CandidateInfo[] {
  for (const ev of events) {
    if (ev.type === "discovery.completed") {
      const p = ev.payload as Record<string, unknown> | undefined;
      if (Array.isArray(p?.candidates)) {
        return p.candidates as CandidateInfo[];
      }
    }
  }
  return [];
}

function extractDecisions(events: RunEventItem[]): TradeDecision[] {
  return events
    .filter((ev) => ev.type === "trade.executed" || ev.type === "trade.rejected")
    .map((ev) => {
      const p = ev.payload as Record<string, unknown> | undefined;
      return {
        ticker: String(p?.ticker ?? ""),
        direction: p?.direction ? String(p.direction) : undefined,
        tradeId: p?.tradeId ? String(p.tradeId) : undefined,
        type: ev.type === "trade.executed" ? "executed" : "rejected",
      } satisfies TradeDecision;
    })
    .filter((d) => d.ticker);
}

// ─── Sections ────────────────────────────────────────────────────────────────

function CandidatesSection({ candidates }: { candidates: CandidateInfo[] }) {
  if (!candidates.length) return null;
  return (
    <div className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Candidates
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidates.map((c) => (
          <span
            key={c.ticker}
            className="text-[11px] font-mono font-medium border rounded px-1.5 py-0.5 text-foreground inline-flex items-center gap-1"
          >
            {c.ticker}
            {c.score != null && (
              <Badge
                variant="secondary"
                className="text-[9px] px-1 py-0 h-auto leading-tight"
              >
                {c.score}
              </Badge>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function ThesesSection({ theses }: { theses: ThesisSummary[] }) {
  if (!theses.length) return null;
  return (
    <div className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Theses
      </p>
      <div className="space-y-1.5">
        {theses.map((t) => {
          const isLong = t.direction === "LONG";
          const isShort = t.direction === "SHORT";
          const dirClass = isLong
            ? "text-emerald-600 dark:text-emerald-400"
            : isShort
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground";
          const confClass =
            t.confidenceScore >= 70
              ? "text-emerald-500"
              : t.confidenceScore >= 50
                ? "text-amber-500"
                : "text-red-500";
          return (
            <div
              key={t.id}
              className="flex items-center gap-2 text-xs rounded px-2 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <span className="font-mono font-semibold w-12 shrink-0">
                {t.ticker}
              </span>
              <span className={`font-medium shrink-0 ${dirClass}`}>
                {t.direction}
              </span>
              <span className={`tabular-nums ml-auto shrink-0 ${confClass}`}>
                {t.confidenceScore}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DecisionsSection({ decisions }: { decisions: TradeDecision[] }) {
  if (!decisions.length) return null;
  return (
    <div className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Decisions
      </p>
      <div className="space-y-1.5">
        {decisions.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            {d.type === "executed" ? (
              <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
            ) : (
              <Minus className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            <span className="font-mono font-semibold">{d.ticker}</span>
            {d.direction && (
              <span
                className={
                  d.direction === "LONG"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : d.direction === "SHORT"
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                }
              >
                {d.direction}
              </span>
            )}
            <span className="ml-auto text-muted-foreground">
              {d.type === "executed" ? "Placed" : "Skipped"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RunSidebar({
  events,
  theses,
}: {
  events: RunEventItem[];
  theses: ThesisSummary[];
}) {
  const candidates = extractCandidates(events);
  const decisions = extractDecisions(events);

  const hasCandidates = candidates.length > 0;
  const hasTheses = theses.length > 0;
  const hasDecisions = decisions.length > 0;

  if (!hasCandidates && !hasTheses && !hasDecisions) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Waiting for results…</p>
      </div>
    );
  }

  return (
    <div>
      {hasCandidates && <CandidatesSection candidates={candidates} />}
      {hasCandidates && (hasTheses || hasDecisions) && <Separator />}
      {hasTheses && <ThesesSection theses={theses} />}
      {hasTheses && hasDecisions && <Separator />}
      {hasDecisions && <DecisionsSection decisions={decisions} />}
    </div>
  );
}
