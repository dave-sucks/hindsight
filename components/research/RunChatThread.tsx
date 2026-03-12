"use client";

import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  SkipForward,
  AlertCircle,
  ExternalLink,
  Loader2,
  ShoppingCart,
  Search,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AssistantMessage } from "@/components/chat/AssistantMessage";
import type { SourceChipData } from "@/components/chat/SourceChip";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
} from "@/components/ai-elements/sources";
import {
  ThesisCard,
  type ThesisCardData,
  MarketContextCard,
  type MarketContextData,
  RunSummaryCard,
  type RunSummaryData,
  type PickRanking,
  ResearchStepCard,
} from "@/components/domain";
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

type DataFetchStep = {
  id: string;
  label: string;
  status: "loading" | "done" | "error";
  details?: string;
};

// ─── Safe casters ─────────────────────────────────────────────────────────────

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

// ─── Chat message model ──────────────────────────────────────────────────────

type ChatMsg =
  | { kind: "kickoff"; analystName: string; config: Record<string, unknown> }
  | { kind: "market_context"; data: MarketContextData }
  | { kind: "scanning"; sectors: string[]; text: string; scannerSteps: DataFetchStep[] }
  | { kind: "candidates"; tickers: string[]; selection: { ticker: string; score: number; sources: string[] }[] }
  | {
      kind: "ticker_group";
      ticker: string;
      company: string;
      toolCalls: DataFetchStep[];
      sources: SourceChipData[];
      concept: { direction: string; confidence: number | null; notes: string } | null;
      thesis: ThesisCardData | null;
      reasoning: string;
      isPass: boolean;
      passReason: string;
    }
  | { kind: "trade_placed"; ticker: string; direction: string; entry: number | null }
  | { kind: "run_summary"; data: RunSummaryData }
  | { kind: "run_complete"; analyzed: number; recommended: number; placed: number | null }
  | { kind: "error"; ticker: string; message: string }
  | { kind: "thinking"; ticker: string };

// ─── Transform events → chat messages ─────────────────────────────────────────

