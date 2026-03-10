"use client";

import { useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  TrendingUp,
  CheckCircle2,
  SkipForward,
  AlertCircle,
  Link as LinkIcon,
  Loader2,
  ListChecks,
  ChevronRight,
} from "lucide-react";
import {
  ChatComposer,
  type ComposerContext,
  type ComposerRecentThesis,
} from "@/components/chat/ChatComposer";
import { cn } from "@/lib/utils";

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

// ─── Events shown in the main feed ────────────────────────────────────────────
// analyzing + concept are shown as lightweight collapsible chips.
// Low-level process events (data_ready, data_fetch, thesis_writing,
// thesis_start, thesis_token) are hidden — sourced into the right panel only.

const MAIN_FEED_TYPES = new Set([
  "scan_start",
  "scanning",
  "candidates",
  "analyzing",
  "concept",
  "thesis_complete",
  "skip",
  "trade_placed",
  "run_complete",
  "error",
  "ticker_error",
]);

// ─── Per-event renderers ───────────────────────────────────────────────────────

function ScanningMsg({ payload }: { payload: Record<string, unknown> }) {
  const sectors = asArray<string>(payload.sectors);
  return (
    <p className="text-sm text-muted-foreground">
      {sectors.length > 0
        ? `Scanning ${sectors.join(", ")} for opportunities…`
        : asString(payload.message) || "Scanning market for opportunities…"}
    </p>
  );
}

function CandidatesMsg({ payload }: { payload: Record<string, unknown> }) {
  const tickers = asArray<string>(payload.tickers);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">
        Found {tickers.length} candidate{tickers.length !== 1 ? "s" : ""}:
      </span>
      {tickers.map((t) => (
        <Badge key={t} variant="outline" className="font-mono text-xs">
          {t}
        </Badge>
      ))}
    </div>
  );
}

// ── Collapsible "thinking" chip shown while the agent analyzes a ticker ───────

