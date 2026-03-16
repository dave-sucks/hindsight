"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Clock,
  Play,
  Zap,
  RotateCcw,
  BarChart3,
  Search,
  LineChart,
  FileText,
  ShoppingCart,
  Briefcase,
  BookOpen,
  Settings2,
  ArrowRight,
  Calendar,
  TrendingUp,
  MessageSquare,
  Landmark,
  Users,
  Newspaper,
  Brain,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { HowItWorksSheet } from "@/components/domain/how-it-works-sheet";

// ── Types ────────────────────────────────────────────────────────────────────

interface FlowStep {
  title: string;
  icon: LucideIcon;
  badges: string[];
  summary: string;
  phase?: string;
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

// ── Flow card (matches HowItWorksSheet card style) ──────────────────────────

function FlowCard({
  step,
  action,
}: {
  step: FlowStep;
  action?: React.ReactNode;
}) {
  const Icon = step.icon;

  return (
    <Card className="w-full max-w-sm p-0 overflow-hidden">
      {/* Title row */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">{step.title}</span>
        {action}
      </div>
      {/* Badges row */}
      <div className="flex flex-wrap gap-1 px-3 pb-1.5">
        {step.badges.map((b) => (
          <Badge key={b} variant="secondary">
            {b}
          </Badge>
        ))}
      </div>
      {/* Summary */}
      <div className="border-t border-border/40">
        <p className="px-3 py-2 text-xs text-muted-foreground leading-relaxed">
          {step.summary}
        </p>
      </div>
    </Card>
  );
}

// ── Info row (for detail sheets) ─────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  );
}

// ── Top-level flow steps ─────────────────────────────────────────────────────

const WORKFLOW_STEPS: FlowStep[] = [
  {
    phase: "Configuration",
    title: "The Agent (Analyst)",
    icon: Bot,
    badges: ["AgentConfig", "GPT-4.1", "18 tools"],
    summary:
      "An autonomous AI research analyst configured with a strategy, trading rules, and preferences. Each agent is stored as an AgentConfig row and runs daily via cron or on-demand.",
  },
  {
    phase: "Trigger",
    title: "Run gets triggered",
    icon: Zap,
    badges: ["Cron: 8 AM ET", "Manual: Run button"],
    summary:
      "Cron runs fire every weekday at 8 AM ET via Inngest for all enabled agents. Manual runs start when you click Run on an analyst page. Same agent, same tools — cron uses generateText(), manual uses streamText().",
  },
  {
    phase: "Execution",
    title: "Research pipeline (18 tools)",
    icon: Search,
    badges: ["Discovery", "Deep Research", "Decision", "Synthesis"],
    summary:
      "The agent autonomously calls tools across 4 phases: read the market, find candidates, deep-dive each ticker, write theses, place trades, and summarize. Up to 30 tool steps per run.",
  },
  {
    phase: "Learning",
    title: "Briefing & feedback loop",
    icon: RotateCcw,
    badges: ["AnalystBriefing", "Price monitor", "Accuracy scorer"],
    summary:
      "After every run, the system generates an AnalystBriefing — a self-assessment injected into the next run's prompt. Price checks, EOD evaluations, and weekly accuracy reports feed back into the agent's context.",
  },
];

// ── Agent detail sheet ───────────────────────────────────────────────────────

function AgentDetailSheet() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon-xs" />}>
        <BookOpen className="h-3.5 w-3.5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>Agent (Analyst) Config</SheetTitle>
          <SheetDescription>
            Every analyst is an AgentConfig row. These fields control how the
            agent researches, trades, and evaluates.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4 space-y-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Runtime
          </p>
          <div className="space-y-2">
            <InfoRow label="Model" value="GPT-4.1 (tool calling)" />
            <InfoRow label="Max tool steps" value="30 per run" />
            <InfoRow label="Tools available" value="18 research + trading" />
            <InfoRow label="Cron execution" value="generateText() (no streaming)" />
            <InfoRow label="Manual execution" value="streamText() (live UI)" />
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Strategy & Identity
          </p>
          <div className="space-y-2">
            <InfoRow label="name" value="Display name for the analyst" />
            <InfoRow label="analystPrompt" value="3-5 paragraph strategy playbook (freeform)" />
            <InfoRow label="description" value="One-line summary" />
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Trading Rules
          </p>
          <div className="space-y-2">
            <InfoRow label="directionBias" value="LONG | SHORT | BOTH" />
            <InfoRow label="holdDurations" value="DAY | SWING | POSITION (array)" />
            <InfoRow label="minConfidence" value="0-100 threshold to place a trade" />
            <InfoRow label="maxPositionSize" value="Max $ per trade" />
            <InfoRow label="maxOpenPositions" value="Per-analyst concurrent limit" />
            <InfoRow label="minMarketCapTier" value="LARGE | MID | SMALL" />
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Focus & Filters
          </p>
          <div className="space-y-2">
            <InfoRow label="sectors" value="Focus areas (TECH, FINANCE, HEALTHCARE...)" />
            <InfoRow label="signalTypes" value="EARNINGS_BEAT, SECTOR_ROTATION, MOMENTUM..." />
            <InfoRow label="watchlist" value="Always research these tickers first" />
            <InfoRow label="exclusionList" value="Never trade these tickers" />
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Scheduling
          </p>
          <div className="space-y-2">
            <InfoRow label="enabled" value="Toggles cron scheduling (on/off)" />
          </div>

