"use client";

import { useState, useCallback } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Sparkles,
  RotateCcw,
  Search,
  Info,
  Play,
  Clock,
  Radar,
  Copy,
  Check,
  Pencil,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";

// ── Types ────────────────────────────────────────────────────────────────────

type SheetType = "analyst-builder" | "agent-run" | "manual-run" | "cron-run" | "learning-loop" | "context-loading";

interface FlowStep {
  title: string;
  icon: LucideIcon;
  badges: string[];
  summary: string;
  phase?: string;
  detailSheet?: SheetType;
}

// ── Connector ────────────────────────────────────────────────────────────────

function Connector() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-px h-4 bg-border" />
      <div className="h-1.5 w-1.5 rounded-full border border-border bg-background" />
      <div className="w-px h-4 bg-border" />
    </div>
  );
}

// ── Flow card ────────────────────────────────────────────────────────────────

function FlowCard({ step }: { step: FlowStep }) {
  const Icon = step.icon;

  return (
    <Card className="w-full max-w-lg p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">{step.title}</span>
        {step.detailSheet && (
          <HowItWorksSheet flow={step.detailSheet}>
            <Info className="h-3.5 w-3.5" />
          </HowItWorksSheet>
        )}
      </div>
      <div className="flex flex-wrap gap-1 px-4 pb-2">
        {step.badges.map((b) => (
          <Badge key={b} variant="secondary">
            {b}
          </Badge>
        ))}
      </div>
      <div className="border-t border-border/40">
        <p className="px-4 py-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
          {step.summary}
        </p>
      </div>
    </Card>
  );
}

// ── Trigger card ─────────────────────────────────────────────────────────────

function TriggerCard({ step }: { step: FlowStep }) {
  const Icon = step.icon;

  return (
    <Card className="flex-1 min-w-0 p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">{step.title}</span>
        {step.detailSheet && (
          <HowItWorksSheet flow={step.detailSheet}>
            <Info className="h-3.5 w-3.5" />
          </HowItWorksSheet>
        )}
      </div>
      <div className="flex flex-wrap gap-1 px-4 pb-2">
        {step.badges.map((b) => (
          <Badge key={b} variant="secondary">
            {b}
          </Badge>
        ))}
      </div>
      <div className="border-t border-border/40">
        <p className="px-4 py-3 text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
          {step.summary}
        </p>
      </div>
    </Card>
  );
}

// ── Copy button ─────────────────────────────────────────────────────────────

function CopyMarkdownButton() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const md = exportWorkflowAsMarkdown();
    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy as markdown"}
    </Button>
  );
}

// ── Flow steps (canonical product documentation) ────────────────────────────

const PRODUCT_INTRO = "Hindsight is an AI-powered paper trading platform. You create AI analysts — each with its own strategy, watchlist, and intelligence policy. Background jobs gather market intelligence overnight. The analysts wake up informed and run structured research sessions that end in real paper trades via Alpaca. After each session, a separate briefing agent reviews what happened and writes memory that feeds the next run. The loop continues daily.";

const CONFIG_STEPS: FlowStep[] = [
  {
    phase: "Configuration",
    title: "Create an Analyst",
    icon: Sparkles,
    badges: ["AI Builder", "GPT-4o", "4 research tools", "Intelligence Setup"],
    summary:
      `You describe your trading style in conversation — sectors you care about, risk appetite, patterns that catch your eye. The AI builder (GPT-4o) researches live market data using 4 tools (market context, stock data, earnings, SEC filings), then proposes a complete analyst:

• Strategy document — a 3-5 paragraph playbook covering the analyst's edge, entry/exit criteria, and risk philosophy
• Trading parameters — direction bias (long/short/both), hold durations, confidence threshold, position sizing, sector focus
• Watchlist — initial stocks to monitor with priority and reasoning
• Domain monitors — 4-6 websites checked daily by the intelligence pipeline (e.g., TechCrunch, Reuters, SEC.gov)
• Search monitors — 3-5 queries run every morning via Perplexity Sonar (e.g., "semiconductor supply chain news")
• Intelligence policy — attention weights (how much focus on holdings vs watchlist vs discovery) and signal budgets

You review everything in a panel, iterate via chat, and click Create. The analyst is now ready to run.`,
    detailSheet: "analyst-builder",
  },
  {
    title: "Edit an Analyst",
    icon: Pencil,
    badges: ["Same AI chat", "Same panel", "Monitors", "Strategy"],
    summary:
      `After creation, you can edit any analyst using the same experience — chat on the left, config panel on the right. Ask the AI to adjust the strategy, change sectors, add monitors, or tune the intelligence policy. The AI explains trade-offs before making changes.

The editor has access to the same research tools as the builder, so it can validate suggestions against live market data. When it proposes changes, the panel updates in real time so you can review before applying.`,
  },
  {
    title: "The Analyst",
    icon: Bot,
    badges: ["Strategy prompt", "Watchlist", "Intelligence policy", "Domain monitors", "Search monitors"],
    summary:
      `An analyst is a saved AI persona that runs autonomously. It consists of:

• Strategy prompt — the multi-paragraph document that guides all research decisions
• Trading rules — direction bias, hold duration, sectors, min confidence (e.g., 70%), max position size, max open positions
• Watchlist — stocks being actively monitored with priority, catalysts, and target prices
• Intelligence policy — signal budgets (max 30 signals/run), attention weights (40% holdings, 35% watchlist, 25% discovery), live search budget (5/run)
• Domain monitors — websites the intelligence pipeline checks daily for this analyst
• Search monitors — queries the pipeline runs every morning via Perplexity Sonar

Each analyst has its own track record — separate positions, theses, performance stats, accuracy reports, and memory (briefings from prior sessions). Multiple analysts can run simultaneously, each with different strategies.`,
  },
];

