"use client";

import { useCallback, useMemo, useState, useRef } from "react";
import type { FC } from "react";
import {
  useExternalStoreRuntime,
  AssistantRuntimeProvider,
  useAssistantToolUI,
  type ThreadMessageLike,
  type AppendMessage,
} from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import {
  useRegisterFollowupToolUIs,
  ToolUICallbacksProvider,
} from "@/components/assistant-ui/tool-uis";
import type { RunEventRow } from "@/components/research/types";
import type { RunFollowupContext } from "@/components/research/RunFollowupChat";

// ─── Run event tool UI imports ──────────────────────────────────────────────

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ThesisCard,
  type ThesisCardData,
  MarketContextCard,
  type MarketContextData,
  RunSummaryCard,
  type RunSummaryData,
  type PickRanking,
  TradeCard,
} from "@/components/domain";
import { SourceChipRow, type SourceChipData } from "@/components/chat/SourceChip";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
} from "@/components/ai-elements/chain-of-thought";
import { ThesisArtifactSheet } from "@/components/research/ThesisArtifactSheet";
import {
  CheckCircle2,
  SkipForward,
  AlertCircle,
  Sparkles,
  Radar,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  Brain,
} from "lucide-react";

// ─── Safe casters (reused from RunChatThread) ──────────────────────────────

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

// ─── Convert run events to ThreadMessageLike[] ─────────────────────────────

interface ConvertedMessage {
  id: string;
  role: "assistant" | "user";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool-call"; toolCallId: string; toolName: string; args: Record<string, unknown>; result?: unknown }
  >;
  createdAt: Date;
}