          <Separator />

          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              <strong>Rule:</strong> The run always executes, even if
              maxOpenPositions is reached. The agent researches and writes
              theses regardless — it just won&apos;t place new trades when at
              capacity.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Trigger detail sheet ─────────────────────────────────────────────────────

function TriggerDetailSheet() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon-xs" />}>
        <BookOpen className="h-3.5 w-3.5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>How Runs Get Triggered</SheetTitle>
          <SheetDescription>
            Two paths to the same agent — automatic cron or manual button.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4 space-y-4">
          {/* Cron */}
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cron Run (Automatic)
          </p>
          <div className="space-y-2">
            <InfoRow label="Schedule" value="8 AM ET, Mon-Fri" />
            <InfoRow label="Timezone" value="America/New_York (auto EDT/EST)" />
            <InfoRow label="Route" value="/api/inngest (POST)" />
            <InfoRow label="Execution" value="generateText() (no streaming)" />
            <InfoRow label="Concurrency" value="1 at a time (sequential)" />
            <InfoRow label="Timeout" value="300s (maxDuration on route)" />
            <InfoRow label="Retries" value="1 retry on failure" />
            <InfoRow label="Source field" value='source: "AGENT"' />
          </div>

          <p className="text-xs text-muted-foreground">
            <strong>Flow:</strong> Inngest fires → load enabled configs → for
            each: count open positions → create ResearchRun (RUNNING) → build
            system prompt + history → generateText() with 30 steps → mark
            COMPLETE → persist messages → generate briefing.
          </p>

          <Separator />

          {/* Manual */}
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Manual Run (On-Demand)
          </p>
          <div className="space-y-2">
            <InfoRow label="Trigger" value="Run button on analyst page" />
            <InfoRow label="Creates run via" value="POST /api/research/agent-run" />
            <InfoRow label="Streams via" value="POST /api/research/agent" />
            <InfoRow label="Execution" value="streamText() (live to browser)" />
            <InfoRow label="UI component" value="AgentThread + AssistantUI" />
            <InfoRow label="Timeout" value="120s (maxDuration on route)" />
            <InfoRow label="Source field" value='source: "MANUAL"' />
          </div>

          <p className="text-xs text-muted-foreground">
            <strong>Flow:</strong> Click Run → POST agent-run → create
            ResearchRun (RUNNING) → redirect to /runs/[id] → AgentThread
            sends message → streamText() with tool UIs rendering live → on
            finish: persist messages, generate briefing → page switches to
            replay mode.
          </p>

