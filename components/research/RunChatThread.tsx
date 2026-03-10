"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  ListChecks,
  Brain,
  PenLine,
  FileText,
  SkipForward,
  AlertCircle,
  Link as LinkIcon,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RunEventRow = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  payload: unknown;
  createdAt: Date | string;
};

type SourceInfo = {
  type: string;
  provider: string;
  title: string;
};

type ThesisPayload = {
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration: string;
  signal_types: string[];
};

function asRecord(v: unknown): Record<string, unknown> {
  return (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// ─── Per-event renderers ───────────────────────────────────────────────────────

function ScanningMsg({ event }: { event: Record<string, unknown> }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span>{asString(event.message) || "Scanning market for opportunities..."}</span>
    </div>
  );
}

function CandidatesMsg({ event }: { event: Record<string, unknown> }) {
  const tickers = asArray<string>(event.tickers);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">Found {tickers.length} candidates:</span>
      {tickers.map((t) => (
        <Badge key={t} variant="outline" className="font-mono text-xs">
          {t}
        </Badge>
      ))}
    </div>
  );
}

function AnalyzingMsg({ event }: { event: Record<string, unknown> }) {
  const ticker = asString(event.ticker);
  const company = asString(event.company);
  return (
    <div className="flex items-center gap-2 text-sm">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" />
      <span>
        Analyzing <span className="font-mono font-semibold">{ticker}</span>
        {company ? <span className="text-muted-foreground"> — {company}</span> : null}
      </span>
    </div>
  );
}

function DataReadyMsg({ event }: { event: Record<string, unknown> }) {
  const ticker = asString(event.ticker);
  const price = asNumber(event.price);
  const count = asNumber(event.sources_count);
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      <span>
        <span className="font-mono font-medium text-foreground">{ticker}</span>
        {price != null ? (
          <span className="tabular-nums"> @ ${price.toFixed(2)}</span>
        ) : null}
        {count != null ? <span> — {count} sources collected</span> : null}
      </span>
    </div>
  );
}

