"use client";

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  TrendingUp,
  Calendar,
  Search,
  LineChart,
  MessageSquare,
  FileText,
  ShoppingCart,
  Briefcase,
  MessageCircle,
  Brain,
  Wrench,
  CheckCircle2,
  Globe,
  Newspaper,
  Users,
  Database,
  User,
  Cpu,
  Landmark,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ── Source definitions ──────────────────────────────────────────────────────

interface SourceDef {
  icon: LucideIcon;
  description: string;
}

const SOURCE_REGISTRY: Record<string, SourceDef> = {
  Finnhub: {
    icon: BarChart3,
    description: "Real-time stock quotes, company metrics, earnings calendar, and market news from Finnhub API.",
  },
  "Finnhub News": {
    icon: Newspaper,
    description: "Financial news headlines aggregated by Finnhub from major business publications.",
  },
  FMP: {
    icon: Database,
    description: "Financial Modeling Prep — market movers, analyst ratings, SEC filings, economic calendar, and insider transactions.",
  },
  Reddit: {
    icon: MessageSquare,
    description: "Retail trader sentiment from r/wallstreetbets, r/stocks, r/options, and r/investing.",
  },
  StockTwits: {
    icon: TrendingUp,
    description: "Trending tickers and social momentum from the StockTwits trader community.",
  },
  SEC: {
    icon: Landmark,
    description: "SEC EDGAR filings — 10-K, 10-Q, 8-K, and insider Form 4 transaction reports.",
  },
  Alpaca: {
    icon: ShoppingCart,
    description: "Alpaca paper trading API — places simulated market orders and tracks positions.",
  },
  Internal: {
    icon: Cpu,
    description: "Hindsight's internal analytics — portfolio exposure, trade history, and performance tracking.",
  },
  "All research": {
    icon: Globe,
    description: "Synthesizes all data gathered in previous steps into a single analysis.",
  },
  "All above": {
    icon: Globe,
    description: "Combines everything from all previous steps into the final output.",
  },
  You: {
    icon: User,
    description: "Your input — trading interests, risk preferences, and strategy ideas.",
  },
  "Market context": {
    icon: BarChart3,
    description: "Live market data gathered from earlier research steps.",
  },
  "Your input": {
    icon: User,
    description: "Your preferences and feedback from the conversation.",
  },
  "Strategy logic": {
    icon: Brain,
    description: "Derived from the strategy prompt and market research above.",
  },
};

// ── Source badge with tooltip ───────────────────────────────────────────────