const INTELLIGENCE_STEP: FlowStep = {
  phase: "Intelligence Pipeline",
  title: "Background intelligence gathering (6:30–7:45 AM ET)",
  icon: Radar,
  badges: ["Perplexity Sonar", "Firecrawl", "FMP", "Finnhub", "GPT-4o"],
  summary:
    `Five background jobs run every weekday morning before analysts wake up:

6:30 AM — Search monitors: runs all enabled search queries via Perplexity Sonar + fetches FMP market movers (gainers/losers) + Finnhub earnings calendar
7:00 AM — Ticker monitors: searches Sonar for news on every open position and watchlist item across all analysts
7:15 AM — Domain monitors: searches tracked websites via domain-filtered Sonar + extracts full articles via Firecrawl for high-priority sources
7:30 AM — Signal router: scores every signal against every analyst (ticker overlap +40, sector +20, theme +15, urgency bonus) and routes relevant ones
7:45 AM — Morning brief generator: GPT-4o reads each analyst's routed signals + portfolio + watchlist and writes a structured brief (market context, portfolio alerts, watchlist updates, new opportunities, risk flags)

The result: by 8 AM, each analyst has a personalized morning brief and a curated inbox of intelligence signals — no scanning the web from scratch.`,
};

const MANUAL_TRIGGER: FlowStep = {
  title: "Manual Run (you click Run)",
  icon: Play,
  badges: ["GPT-4.1", "Real-time streaming", "14 tools", "30 steps max"],
  summary:
    `Click "Run" on an analyst's page. The agent starts immediately — you watch it think, research, and trade in real time. Every tool call renders as a card in the chat: market data, stock analysis, thesis verdicts, trade confirmations.

The agent reads its pre-gathered intelligence first (morning brief + routed signals), then validates with live API calls to Finnhub, FMP, SEC EDGAR, and Perplexity Sonar. It follows the 8-phase workflow strictly. Up to 30 tool calls, 5-minute time limit, GPT-4.1 model.`,
  detailSheet: "manual-run",
};

const CRON_TRIGGER: FlowStep = {
  title: "Daily Cron (8 AM ET)",
  icon: Clock,
  badges: ["Automatic", "All enabled analysts", "Sequential", "4 min each"],
  summary:
    `Every weekday at 8 AM Eastern, each enabled analyst runs automatically — same model (GPT-4.1), same tools, same workflow. The system checks open positions per analyst and adjusts position limits. Runs sequentially with a 4-minute timeout per analyst. Messages are saved for replay on the run page.`,
  detailSheet: "cron-run",
};

