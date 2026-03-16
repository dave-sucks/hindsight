"use client";

import { createContext, useContext, useState } from "react";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useAssistantToolUI } from "@assistant-ui/react";
import {
  ArrowRight,
  Check,
  BarChart3,
  Activity,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  FileText,
  Briefcase,
  GitCompare,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── UI Components ──────────────────────────────────────────────────────────

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ─── Domain Components ──────────────────────────────────────────────────────

import {
  AgentConfigCard,
  type AgentConfigData,
} from "@/components/domain/agent-config-card";
import {
  ThesisCard,
  type ThesisCardData,
  TradeCard,
  TradeConfirmation,
  StockCard,
  RunSummaryCard,
} from "@/components/domain";

// ─── Chat UI Components ─────────────────────────────────────────────────────

import { OrderConfirm } from "@/components/manifest-ui/order-confirm";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
  ChainOfThoughtContent,
} from "@/components/ai-elements/chain-of-thought";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselItem,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselPrev,
  InlineCitationCarouselNext,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";

// ─── Context for passing callbacks into tool UIs ────────────────────────────

type ToolUICallbacks = {
  /** Builder mode: create from config */
  onConfirmConfig?: (config: AgentConfigData) => void;
  isCreating?: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
  /** Editor mode: apply diff against existing config */
  currentConfig?: Record<string, unknown>;
  onApplyConfig?: (config: AgentConfigData) => void;
  isApplying?: boolean;
  applied?: boolean;
};

const ToolUICallbacksContext = createContext<ToolUICallbacks>({});

export const ToolUICallbacksProvider = ToolUICallbacksContext.Provider;
export const useToolUICallbacks = () => useContext(ToolUICallbacksContext);

// ─── Shared: source attribution helpers ──────────────────────────────────────

interface SourceData {
  provider: string;
  title: string;
  url?: string;
  excerpt?: string;
}

/** Extract _sources from a tool result, falling back to provider-only strings */
function extractToolSources(result: Record<string, unknown>): SourceData[] {
  const raw = result._sources;
  if (Array.isArray(raw)) {
    return raw.filter(
      (s): s is SourceData =>
        typeof s === "object" && s !== null && "provider" in s && "title" in s,
    );
  }
  return [];
}

const PROVIDER_DOMAINS: Record<string, string> = {
  finnhub: "https://finnhub.io",
  fmp: "https://financialmodelingprep.com",
  reddit: "https://reddit.com",
  stocktwits: "https://stocktwits.com",
  twitter: "https://x.com",
  "fmp social": "https://financialmodelingprep.com",
  technical: "https://finnhub.io",
  earnings: "https://finnhub.io",
  options: "https://financialmodelingprep.com",
  sec: "https://sec.gov",
};

/** Get a valid URL for a source (needed by InlineCitationCardTrigger) */
function sourceUrl(s: SourceData): string {
  if (s.url) return s.url;
  const key = s.provider.toLowerCase().replace(/[^a-z ]/g, "");
  return PROVIDER_DOMAINS[key] ?? `https://${s.provider.toLowerCase().replace(/[^a-z]/g, "")}.com`;
}