          <Separator />

          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              <strong>Key difference:</strong> Manual runs stream to the
              browser with rich tool UIs (cards, charts). Cron runs use
              generateText() with no client — same tools, same agent, just no
              live rendering.
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Learning loop detail sheet ───────────────────────────────────────────────

function LearningDetailSheet() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="ghost" size="icon-xs" />}>
        <BookOpen className="h-3.5 w-3.5" />
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>Learning Loop</SheetTitle>
          <SheetDescription>
            How the agent learns between runs via briefings and evaluations.
          </SheetDescription>
        </SheetHeader>
        <div className="p-4 space-y-4">
          {/* Flow */}
          <div className="flex items-center gap-3 overflow-x-auto py-2">
            {[
              { icon: Zap, label: "Run completes" },
              { icon: Briefcase, label: "Briefing generated" },
              { icon: Settings2, label: "Stored in DB" },
              { icon: Bot, label: "Injected into next run" },
            ].map((step, i, arr) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className="h-8 w-8 rounded-full border border-border flex items-center justify-center">
                    <step.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-[10px] text-muted-foreground text-center whitespace-nowrap">
                    {step.label}
                  </span>
                </div>
                {i < arr.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </div>
            ))}
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            What the briefing captures
          </p>
          <div className="space-y-2">
            <InfoRow label="narrative" value="AI-written portfolio standup (400-600 words)" />
            <InfoRow label="strategyNotes" value="Data-driven adjustments (100-200 words)" />
            <InfoRow label="portfolioSnapshot" value="Open positions, P&L, win rate, total runs" />
            <InfoRow label="theses" value="Structured theses from this run" />
            <InfoRow label="trades" value="Structured trades from this run" />
            <InfoRow label="marketContext" value="Market summary from summarize_run" />
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            System prompt context injected per run
          </p>
          <div className="space-y-2">
            <InfoRow label="Recent briefings" value="3 most recent self-assessments (600 words each)" />
            <InfoRow label="Open positions" value="All current trades with entry/target/stop" />
            <InfoRow label="Trade history" value="20 most recent closed trades with P&L + evaluations" />
            <InfoRow label="Shadow trades" value="10 most recent pass results (good pass / bad pass)" />
            <InfoRow label="Accuracy stats" value="Win rate, calibration narrative from latest report" />
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Other learning inputs
          </p>
          <div className="space-y-2">
            <InfoRow label="Price monitor" value="Hourly 9-5 ET: checks exits, logs TradeEvents" />
            <InfoRow label="EOD evaluation" value="5 PM ET: evaluates all trades placed today" />
            <InfoRow label="Trade evaluator" value="Event-driven: GPT-4o eval on trade close" />
            <InfoRow label="Accuracy scorer" value="Weekly (Sun 10 AM): win rate, calibration, narrative" />
            <InfoRow label="Weekly digest" value="Sunday 9 AM: email summary of the week" />
          </div>

          <Separator />

          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            All cron schedules
          </p>
          <div className="space-y-2">
            <InfoRow label="morning-research" value="8:00 AM ET Mon-Fri" />
            <InfoRow label="price-monitor" value="Hourly 9 AM - 5 PM ET Mon-Fri" />
            <InfoRow label="eod-evaluation" value="5:00 PM ET Mon-Fri" />
            <InfoRow label="trade-evaluator" value="Event-driven (on trade close)" />
            <InfoRow label="weekly-digest" value="Sunday 9:00 AM ET" />
            <InfoRow label="accuracy-scorer" value="Sunday 10:00 AM ET" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgentWorkflowPage() {
  const detailSheets: Record<number, React.ReactNode> = {
    0: <AgentDetailSheet />,
    1: <TriggerDetailSheet />,
    2: (
      <HowItWorksSheet flow="agent-run">
        <BookOpen className="h-3.5 w-3.5" />
      </HowItWorksSheet>
    ),
    3: <LearningDetailSheet />,
  };

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agent Workflow</h1>
        <p className="text-sm text-muted-foreground mt-1">
          End-to-end flow: how agents research, trade, and learn
        </p>
      </div>

      <Separator />

      {/* Vertical flow */}
      <div className="flex flex-col items-center gap-0 py-2">
        {WORKFLOW_STEPS.map((step, i) => {
          const isLast = i === WORKFLOW_STEPS.length - 1;

          return (
            <div key={i} className="flex flex-col items-center w-full">
              {/* Phase label */}
              {step.phase && (
                <div className="mb-2 mt-1">
                  <Badge variant="outline">{step.phase}</Badge>
                </div>
              )}

              {/* Flow card */}
              <FlowCard step={step} action={detailSheets[i]} />

              {/* Connector */}
              {!isLast && <Connector />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