function eventsToMessages(
  events: RunEventRow[],
  analystName: string,
  config: Record<string, unknown>,
  isLive: boolean
): ChatMsg[] {
  const msgs: ChatMsg[] = [];

  // Always start with the kickoff message
  msgs.push({ kind: "kickoff", analystName, config });

  // Group per-ticker events
  const tickerGroups: Record<
    string,
    {
      company: string;
      toolCalls: DataFetchStep[];
      sources: SourceChipData[];
      concept: { direction: string; confidence: number | null; notes: string } | null;
      thesis: ThesisCardData | null;
      reasoning: string;
      isPass: boolean;
      passReason: string;
    }
  > = {};

  function ensureGroup(ticker: string) {
    if (!tickerGroups[ticker]) {
      tickerGroups[ticker] = {
        company: "",
        toolCalls: [],
        sources: [],
        concept: null,
        thesis: null,
        reasoning: "",
        isPass: false,
        passReason: "",
      };
    }
    return tickerGroups[ticker];
  }

  // Track which tickers we've seen so we can emit groups in order
  const tickerOrder: string[] = [];
  let scanSeen = false;
  let candidatesSeen = false;
  let completeSeen = false;
  const scannerSteps: DataFetchStep[] = [];
  let candidatesSelection: { ticker: string; score: number; sources: string[] }[] = [];
  let marketContextData: MarketContextData | null = null;
  let runSummaryData: RunSummaryData | null = null;

  for (const ev of events) {
    const payload = asRecord(ev.payload);

    switch (ev.type) {
      // ── Phase 1: Market Context ─────────────────────────────────────
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
          portfolioStatus: portfolioRaw.openPositions != null
            ? {
                openPositions: asNumber(portfolioRaw.openPositions) ?? asNumber(portfolioRaw.open_positions) ?? 0,
                capitalDeployed: asNumber(portfolioRaw.capitalDeployed) ?? asNumber(portfolioRaw.capital_deployed) ?? 0,
                capitalAvailable: asNumber(portfolioRaw.capitalAvailable) ?? asNumber(portfolioRaw.capital_available) ?? 0,
              }
            : undefined,
        };
        break;
      }

      // ── Phase 2: Scanning ───────────────────────────────────────────
      case "scan_start":
      case "scanning": {
        if (!scanSeen) {
          scanSeen = true;
        }
        break;
      }

      case "scanner_source": {
        scannerSteps.push({
          id: ev.id,
          label: asString(payload.summary) || `Checking ${asString(payload.source)}`,
          status: "done",
          details: asString(payload.summary),
        });
        break;
      }

      case "candidates_selected": {
        candidatesSelection = asArray<Record<string, unknown>>(payload.selection).map((s) => ({
          ticker: asString(s.ticker),
          score: asNumber(s.score) ?? 0,
          sources: asArray<string>(s.sources),
        }));
        // Fall through to candidates
      }
      // falls through
      case "candidates": {
        if (!candidatesSeen) {
          const tickers =
            candidatesSelection.length > 0
              ? candidatesSelection.map((s) => s.ticker)
              : asArray<string>(payload.tickers);
          msgs.push({
            kind: "candidates",
            tickers,
            selection: candidatesSelection,
          });
          candidatesSeen = true;
        }
        break;
      }

      // ── Phase 3-4: Per-ticker research ──────────────────────────────
      case "analyzing": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          g.company = asString(payload.company);
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
          g.toolCalls.push({
            id: ev.id,
            label,
            status: "done",
            details: asString(payload.details || payload.summary),
          });
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
          const sourcesArr = asArray<Record<string, unknown>>(payload.sources);
          for (const s of sourcesArr) {
            g.sources.push({
              provider: asString(s.provider),
              title: asString(s.title) || asString(s.provider),
              url: asString(s.url) || undefined,
            });
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
            status: "done",
            details: asString(payload.summary),
          });
          g.sources.push({
            provider: "technical",
            title: "Technical Indicators",
            excerpt: asString(payload.summary) || undefined,
          });
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }

      case "concept": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          g.concept = {
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
        if (ticker) {
          ensureGroup(ticker);
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }

      case "thesis_reasoning": {
        const ticker = asString(payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          g.reasoning += asString(payload.text);
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }

      case "thesis_complete": {
        const raw = asRecord(payload.thesis ?? payload);
        const ticker = asString(raw.ticker || payload.ticker);
        if (ticker) {
          const g = ensureGroup(ticker);
          const direction = (asString(raw.direction) || "PASS") as
            | "LONG"
            | "SHORT"
            | "PASS";
          if (direction === "PASS") {
            g.isPass = true;
            g.passReason =
              asString(raw.pass_reason || raw.reasoning_summary) ||
              "No clear tradeable signal";
          }
          g.thesis = {
            ticker,
            direction,
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
          g.passReason =
            asString(payload.reason) || "Below confidence threshold";
          if (!g.thesis) {
            g.thesis = {
              ticker,
              direction: "PASS",
              confidence_score: asNumber(payload.confidence) ?? 0,
              pass_reason: g.passReason,
            };
          }
          if (!tickerOrder.includes(ticker)) tickerOrder.push(ticker);
        }
        break;
      }

      // ── Trade events ────────────────────────────────────────────────
      case "trade_placed": {
        msgs.push({
          kind: "trade_placed",
          ticker: asString(payload.ticker),
          direction: asString(payload.direction).toUpperCase() || "LONG",
          entry: asNumber(payload.entry),
        });
        break;
      }

      // ── Phase 5: Portfolio Synthesis ─────────────────────────────────
      case "run_summary": {
        const rankedPicks = asArray<Record<string, unknown>>(payload.ranked_picks).map(
          (p, i) => ({
            rank: asNumber(p.rank) ?? i + 1,
            ticker: asString(p.ticker),
            direction: (asString(p.action) === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT",
            confidence: asNumber(p.confidence) ?? 0,
            reasoning: asString(p.reasoning),
            action: (asString(p.action) === "SKIP"
              ? "PASS"
              : asString(p.action) === "BUY"
                ? "TRADE"
                : asString(p.action) || "TRADE") as PickRanking["action"],
          })
        );

        runSummaryData = {
          marketSummary: asString(payload.summary),
          rankedPicks,
          riskNotes: asArray<string>(payload.risk_notes),
          overallAssessment: asString(payload.overall_assessment) || undefined,
        };
        break;
      }

      // ── Run complete ────────────────────────────────────────────────
      case "run_complete": {
        completeSeen = true;
        msgs.push({
          kind: "run_complete",
          analyzed: asNumber(payload.analyzed) ?? 0,
          recommended: asNumber(payload.recommended) ?? 0,
          placed: asNumber(payload.placed),
        });
        break;
      }

      case "ticker_error":
      case "error": {
        const ticker = asString(payload.ticker);
        msgs.push({
          kind: "error",
          ticker,
          message: asString(payload.message || payload.text),
        });
        break;
      }
    }
  }

  // Insert market context after kickoff if we have it
  if (marketContextData) {
    msgs.splice(1, 0, { kind: "market_context", data: marketContextData });
  }

  // Insert scanning message with scanner steps
  if (scanSeen) {
    const scanIdx = marketContextData ? 2 : 1;
    const sectors = asArray<string>(
      asRecord(events.find((e) => e.type === "scanning")?.payload).sectors
    );
    msgs.splice(scanIdx, 0, {
      kind: "scanning",
      sectors,
      text:
        sectors.length > 0
          ? `Scanning **${sectors.join(", ")}** for opportunities...`
          : "Scanning market for opportunities...",
      scannerSteps,
    });
  }

  // Insert ticker group messages in order (after candidates, before trades)
  const insertIdx = msgs.findIndex((m) => m.kind === "candidates");
  const insertAt = insertIdx >= 0 ? insertIdx + 1 : msgs.length;

  const groupMsgs: ChatMsg[] = tickerOrder.map((ticker) => {
    const g = tickerGroups[ticker];
    return {
      kind: "ticker_group" as const,
      ticker,
      company: g.company,
      toolCalls: g.toolCalls,
      sources: g.sources,
      concept: g.concept,
      thesis: g.thesis,
      reasoning: g.reasoning,
      isPass: g.isPass,
      passReason: g.passReason,
    };
  });

  msgs.splice(insertAt, 0, ...groupMsgs);

  // Insert run summary before run_complete if we have it
  if (runSummaryData) {
    const completeIdx = msgs.findIndex((m) => m.kind === "run_complete");
    if (completeIdx >= 0) {
      msgs.splice(completeIdx, 0, { kind: "run_summary", data: runSummaryData });
    } else {
      msgs.push({ kind: "run_summary", data: runSummaryData });
    }
  }

  return msgs;
}

// ─── Config badges ──────────────────────────────────────────────────────────

function ConfigBadges({ config }: { config: Record<string, unknown> }) {
  const direction = asString(config.directionBias || config.direction_bias);
  const holdDurations = asArray<string>(
    config.holdDurations || config.hold_durations
  );
  const minConf = asNumber(config.minConfidence || config.min_confidence);
  const sectors = asArray<string>(config.sectors);

  const items: { label: string; value: string }[] = [];
  if (direction) items.push({ label: "Direction", value: direction });
  if (holdDurations.length > 0)
    items.push({ label: "Hold", value: holdDurations.join(", ") });
  if (minConf != null) items.push({ label: "Min Conf", value: `${minConf}%` });
  if (sectors.length > 0)
    items.push({ label: "Sectors", value: sectors.slice(0, 3).join(", ") });

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {items.map((item) => (
        <Badge key={item.label} variant="outline" className="text-[10px] gap-1">
          <span className="text-muted-foreground">{item.label}:</span>
          <span>{item.value}</span>
        </Badge>
      ))}
    </div>
  );
}