function AnalyzingMsg({ payload }: { payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const ticker = asString(payload.ticker);
  const company = asString(payload.company);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors cursor-pointer select-none">
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-150",
            open && "rotate-90"
          )}
        />
        <span>
          Analyzing{" "}
          <span className="font-mono font-medium text-muted-foreground">
            {ticker}
          </span>
          {"…"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
        <p className="mt-1 pl-4 text-xs text-muted-foreground/60 leading-relaxed">
          {company
            ? company
            : "Fetching price data, news, and market signals…"}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Inline direction signal shown after concept CoT, before thesis card ───────

function ConceptMsg({ payload }: { payload: Record<string, unknown> }) {
  const ticker = asString(payload.ticker);
  const direction = asString(payload.direction).toUpperCase();
  const confidence = asNumber(payload.confidence);
  const isLong = direction === "LONG";
  const isShort = direction === "SHORT";

  return (
    <p className="text-xs text-muted-foreground/70 pl-4">
      Initial signal for{" "}
      <span className="font-mono font-medium text-muted-foreground">
        {ticker}
      </span>
      {": "}
      <span
        className={cn(
          "font-semibold",
          isLong
            ? "text-emerald-500"
            : isShort
            ? "text-red-500"
            : "text-muted-foreground"
        )}
      >
        {direction}
      </span>
      {confidence != null && (
        <span className="tabular-nums"> · {confidence}%</span>
      )}
    </p>
  );
}

function ThesisCompleteMsg({ payload }: { payload: Record<string, unknown> }) {
  const raw = asRecord(payload.thesis ?? payload);
  const thesis: ThesisPayload = {
    ticker: asString(raw.ticker || payload.ticker),
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
  const dirColor = isLong
    ? "text-emerald-500"
    : isShort
    ? "text-red-500"
    : "text-muted-foreground";

  const gainPct =
    thesis.entry_price && thesis.target_price
      ? (
          ((thesis.target_price - thesis.entry_price) / thesis.entry_price) *
          100
        ).toFixed(1)
      : null;
  const lossPct =
    thesis.entry_price && thesis.stop_loss
      ? (
          ((thesis.entry_price - thesis.stop_loss) / thesis.entry_price) *
          100
        ).toFixed(1)
      : null;
  const rrRatio =
    thesis.entry_price && thesis.target_price && thesis.stop_loss
      ? (
          (thesis.target_price - thesis.entry_price) /
          (thesis.entry_price - thesis.stop_loss)
        ).toFixed(1)
      : null;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header row */}
      <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/20">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold font-mono">
            {thesis.ticker}
          </span>
          <span className={`text-sm font-semibold ${dirColor}`}>
            {thesis.direction}
          </span>
          {thesis.hold_duration && (
            <span className="text-xs text-muted-foreground">
              {thesis.hold_duration}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {thesis.signal_types.slice(0, 2).map((s) => (
            <span
              key={s}
              className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
            >
              {s.replace(/_/g, " ")}
            </span>
          ))}
          <span
            className={`text-sm font-semibold tabular-nums ${
              thesis.confidence_score >= 70
                ? "text-emerald-500"
                : "text-amber-500"
            }`}
          >
            {thesis.confidence_score}%
          </span>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Trade plan */}
        {thesis.entry_price != null && (
          <div className="grid grid-cols-4 gap-3 rounded-lg bg-muted/40 p-3 text-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                Entry
              </p>
              <p className="text-sm tabular-nums font-semibold">
                ${thesis.entry_price.toFixed(2)}
              </p>
            </div>
            {thesis.target_price != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  Target
                </p>
                <p className="text-sm tabular-nums font-semibold text-emerald-500">
                  ${thesis.target_price.toFixed(2)}
                  {gainPct && (
                    <span className="text-[10px] text-muted-foreground ml-1">
                      +{gainPct}%
                    </span>
                  )}
                </p>
              </div>
            )}
            {thesis.stop_loss != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  Stop
                </p>
                <p className="text-sm tabular-nums font-semibold text-red-500">
                  ${thesis.stop_loss.toFixed(2)}
                  {lossPct && (
                    <span className="text-[10px] text-muted-foreground ml-1">
                      −{lossPct}%
                    </span>
                  )}
                </p>
              </div>
            )}
            {rrRatio != null && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                  R:R
                </p>
                <p
                  className={`text-sm tabular-nums font-semibold ${
                    parseFloat(rrRatio) >= 2
                      ? "text-emerald-500"
                      : parseFloat(rrRatio) >= 1
                      ? "text-muted-foreground"
                      : "text-red-500"
                  }`}
                >
                  {rrRatio}×
                </p>
              </div>
            )}
          </div>
        )}

        {/* Reasoning */}
        {thesis.reasoning_summary && (
          <p className="text-sm text-foreground/80 leading-relaxed">
            {thesis.reasoning_summary}
          </p>
        )}

        {/* Bullish bullets */}
        {thesis.thesis_bullets.length > 0 && (
          <ul className="space-y-1.5">
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
          <ul className="space-y-1.5">
            {thesis.risk_flags.map((r, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SkipMsg({ payload }: { payload: Record<string, unknown> }) {
  const ticker = asString(payload.ticker);
  const reason = asString(payload.reason);
  const confidence = asNumber(payload.confidence);
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      <SkipForward className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        Passed on{" "}
        <span className="font-mono font-medium text-foreground">{ticker}</span>
        {confidence != null ? (
          <span className="tabular-nums"> — {confidence}% confidence</span>
        ) : null}
        {reason ? <span> · {reason}</span> : null}
      </span>
    </div>
  );
}

function TradePlacedMsg({ payload }: { payload: Record<string, unknown> }) {
  const ticker = asString(payload.ticker);
  const entry = asNumber(payload.entry);
  return (
    <div className="flex items-center gap-2 text-sm">
      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
      <span className="text-muted-foreground">
        Paper trade placed:{" "}
        <span className="font-mono font-medium text-foreground">{ticker}</span>
        {entry != null ? (
          <span className="tabular-nums"> @ ${entry.toFixed(2)}</span>
        ) : null}
      </span>
    </div>
  );
}

function ErrorMsg({ payload }: { payload: Record<string, unknown> }) {
  const ticker = asString(payload.ticker);
  const msg = asString(payload.message || payload.text);
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

function RunCompleteMsg({ payload }: { payload: Record<string, unknown> }) {
  const analyzed = asNumber(payload.analyzed) ?? 0;
  const recommended = asNumber(payload.recommended) ?? 0;
  const placed = asNumber(payload.placed);
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        Run complete
      </div>
      <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
        <span className="tabular-nums">{analyzed} analyzed</span>
        <Separator orientation="vertical" className="h-4 self-center" />
        <span className="tabular-nums text-emerald-500">
          {recommended} recommended
        </span>
        {placed != null && placed > 0 && (
          <>
            <Separator orientation="vertical" className="h-4 self-center" />
            <span className="tabular-nums">{placed} trades placed</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Event dispatcher ──────────────────────────────────────────────────────────

function renderEvent(event: RunEventRow) {
  const payload = asRecord(event.payload);
  switch (event.type) {
    case "scanning":
    case "scan_start":
      return <ScanningMsg payload={payload} />;
    case "candidates":
      return <CandidatesMsg payload={payload} />;
    case "analyzing":
      return <AnalyzingMsg payload={payload} />;
    case "concept":
      return <ConceptMsg payload={payload} />;
    case "thesis_complete":
      return <ThesisCompleteMsg payload={payload} />;
    case "skip":
      return <SkipMsg payload={payload} />;
    case "trade_placed":
      return <TradePlacedMsg payload={payload} />;
    case "ticker_error":
    case "error":
      return <ErrorMsg payload={payload} />;
    case "run_complete":
      return <RunCompleteMsg payload={payload} />;
    default:
      return null;
  }
}

// ─── Spacing helper — tighten gap between analyzing/concept/thesis groups ─────

function getEventSpacing(
  events: RunEventRow[],
  index: number
): string {
  const curr = events[index];
  const prev = index > 0 ? events[index - 1] : null;
  const TIGHT_TYPES = new Set(["analyzing", "concept", "thesis_complete"]);
  if (prev && TIGHT_TYPES.has(prev.type) && TIGHT_TYPES.has(curr.type)) {
    return "mt-1.5"; // tight spacing within a ticker group
  }
  return "mt-5"; // normal spacing between different topics
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
    if (ev.type !== "data_ready" && ev.type !== "data_fetch") continue;
    const payload = asRecord(ev.payload);
    const ticker = asString(payload.ticker);
    if (!ticker) continue;
    if (!byTicker[ticker]) {
      byTicker[ticker] = {
        ticker,
        company: asString(payload.company),
        price: asNumber(payload.price),
        sources: [],
      };
    }
    if (ev.type === "data_ready") {
      byTicker[ticker].price =
        asNumber(payload.price) ?? byTicker[ticker].price;
      byTicker[ticker].sources.push(...asArray<SourceInfo>(payload.sources));
    } else if (ev.type === "data_fetch") {
      byTicker[ticker].sources.push({
        type: "fetch",
        provider: asString(payload.source),
        title: asString(payload.source),
      });
    }
  }

  const items = Object.values(byTicker);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-muted-foreground">
        <LinkIcon className="h-8 w-8 mb-3 opacity-30" />
        <p className="text-sm">Sources appear here as stocks are analyzed</p>
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
          {sources.length > 0 && (
            <ul className="space-y-1">
              {sources.map((s, i) => (
                <li
                  key={i}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                  <span className="font-medium text-foreground/70">
                    {s.provider}
                  </span>
                  {s.title !== s.provider && (
                    <span className="truncate">{s.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Separator />
        </div>
      ))}
    </div>
  );
}

// ─── Follow-up chat ────────────────────────────────────────────────────────────

type FollowupMsg = {
  role: "user" | "assistant";
  text: string;
  status?: "streaming" | "done" | "error";
};

function FollowupChat({
  analystId,
  recentTheses,
}: {
  analystId?: string;
  recentTheses?: ComposerRecentThesis[];
}) {
  const [messages, setMessages] = useState<FollowupMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function submit(rawMsg: string, ctx: ComposerContext) {
    const question = rawMsg.trim();
    if (!question || busy) return;

    // Build message with optional ticker context
    const fullMsg = ctx.ticker
      ? `[Context: $${ctx.ticker.symbol}] ${question}`
      : question;

    setBusy(true);
    const assistantIdx = messages.length + 1;

    setMessages((prev) => [
      ...prev,
      { role: "user", text: question },
      { role: "assistant", text: "", status: "streaming" },
    ]);

    try {
      const res = await fetch("/api/research/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: fullMsg,
          history: [],
          model: ctx.model ?? "gpt-4o",
        }),
      });
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === "token") {
              accumulated += evt.text;
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx ? { ...m, text: accumulated } : m
                )
              );
            } else if (evt.type === "complete") {
              setMessages((prev) =>
                prev.map((m, i) =>
                  i === assistantIdx ? { ...m, status: "done" } : m
                )
              );
            }
          } catch {
            // malformed line
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === assistantIdx
            ? {
                ...m,
                status: "error",
                text: "Request failed. Please try again.",
              }
            : m
        )
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t shrink-0">
      {/* Follow-up thread */}
      {messages.length > 0 && (
        <div className="max-w-2xl mx-auto px-6 pt-4 pb-2 space-y-4">
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm max-w-sm">
                  {msg.text}
                </div>
              </div>
            ) : (
              <div
                key={i}
                className={`text-sm leading-relaxed ${
                  msg.status === "error"
                    ? "text-red-500"
                    : "text-muted-foreground"
                }`}
              >
                {msg.text || (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Thinking…
                  </span>
                )}
                {msg.status === "streaming" && msg.text && (
                  <span className="animate-pulse">▌</span>
                )}
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Composer */}
      <div className="px-6 py-3">
        <ChatComposer
          onSubmit={submit}
          recentTheses={recentTheses}
          loading={busy}
          placeholder="Ask a follow-up question about this run…"
          className="max-w-2xl mx-auto"
        />
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function RunChatThread({
  events,
  showFollowup = false,
  userId,
  analystId,
  recentTheses,
}: {
  events: RunEventRow[];
  showFollowup?: boolean;
  userId?: string;
  analystId?: string;
  /** Past theses for @-reference in the follow-up composer */
  recentTheses?: ComposerRecentThesis[];
}) {
  // Only render meaningful events in the main feed
  const mainEvents = events.filter((ev) => MAIN_FEED_TYPES.has(ev.type));

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: research output + follow-up */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Event feed */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-6">
            {mainEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
                <Loader2 className="h-8 w-8 mb-3 animate-spin opacity-40" />
                <p className="text-sm">Waiting for run to start…</p>
              </div>
            ) : (
              <div>
                {mainEvents.map((ev, idx) => {
                  const rendered = renderEvent(ev);
                  if (!rendered) return null;
                  const spacing = getEventSpacing(mainEvents, idx);
                  return (
                    <div
                      key={ev.id}
                      className={idx === 0 ? "" : spacing}
                    >
                      {rendered}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Follow-up chat with proper ChatComposer */}
        {showFollowup && (
          <FollowupChat analystId={analystId} recentTheses={recentTheses} />
        )}
      </div>

      {/* Right: sources panel */}
      <div className="hidden lg:flex w-[300px] border-l overflow-y-auto flex-col">
        <SourcesPanel events={events} />
      </div>
    </div>
  );
}
