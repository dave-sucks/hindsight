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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

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
    sources: ["Finnhub", "FMP", "SEC"],
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
    phase: "Conversation",
    title: "Understand your trading vision",
    icon: MessageCircle,
    sources: ["You"],
    summary:
      "The builder asks what excites you about trading — what patterns catch your eye, what sectors interest you, how much risk you're comfortable with. It's like brainstorming with a hedge fund PM who pushes you to think deeper about your edge.",
  },
  {
    title: "Research the current market",
    icon: BarChart3,
    sources: ["Finnhub", "FMP", "Reddit"],
    summary:
      "Before suggesting anything, the builder pulls live market data — today's regime, sector performance, trending themes, and real stock candidates. It uses the same tools the analyst will use on its daily runs, so the strategy is grounded in what's actually happening.",
  },
  {
    title: "Detect themes & opportunities",
    icon: TrendingUp,
    sources: ["Finnhub News", "Reddit"],
    summary:
      "Identifies the dominant market narratives right now — AI, biotech catalysts, rate cuts, meme momentum. Shows you which themes are strong and how they align with your interests. A great strategy exploits themes, not just individual stocks.",
  },
  {
    title: "Scan for real candidates",
    icon: Search,
    sources: ["Finnhub", "FMP", "StockTwits"],
    summary:
      "Finds actual stocks that fit the emerging strategy — earnings movers, sector leaders, social buzz. This lets you see what kind of opportunities your analyst would find on a typical morning, before you've even finished building it.",
  },
  {
    phase: "Strategy Design",
    title: "Craft the strategy prompt",
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
      "Sets the dials: direction bias (long/short/both), hold duration (day/swing/position), sector focus, signal types, confidence threshold, position sizing, and max open trades. Each parameter has trade-offs — the builder explains them so you make informed choices.",
  },
  {
    phase: "Output",
    title: "Deliver complete analyst config",
    icon: CheckCircle2,
    sources: ["All above"],
    summary:
      "Produces a full analyst configuration ready to deploy. Includes the strategy name, detailed prompt, all trading parameters, optional watchlist, and exclusion list. You can refine any part through conversation before saving.",
  },
];

// ── Flow diagram component ──────────────────────────────────────────────────

function FlowDiagram({ steps }: { steps: FlowStep[] }) {
  return (
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
              {/* Header row */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-xs font-medium flex-1 truncate">
                  {step.title}
                </span>
                <div className="flex gap-1 shrink-0">
                  {step.sources.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
              {/* Summary */}
              <p className="px-3 py-2 text-xs text-muted-foreground leading-relaxed">
                {step.summary}
              </p>
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
      "The builder uses live market data and AI to help you design a unique trading strategy from scratch.",
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
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors border bg-background hover:bg-muted text-muted-foreground hover:text-foreground"
          />
        }
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
