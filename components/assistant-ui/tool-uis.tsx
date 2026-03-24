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
  Eye,
  Radar,
  Zap,
  Globe,
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
  PortfolioReviewCard,
  type PortfolioReviewData,
  DecisionSummaryCard,
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
  // ── Market context (was: market_overview + detect_market_themes) ────
  useAssistantToolUI({
    toolName: "get_market_context",
    render: () => null,
  });

  // ── Stock data → CoT only (rendered by ResearchToolGroup, no separate card) ──
  useAssistantToolUI({
    toolName: "get_stock_data",
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

  // ── SEC Filings — rendered as CoT step by ResearchToolGroup ─────────
  useAssistantToolUI({
    toolName: "get_sec_filings",
    render: () => null,
  });

  // ── V3 Intelligence Layer — CoT steps ────────────────────────────────────
  useAssistantToolUI({
    toolName: "read_morning_brief",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Reading morning intelligence brief...</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Radar} label="Loading today's brief" status="active" />
              <ChainOfThoughtStep icon={BarChart3} label="Market context" status="pending" />
              <ChainOfThoughtStep icon={Briefcase} label="Portfolio alerts" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const r = result as Record<string, unknown>;
      if (r.available === false) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>No morning brief available</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Radar} label="Intelligence jobs may not have run yet" status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const marketCtx = typeof r.marketContext === "string" ? r.marketContext.slice(0, 100) : "";
      const alertCount = Array.isArray(r.portfolioAlerts) ? r.portfolioAlerts.length : 0;
      const watchCount = Array.isArray(r.watchlistUpdates) ? r.watchlistUpdates.length : 0;
      const oppCount = Array.isArray(r.newOpportunities) ? r.newOpportunities.length : 0;

      return (
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>Morning intelligence brief</ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep icon={BarChart3} label={marketCtx ? `${marketCtx}…` : "Market context loaded"} status="complete" />
            <ChainOfThoughtStep icon={Briefcase} label={`${alertCount} portfolio alert${alertCount !== 1 ? "s" : ""}`} status="complete" />
            <ChainOfThoughtStep icon={Eye} label={`${watchCount} watchlist update${watchCount !== 1 ? "s" : ""}`} status="complete" />
            <ChainOfThoughtStep icon={Zap} label={`${oppCount} new opportunit${oppCount !== 1 ? "ies" : "y"}`} status="complete" />
          </ChainOfThoughtContent>
          <SourceChips sources={[{ provider: "Intelligence Pipeline", title: "Morning Brief", excerpt: `${r.signalCount ?? 0} signals synthesized` }]} />
        </ChainOfThought>
      );
    },
  });

  useAssistantToolUI({
    toolName: "read_signals",
    render: ({ args, result }) => {
      const filterTickers = (args as Record<string, unknown>)?.tickers as string[] | undefined;
      const filterType = (args as Record<string, unknown>)?.type as string | undefined;

      if (!result) {
        const filterCtx = filterTickers?.length
          ? ` for ${filterTickers.join(", ")}`
          : filterType
            ? ` (${filterType})`
            : "";
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Reading routed signals{filterCtx}...</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Zap} label="Querying intelligence feed" status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const r = result as Record<string, unknown>;
      const count = typeof r.count === "number" ? r.count : 0;
      const signals = Array.isArray(r.signals) ? r.signals as Record<string, unknown>[] : [];
      const urgent = signals.filter((s) => s.urgency === "HIGH" || s.urgency === "BREAKING").length;
      const bullish = signals.filter((s) => s.sentiment === "BULLISH").length;
      const bearish = signals.filter((s) => s.sentiment === "BEARISH").length;
      const top3 = signals.slice(0, 3).map((s) => s.headline as string).filter(Boolean);
      const allTickers = [...new Set(signals.flatMap((s) => Array.isArray(s.tickers) ? s.tickers as string[] : []))];
      const sourceNames = [...new Set(signals.flatMap((s) => Array.isArray(s.sourceNames) ? s.sourceNames as string[] : []))];

      return (
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>
            Read {count} signal{count !== 1 ? "s" : ""} ({urgent} urgent, {bullish} bullish, {bearish} bearish)
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            {top3.map((headline, i) => (
              <ChainOfThoughtStep key={i} icon={Zap} label={headline} status="complete" />
            ))}
            {count > 3 && (
              <ChainOfThoughtStep icon={Zap} label={`+${count - 3} more signals`} status="complete" />
            )}
          </ChainOfThoughtContent>
          {allTickers.length > 0 && (
            <div className="mt-1.5 flex items-center gap-1 flex-wrap px-1">
              {allTickers.slice(0, 8).map((t) => (
                <Badge key={t} variant="secondary">${t}</Badge>
              ))}
              {allTickers.length > 8 && (
                <span className="text-[11px] text-muted-foreground">+{allTickers.length - 8}</span>
              )}
            </div>
          )}
          <SourceChips sources={sourceNames.map((n) => ({ provider: n, title: `${n} signals` }))} />
        </ChainOfThought>
      );
    },
  });

  useAssistantToolUI({
    toolName: "read_artifact",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Reading full article...</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={FileText} label="Extracting article content" status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const r = result as Record<string, unknown>;
      if (r.error) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Article not found</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={FileText} label={String(r.error)} status="complete" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const title = typeof r.title === "string" ? r.title : "Untitled";
      const url = typeof r.url === "string" ? r.url : "";
      const content = typeof r.contentMarkdown === "string" ? r.contentMarkdown : "";
      const wordCount = content ? content.split(/\s+/).length : 0;
      let domain = "";
      try { domain = url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { /* */ }

      const sources = extractToolSources(r);

      return (
        <ChainOfThought defaultOpen>
          <ChainOfThoughtHeader>
            {domain ? `${domain}: ` : ""}{title} ({wordCount.toLocaleString()} words)
          </ChainOfThoughtHeader>
          <ChainOfThoughtContent>
            <ChainOfThoughtStep icon={FileText} label={title} status="complete" />
          </ChainOfThoughtContent>
          <SourceChips sources={sources.length > 0 ? sources : (domain ? [{ provider: domain, title, url }] : [])} />
        </ChainOfThought>
      );
    },
  });

  // ── Thesis → ThesisCard (compact preview, opens sheet on click) ────
  // Shared render for record_thesis (new) and show_thesis (backward compat alias)
  const thesisRender = ({ result }: { result?: Record<string, unknown> }) => {
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
      fundamentals: (result.fundamentals as ThesisCardData["fundamentals"]) ?? null,
      status: (result.status as ThesisCardData["status"]) ?? undefined,
    };

    return (
      <div className="my-2">
        <ThesisCard {...thesis} />
      </div>
    );
  };

  useAssistantToolUI({ toolName: "record_thesis", render: thesisRender });
  // Backward compat alias for old persisted messages
  useAssistantToolUI({ toolName: "show_thesis", render: thesisRender });

  // ── Portfolio state → kept for backward compat with old persisted messages ──
  useAssistantToolUI({
    toolName: "get_portfolio_state",
    render: ({ result }) => {
      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>Loading portfolio state</ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={BarChart3} label="Fetching positions and theses" status="active" />
              <ChainOfThoughtStep icon={Activity} label="Loading account balances" status="pending" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      if (result.error) {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Portfolio state failed: {String(result.error)}
          </div>
        );
      }

      return (
        <div className="my-2">
          <PortfolioReviewCard
            run_theses={(result.run_theses ?? []) as PortfolioReviewData["run_theses"]}
            open_positions={(result.open_positions ?? []) as PortfolioReviewData["open_positions"]}
            watchlist={(result.watchlist ?? []) as PortfolioReviewData["watchlist"]}
            account={(result.account ?? { cash: 0, buying_power: 0, portfolio_value: 0 }) as PortfolioReviewData["account"]}
          />
        </div>
      );
    },
  });

  // ── Close position → inline result card ─────────────────────────
  useAssistantToolUI({
    toolName: "close_position",
    render: ({ result }) => {
      if (!result) {
        return (
          <div className="my-1.5 text-xs text-muted-foreground rounded-md border px-3 py-2">
            Closing position…
          </div>
        );
      }

      // NO_POSITION or FAILED — clean inline message
      if (result.status === "NO_POSITION") {
        return (
          <div className="my-1.5 text-xs text-muted-foreground rounded-md border px-3 py-2">
            {String(result.message)}
          </div>
        );
      }

      if (result.status === "FAILED" || result.success === false) {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Close failed: {String(result.message)}
          </div>
        );
      }

      const pnl = typeof result.realized_pnl === "number" ? result.realized_pnl : 0;

      return (
        <div className="my-2">
          <TradeCard
            ticker={result.ticker as string}
            direction={result.direction as "LONG" | "SHORT"}
            entryPrice={typeof result.entry_price === "number" ? result.entry_price : 0}
            shares={typeof result.closed_qty === "number" ? result.closed_qty : undefined}
            closePrice={typeof result.close_price === "number" ? result.close_price : undefined}
            realizedPnl={pnl}
            outcome={(result.outcome as "WIN" | "LOSS" | "BREAKEVEN") ?? null}
            status="CLOSED"
          />
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

      if (result.status === "FAILED" || result.success === false) {
        return (
          <div className="my-1.5 text-xs text-negative rounded-md border border-negative/20 bg-negative/5 px-3 py-2">
            Trade failed: {String(result.message)}
          </div>
        );
      }

      return (
        <div className="my-2">
          <TradeCard
            ticker={result.ticker as string}
            direction={result.direction as "LONG" | "SHORT"}
            entryPrice={typeof result.entry_price === "number" ? result.entry_price : 0}
            shares={typeof result.shares === "number" ? result.shares : undefined}
            targetPrice={typeof result.target_price === "number" ? result.target_price : undefined}
            stopLoss={typeof result.stop_loss === "number" ? result.stop_loss : undefined}
            status="OPEN"
          />
        </div>
      );
    },
  });

  // ── Run summary → RunSummaryCard ──────────────────────────────────
  // Shared render for complete_run (new) and summarize_run (backward compat alias)
  const runSummaryRender = ({ result }: { result?: Record<string, unknown> }) => {
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
      direction: string;
      confidence: number;
      reasoning: string;
      action: string;
    }[];

    const exposure = result.exposure_breakdown as {
      long_exposure: number;
      short_exposure: number;
      net_exposure: number;
      sector_concentration?: string;
    } | null;

    // Decision picks for the V2 DecisionSummaryCard
    const decisionPicks = rankedPicks.map((p) => ({
      rank: p.rank,
      ticker: p.ticker,
      direction: p.direction,
      confidence: p.confidence,
      reasoning: p.reasoning,
      action: p.action,
    }));

    return (
      <div className="my-2">
        <DecisionSummaryCard
          rankedPicks={decisionPicks}
          marketSummary={result.market_summary as string}
          exposureBreakdown={
            exposure
              ? {
                  longExposure: exposure.long_exposure,
                  shortExposure: exposure.short_exposure,
                  netExposure: exposure.net_exposure,
                }
              : undefined
          }
          riskNotes={(result.risk_notes ?? []) as string[]}
          overallAssessment={result.overall_assessment as string}
          portfolioReview={result.portfolio_review as string | undefined}
        />
      </div>
    );
  };

  useAssistantToolUI({ toolName: "complete_run", render: runSummaryRender });
  // Backward compat alias for old persisted messages
  useAssistantToolUI({ toolName: "summarize_run", render: runSummaryRender });

  // ── Watchlist management → inline status card ───────────────────────
  useAssistantToolUI({
    toolName: "manage_watchlist",
    render: ({ args, result }) => {
      const action = (args?.action as string) ?? "";
      const ticker = (args?.ticker as string) ?? "";
      const reason = (args?.reason as string) ?? "";

      if (!result) {
        return (
          <ChainOfThought defaultOpen>
            <ChainOfThoughtHeader>
              {action === "ADD" ? `Adding $${ticker} to watchlist` : action === "REMOVE" ? `Removing $${ticker} from watchlist` : `Updating $${ticker} watchlist entry`}
            </ChainOfThoughtHeader>
            <ChainOfThoughtContent>
              <ChainOfThoughtStep icon={Eye} label={`${action} watchlist item`} status="active" />
            </ChainOfThoughtContent>
          </ChainOfThought>
        );
      }

      const success = result.success as boolean;
      const changed = result.changed as boolean;
      const watchlistItem = result.watchlist_item as Record<string, unknown> | undefined;
      const priority = watchlistItem?.priority as string | undefined;

      return (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            {success && changed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              {action === "ADD" ? `Added $${ticker} to watchlist` : action === "REMOVE" ? `Removed $${ticker} from watchlist` : `Updated $${ticker}`}
            </span>
            {priority && priority !== "NORMAL" && (
              <Badge variant="outline" className="text-[10px]">{priority}</Badge>
            )}
            {!!watchlistItem?.thesis_direction && (
              <Badge variant="outline" className="text-[10px]">{String(watchlistItem.thesis_direction)}</Badge>
            )}
          </div>
          {reason && (
            <p className="text-xs text-muted-foreground mt-1.5 ml-6">{reason}</p>
          )}
          {!!watchlistItem?.catalyst && (
            <p className="text-xs text-muted-foreground mt-1 ml-6">Catalyst: {String(watchlistItem.catalyst)}</p>
          )}
        </Card>
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