const POST_TRIGGER_STEPS: FlowStep[] = [
  {
    phase: "Research Session",
    title: "8-phase research pipeline (14 tools)",
    icon: Search,
    badges: ["Check-in", "Intelligence", "Orient", "Holdings", "Watchlist", "Discover", "Synthesize", "Execute", "Wrap Up"],
    summary:
      `Before the first tool call, the system loads the analyst's full context: strategy rules, intelligence policy, open positions with live P&L (via Alpaca), watchlist, active theses, last briefing (with watch-tomorrow items), trade history, and accuracy stats.

The agent then follows an 8-phase workflow:
Phase 0: Portfolio check-in — acknowledge positions, reference prior brief's watch-tomorrow items
Phase 1: Read intelligence — read_morning_brief + read_signals (pre-gathered by background jobs)
Phase 2: Orient — optionally call get_market_context if the brief is stale
Phase 3: Review holdings — triage positions near targets/stops, with earnings, or flagged in brief
Phase 4: Review watchlist — triage by priority, check triggers and catalysts
Phase 5: Discover — research 2-4 opportunities from signals, verify with get_stock_data + web_search
Phase 5.5: Synthesize — portfolio-level reasoning, output decision table (no tools)
Phase 6: Execute — exits before entries: close_position, place_trade, manage_watchlist
Phase 7: Wrap up — complete_run with ranked picks, market summary, risk notes

14 tools: read_morning_brief, read_signals, read_artifact, web_search, get_market_context, get_stock_data, get_earnings_data, get_options_flow, get_sec_filings, record_thesis, place_trade, close_position, manage_watchlist, complete_run`,
    detailSheet: "agent-run",
  },
  {
    phase: "Learning Loop",
    title: "Post-run briefing agent",
    icon: RotateCcw,
    badges: ["GPT-4o", "Separate agent", "Memory", "Dynamic monitors"],
    summary:
      `After every session, a separate briefing agent (GPT-4o) reads the full conversation transcript, portfolio state, and trade outcomes. It writes a structured standup brief:

• Narrative (400-600 words) — what the analyst did, key findings, decisions and rationale
• Strategy notes — data-driven assessment of what's working and what should change
• Market posture — e.g., "cautiously bullish", "defensive"
• Watch tomorrow — specific items to check next session (e.g., "NVDA: watch for earnings reaction, consider adding if price < $130")
• Unresolved items — data gaps, failed tool calls, tickers the analyst ran out of time to research
• Self-corrections — behavioral patterns to fix (e.g., "stop chasing momentum after the first 15 minutes")
• Dynamic monitors — 0-5 temporary search queries for things that need tracking, with expiration dates

The brief feeds into the next session's system prompt. The analyst MUST reference watch-tomorrow items in Phase 0 — this enforces run-to-run continuity. Dynamic monitors are picked up by the morning intelligence pipeline automatically.`,
    detailSheet: "learning-loop",
  },
];

// ── Markdown export ─────────────────────────────────────────────────────────

function exportWorkflowAsMarkdown(): string {
  const lines: string[] = [
    "# How Hindsight Works",
    "",
    PRODUCT_INTRO,
    "",
    "---",
    "",
  ];

  const allSteps = [
    ...CONFIG_STEPS,
    INTELLIGENCE_STEP,
    MANUAL_TRIGGER,
    CRON_TRIGGER,
    ...POST_TRIGGER_STEPS,
  ];

  for (const step of allSteps) {
    if (step.phase) {
      lines.push(`## ${step.phase}`);
      lines.push("");
    }
    lines.push(`### ${step.title}`);
    lines.push("");
    if (step.badges.length > 0) {
      lines.push(step.badges.map((b) => `\`${b}\``).join(" · "));
      lines.push("");
    }
    lines.push(step.summary);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AgentWorkflowPage() {
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">How Hindsight Works</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {PRODUCT_INTRO}
          </p>
        </div>
        <CopyMarkdownButton />
      </div>

      <Separator />

      {/* Vertical flow */}
      <div className="flex flex-col items-center gap-0 py-2">
        {/* ── Configuration ─────────────────────────────────────────── */}
        {CONFIG_STEPS.map((step, i) => (
          <div key={i} className="flex flex-col items-center w-full">
            {step.phase && (
              <div className="mb-2 mt-1">
                <Badge variant="outline">{step.phase}</Badge>
              </div>
            )}
            <FlowCard step={step} />
            <Connector />
          </div>
        ))}

        {/* ── Intelligence Pipeline ──────────────────────────────────── */}
        <div className="flex flex-col items-center w-full">
          <div className="mb-2 mt-1">
            <Badge variant="outline">{INTELLIGENCE_STEP.phase}</Badge>
          </div>
          <FlowCard step={INTELLIGENCE_STEP} />
          <Connector />
        </div>

        {/* ── Trigger (side by side) ────────────────────────────────── */}
        <div className="mb-2 mt-1">
          <Badge variant="outline">Trigger</Badge>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-2xl">
          <TriggerCard step={MANUAL_TRIGGER} />
          <TriggerCard step={CRON_TRIGGER} />
        </div>

        <Connector />

        {/* ── Post-trigger ──────────────────────────────────────────── */}
        {POST_TRIGGER_STEPS.map((step, i) => {
          const isLast = i === POST_TRIGGER_STEPS.length - 1;
          return (
            <div key={i} className="flex flex-col items-center w-full">
              {step.phase && (
                <div className="mb-2 mt-1">
                  <Badge variant="outline">{step.phase}</Badge>
                </div>
              )}
              <FlowCard step={step} />
              {!isLast && <Connector />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
