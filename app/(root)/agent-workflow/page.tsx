"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Sparkles,
  Zap,
  RotateCcw,
  Search,
  Info,
  Play,
  Clock,
  BookOpen,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
    <Card className="w-full max-w-sm p-0 overflow-hidden">
      {/* Title row */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">{step.title}</span>
        {step.detailSheet && (
          <HowItWorksSheet flow={step.detailSheet}>
            <Info className="h-3.5 w-3.5" />
          </HowItWorksSheet>
        )}
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

// ── Trigger card (same style but flex-1 for side-by-side) ────────────────────

function TriggerCard({ step }: { step: FlowStep }) {
  const Icon = step.icon;

  return (
    <Card className="flex-1 min-w-0 p-0 overflow-hidden">
      {/* Title row */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">{step.title}</span>
        {step.detailSheet && (
          <HowItWorksSheet flow={step.detailSheet}>
            <Info className="h-3.5 w-3.5" />
          </HowItWorksSheet>
        )}
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

// ── Flow steps ───────────────────────────────────────────────────────────────

const CONFIG_STEPS: FlowStep[] = [
  {
    phase: "Configuration",
    title: "Create an Analyst (Builder)",
    icon: Sparkles,
    badges: ["GPT-4o", "14 tools", "suggest_config"],
    summary:
      "An AI-powered chat that brainstorms your trading strategy. It has 13 of the agent's 18 research tools (can't trade or persist theses), plus suggest_config to propose a complete AgentConfig. 4 phases: Understand → Research → Craft → Refine. Max 15 tool steps.",
    detailSheet: "analyst-builder",
  },
  {
    title: "The Analyst (AgentConfig)",
    icon: Bot,
    badges: ["AgentConfig", "GPT-4.1", "18 tools"],
    summary:
      "The saved output of the builder. An AgentConfig row stores the analyst's strategy prompt, direction bias, hold durations, sectors, signal types, confidence threshold, position sizing, watchlist, and exclusion list. Each analyst has its own briefings, trade history, and equity curve.",
  },
];

const MANUAL_TRIGGER: FlowStep = {
  title: "Manual Run",
  icon: Play,
  badges: ["Run button", "streamText()", "Vercel"],
  summary:
    "Click \"Run\" on analyst page → POST /api/research/agent-run creates a ResearchRun (source: MANUAL) → redirect to /runs/[id] → AgentThread streams GPT-4.1 responses in real time via streamText(). maxDuration: 120s, max 30 tool steps.",
  detailSheet: "manual-run",
};

const CRON_TRIGGER: FlowStep = {
  title: "Cron Run",
  icon: Clock,
  badges: ["Inngest", "generateText()", "Server-side"],
  summary:
    "Inngest cron fires at 8 AM ET Mon–Fri. Loads all enabled analysts, checks open position slots, runs each sequentially with generateText() (no streaming — no client). Same GPT-4.1 model, same 18 tools, same 30-step limit, same historical context.",
  detailSheet: "cron-run",
};

const POST_TRIGGER_STEPS: FlowStep[] = [
  {
    phase: "Context",
    title: "Load analyst context into system prompt",
    icon: BookOpen,
    badges: ["buildSystemPrompt()", "Historical context", "6 queries"],
    summary:
      "Before the agent makes a single tool call, the system loads the analyst's full strategy prompt, last 3 briefings (the analyst's memory of prior sessions), all currently open positions, last 20 closed trades with evaluations, last 10 shadow trades (pass tracking), and the latest accuracy report. All of this is appended to the system prompt so the agent starts every run with full awareness of its history and current portfolio.",
    detailSheet: "context-loading",
  },
  {
    phase: "Execution",
    title: "Research pipeline (18 tools)",
    icon: Search,
    badges: ["Discovery", "Deep Research", "Decision", "Synthesis"],
    summary:
      "The agent autonomously calls tools across 4 phases: read the market, find candidates, deep-dive each ticker, write theses, place trades, and summarize. Up to 30 tool steps per run.",
    detailSheet: "agent-run",
  },
  {
    phase: "Learning",
    title: "Post-run analyst briefing",
    icon: RotateCcw,
    badges: ["GPT-4o-mini", "generateObject()", "AnalystBriefing"],
    summary:
      "Immediately after every run, GPT-4o-mini reviews everything that just happened — theses written, trades placed, portfolio state, and shadow trade results — then writes a narrative briefing and strategy notes. The last 3 briefings are injected into the next run's system prompt, giving the analyst a living memory.",
    detailSheet: "learning-loop",
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AgentWorkflowPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agent Workflow</h1>
        <p className="text-sm text-muted-foreground mt-1">
          End-to-end flow: how agents research, trade, and learn
        </p>
      </div>

      <Separator />

      {/* Vertical flow */}
      <div className="flex flex-col items-center gap-0 py-2">
        {/* ── Configuration steps ─────────────────────────────────────────── */}
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

        {/* ── Trigger phase (side by side) ────────────────────────────────── */}
        <div className="mb-2 mt-1">
          <Badge variant="outline">Trigger</Badge>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-2xl">
          <TriggerCard step={MANUAL_TRIGGER} />
          <TriggerCard step={CRON_TRIGGER} />
        </div>

        <Connector />

        {/* ── Post-trigger steps ──────────────────────────────────────────── */}
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