function SourceBadge({ name }: { name: string }) {
  const def = SOURCE_REGISTRY[name];
  const Icon = def?.icon ?? Globe;
  const description = def?.description ?? name;

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex" />}
      >
        <Badge variant="secondary">
          <Icon className="h-3 w-3" data-icon="inline-start" />
          {name}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Flow step data ──────────────────────────────────────────────────────────

interface FlowStep {
  title: string;
  icon: LucideIcon;
  sources: string[];
  summary: string;
  phase?: string;
}

const AGENT_RUN_STEPS: FlowStep[] = [
  {
    phase: "Discovery",
    title: "Read the market regime",
    icon: BarChart3,
    sources: ["Finnhub", "FMP"],
    summary:
      "Fetches S&P 500, VIX, and 11 sector ETFs. Classifies the market as Risk-On, Risk-Off, or Neutral using VIX levels and SPY's trend vs its 20-day average. Also pulls today's macro events (FOMC, CPI, jobs) and upcoming earnings density.",
  },
  {
    title: "Detect market themes",
    icon: TrendingUp,
    sources: ["Finnhub News", "Reddit"],
    summary:
      "Scans 50 recent headlines and Reddit trending tickers to identify dominant narratives — like AI infrastructure, biotech catalysts, or rate cut plays. Scores each theme by headline matches, social overlap, and sector momentum. Strong themes guide which stocks to research.",
  },
  {
    title: "Scan for catalysts",
    icon: Calendar,
    sources: ["Finnhub", "FMP"],
    summary:
      "Builds a pipeline of upcoming price-moving events: earnings dates, economic releases, insider buying clusters, and analyst upgrades/downgrades. Catalysts within 3 days get priority — a stock reporting tomorrow is more urgent than one reporting in two weeks.",
  },
  {
    title: "Find candidate stocks",
    icon: Search,
    sources: ["Finnhub", "FMP", "StockTwits", "Reddit"],
    summary:
      "Pulls from 5 sources: earnings calendar, top gainers/losers, StockTwits trending, and Reddit buzz. Filters out micro-caps and illiquid names. Boosts stocks matching the detected theme. Flags unusual volume spikes. Produces a ranked shortlist of 5–10 high-quality candidates.",
  },
  {
    phase: "Deep Research",
    title: "Analyze each stock",
    icon: LineChart,
    sources: ["Finnhub", "FMP", "Reddit", "SEC"],
    summary:
      "For the top 3–5 candidates: pulls price data, financials, analyst consensus, technical indicators (RSI, moving averages), social sentiment from Reddit, recent news, SEC filings, and peer comparisons. Every data point gets cited with its source.",
  },
  {
    title: "Check social sentiment",
    icon: MessageSquare,
    sources: ["Reddit", "StockTwits"],
    summary:
      "Reads what retail traders are saying on r/wallstreetbets, r/stocks, and r/options. Sentiment can confirm or contradict the technical picture — a stock with bullish technicals but bearish social buzz is a warning sign.",
  },
  {
    phase: "Decision",
    title: "Write a thesis for every stock",
    icon: FileText,
    sources: ["All research"],
    summary:
      "Produces a detailed trade thesis for each researched stock — direction (long, short, or pass), confidence score, entry/target/stop prices, supporting bullets, and risk flags. Even stocks the analyst passes on get a thesis explaining why, so you can track whether the pass was right.",
  },
  {
    title: "Execute paper trades",
    icon: ShoppingCart,
    sources: ["Alpaca"],
    summary:
      "Any thesis above the confidence threshold automatically places a paper trade through Alpaca. Calculates position size based on your max position setting. This is simulated money — every trade gets tracked so you can measure real performance over time.",
  },
  {
    phase: "Synthesis",
    title: "Portfolio review & summary",
    icon: Briefcase,
    sources: ["Internal"],
    summary:
      "Reviews all positions for concentration risk, sector exposure, and correlation. Produces a final summary card with ranked picks, exposure breakdown, risk notes, and an overall market assessment. This becomes the briefing for the next session.",
  },
];

const ANALYST_BUILDER_STEPS: FlowStep[] = [
  {
    phase: "Phase 1 — Understand Vision",
    title: "Ask about trading interests",
    icon: MessageCircle,
    sources: ["You"],
    summary:
      "The builder asks what excites you about trading — what patterns catch your eye, what sectors interest you, how much risk you're comfortable with. It's like brainstorming with a hedge fund PM who pushes you to think deeper about your edge. Typically 1–2 exchanges.",
  },
  {
    phase: "Phase 2 — Research & Brainstorm",
    title: "Read the market regime",
    icon: BarChart3,
    sources: ["Finnhub", "FMP"],
    summary:
      "Before suggesting anything, the builder calls get_market_overview — SPY, VIX, 11 sector ETFs, macro events. This is mandatory: the builder must call at least 2–3 research tools before proposing any strategy. It uses the same 13 research tools the agent uses on daily runs.",
  },
  {
    title: "Detect themes & scan candidates",
    icon: TrendingUp,
    sources: ["Finnhub News", "Reddit", "StockTwits"],
    summary:
      "Calls detect_market_themes and scan_candidates to find dominant narratives (AI, biotech, rate cuts) and real candidate stocks. This grounds the strategy in what's actually moving — a momentum strategy needs active momentum, an earnings strategy needs upcoming reports.",
  },
  {
    title: "Deep-dive specific stocks",
    icon: LineChart,
    sources: ["Finnhub", "FMP", "Reddit", "SEC"],
    summary:
      "For promising candidates, the builder can call any of the 13 research tools — get_stock_data, get_technical_analysis, get_earnings_data, get_reddit_sentiment, search_reddit, get_news_deep_dive, get_analyst_targets, get_company_peers, get_sec_filings. Shows you what your analyst would actually find on a typical morning.",
  },
  {
    phase: "Phase 3 — Craft Strategy",
    title: "Write the strategy prompt",
    icon: Brain,
    sources: ["Market context", "Your input"],
    summary:
      "Writes a 3–5 paragraph strategy document — the analyst's playbook. Covers: the core edge, what patterns to look for, which data sources matter most, entry/exit criteria, risk management philosophy, and unique angles. This is the most important output — it guides every future research session.",
  },
  {
    title: "Configure trading parameters",
    icon: Wrench,
    sources: ["Strategy logic"],
    summary:
      "Sets the dials: directionBias (LONG/SHORT/BOTH), holdDurations (DAY/SWING/POSITION), sectors, signalTypes, minConfidence (0–100), maxPositionSize ($), maxOpenPositions, minMarketCapTier (LARGE/MID/SMALL), watchlist, and exclusionList.",
  },
  {
    title: "Submit config via suggest_config",
    icon: CheckCircle2,
    sources: ["All above"],
    summary:
      "Calls the suggest_config tool with the complete AgentConfig. The UI renders a confirmation card with all fields. You can refine any part through conversation — the builder calls suggest_config again with updates. Click 'Create Analyst' to save.",
  },
  {
    phase: "Phase 4 — Refine",
    title: "Iterate on changes",
    icon: MessageCircle,
    sources: ["Your input"],
    summary:
      "After the initial config, you can request changes to any field. The builder calls suggest_config again with the updated values. This loop continues until you're happy and click Create. Max 15 tool calls per response.",
  },
];

// ── Flow diagram component ──────────────────────────────────────────────────

function FlowDiagram({ steps }: { steps: FlowStep[] }) {
  return (
    <TooltipProvider>
      <div className="relative flex flex-col items-center gap-0 py-2">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isLast = i === steps.length - 1;
          const showPhase = step.phase !== undefined;

          return (
            <div key={i} className="flex flex-col items-center w-full">
              {/* Phase label */}
              {showPhase && (
                <div className="mb-2 mt-1">
                  <Badge variant="outline">{step.phase}</Badge>
                </div>
              )}

              {/* Card */}
              <Card className="w-full max-w-sm p-0 overflow-hidden">
                {/* Title row */}
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-xs font-medium">
                    {step.title}
                  </span>
                </div>
                {/* Source badges row */}
                <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                  {step.sources.map((s) => (
                    <SourceBadge key={s} name={s} />
                  ))}
                </div>
                {/* Summary */}
                <div className="border-t border-border/40">
                  <p className="px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                    {step.summary}
                  </p>
                </div>
              </Card>

              {/* Connector */}
              {!isLast && (
                <div className="flex flex-col items-center">
                  <div className="w-px h-4 bg-border" />
                  <div className="h-1.5 w-1.5 rounded-full border border-border bg-background" />
                  <div className="w-px h-4 bg-border" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

// ── Sheet exports ───────────────────────────────────────────────────────────

type FlowType = "agent-run" | "analyst-builder";

const FLOW_CONFIG: Record<
  FlowType,
  { title: string; description: string; steps: FlowStep[] }
> = {
  "agent-run": {
    title: "How a Research Run Works",
    description:
      "Each run follows a structured discovery funnel — from reading the market, to finding candidates, to placing paper trades.",
    steps: AGENT_RUN_STEPS,
  },
  "analyst-builder": {
    title: "How the Analyst Builder Works",
    description:
      "GPT-4o with 14 tools (suggest_config + 13 research tools). 4-phase workflow: understand → research → craft → refine. Max 15 tool steps per response.",
    steps: ANALYST_BUILDER_STEPS,
  },
};

export function HowItWorksSheet({
  flow,
  children,
}: {
  flow: FlowType;
  children: React.ReactNode;
}) {
  const config = FLOW_CONFIG[flow];

  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" />}
      >
        {children}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>{config.title}</SheetTitle>
          <SheetDescription>{config.description}</SheetDescription>
        </SheetHeader>
        <div className="p-4">
          <FlowDiagram steps={config.steps} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