function eventsToThreadMessages(
  events: RunEventRow[],
  analystName: string,
  config: Record<string, unknown>,
): ConvertedMessage[] {
  const msgs: ConvertedMessage[] = [];

  // ── Group per-ticker events first ─────────────────────────────────────
  const tickerGroups: Record<string, {
    company: string;
    toolCalls: { id: string; label: string; status: string; details?: string }[];
    sources: SourceChipData[];
    concept: { direction: string; confidence: number | null; notes: string } | null;
    thesis: ThesisCardData | null;
    reasoning: string;
    isPass: boolean;
    passReason: string;
  }> = {};
  const tickerOrder: string[] = [];
  let marketContextData: MarketContextData | null = null;
  const scannerSteps: { label: string; details?: string }[] = [];
  let scanSeen = false;
  let candidatesSelection: { ticker: string; score: number; sources: string[] }[] = [];
  let candidatesTickers: string[] = [];
  let runSummaryData: RunSummaryData | null = null;
  let runCompleteData: { analyzed: number; recommended: number; placed: number | null } | null = null;

  function ensureGroup(ticker: string) {
    if (!tickerGroups[ticker]) {
      tickerGroups[ticker] = {
        company: "", toolCalls: [], sources: [], concept: null,
        thesis: null, reasoning: "", isPass: false, passReason: "",
      };
    }
    return tickerGroups[ticker];
  }

  for (const ev of events) {
    const payload = asRecord(ev.payload);

    switch (ev.type) {
      case "market_context": {
        const topSectors = asArray<Record<string, unknown>>(payload.top_sectors).map((s) => ({
          name: asString(s.name || s.symbol),
          change: (asNumber(s.change) ?? asNumber(s.change_pct)) ?? 0,
        }));
        const bottomSectors = asArray<Record<string, unknown>>(payload.bottom_sectors).map((s) => ({
          name: asString(s.name || s.symbol),
          change: (asNumber(s.change) ?? asNumber(s.change_pct)) ?? 0,
        }));
        const portfolioRaw = asRecord(payload.portfolio_summary);
        marketContextData = {
          regime: (asString(payload.regime) || "range_bound") as MarketContextData["regime"],
          keyLevels: asString(payload.key_levels) || undefined,
          sectorRotation: asString(payload.sector_rotation_notes) || undefined,
          todaysApproach: asString(payload.approach_summary) || "Analyzing market conditions...",
          spxChange: asNumber(payload.spx_change_pct) ?? undefined,
          vixLevel: asNumber(payload.vix_level) ?? undefined,
          topSectors,
          bottomSectors,
          portfolioStatus: portfolioRaw.openPositions != null ? {
            openPositions: asNumber(portfolioRaw.openPositions) ?? asNumber(portfolioRaw.open_positions) ?? 0,
            capitalDeployed: asNumber(portfolioRaw.capitalDeployed) ?? asNumber(portfolioRaw.capital_deployed) ?? 0,
            capitalAvailable: asNumber(portfolioRaw.capitalAvailable) ?? asNumber(portfolioRaw.capital_available) ?? 0,
          } : undefined,
        };
        break;
      }
      case "scan_start":
      case "scanning":
        scanSeen = true;
        break;
      case "scanner_source":
        scannerSteps.push({
          label: asString(payload.summary) || `Checking ${asString(payload.source)}`,
          details: asString(payload.summary),
        });
        break;
      case "candidates_selected":
        candidatesSelection = asArray<Record<string, unknown>>(payload.selection).map((s) => ({
          ticker: asString(s.ticker), score: asNumber(s.score) ?? 0, sources: asArray<string>(s.sources),
        }));
        candidatesTickers = candidatesSelection.map(s => s.ticker);
        break;
      case "candidates":
        if (candidatesTickers.length === 0) {
          candidatesTickers = asArray<string>(payload.tickers);
        }
        break;
      case "analyzing": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          ensureGroup(ticker).company = asString(payload.company);
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }
      case "data_fetch":
      case "source_fetched": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          const source = asString(payload.source || payload.provider);
          const label = asString(payload.label || payload.message) || `Fetching ${source}`;
          g.toolCalls.push({ id: ev.id, label, status: "done", details: asString(payload.details || payload.summary) });
          if (source) {
            g.sources.push({
              provider: source,
              title: asString(payload.title) || source,
              url: asString(payload.url) || undefined,
              excerpt: asString(payload.excerpt || payload.summary) || undefined,
            });
          }
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }
      case "data_ready": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          for (const s of asArray<Record<string, unknown>>(payload.sources)) {
            g.sources.push({ provider: asString(s.provider), title: asString(s.title) || asString(s.provider), url: asString(s.url) || undefined });
          }
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }
      case "technical_summary": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          g.toolCalls.push({
            id: ev.id,
            label: `Technical analysis: RSI ${asNumber(payload.rsi)?.toFixed(0) ?? "—"}, MACD ${asNumber(payload.macd)?.toFixed(2) ?? "—"}`,
            status: "done", details: asString(payload.summary),
          });
          g.sources.push({ provider: "technical", title: "Technical Indicators", excerpt: asString(payload.summary) || undefined });
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }
      case "concept": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          ensureGroup(ticker).concept = {
            direction: asString(payload.direction).toUpperCase(),
            confidence: asNumber(payload.confidence),
            notes: asString(payload.reasoning_notes || payload.reasoning || payload.notes),
          };
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }
      case "thesis_writing": {
        const ticker = asString(payload.ticker);
        if (ticker) { ensureGroup(ticker); if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker); }
        break;
      }
      case "thesis_reasoning": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          ensureGroup(ticker).reasoning += asString(payload.text);
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }
      case "thesis_complete": {
        const raw = asRecord(payload.thesis ?? payload);
        const ticker = asString(raw.ticker || payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          const direction = (asString(raw.direction) || "PASS") as "LONG" | "SHORT" | "PASS";
          if (direction === "PASS") {
            g.isPass = true;
            g.passReason = asString(raw.pass_reason || raw.reasoning_summary) || "No clear tradeable signal";
          }
          g.thesis = {
            ticker, direction,
            confidence_score: asNumber(raw.confidence_score) ?? 0,
            reasoning_summary: asString(raw.reasoning_summary),
            thesis_bullets: asArray<string>(raw.thesis_bullets),
            risk_flags: asArray<string>(raw.risk_flags),
            entry_price: asNumber(raw.entry_price),
            target_price: asNumber(raw.target_price),
            stop_loss: asNumber(raw.stop_loss),
            hold_duration: asString(raw.hold_duration) || "SWING",
            signal_types: asArray<string>(raw.signal_types),
            sources: g.sources,
            pass_reason: asString(raw.pass_reason),
          };
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }
      case "skip": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          g.isPass = true;
          g.passReason = asString(payload.reason) || "Below confidence threshold";
          if (!g.thesis) {
            g.thesis = { ticker, direction: "PASS", confidence_score: asNumber(payload.confidence) ?? 0, pass_reason: g.passReason };
          }
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }
      case "trade_placed":
        msgs.push({
          id: `trade-${ev.id}`,
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: `trade-${ev.id}`,
            toolName: "run_trade_placed",
            args: {
              ticker: asString(payload.ticker),
              direction: asString(payload.direction).toUpperCase() || "LONG",
              entry: asNumber(payload.entry),
              target: asNumber(payload.target_price),
              stop: asNumber(payload.stop_loss),
              shares: asNumber(payload.shares),
            },
          }],
          createdAt: new Date(ev.createdAt),
        });
        break;
      case "run_summary": {
        const rankedPicks = asArray<Record<string, unknown>>(payload.ranked_picks).map((p, i) => ({
          rank: asNumber(p.rank) ?? i + 1,
          ticker: asString(p.ticker),
          direction: (asString(p.action) === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT",
          confidence: asNumber(p.confidence) ?? 0,
          reasoning: asString(p.reasoning),
          action: (asString(p.action) === "SKIP" ? "PASS" : asString(p.action) === "BUY" ? "TRADE" : asString(p.action) || "TRADE") as PickRanking["action"],
        }));
        runSummaryData = {
          marketSummary: asString(payload.summary),
          rankedPicks,
          riskNotes: asArray<string>(payload.risk_notes),
          overallAssessment: asString(payload.overall_assessment) || undefined,
        };
        break;
      }
      case "run_complete":
        runCompleteData = {
          analyzed: asNumber(payload.analyzed) ?? 0,
          recommended: asNumber(payload.recommended) ?? 0,
          placed: asNumber(payload.placed),
        };
        break;
      case "ticker_error":
      case "error":
        msgs.push({
          id: `err-${ev.id}`,
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: `err-${ev.id}`,
            toolName: "run_error",
            args: { ticker: asString(payload.ticker), message: asString(payload.message || payload.text) },
          }],
          createdAt: new Date(ev.createdAt),
        });
        break;
    }
  }

  // ── Build ordered message list ────────────────────────────────────────
  const baseDate = events[0]?.createdAt ? new Date(events[0].createdAt) : new Date();
  let msgIdx = 0;

  // 1. Kickoff
  msgs.unshift({
    id: `run-kickoff-${msgIdx++}`,
    role: "assistant",
    content: [{
      type: "tool-call",
      toolCallId: `kickoff-0`,
      toolName: "run_kickoff",
      args: { analystName, config },
      result: { analystName, config },
    }],
    createdAt: baseDate,
  });

  // 2. Market context
  if (marketContextData) {
    msgs.splice(1, 0, {
      id: `run-market-${msgIdx++}`,
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: `market-0`,
        toolName: "run_market_context",
        args: marketContextData as unknown as Record<string, unknown>,
        result: marketContextData,
      }],
      createdAt: baseDate,
    });
  }

  // 3. Scanning
  if (scanSeen) {
    const scanIdx = marketContextData ? 2 : 1;
    const sectors = asArray<string>(
      asRecord(events.find((e) => e.type === "scanning")?.payload).sectors
    );
    msgs.splice(scanIdx, 0, {
      id: `run-scan-${msgIdx++}`,
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: `scan-0`,
        toolName: "run_scanning",
        args: { steps: scannerSteps, sectors },
        result: { steps: scannerSteps },
      }],
      createdAt: baseDate,
    });
  }

  // 4. Candidates
  if (candidatesTickers.length > 0) {
    const candidateIdx = msgs.length;
    msgs.splice(candidateIdx, 0, {
      id: `run-candidates-${msgIdx++}`,
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: `candidates-0`,
        toolName: "run_candidates",
        args: { tickers: candidatesTickers, selection: candidatesSelection },
        result: { tickers: candidatesTickers, selection: candidatesSelection },
      }],
      createdAt: baseDate,
    });
  }

  // 5. Per-ticker groups
  for (const ticker of tickerOrder) {
    const g = tickerGroups[ticker];
    msgs.push({
      id: `run-ticker-${ticker}`,
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: `ticker-${ticker}`,
        toolName: "run_ticker_group",
        args: {
          ticker,
          company: g.company,
          toolCalls: g.toolCalls,
          sources: g.sources,
          concept: g.concept,
          thesis: g.thesis,
          reasoning: g.reasoning,
          isPass: g.isPass,
          passReason: g.passReason,
        },
        result: { ticker, thesis: g.thesis, isPass: g.isPass },
      }],
      createdAt: baseDate,
    });
  }

  // 6. Run summary
  if (runSummaryData) {
    msgs.push({
      id: `run-summary-${msgIdx++}`,
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: `summary-0`,
        toolName: "run_summary_card",
        args: runSummaryData as unknown as Record<string, unknown>,
        result: runSummaryData,
      }],
      createdAt: baseDate,
    });
  }

  // 7. Run complete
  if (runCompleteData) {
    msgs.push({
      id: `run-complete-${msgIdx++}`,
      role: "assistant",
      content: [{
        type: "tool-call",
        toolCallId: `complete-0`,
        toolName: "run_complete",
        args: runCompleteData as unknown as Record<string, unknown>,
        result: runCompleteData,
      }],
      createdAt: baseDate,
    });
  }

  return msgs;
}

