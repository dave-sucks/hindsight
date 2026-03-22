"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Sparkles,
  RotateCcw,
  Search,
  Info,
  Play,
  Clock,
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
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">{step.title}</span>
        {step.detailSheet && (
          <HowItWorksSheet flow={step.detailSheet}>
            <Info className="h-3.5 w-3.5" />
          </HowItWorksSheet>
        )}
      </div>
      <div className="flex flex-wrap gap-1 px-3 pb-1.5">
        {step.badges.map((b) => (
          <Badge key={b} variant="secondary">
            {b}
          </Badge>
        ))}
      </div>
      <div className="border-t border-border/40">
        <p className="px-3 py-2 text-xs text-muted-foreground leading-relaxed">
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
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">{step.title}</span>
        {step.detailSheet && (
          <HowItWorksSheet flow={step.detailSheet}>
            <Info className="h-3.5 w-3.5" />
          </HowItWorksSheet>
        )}
      </div>
      <div className="flex flex-wrap gap-1 px-3 pb-1.5">
        {step.badges.map((b) => (
          <Badge key={b} variant="secondary">
            {b}
          </Badge>
        ))}
      </div>
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
    title: "Create an Analyst",
    icon: Sparkles,
    badges: ["AI Builder", "GPT-4o", "8 tools"],
    summary:
      "You describe your trading style in conversation — what sectors interest you, how much risk you want, what patterns catch your eye. The builder researches live market data to ground the strategy in reality, then writes a full analyst persona: strategy document, direction bias, sectors, confidence threshold, position sizing, and watchlist. Think of it like onboarding a new PM.",
    detailSheet: "analyst-builder",
  },
  {
    title: "The Analyst (AgentConfig)",
    icon: Bot,
    badges: ["7 config fields", "Strategy prompt", "Watchlist"],
    summary:
      "The output of the builder is a saved analyst profile. It has a name, a multi-paragraph strategy document (its playbook), direction bias (long-only, short-only, or both), hold durations, sector focus, minimum confidence to trade, max position size, and a watchlist of stocks to monitor. Each analyst builds its own track record — separate trades, separate performance stats, separate memory.",
  },
];

const MANUAL_TRIGGER: FlowStep = {
  title: "Manual Run (you click Run)",
  icon: Play,
  badges: ["Real-time streaming", "30 tool steps", "120s max"],
  summary:
    "You click \"Run\" on an analyst's page. The agent starts immediately — you watch it think, research, and trade in real time. Every tool call renders as a data card in the chat: market overview, stock analysis, thesis, trade confirmation. The whole session runs in your browser with a 120-second time limit and up to 30 tool calls.",
  detailSheet: "manual-run",
};

const CRON_TRIGGER: FlowStep = {
  title: "Daily Cron (8 AM ET)",
  icon: Clock,
  badges: ["Automatic", "All analysts", "Sequential"],
  summary:
    "Every weekday at 8 AM Eastern, each enabled analyst runs automatically — no human needed. The system checks how many open positions each analyst already has and adjusts its position limits accordingly. Same research tools, same model, same rules. The only difference: it runs on the server with no streaming UI, and each analyst gets a 4-minute time limit.",
  detailSheet: "cron-run",
};

const POST_TRIGGER_STEPS: FlowStep[] = [
  {
    phase: "Research Session",
    title: "8-phase research pipeline (13 tools)",
    icon: Search,
    badges: ["Context", "Orient", "Holdings", "Watchlist", "Discover", "Synthesize", "Execute", "Brief"],
    summary:
      "Before the agent makes its first tool call, the system loads its full context: strategy rules, open positions with live P&L, watchlist, last briefing, trade history, and accuracy stats. Then the agent follows an 8-phase workflow — acknowledge portfolio, read the market, triage holdings, review watchlist, discover new opportunities, synthesize decisions at the portfolio level, execute trades and watchlist changes, and write a summary.",
    detailSheet: "agent-run",
  },
  {
    phase: "Learning Loop",
    title: "Write the analyst briefing (memory)",
    icon: RotateCcw,
    badges: ["Post-run", "GPT-4o-mini", "Feeds next session"],
    summary:
      "After every session, the analyst writes itself a memo — a 400-600 word narrative covering: portfolio status, what it researched, what it traded, how recent trades performed, whether its passes were good calls, and what to focus on tomorrow. Plus strategy adjustment notes. The next time this analyst runs, it reads its last 3 briefings before doing anything. This is the memory loop — how the analyst learns and adapts across sessions.",
    detailSheet: "learning-loop",
  },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AgentWorkflowPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">How Hindsight Works</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI analysts that research stocks, place paper trades, and learn from their results — like having a team of portfolio managers that run 24/5
        </p>
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