// ─── Step status mapping ─────────────────────────────────────────────────────

function mapStepStatus(s: DataFetchStep["status"]): "complete" | "active" | "pending" {
  if (s === "done") return "complete";
  if (s === "loading") return "active";
  return "complete";
}

function stepIcon(s: DataFetchStep["status"]) {
  if (s === "loading") return Loader2;
  if (s === "error") return AlertCircle;
  return CheckCircle2;
}

// ─── Per-message renderers ────────────────────────────────────────────────────

function KickoffMessage({
  analystName,
  config,
}: {
  analystName: string;
  config: Record<string, unknown>;
}) {
  return (
    <AssistantMessage
      content={`Starting research run for **${analystName}**`}
    >
      <ConfigBadges config={config} />
    </AssistantMessage>
  );
}

function MarketContextMessage({ data }: { data: MarketContextData }) {
  return <MarketContextCard {...data} />;
}

function ScanningMessage({ text, scannerSteps }: { text: string; scannerSteps: DataFetchStep[] }) {
  return (
    <AssistantMessage content={text}>
      {scannerSteps.length > 0 ? (
        <ChainOfThought defaultOpen={false}>
          <ChainOfThoughtHeader>
            {scannerSteps.length} source{scannerSteps.length !== 1 ? "s" : ""} scanned
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {scannerSteps.map((tc, i) => (
              <ChainOfThoughtStep
                key={tc.id}
                label={tc.label}
                status={mapStepStatus(tc.status)}
                description={tc.details}
                icon={stepIcon(tc.status)}
                className={cn(
                  i === scannerSteps.length - 1 && "[&_div.absolute]:hidden"
                )}
              />
            ))}
          </ChainOfThoughtContent>
        </ChainOfThought>
      ) : (
        <div className="text-xs text-muted-foreground">
          <Shimmer duration={1.5}>Discovering candidates...</Shimmer>
        </div>
      )}
    </AssistantMessage>
  );
}