// ─── Tool UI renderers for run events ──────────────────────────────────────

function useRegisterRunEventToolUIs() {
  // ── Kickoff ─────────────────────────────────────────────────────────────
  useAssistantToolUI({
    toolName: "run_kickoff",
    render: ({ args }) => {
      const a = args as { analystName: string; config: Record<string, unknown> };
      const direction = asString(a.config?.directionBias || a.config?.direction_bias);
      const holdDurations = asArray<string>(a.config?.holdDurations || a.config?.hold_durations);
      const minConf = asNumber(a.config?.minConfidence || a.config?.min_confidence);
      const sectors = asArray<string>(a.config?.sectors);

      return (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm leading-relaxed">
              Starting research run. I&apos;ll scan the market, analyze candidates across multiple data sources, and build thesis reports for the most promising opportunities.
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {direction && (
                <Badge variant="outline" className="text-[10px] gap-1 font-normal">
                  <Target className="h-2.5 w-2.5 text-muted-foreground" />
                  {direction}
                </Badge>
              )}
              {holdDurations.length > 0 && (
                <Badge variant="outline" className="text-[10px] gap-1 font-normal">
                  Hold: {holdDurations.join(", ")}
                </Badge>
              )}
              {minConf != null && (
                <Badge variant="outline" className="text-[10px] gap-1 font-normal tabular-nums">
                  Min {minConf}% confidence
                </Badge>
              )}
              {sectors.length > 0 && (
                <Badge variant="outline" className="text-[10px] gap-1 font-normal">
                  {sectors.slice(0, 3).join(", ")}{sectors.length > 3 ? ` +${sectors.length - 3}` : ""}
                </Badge>
              )}
            </div>
          </div>
        </div>
      );
    },
  });

  // ── Market Context ──────────────────────────────────────────────────────
  useAssistantToolUI({
    toolName: "run_market_context",
    render: ({ args }) => (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Let me pull up today&apos;s market environment before diving in.
        </p>
        <MarketContextCard {...(args as unknown as MarketContextData)} />
      </div>
    ),
  });

  // ── Scanning ────────────────────────────────────────────────────────────
  useAssistantToolUI({
    toolName: "run_scanning",
    render: ({ args }) => {
      const a = args as { steps: { label: string; details?: string }[]; sectors: string[] };
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Radar className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm">
              Scanning {a.sectors?.length > 0 ? (
                <span className="font-medium">{a.sectors.join(", ")}</span>
              ) : "the market"} for opportunities...
            </p>
          </div>
          {a.steps && a.steps.length > 0 && (
            <ChainOfThought defaultOpen={false}>
              <ChainOfThoughtHeader>
                {a.steps.length} sources checked
              </ChainOfThoughtHeader>
              <ChainOfThoughtContent>
                {a.steps.map((step, i) => (
                  <ChainOfThoughtStep
                    key={i}
                    label={step.label}
                    description={step.details}
                    status="complete"
                  />
                ))}
              </ChainOfThoughtContent>
            </ChainOfThought>
          )}
        </div>
      );
    },
  });

  // ── Candidates ──────────────────────────────────────────────────────────
  useAssistantToolUI({
    toolName: "run_candidates",
    render: ({ args }) => {
      const a = args as { tickers: string[]; selection: { ticker: string; score: number; sources: string[] }[] };
      const hasScores = a.selection?.some(s => s.score > 0);

      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <p className="text-sm">
              Found <span className="font-semibold tabular-nums">{a.tickers.length}</span> candidate{a.tickers.length !== 1 ? "s" : ""} worth investigating:
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(a.selection?.length > 0 ? a.selection : a.tickers.map(t => ({ ticker: t, score: 0, sources: [] }))).map((s) => (
              <div
                key={s.ticker}
                className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
              >
                <span className="font-mono text-sm font-semibold">{s.ticker}</span>
                {hasScores && s.score > 0 && (
                  <span className={cn(
                    "text-[10px] tabular-nums font-medium px-1.5 py-0.5 rounded-full",
                    s.score >= 70 ? "bg-emerald-500/10 text-emerald-500" :
                    s.score >= 50 ? "bg-amber-500/10 text-amber-500" :
                    "bg-muted text-muted-foreground",
                  )}>
                    {s.score}pt
                  </span>
                )}
                {s.sources.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {s.sources.length} source{s.sources.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    },
  });

  // ── Ticker Group (full per-ticker research) ────────────────────────────
  useAssistantToolUI({
    toolName: "run_ticker_group",
    render: ({ args }) => {
      const a = args as {
        ticker: string;
        company: string;
        toolCalls: { id: string; label: string; status: string; details?: string }[];
        sources: SourceChipData[];
        concept: { direction: string; confidence: number | null; notes: string } | null;
        thesis: ThesisCardData | null;
        reasoning: string;
        isPass: boolean;
        passReason: string;
      };

      const conceptDir = a.concept?.direction;
      const conceptConf = a.concept?.confidence;
      const isPass = a.isPass || a.thesis?.direction === "PASS";
      const hasThesis = a.thesis && a.thesis.direction !== "PASS";

      return (
        <div className="space-y-3">
          {/* ── Ticker header ──────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg font-mono text-xs font-bold shrink-0",
              hasThesis ? "bg-primary/10 text-primary" :
              isPass ? "bg-muted text-muted-foreground" :
              "bg-muted text-foreground",
            )}>
              {a.ticker.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold">{a.ticker}</span>
                {a.company && <span className="text-xs text-muted-foreground">({a.company})</span>}
              </div>
              {a.sources.length > 0 && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {a.sources.length} source{a.sources.length !== 1 ? "s" : ""} analyzed
                </span>
              )}
            </div>
          </div>

          {/* ── Source chips ──────────────────────────────────────── */}
          {a.sources.length > 0 && (
            <SourceChipRow sources={a.sources} />
          )}

          {/* ── Research steps (collapsible chain-of-thought) ──────── */}
          {a.toolCalls.length > 0 && (
            <ChainOfThought defaultOpen={false}>
              <ChainOfThoughtHeader>
                Data collection — {a.toolCalls.length} source{a.toolCalls.length !== 1 ? "s" : ""}
              </ChainOfThoughtHeader>
              <ChainOfThoughtContent>
                {a.toolCalls.map((tc) => (
                  <ChainOfThoughtStep
                    key={tc.id}
                    label={tc.label}
                    description={tc.details}
                    status="complete"
                  />
                ))}
              </ChainOfThoughtContent>
            </ChainOfThought>
          )}

          {/* ── Concept signal ────────────────────────────────────── */}
          {a.concept && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
              <Brain className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Initial signal:</span>
                  <span className={cn(
                    "font-semibold",
                    conceptDir === "LONG" ? "text-emerald-500" :
                    conceptDir === "SHORT" ? "text-red-500" :
                    "text-muted-foreground",
                  )}>
                    {conceptDir}
                  </span>
                  {conceptConf != null && (
                    <span className={cn(
                      "text-xs tabular-nums font-medium px-1.5 py-0.5 rounded-full",
                      conceptConf >= 70 ? "bg-emerald-500/10 text-emerald-500" :
                      conceptConf >= 50 ? "bg-amber-500/10 text-amber-500" :
                      "bg-muted text-muted-foreground",
                    )}>
                      {conceptConf}%
                    </span>
                  )}
                </div>
                {a.concept.notes && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.concept.notes}</p>
                )}
              </div>
            </div>
          )}

          {/* ── Reasoning block (collapsible thinking) ───────────── */}
          {a.reasoning && a.reasoning.length > 0 && (
            <Reasoning defaultOpen={false}>
              <ReasoningTrigger
                getThinkingMessage={() => <span>Thesis reasoning</span>}
              />
              <ReasoningContent>
                <p className="whitespace-pre-wrap leading-relaxed">{a.reasoning}</p>
              </ReasoningContent>
            </Reasoning>
          )}

          {/* ── Thesis card + artifact sheet ──────────────────────── */}
          {hasThesis && a.thesis && (
            <div className="space-y-2">
              <ThesisCard {...a.thesis} />
              <ThesisArtifactSheet thesis={a.thesis} />
            </div>
          )}

          {/* ── Pass message ──────────────────────────────────────── */}
          {isPass && (
            <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/10 px-4 py-3">
              <SkipForward className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm">
                  <span className="text-muted-foreground">Passed on </span>
                  <span className="font-mono font-medium">{a.ticker}</span>
                  {conceptConf != null && (
                    <span className="text-muted-foreground tabular-nums"> — {conceptConf}% confidence</span>
                  )}
                </p>
                {a.passReason && (
                  <p className="text-xs text-muted-foreground leading-relaxed">{a.passReason}</p>
                )}
              </div>
            </div>
          )}
        </div>
      );
    },
  });

  // ── Trade Placed ────────────────────────────────────────────────────────
  useAssistantToolUI({
    toolName: "run_trade_placed",
    render: ({ args }) => {
      const a = args as {
        ticker: string;
        direction: string;
        entry: number | null;
        target?: number | null;
        stop?: number | null;
        shares?: number | null;
      };
      const isLong = a.direction === "LONG";
      const DirIcon = isLong ? ArrowUpRight : ArrowDownRight;

      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full shrink-0",
              isLong ? "bg-emerald-500/15" : "bg-red-500/15",
            )}>
              <DirIcon className={cn("h-3.5 w-3.5", isLong ? "text-emerald-500" : "text-red-500")} />
            </div>
            <p className="text-sm">
              Placing <span className={cn("font-semibold", isLong ? "text-emerald-500" : "text-red-500")}>{a.direction}</span>{" "}
              trade on <span className="font-mono font-semibold">{a.ticker}</span>
            </p>
          </div>
          <TradeCard
            ticker={a.ticker}
            direction={(a.direction === "LONG" || a.direction === "SHORT") ? a.direction : "LONG"}
            entryPrice={a.entry ?? 0}
            status="OPEN"
            targetPrice={a.target}
            stopLoss={a.stop}
            shares={a.shares ?? undefined}
            className="max-w-sm"
          />
        </div>
      );
    },
  });

  // ── Run Summary ─────────────────────────────────────────────────────────
  useAssistantToolUI({
    toolName: "run_summary_card",
    render: ({ args }) => (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">Portfolio Synthesis</p>
        </div>
        <RunSummaryCard {...(args as unknown as RunSummaryData)} />
      </div>
    ),
  });

  // ── Run Complete ────────────────────────────────────────────────────────
  useAssistantToolUI({
    toolName: "run_complete",
    render: ({ args }) => {
      const a = args as { analyzed: number; recommended: number; placed: number | null };
      return (
        <div className="rounded-xl border bg-gradient-to-br from-emerald-500/5 via-background to-primary/5 p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-semibold">Research Complete</p>
              <p className="text-xs text-muted-foreground">All candidates analyzed and scored</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 rounded-lg bg-muted/30 p-4 text-center">
            <div>
              <p className="text-2xl font-bold tabular-nums">{a.analyzed}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mt-1">Analyzed</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-emerald-500">{a.recommended}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mt-1">Recommended</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{a.placed ?? 0}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mt-1">Trades Placed</p>
            </div>
          </div>
        </div>
      );
    },
  });

  // ── Error ───────────────────────────────────────────────────────────────
  useAssistantToolUI({
    toolName: "run_error",
    render: ({ args }) => {
      const a = args as { ticker: string; message: string };
      return (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="text-sm text-red-500 font-medium">
              {a.ticker ? (<>Error analyzing <span className="font-mono">{a.ticker}</span></>) : "Error during research"}
            </p>
            <p className="text-xs text-red-500/70 mt-0.5">{a.message}</p>
          </div>
        </div>
      );
    },
  });
}