function ConceptMsg({ event }: { event: Record<string, unknown> }) {
  const ticker = asString(event.ticker);
  const dir = asString(event.direction);
  const confidence = asNumber(event.confidence);
  const icon =
    dir === "LONG" ? (
      <TrendingUp className="h-4 w-4 text-emerald-500" />
    ) : dir === "SHORT" ? (
      <TrendingDown className="h-4 w-4 text-red-500" />
    ) : (
      <Minus className="h-4 w-4 text-muted-foreground" />
    );
  return (
    <div className="flex items-start gap-2 text-sm">
      <Brain className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div>
        <span>
          <span className="font-mono font-semibold">{ticker}</span>:{" "}
          <span className="flex-inline items-center gap-1">
            {icon}
          </span>{" "}
          <span
            className={
              dir === "LONG"
                ? "text-emerald-500 font-medium"
                : dir === "SHORT"
                ? "text-red-500 font-medium"
                : "text-muted-foreground"
            }
          >
            {dir}
          </span>
          {confidence != null ? (
            <span className="text-muted-foreground tabular-nums"> — {confidence}% confidence</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function ThesisWritingMsg({ event }: { event: Record<string, unknown> }) {
  const ticker = asString(event.ticker);
  const dir = asString(event.direction);
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <PenLine className="h-3.5 w-3.5 shrink-0" />
      <span>
        Writing{" "}
        <span
          className={
            dir === "LONG"
              ? "text-emerald-500 font-medium"
              : dir === "SHORT"
              ? "text-red-500 font-medium"
              : ""
          }
        >
          {dir}
        </span>{" "}
        thesis for <span className="font-mono font-medium text-foreground">{ticker}</span>
        ...
      </span>
    </div>
  );
}

function ThesisCompleteMsg({ event }: { event: Record<string, unknown> }) {
  const raw = asRecord(event.thesis);
  const thesis: ThesisPayload = {
    ticker: asString(raw.ticker || event.ticker),
    direction: (asString(raw.direction) || "PASS") as "LONG" | "SHORT" | "PASS",
    confidence_score: asNumber(raw.confidence_score) ?? 0,
    reasoning_summary: asString(raw.reasoning_summary),
    thesis_bullets: asArray<string>(raw.thesis_bullets),
    risk_flags: asArray<string>(raw.risk_flags),
    entry_price: asNumber(raw.entry_price),
    target_price: asNumber(raw.target_price),
    stop_loss: asNumber(raw.stop_loss),
    hold_duration: asString(raw.hold_duration) || "SWING",
    signal_types: asArray<string>(raw.signal_types),
  };

  const isLong = thesis.direction === "LONG";
  const isShort = thesis.direction === "SHORT";

  return (
    <Card className="border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base font-semibold">
              {thesis.ticker} — Trade Thesis
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={isLong ? "default" : isShort ? "destructive" : "secondary"}
              className="font-mono"
            >
              {thesis.direction}
            </Badge>
            <Badge variant="outline" className="tabular-nums">
              {thesis.confidence_score}% confidence
            </Badge>
            <Badge variant="outline">{thesis.hold_duration}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price plan */}
        {thesis.entry_price != null && (
          <div className="grid grid-cols-3 gap-4 rounded-lg bg-muted/50 p-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entry</p>
              <p className="tabular-nums font-semibold">${thesis.entry_price.toFixed(2)}</p>
            </div>
            {thesis.target_price != null && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target</p>
                <p className="tabular-nums font-semibold text-emerald-500">
                  ${thesis.target_price.toFixed(2)}
                </p>
              </div>
            )}
            {thesis.stop_loss != null && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Stop</p>
                <p className="tabular-nums font-semibold text-red-500">
                  ${thesis.stop_loss.toFixed(2)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Reasoning summary */}
        {thesis.reasoning_summary && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {thesis.reasoning_summary.slice(0, 300)}
            {thesis.reasoning_summary.length > 300 ? "…" : ""}
          </p>
        )}

        {/* Thesis bullets */}
        {thesis.thesis_bullets.length > 0 && (
          <ul className="space-y-1">
            {thesis.thesis_bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Risk flags */}
        {thesis.risk_flags.length > 0 && (
          <ul className="space-y-1">
            {thesis.risk_flags.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-500" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Signal types */}
        {thesis.signal_types.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {thesis.signal_types.map((s) => (
              <Badge key={s} variant="secondary" className="text-xs">
                {s.replace(/_/g, " ")}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SkipMsg({ event }: { event: Record<string, unknown> }) {
  const ticker = asString(event.ticker);
  const reason = asString(event.reason);
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <SkipForward className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        Passing on <span className="font-mono font-medium text-foreground">{ticker}</span>
        {reason ? <span> — {reason}</span> : null}
      </span>
    </div>
  );
}

function ErrorMsg({ event }: { event: Record<string, unknown> }) {
  const ticker = asString(event.ticker);
  const msg = asString(event.message || event.text);
  return (
    <div className="flex items-start gap-2 text-sm text-red-500">
      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        {ticker ? (
          <>
            Error on <span className="font-mono font-semibold">{ticker}</span>:{" "}
          </>
        ) : null}
        {msg}
      </span>
    </div>
  );
}

function RunCompleteMsg({ event }: { event: Record<string, unknown> }) {
  const analyzed = asNumber(event.analyzed) ?? 0;
  const recommended = asNumber(event.recommended) ?? 0;
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        Run complete
      </div>
      <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
        <span className="tabular-nums">{analyzed} analyzed</span>
        <Separator orientation="vertical" className="h-4" />
        <span className="tabular-nums text-emerald-500">{recommended} recommended</span>
      </div>
    </div>
  );
}

// ─── Sources Panel ─────────────────────────────────────────────────────────────

type TickerSources = {
  ticker: string;
  company: string;
  price: number | null;
  sources: SourceInfo[];
};

function SourcesPanel({ events }: { events: RunEventRow[] }) {
  const byTicker: Record<string, TickerSources> = {};

  for (const ev of events) {
    if (ev.type !== "data_ready") continue;
    const payload = asRecord(ev.payload);
    const ticker = asString(payload.ticker);
    if (!ticker) continue;
    byTicker[ticker] = {
      ticker,
      company: asString(payload.company),
      price: asNumber(payload.price),
      sources: asArray<SourceInfo>(payload.sources),
    };
  }

  const items = Object.values(byTicker);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-muted-foreground">
        <LinkIcon className="h-8 w-8 mb-3 opacity-30" />
        <p className="text-sm">Sources will appear here as stocks are analyzed</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Sources
      </h3>
      {items.map(({ ticker, company, price, sources }) => (
        <div key={ticker} className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold font-mono">{ticker}</p>
            {price != null && (
              <p className="text-xs text-muted-foreground tabular-nums">
                ${price.toFixed(2)}
              </p>
            )}
          </div>
          {company && (
            <p className="text-xs text-muted-foreground -mt-1">{company}</p>
          )}
          <ul className="space-y-1">
            {sources.map((s, i) => (
              <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                <span className="font-medium text-foreground/70">{s.provider}</span>
                <span className="truncate">{s.title}</span>
              </li>
            ))}
          </ul>
          <Separator />
        </div>
      ))}
    </div>
  );
}

// ─── Event renderer ───────────────────────────────────────────────────────────

function renderEvent(event: RunEventRow) {
  const payload = asRecord(event.payload);

  switch (event.type) {
    case "scanning":
      return <ScanningMsg event={payload} />;
    case "candidates":
      return <CandidatesMsg event={payload} />;
    case "analyzing":
      return <AnalyzingMsg event={payload} />;
    case "data_ready":
      return <DataReadyMsg event={payload} />;
    case "concept":
      return <ConceptMsg event={payload} />;
    case "thesis_writing":
      return <ThesisWritingMsg event={payload} />;
    case "thesis_complete":
      return <ThesisCompleteMsg event={payload} />;
    case "skip":
      return <SkipMsg event={payload} />;
    case "ticker_error":
    case "error":
      return <ErrorMsg event={payload} />;
    case "run_complete":
      return <RunCompleteMsg event={payload} />;
    default:
      return (
        <p className="text-sm text-muted-foreground">{event.title}</p>
      );
  }
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function RunChatThread({ events }: { events: RunEventRow[] }) {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: chat thread */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-4 px-6 py-6">
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
              <Loader2 className="h-8 w-8 mb-3 animate-spin opacity-40" />
              <p className="text-sm">Waiting for run to start...</p>
            </div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className="space-y-1">
                {renderEvent(ev)}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: sources panel */}
      <div className="hidden lg:flex w-[300px] border-l overflow-y-auto">
        <SourcesPanel events={events} />
      </div>
    </div>
  );
}