function CandidatesMessage({
  tickers,
  selection,
}: {
  tickers: string[];
  selection: { ticker: string; score: number; sources: string[] }[];
}) {
  return (
    <AssistantMessage
      content={`Found **${tickers.length}** candidate${tickers.length !== 1 ? "s" : ""} to analyze:`}
    >
      <div className="flex flex-wrap gap-1.5">
        {selection.length > 0
          ? selection.map((s) => (
              <Badge key={s.ticker} variant="outline" className="font-mono text-xs gap-1.5">
                {s.ticker}
                {s.score > 0 && (
                  <span className="text-muted-foreground tabular-nums text-[10px]">
                    {s.score}pt
                  </span>
                )}
              </Badge>
            ))
          : tickers.map((t) => (
              <Badge key={t} variant="outline" className="font-mono text-xs">
                {t}
              </Badge>
            ))}
      </div>
    </AssistantMessage>
  );
}

function TickerGroupMessage({
  ticker,
  company,
  toolCalls,
  sources,
  concept,
  thesis,
  reasoning,
  isPass,
  passReason,
  isLive,
}: {
  ticker: string;
  company: string;
  toolCalls: DataFetchStep[];
  sources: SourceChipData[];
  concept: { direction: string; confidence: number | null; notes: string } | null;
  thesis: ThesisCardData | null;
  reasoning: string;
  isPass: boolean;
  passReason: string;
  isLive: boolean;
}) {
  const isAnalyzing = !thesis && !isPass;
  const conceptDir = concept?.direction;
  const conceptConf = concept?.confidence;
  const hasReasoning = reasoning.length > 0;
  const isStreamingReasoning = isLive && isAnalyzing && hasReasoning;

  return (
    <div className="space-y-3">
      {/* Ticker header */}
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">
          Researching{" "}
          <span className="font-mono font-semibold">{ticker}</span>
          {company && (
            <span className="text-muted-foreground font-normal"> ({company})</span>
          )}
        </span>
      </div>

      {/* Data fetch steps — ChainOfThought timeline */}
      {toolCalls.length > 0 && (
        <ChainOfThought defaultOpen={false}>
          <ChainOfThoughtHeader>
            {toolCalls.length} data source{toolCalls.length !== 1 ? "s" : ""} fetched
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {toolCalls.map((tc, i) => (
              <ChainOfThoughtStep
                key={tc.id}
                label={tc.label}
                status={mapStepStatus(tc.status)}
                description={tc.details}
                icon={stepIcon(tc.status)}
                className={cn(
                  i === toolCalls.length - 1 && "[&_div.absolute]:hidden"
                )}
              />
            ))}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )}

      {/* Concept signal */}
      {concept && (
        <p className="text-xs text-muted-foreground">
          Initial signal:{" "}
          <span
            className={cn(
              "font-semibold",
              conceptDir === "LONG"
                ? "text-emerald-500"
                : conceptDir === "SHORT"
                  ? "text-red-500"
                  : "text-muted-foreground"
            )}
          >
            {conceptDir}
          </span>
          {conceptConf != null && (
            <span className="tabular-nums"> at {conceptConf}% confidence</span>
          )}
        </p>
      )}

      {/* Reasoning block — shows AI thinking during thesis generation */}
      {hasReasoning && (
        <Reasoning
          isStreaming={isStreamingReasoning}
          defaultOpen={isStreamingReasoning ? undefined : false}
        >
          <ReasoningTrigger
            getThinkingMessage={(streaming, duration) => {
              if (streaming) return <Shimmer duration={1}>Building thesis...</Shimmer>;
              if (duration) return <p>Analyzed for {duration}s</p>;
              return <p>Thesis reasoning</p>;
            }}
          />
          <ReasoningContent>{reasoning}</ReasoningContent>
        </Reasoning>
      )}

      {/* Thesis card */}
      {thesis && thesis.direction !== "PASS" && <ThesisCard {...thesis} />}

      {/* Pass message */}
      {(isPass || thesis?.direction === "PASS") && (
        <>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <SkipForward className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Passed on{" "}
              <span className="font-mono font-medium text-foreground">
                {ticker}
              </span>
              {conceptConf != null && (
                <span className="tabular-nums"> — {conceptConf}% confidence</span>
              )}
              {passReason && <span> · {passReason}</span>}
            </span>
          </div>
          {/* Sources for passed tickers (no ThesisCard to show them) */}
          {sources.length > 0 && (
            <Sources className="pt-1">
              <SourcesTrigger count={sources.length} />
              <SourcesContent>
                {sources.map((s, i) => (
                  <div key={`${s.provider}-${i}`} className="flex items-center gap-2 text-xs">
                    <span className="tabular-nums text-muted-foreground w-4 text-right shrink-0">
                      {i + 1}.
                    </span>
                    <span className="font-medium truncate max-w-[240px]">
                      {s.title || s.provider}
                    </span>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline shrink-0"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </SourcesContent>
            </Sources>
          )}
        </>
      )}

      {/* Still analyzing (live) */}
      {isAnalyzing && isLive && !hasReasoning && (
        <div className="text-xs text-muted-foreground">
          <Shimmer duration={1.5}>Generating thesis...</Shimmer>
        </div>
      )}
    </div>
  );
}

function TradePlacedMessage({
  ticker,
  direction,
  entry,
}: {
  ticker: string;
  direction: string;
  entry: number | null;
}) {
  const isLong = direction === "LONG";
  const Icon = isLong ? TrendingUp : TrendingDown;
  const color = isLong ? "text-emerald-500" : "text-red-500";

  return (
    <div className="flex items-center gap-2 text-sm rounded-lg border bg-muted/30 px-4 py-3">
      <ShoppingCart className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>
        Paper trade placed:{" "}
        <span className="font-mono font-semibold">{ticker}</span>{" "}
        <span className={cn("font-semibold", color)}>
          <Icon className="inline h-3 w-3 mr-0.5" />
          {direction}
        </span>
        {entry != null && (
          <span className="tabular-nums text-muted-foreground"> @ ${entry.toFixed(2)}</span>
        )}
      </span>
    </div>
  );
}

function RunSummaryMessage({ data }: { data: RunSummaryData }) {
  return <RunSummaryCard {...data} />;
}

function RunCompleteMessage({
  analyzed,
  recommended,
  placed,
}: {
  analyzed: number;
  recommended: number;
  placed: number | null;
}) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        Run complete
      </div>
      <div className="mt-2 flex gap-4 text-sm text-muted-foreground tabular-nums">
        <span>{analyzed} analyzed</span>
        <span className="text-border">|</span>
        <span className="text-emerald-500">{recommended} recommended</span>
        {placed != null && placed > 0 && (
          <>
            <span className="text-border">|</span>
            <span>{placed} trades placed</span>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorMessage({ ticker, message }: { ticker: string; message: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-red-500">
      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        {ticker ? (
          <>
            Error on{" "}
            <span className="font-mono font-semibold">{ticker}</span>:{" "}
          </>
        ) : null}
        {message}
      </span>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function RunChatThread({
  events,
  analystName = "Agent",
  config = {},
  isLive = false,
  composerSlot,
}: {
  events: RunEventRow[];
  analystName?: string;
  config?: Record<string, unknown>;
  isLive?: boolean;
  /** Optional composer/follow-up chat rendered below the thread */
  composerSlot?: React.ReactNode;
}) {
  const messages = eventsToMessages(events, analystName, config, isLive);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Conversation>
        <ConversationContent className="mx-auto max-w-2xl px-4 sm:px-6 py-6 gap-6">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Loader2 className="h-8 w-8 animate-spin opacity-40" />}
              title="Waiting for run to start..."
            />
          ) : (
            messages.map((msg, i) => {
              switch (msg.kind) {
                case "kickoff":
                  return (
                    <KickoffMessage
                      key={i}
                      analystName={msg.analystName}
                      config={msg.config}
                    />
                  );
                case "market_context":
                  return <MarketContextMessage key={i} data={msg.data} />;
                case "scanning":
                  return (
                    <ScanningMessage
                      key={i}
                      text={msg.text}
                      scannerSteps={msg.scannerSteps}
                    />
                  );
                case "candidates":
                  return (
                    <CandidatesMessage
                      key={i}
                      tickers={msg.tickers}
                      selection={msg.selection}
                    />
                  );
                case "ticker_group":
                  return (
                    <TickerGroupMessage
                      key={`ticker-${msg.ticker}`}
                      ticker={msg.ticker}
                      company={msg.company}
                      toolCalls={msg.toolCalls}
                      sources={msg.sources}
                      concept={msg.concept}
                      thesis={msg.thesis}
                      reasoning={msg.reasoning}
                      isPass={msg.isPass}
                      passReason={msg.passReason}
                      isLive={isLive}
                    />
                  );
                case "trade_placed":
                  return (
                    <TradePlacedMessage
                      key={i}
                      ticker={msg.ticker}
                      direction={msg.direction}
                      entry={msg.entry}
                    />
                  );
                case "run_summary":
                  return <RunSummaryMessage key={i} data={msg.data} />;
                case "run_complete":
                  return (
                    <RunCompleteMessage
                      key={i}
                      analyzed={msg.analyzed}
                      recommended={msg.recommended}
                      placed={msg.placed}
                    />
                  );
                case "error":
                  return (
                    <ErrorMessage
                      key={i}
                      ticker={msg.ticker}
                      message={msg.message}
                    />
                  );
                default:
                  return null;
              }
            })
          )}

          {/* Live streaming indicator at the bottom */}
          {isLive &&
            !messages.some((m) => m.kind === "run_complete") && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                <span>Research in progress...</span>
              </div>
            )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Composer slot (follow-up chat) */}
      {composerSlot}
    </div>
  );
}