// ─── Inner component (inside AssistantRuntimeProvider) ──────────────────────

function RunThread() {
  useRegisterRunEventToolUIs();
  useRegisterFollowupToolUIs();

  return (
    <ToolUICallbacksProvider value={{}}>
      <Thread
        hideWelcome
        composerFeatures={{
          tickerSearch: true,
          slashCommands: true,
          placeholder: "Ask about this run, research a ticker, or place a trade…",
        }}
      />
    </ToolUICallbacksProvider>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

export function RunUnifiedChat({
  events,
  analystName = "Agent",
  config = {},
  runContext,
  isLive = false,
  className,
}: {
  events: RunEventRow[];
  analystName?: string;
  config?: Record<string, unknown>;
  runContext: RunFollowupContext;
  isLive?: boolean;
  className?: string;
}) {
  const runMessages = useMemo(
    () => eventsToThreadMessages(events, analystName, config),
    [events, analystName, config]
  );

  const [chatMessages, setChatMessages] = useState<ConvertedMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const allMessages = useMemo(
    () => [...runMessages, ...chatMessages],
    [runMessages, chatMessages]
  );

  const convertMessage = useCallback(
    (msg: ConvertedMessage): ThreadMessageLike => ({
      role: msg.role,
      content: msg.content as ThreadMessageLike["content"],
      id: msg.id,
      createdAt: msg.createdAt,
      status: { type: "complete" as const, reason: "stop" as const },
    }),
    []
  );

  const abortRef = useRef<AbortController | null>(null);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const textPart = message.content.find((p) => p.type === "text");
      if (!textPart || textPart.type !== "text") return;
      const input = textPart.text;

      const userMsg: ConvertedMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: [{ type: "text", text: input }],
        createdAt: new Date(),
      };
      setChatMessages((prev) => [...prev, userMsg]);
      setIsRunning(true);

      try {
        abortRef.current = new AbortController();

        const response = await fetch("/api/chat/run-followup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: input }],
            runContext,
          }),
          signal: abortRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("0:")) {
              try {
                const text = JSON.parse(line.slice(2));
                if (typeof text === "string") fullText += text;
              } catch {
                // skip unparseable
              }
            }
          }
        }

        const assistantMsg: ConvertedMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: [{ type: "text", text: fullText || "I processed your request." }],
          createdAt: new Date(),
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        const assistantMsg: ConvertedMessage = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: [{ type: "text", text: `Sorry, I encountered an error: ${err instanceof Error ? err.message : "Unknown error"}` }],
          createdAt: new Date(),
        };
        setChatMessages((prev) => [...prev, assistantMsg]);
      } finally {
        setIsRunning(false);
        abortRef.current = null;
      }
    },
    [allMessages, runContext]
  );

  const onCancel = useCallback(async () => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  const runtime = useExternalStoreRuntime({
    messages: allMessages,
    convertMessage,
    onNew,
    onCancel,
    isRunning,
  });

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <AssistantRuntimeProvider runtime={runtime}>
        <RunThread />
      </AssistantRuntimeProvider>
    </div>
  );
}
