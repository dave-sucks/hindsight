"use client";

import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  Minus,
  Database,
  Play,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RunEventItem = {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  payload?: unknown;
  createdAt: string | Date;
};

type CandidateInfo = {
  ticker: string;
  score?: number;
  sources?: string[];
};

type SourceCategory = {
  category: string;
  provider: string;
  available: boolean;
  count?: number;
  sentiment?: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function eventIcon(type: string, payload?: unknown) {
  switch (type) {
    case "run.started":
      return <Play className="h-3.5 w-3.5 text-violet-500" />;
    case "strategy.parsed":
      return <Zap className="h-3.5 w-3.5 text-blue-400" />;
    case "discovery.started":
      return <Search className="h-3.5 w-3.5 text-blue-400" />;
    case "discovery.completed":
      return <Search className="h-3.5 w-3.5 text-blue-500" />;
    case "ticker.research.started":
      return <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />;
    case "data_gathering.completed":
      return <Database className="h-3.5 w-3.5 text-amber-500" />;
    case "thesis.generated": {
      const p = payload as Record<string, unknown> | undefined;
      const dir = String(p?.direction ?? "");
      if (dir === "LONG")
        return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
      if (dir === "SHORT")
        return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
      return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
    }
    case "trade_plan.generated":
      return <Zap className="h-3.5 w-3.5 text-amber-500" />;
    case "trade.executed":
      return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
    case "trade.rejected":
      return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
    case "run.completed":
      return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
    case "run.error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// ─── Expandable candidates list ───────────────────────────────────────────────

function CandidateList({ candidates }: { candidates: CandidateInfo[] }) {
  const [open, setOpen] = useState(false);
  if (!candidates.length) return null;
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{candidates.length} candidate{candidates.length !== 1 ? "s" : ""}</span>
        {open ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {candidates.map((c) => (
            <span
              key={c.ticker}
              className="text-[11px] font-mono font-medium border rounded px-1.5 py-0.5 text-foreground"
            >
              {c.ticker}
              {c.score != null && (
                <span className="ml-1 text-muted-foreground font-normal">{c.score}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Source chips for data_gathering.completed ────────────────────────────────

function SourceChips({ sources }: { sources: SourceCategory[] }) {
  const available = sources.filter((s) => s.available);
  if (!available.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {available.map((s) => (
        <Badge
          key={s.category}
          variant="outline"
          className="text-[10px] px-1.5 py-0 font-normal"
        >
          {s.category.replace(/_/g, " ")}
          {s.count != null && s.count > 0 ? ` (${s.count})` : ""}
        </Badge>
      ))}
    </div>
  );
}

// ─── Single event row ─────────────────────────────────────────────────────────

function EventRow({ event }: { event: RunEventItem }) {
  const payload = event.payload as Record<string, unknown> | undefined;

  const candidates: CandidateInfo[] =
    event.type === "discovery.completed" && Array.isArray(payload?.candidates)
      ? (payload.candidates as CandidateInfo[])
      : [];

  const sources: SourceCategory[] =
    event.type === "data_gathering.completed" && Array.isArray(payload?.sources)
      ? (payload.sources as SourceCategory[])
      : [];

  return (
    <div className="flex gap-2.5 py-2">
      <div className="shrink-0 mt-0.5 w-5 flex justify-center">
        {eventIcon(event.type, payload)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground leading-tight">{event.title}</p>
        {event.message && (
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
            {event.message}
          </p>
        )}
        {candidates.length > 0 && <CandidateList candidates={candidates} />}
        {sources.length > 0 && <SourceChips sources={sources} />}
        {payload?.synthetic === true && (
          <p className="text-[10px] text-muted-foreground/50 mt-0.5 italic">
            reconstructed
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RunTimeline({
  events,
  isLive,
  isComplete,
  isSynthetic,
}: {
  events: RunEventItem[];
  isLive: boolean;
  isComplete: boolean;
  isSynthetic?: boolean;
}) {
  return (
    <div className="flex flex-col h-full">
      {isSynthetic && (
        <div className="px-4 py-2 bg-muted/30 border-b">
          <p className="text-[11px] text-muted-foreground italic">
            Timeline reconstructed from results (run predates streaming).
          </p>
        </div>
      )}

      <ScrollArea className="flex-1 px-4">
        <div className="py-3 divide-y divide-border/50">
          {events.length === 0 && !isLive && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No timeline events yet.
            </p>
          )}

          {events.length === 0 && isLive && !isComplete && (
            <div className="flex items-center gap-2 py-4">
              <div className="shrink-0 mt-0.5 w-5 flex justify-center">
                <Loader2 className="h-3.5 w-3.5 text-violet-500 animate-spin" />
              </div>
              <p className="text-xs text-muted-foreground">Starting research…</p>
            </div>
          )}

          {events.map((ev) => <EventRow key={ev.id} event={ev} />)}

          {isLive && !isComplete && events.length > 0 && (
            <div className="flex items-center gap-2 py-2">
              <div className="shrink-0 mt-0.5 w-5 flex justify-center">
                <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
              </div>
              <p className="text-xs text-muted-foreground">Processing…</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