/** Favicon from a URL */
function faviconFromUrl(url: string): string | null {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`;
  } catch {
    return null;
  }
}

/** Provider row with favicon + name for carousel items */
function ProviderRow({ provider, url }: { provider: string; url: string }) {
  const favicon = faviconFromUrl(url);
  return (
    <div className="flex items-center gap-2 mb-1">
      {favicon && (
        <img src={favicon} alt="" width={16} height={16} className="size-4 shrink-0 rounded-sm" />
      )}
      <span className="text-xs font-medium text-muted-foreground">{provider}</span>
    </div>
  );
}

function SourceChips({ sources }: { sources: SourceData[] }) {
  if (!sources.length) return null;
  const urls = sources.map(sourceUrl);

  return (
    <div className="mt-1.5">
      <InlineCitation>
        <InlineCitationCard>
          <InlineCitationCardTrigger sources={urls} />
          <InlineCitationCardBody>
            <InlineCitationCarousel>
              <InlineCitationCarouselHeader>
                <InlineCitationCarouselPrev />
                <InlineCitationCarouselNext />
                <InlineCitationCarouselIndex />
              </InlineCitationCarouselHeader>
              <InlineCitationCarouselContent>
                {sources.map((s, i) => (
                  <InlineCitationCarouselItem key={`${s.provider}-${i}`}>
                    <ProviderRow provider={s.provider} url={urls[i]} />
                    <InlineCitationSource
                      title={s.title}
                      url={s.url}
                      description={s.excerpt}
                    />
                  </InlineCitationCarouselItem>
                ))}
              </InlineCitationCarouselContent>
            </InlineCitationCarousel>
          </InlineCitationCardBody>
        </InlineCitationCard>
      </InlineCitation>
    </div>
  );
}

// ─── suggest_config tool UI ─────────────────────────────────────────────────

const SuggestConfigRender: ToolCallMessagePartComponent<
  AgentConfigData,
  AgentConfigData
> = ({ args, status }) => {
  const { onConfirmConfig, isCreating, confirmLabel, confirmingLabel } =
    useToolUICallbacks();

  if (!args) return null;

  return (
    <div className="my-2">
      <AgentConfigCard
        {...args}
        onConfirm={
          onConfirmConfig ? () => onConfirmConfig(args) : undefined
        }
        isCreating={isCreating}
        showConfirmButton={!!onConfirmConfig}
        confirmLabel={confirmLabel}
        confirmingLabel={confirmingLabel}
      />
    </div>
  );
};

SuggestConfigRender.displayName = "SuggestConfigRender";

// ─── Config diff helpers (editor mode) ──────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  analystPrompt: "Strategy",
  directionBias: "Direction",
  holdDurations: "Hold Duration",
  sectors: "Sectors",
  signalTypes: "Signals",
  minConfidence: "Min Confidence",
  maxPositionSize: "Position Size",
  maxOpenPositions: "Max Positions",
  minMarketCapTier: "Market Cap",
  watchlist: "Watchlist",
  exclusionList: "Exclusion List",
};

function formatValue(key: string, val: unknown): string {
  if (val == null || val === "") return "—";
  if (Array.isArray(val)) return val.length === 0 ? "—" : val.join(", ");
  if (key === "maxPositionSize" && typeof val === "number")
    return `$${val.toLocaleString()}`;
  if (key === "minConfidence" && typeof val === "number") return `${val}%`;
  if (typeof val === "string" && key === "analystPrompt")
    return val.length > 80 ? val.slice(0, 80) + "…" : val;
  return String(val);
}

function computeDiff(
  before: Record<string, unknown>,
  after: AgentConfigData
): { label: string; before: string; after: string }[] {
  const diffs: { label: string; before: string; after: string }[] = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const bStr = formatValue(key, before[key]);
    const aStr = formatValue(key, after[key as keyof AgentConfigData]);
    if (bStr !== aStr) diffs.push({ label, before: bStr, after: aStr });
  }
  return diffs;
}

// ─── Editor-mode suggest_config render (with diff) ──────────────────────────

const SuggestConfigEditorRender: ToolCallMessagePartComponent<
  AgentConfigData,
  AgentConfigData
> = ({ args }) => {
  const { currentConfig, onApplyConfig, isApplying, applied } =
    useToolUICallbacks();
  const [showFull, setShowFull] = useState(false);

  if (!args || !currentConfig) return null;

  const diffs = computeDiff(currentConfig, args);

  if (diffs.length === 0) {
    return (
      <Card className="p-4 mt-1">
        <p className="text-sm text-muted-foreground">No changes detected.</p>
      </Card>
    );
  }

  return (
    <div className="my-2 space-y-3">
      <Card className="overflow-hidden p-0">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Proposed Changes
          </h4>
          <Badge variant="secondary">
            {diffs.length} {diffs.length === 1 ? "change" : "changes"}
          </Badge>
        </div>
        <div className="px-5 py-4 space-y-3">
          {diffs.map((d) => (
            <div key={d.label} className="text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {d.label}
              </span>
              <div className="flex items-start gap-2.5 mt-1">
                <span className="text-red-500 line-through min-w-0 break-words text-sm">
                  {d.before}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="text-emerald-500 font-medium min-w-0 break-words text-sm">
                  {d.after}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-4">
          <button
            onClick={() => setShowFull(!showFull)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
          >
            {showFull ? "Hide full config" : "Show full config"}
          </button>
        </div>
      </Card>

      {showFull && (
        <AgentConfigCard
          {...args}
          showConfirmButton={false}
          className="border-dashed"
        />
      )}

      {applied ? (
        <Card className="p-4 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2 text-sm text-emerald-500 font-medium">
            <Check className="h-4 w-4" />
            Changes applied successfully
          </div>
        </Card>
      ) : (
        onApplyConfig && (
          <Button
            onClick={() => onApplyConfig(args)}
            disabled={isApplying}
            className="w-full h-10"
            size="default"
          >
            <Check className="h-4 w-4 mr-2" />
            {isApplying ? "Applying…" : "Apply Changes"}
          </Button>
        )
      )}
    </div>
  );
};

SuggestConfigEditorRender.displayName = "SuggestConfigEditorRender";

// ─── Research tool UI registrations (shared across agent, builder, editor) ───

/**
 * Register all 14 research tool UIs used by the agent.
 * Extracted from AgentThread.tsx so any chat context can render the same
 * rich domain cards. Sources aggregated in Sources tab.
 */
export function useRegisterResearchToolUIs(_runId?: string) {
  // ── Market overview — rendered as CoT step by ResearchToolGroup ────
  useAssistantToolUI({
    toolName: "get_market_overview",
    render: () => null,
  });

  // ── Scan candidates — rendered as CoT step by ResearchToolGroup ────
  useAssistantToolUI({
    toolName: "scan_candidates",
    render: () => null,
  });

  // ── Detect market themes — rendered as CoT step by ResearchToolGroup ────
  useAssistantToolUI({
    toolName: "detect_market_themes",
    render: () => null,
  });

  // ── Scan catalysts — rendered as CoT step by ResearchToolGroup ────
  useAssistantToolUI({
    toolName: "scan_catalysts",
    render: () => null,
  });

  // ── Stock data → StockCard (CoT step via ResearchToolGroup, news in Sources tab) ─
  useAssistantToolUI({
    toolName: "get_stock_data",
    render: ({ args, result }) => {
      const ticker = (args as { ticker?: string })?.ticker ?? "";

      if (!result) return null;

      const quote = result.quote as {
        price: number;
        change: number;
        change_pct: number;
        high: number;
        low: number;
      } | null;
      const company = result.company as {
        name: string;
        sector: string;
        market_cap: number | null;
        exchange: string;
      } | null;
      const financials = result.financials as {
        pe_ratio: number | null;
        pb_ratio: number | null;
        high_52w: number | null;
        low_52w: number | null;
        avg_volume_10d: number | null;
        beta: number | null;
      } | null;
      const consensus = result.analyst_consensus as {
        buy: number;
        hold: number;
        sell: number;
        strong_buy: number;
        strong_sell: number;
      } | null;

      return (
        <div className="my-2 space-y-1.5">
          <StockCard
            ticker={ticker}
            companyName={company?.name}
            price={quote?.price}
            change={quote?.change}
            changePct={quote?.change_pct}
            sector={company?.sector}
            marketCap={company?.market_cap}
            exchange={company?.exchange}
            dayHigh={quote?.high}
            dayLow={quote?.low}
            peRatio={financials?.pe_ratio}
            beta={financials?.beta}
            high52w={financials?.high_52w}
            low52w={financials?.low_52w}
            avgVolume={
              financials?.avg_volume_10d
                ? financials.avg_volume_10d * 1_000_000
                : null
            }
            analystConsensus={
              consensus
                ? {
                    buy: consensus.buy,
                    hold: consensus.hold,
                    sell: consensus.sell,
                    strongBuy: consensus.strong_buy,
                    strongSell: consensus.strong_sell,
                  }
                : null
            }
          />
          <SourceChips sources={extractToolSources(result as Record<string, unknown>)} />
        </div>
      );
    },
  });

  // ── Technical analysis — rendered as CoT step by ResearchToolGroup ──
  useAssistantToolUI({
    toolName: "get_technical_analysis",
    render: () => null,
  });

  // ── Earnings data — rendered as CoT step by ResearchToolGroup ───────
  useAssistantToolUI({
    toolName: "get_earnings_data",
    render: () => null,
  });

  // ── Options flow — rendered as CoT step by ResearchToolGroup ────────
  useAssistantToolUI({
    toolName: "get_options_flow",
    render: () => null,
  });

  // ── Reddit sentiment — rendered as CoT step by ResearchToolGroup ────
  useAssistantToolUI({
    toolName: "get_reddit_sentiment",
    render: () => null,
  });

  // ── StockTwits sentiment — rendered as CoT step by ResearchToolGroup
  useAssistantToolUI({
    toolName: "get_twitter_sentiment",
    render: () => null,
  });

  // ── SEC Filings — rendered as CoT step by ResearchToolGroup ─────────
  useAssistantToolUI({
    toolName: "get_sec_filings",
    render: () => null,
  });

  // ── Analyst Targets — rendered as CoT step by ResearchToolGroup ─────
  useAssistantToolUI({
    toolName: "get_analyst_targets",
    render: () => null,
  });

  // ── Company Peers — rendered as CoT step by ResearchToolGroup ───────
  useAssistantToolUI({
    toolName: "get_company_peers",
    render: () => null,
  });

  // ── News Deep Dive — CoT step via ResearchToolGroup, articles in Sources tab ─
  useAssistantToolUI({
    toolName: "get_news_deep_dive",
    render: () => null,
  });

  // ── Thesis → ThesisCard (compact preview, opens sheet on click) ────
  useAssistantToolUI({
    toolName: "show_thesis",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Building thesis</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={CheckCircle2} label="Data collected" status="complete" />
              <ChainOfThoughtStep icon={BarChart3} label="Generating direction + confidence" status="active" />
              <ChainOfThoughtStep icon={FileText} label="Writing full analysis" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const sources = extractToolSources(result as Record<string, unknown>);
      const thesis: ThesisCardData = {
        ticker: result.ticker as string,
        direction: result.direction as "LONG" | "SHORT" | "PASS",
        confidence_score: result.confidence_score as number,
        reasoning_summary: result.reasoning_summary as string,
        thesis_bullets: (result.thesis_bullets ?? []) as string[],
        risk_flags: (result.risk_flags ?? []) as string[],
        entry_price: (result.entry_price as number) ?? null,
        target_price: (result.target_price as number) ?? null,
        stop_loss: (result.stop_loss as number) ?? null,
        hold_duration: (result.hold_duration as string) ?? "SWING",
        signal_types: (result.signal_types ?? []) as string[],
        company_name: (result.company_name as string) ?? null,
        exchange: (result.exchange as string) ?? null,
        sources: sources.map((s) => ({
          provider: s.provider,
          title: s.title,
          url: s.url,
          excerpt: s.excerpt,
        })),
      };

      return (
        <div className="my-2">
          <ThesisCard {...thesis} />
        </div>
      );
    },
  });

  // ── Place trade → OrderConfirm (pending) / TradeCard (filled) ─────
  useAssistantToolUI({
    toolName: "place_trade",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-2 max-w-md">
            <OrderConfirm
              data={{
                productName: "Placing trade…",
                productVariant: "Submitting to Alpaca Paper",
              }}
              control={{ isLoading: true }}
            />
          </div>
        );
      }

      const status = result.status as string;

      if (status === "failed") {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Trade failed: {String(result.error || result.note || "Unknown error")}
          </div>
        );
      }

      return (
        <div className="my-2">
          <TradeCard
            ticker={result.ticker as string}
            direction={result.direction as "LONG" | "SHORT"}
            entryPrice={(result.fill_price as number) ?? (result.entry_price as number)}
            shares={result.shares as number}
            targetPrice={result.target_price as number | undefined}
            stopLoss={result.stop_loss as number | undefined}
            companyName={(result.company_name as string) ?? undefined}
            exchange={(result.exchange as string) ?? undefined}
            status="OPEN"
          />
        </div>
      );
    },
  });

  // ── Run summary → RunSummaryCard ──────────────────────────────────
  useAssistantToolUI({
    toolName: "summarize_run",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Portfolio synthesis</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={BarChart3} label="Ranking picks by conviction" status="active" />
              <ChainOfThoughtStep icon={Activity} label="Calculating exposure" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const rankedPicks = (result.ranked_picks ?? []) as {
        rank: number;
        ticker: string;
        direction: "LONG" | "SHORT";
        confidence: number;
        reasoning: string;
        action: "TRADE" | "WATCH" | "PASS";
      }[];

      const exposure = result.exposure_breakdown as {
        long_exposure: number;
        short_exposure: number;
        net_exposure: number;
        sector_concentration?: string;
      } | null;

      return (
        <div className="my-2">
          <RunSummaryCard
            marketSummary={result.market_summary as string}
            rankedPicks={rankedPicks}
            exposureBreakdown={
              exposure
                ? {
                    longExposure: exposure.long_exposure,
                    shortExposure: exposure.short_exposure,
                    netExposure: exposure.net_exposure,
                    sectorConcentration: exposure.sector_concentration,
                  }
                : undefined
            }
            riskNotes={(result.risk_notes ?? []) as string[]}
            overallAssessment={result.overall_assessment as string}
          />
        </div>
      );
    },
  });
}

// ─── Registration hooks ─────────────────────────────────────────────────────

/**
 * Register suggest_config tool UI for the builder (shows full config card + create button).
 * Also registers research tool UIs with domain cards where possible.
 */
export function useRegisterBuilderToolUIs() {
  // Reuse the SAME research tool UIs as the agent run (domain cards)
  useRegisterResearchToolUIs();

  // Builder-only: suggest_config renders as config card + create button
  useAssistantToolUI({
    toolName: "suggest_config",
    render: SuggestConfigRender,
  });
}

/**
 * Register suggest_config tool UI for the editor (shows diff card + apply button).
 * Also registers research tool UIs with domain cards where possible.
 */
export function useRegisterEditorToolUIs() {
  // Reuse the SAME research tool UIs as the agent run (domain cards)
  useRegisterResearchToolUIs();

  // Editor-only: suggest_config renders as diff card + apply button
  useAssistantToolUI({
    toolName: "suggest_config",
    render: SuggestConfigEditorRender,
  });
}


// ─── Trading / Research / Portfolio tool UIs (run-followup chat) ────────────

// ── research_ticker / get_thesis → ThesisCard ───────────────────────────────

const ResearchTickerRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(r.error)}
      </div>
    );
  }
  const thesis: ThesisCardData = {
    ticker: String(r.ticker ?? ""),
    direction: String(r.direction ?? "PASS") as "LONG" | "SHORT" | "PASS",
    confidence_score: Number(r.confidence_score ?? 0),
    reasoning_summary: String(r.reasoning_summary ?? ""),
    thesis_bullets: Array.isArray(r.thesis_bullets)
      ? (r.thesis_bullets as string[])
      : [],
    risk_flags: Array.isArray(r.risk_flags)
      ? (r.risk_flags as string[])
      : [],
    entry_price: typeof r.entry_price === "number" ? r.entry_price : null,
    target_price: typeof r.target_price === "number" ? r.target_price : null,
    stop_loss: typeof r.stop_loss === "number" ? r.stop_loss : null,
    hold_duration: String(r.hold_duration ?? "SWING"),
    signal_types: Array.isArray(r.signal_types)
      ? (r.signal_types as string[])
      : [],
  };
  return (
    <div className="my-2">
      <ThesisCard {...thesis} />
    </div>
  );
};
ResearchTickerRender.displayName = "ResearchTickerRender";

// ── place_trade → TradeConfirmation (pending) / TradeCard (result) ───────────

const PlaceTradeRender: ToolCallMessagePartComponent = ({ args, result, status }) => {
  // Pending state — show confirmation preview
  if (!result && args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    const dir = String(a.direction ?? "LONG").toUpperCase();
    return (
      <div className="my-2">
        <TradeConfirmation
          ticker={String(a.ticker ?? "")}
          direction={dir === "SHORT" ? "SHORT" : "LONG"}
          shares={typeof a.shares === "number" ? a.shares : undefined}
          estimatedPrice={typeof a.price === "number" ? a.price : null}
          estimatedCost={
            typeof a.price === "number" && typeof a.shares === "number"
              ? a.price * a.shares
              : null
          }
          action="BUY"
          onConfirm={() => {}}
          onCancel={() => {}}
          isExecuting
          resolved="confirmed"
          className="max-w-md"
        />
      </div>
    );
  }

  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(r.error)}
      </div>
    );
  }
  const dir = String(r.direction ?? "LONG").toUpperCase();
  return (
    <div className="my-2">
      <TradeCard
        ticker={String(r.ticker ?? "")}
        direction={dir === "SHORT" ? "SHORT" : "LONG"}
        entryPrice={typeof r.fillPrice === "number" ? r.fillPrice : 0}
        shares={typeof r.shares === "number" ? r.shares : undefined}
        status="OPEN"
        className="max-w-md"
      />
    </div>
  );
};
PlaceTradeRender.displayName = "PlaceTradeRender";

// ── close_position → TradeCard (closed state) ──────────────────────────────

const ClosePositionRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.error) {
    return (
      <div className="text-sm text-red-500 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
        {String(r.error)}
      </div>
    );
  }
  const dir = String(r.direction ?? "LONG").toUpperCase();
  const pnl = typeof r.realizedPnl === "number" ? r.realizedPnl : null;
  const outcome = String(r.outcome ?? "").toUpperCase();
  return (
    <div className="my-2">
      <TradeCard
        ticker={String(r.ticker ?? "")}
        direction={dir === "SHORT" ? "SHORT" : "LONG"}
        entryPrice={typeof r.entryPrice === "number" ? r.entryPrice : 0}
        closePrice={typeof r.closePrice === "number" ? r.closePrice : null}
        realizedPnl={pnl}
        outcome={
          outcome === "WIN" || outcome === "LOSS" || outcome === "BREAKEVEN"
            ? outcome
            : null
        }
        status="CLOSED"
        className="max-w-md"
      />
    </div>
  );
};
ClosePositionRender.displayName = "ClosePositionRender";

// ── portfolio_status ────────────────────────────────────────────────────────

const PortfolioStatusRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const positions = Array.isArray(r.positions) ? r.positions.length : 0;
  const unrealized =
    typeof r.unrealizedPnl === "number" ? r.unrealizedPnl : null;
  const winRate = typeof r.winRate === "number" ? r.winRate : null;
  return (
    <div className="my-2 rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Briefcase className="h-4 w-4 text-muted-foreground" />
        Portfolio Status
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Positions
          </p>
          <p className="text-sm tabular-nums font-semibold">{positions}</p>
        </div>
        {unrealized != null && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Unrealized
            </p>
            <p
              className={cn(
                "text-sm tabular-nums font-semibold",
                unrealized >= 0 ? "text-emerald-500" : "text-red-500"
              )}
            >
              {unrealized >= 0 ? "+" : ""}${unrealized.toFixed(2)}
            </p>
          </div>
        )}
        {winRate != null && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Win Rate
            </p>
            <p className="text-sm tabular-nums font-semibold">
              {winRate.toFixed(0)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
PortfolioStatusRender.displayName = "PortfolioStatusRender";

// ── compare_tickers ─────────────────────────────────────────────────────────

const CompareTickersRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const tickers = Array.isArray(r.tickers)
    ? (r.tickers as string[])
    : [];
  const recommended = String(r.recommended ?? "");
  return (
    <div className="my-2 rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <GitCompare className="h-4 w-4 text-muted-foreground" />
        Comparing {tickers.join(" vs ")}
      </div>
      {recommended && (
        <p className="text-sm">
          Recommendation:{" "}
          <span className="font-mono font-semibold text-emerald-500">
            {recommended}
          </span>
        </p>
      )}
    </div>
  );
};
CompareTickersRender.displayName = "CompareTickersRender";

// ── performance_report ──────────────────────────────────────────────────────

const PerformanceReportRender: ToolCallMessagePartComponent = ({
  result,
}) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const wins = typeof r.wins === "number" ? r.wins : 0;
  const losses = typeof r.losses === "number" ? r.losses : 0;
  const winRate = typeof r.winRate === "number" ? r.winRate : null;
  return (
    <div className="my-2 rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        Performance Report
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Wins
          </p>
          <p className="text-sm tabular-nums font-semibold text-emerald-500">
            {wins}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Losses
          </p>
          <p className="text-sm tabular-nums font-semibold text-red-500">
            {losses}
          </p>
        </div>
        {winRate != null && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Win Rate
            </p>
            <p className="text-sm tabular-nums font-semibold">
              {winRate.toFixed(0)}%
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
PerformanceReportRender.displayName = "PerformanceReportRender";

// ── explain_decision ────────────────────────────────────────────────────────

const ExplainDecisionRender: ToolCallMessagePartComponent = ({ result }) => {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  return (
    <div className="my-2 rounded-lg border p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <HelpCircle className="h-4 w-4 text-muted-foreground" />
        Decision:{" "}
        <span className="font-mono">{String(r.ticker)}</span>
      </div>
      {typeof r.explanation === "string" && (
        <p className="text-sm text-muted-foreground">{r.explanation}</p>
      )}
    </div>
  );
};
ExplainDecisionRender.displayName = "ExplainDecisionRender";

// ─── Registration hook for run-followup tools ───────────────────────────────

/**
 * Register all trading/research/portfolio tool UIs for the run-followup chat.
 */
export function useRegisterFollowupToolUIs() {
  useAssistantToolUI({ toolName: "research_ticker", render: ResearchTickerRender });
  useAssistantToolUI({ toolName: "get_thesis", render: ResearchTickerRender });
  useAssistantToolUI({ toolName: "place_trade", render: PlaceTradeRender });
  useAssistantToolUI({ toolName: "close_position", render: ClosePositionRender });
  useAssistantToolUI({ toolName: "modify_position", render: ClosePositionRender });
  useAssistantToolUI({ toolName: "add_to_position", render: PlaceTradeRender });
  useAssistantToolUI({ toolName: "portfolio_status", render: PortfolioStatusRender });
  useAssistantToolUI({ toolName: "compare_tickers", render: CompareTickersRender });
  useAssistantToolUI({ toolName: "performance_report", render: PerformanceReportRender });
  useAssistantToolUI({ toolName: "explain_decision", render: ExplainDecisionRender });
  useAssistantToolUI({ toolName: "run_summary", render: PerformanceReportRender });
}
