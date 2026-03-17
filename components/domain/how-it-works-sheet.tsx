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
import { Separator } from "@/components/ui/separator";
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
    sources: ["Reddit"],
    summary:
      "Checks what retail traders are saying on r/wallstreetbets, r/stocks, and r/options via get_reddit_sentiment, plus Twitter/X buzz via get_twitter_sentiment. The system prompt requires checking BOTH for every candidate. Divergence between Reddit and Twitter sentiment is a signal worth noting.",
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
      "Reviews all positions for concentration risk, sector exposure, and correlation. Calls summarize_run which marks the ResearchRun as COMPLETE and produces a final summary card with ranked picks, exposure breakdown, risk notes, and an overall market assessment. Note: this is NOT the analyst briefing — the briefing is a separate post-run step that generates the memory for the next session.",
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
      "Before suggesting anything, the builder calls get_market_overview — SPY, VIX, 11 sector ETFs, macro events. This is mandatory: the builder must call at least 2–3 research tools before proposing any strategy. It has 13 of the agent's 18 research tools (excludes get_twitter_sentiment, get_options_flow, show_thesis, place_trade, summarize_run — the builder can't trade or persist theses).",
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

// ── Detail section data (for key-value detail sheets) ────────────────────────

interface DetailSection {
  heading: string;
  items: { label: string; value: string }[];
}

const MANUAL_RUN_DETAILS: DetailSection[] = [
  {
    heading: "What it does (plain English)",
    items: [
      { label: "When", value: "You click the \"Run\" button on an analyst's detail page." },
      { label: "What happens", value: "Creates a new research run, redirects you to the run page, and starts a live-streaming AI agent session. You see every tool call, every data card, and every piece of reasoning appear in real time as the agent works." },
      { label: "How it differs from cron", value: "Manual runs use streamText() so you see tokens appear live in the UI. Cron runs use generateText() on the server with no client. Same model, same tools, same system prompt, same context. The only other difference: manual runs pass full maxOpenPositions, while crons calculate remaining slots per-analyst." },
      { label: "Duration", value: "Capped at 120 seconds on Vercel. The agent gets up to 30 tool call rounds within that window. Most runs complete in 60-90 seconds." },
    ],
  },
  {
    heading: "Trigger",
    items: [
      { label: "Entry point", value: "Click \"Run\" button on analyst detail page (/analysts/[id])" },
      { label: "Component", value: "RunResearchButton → onClick handler" },
      { label: "Request", value: "POST /api/research/agent-run with body { agentConfigId }" },
      { label: "Route file", value: "app/api/research/agent-run/route.ts" },
      { label: "Auth", value: "Supabase server auth — requires logged-in user" },
    ],
  },
  {
    heading: "Run creation",
    items: [
      { label: "Creates", value: "ResearchRun row in Prisma" },
      { label: "source", value: "\"MANUAL\"" },
      { label: "status", value: "\"RUNNING\"" },
      { label: "parameters", value: "{ analystName, agentMode: true }" },
      { label: "agentConfigId", value: "Linked to the analyst's AgentConfig row" },
      { label: "Returns", value: "{ runId: string } — the new run's ID" },
    ],
  },
  {
    heading: "Redirect & UI",
    items: [
      { label: "Navigation", value: "router.push(/runs/[runId]) immediately after response" },
      { label: "Page", value: "app/(root)/runs/[id]/page.tsx — server component" },
      { label: "Detects", value: "run.status === \"RUNNING\" → renders AgentThread with autoStart=true" },
      { label: "Component", value: "AgentThread (components/research/AgentThread.tsx)" },
      { label: "Transport", value: "DefaultChatTransport({ api: \"/api/research/agent\", body: { runId, analystId, config } })" },
      { label: "Runtime", value: "useChatRuntime from @assistant-ui/react-ai-sdk → AssistantRuntimeProvider" },
    ],
  },
  {
    heading: "Agent execution",
    items: [
      { label: "Route", value: "POST /api/research/agent (app/api/research/agent/route.ts)" },
      { label: "Model", value: "GPT-4.1 via openai(\"gpt-4.1\")" },
      { label: "Method", value: "streamText() — streams response tokens to the UI in real time" },
      { label: "Max duration", value: "120 seconds (maxDuration = 120)" },
      { label: "Step limit", value: "stopWhen: stepCountIs(30) — max 30 tool call rounds" },
      { label: "Tools", value: "18 tools from createResearchTools({ runId, userId, watchlist, exclusionList, sectors, maxPositionSize })" },
      { label: "System prompt", value: "buildSystemPrompt(agentConfig) + historical context block appended" },
      { label: "Messages", value: "convertToModelMessages(messages) — converts UIMessage[] (AI SDK v6 parts) to ModelMessage[]" },
      { label: "Response", value: "result.toUIMessageStreamResponse() — SSE stream to client" },
    ],
  },
  {
    heading: "Config loading",
    items: [
      { label: "Priority 1", value: "analystId from request body → prisma.agentConfig.findFirst({ id, userId })" },
      { label: "Priority 2", value: "runId from request body → prisma.researchRun.findFirst({ id }) → include agentConfig" },
      { label: "Fields loaded", value: "name, analystPrompt, directionBias, holdDurations, sectors, signalTypes, minConfidence, maxPositionSize, maxOpenPositions, watchlist, exclusionList" },
    ],
  },
  {
    heading: "Historical context (injected into system prompt)",
    items: [
      { label: "Briefings", value: "Last 3 AnalystBriefing rows for this analyst — narrative + strategyNotes, each capped at 600/300 chars" },
      { label: "Open positions", value: "All OPEN trades for this analyst (filtered by agentConfigId) — ticker, direction, shares, entry, target, stop. Includes instruction: \"Do NOT open duplicate positions\"" },
      { label: "Closed trades", value: "Last 20 CLOSED trades (filtered by agentConfigId) — ticker, direction, outcome (WIN/LOSS), entry/exit prices, P&L, agentEvaluation snippet (200 chars)" },
      { label: "Shadow trades", value: "Last 10 SHADOW_CLOSED trades — pass tracking results with GOOD PASS/BAD PASS labels, price delta, hypothetical P&L" },
      { label: "Accuracy stats", value: "Latest AccuracyReport — winRate, tradesAnalyzed, narrativeSummary (300 chars)" },
      { label: "Recent runs", value: "Last 5 completed ResearchRun IDs + completedAt timestamps" },
      { label: "No slot check", value: "Unlike cron runs, manual runs pass the full config.maxOpenPositions to the system prompt — no pre-check of how many positions are already open. The agent relies on seeing its open positions in the context to self-regulate." },
    ],
  },
  {
    heading: "After completion (onFinish callback)",
    items: [
      { label: "Message persistence", value: "Deletes existing RunMessage rows for this runId, creates one new RunMessage with role=\"thread\" containing JSON.stringify of all messages" },
      { label: "Briefing update", value: "Resolves analystId (from request or from run's linked agentConfig), calls updateAnalystBriefing({ analystId, runId, userId })" },
      { label: "waitUntil", value: "Uses @vercel/functions waitUntil() to keep the serverless function alive after the stream closes for the briefing generation" },
      { label: "Briefing model", value: "GPT-4o-mini via generateObject() — produces narrative (400-600 words) + strategyNotes (100-200 words)" },
      { label: "Briefing persists", value: "Creates AnalystBriefing row with: narrative, marketContext, theses[], trades[], portfolioSnapshot, strategyNotes" },
    ],
  },
];

const CRON_RUN_DETAILS: DetailSection[] = [
  {
    heading: "What it does (plain English)",
    items: [
      { label: "When", value: "Every weekday at 8:00 AM Eastern Time, automatically via Inngest cron. Can also be triggered manually via POST /api/research/trigger." },
      { label: "What happens", value: "Finds all enabled analysts and runs each one sequentially. For each analyst: checks how many open positions it already has, creates a ResearchRun, loads full historical context (briefings, trades, accuracy), and calls GPT-4.1 with generateText(). The agent does the same research, thesis, and trade flow as a manual run — it just runs on the server with no UI." },
      { label: "Key difference from manual", value: "Uses generateText() instead of streamText() (no client to stream to). Also calculates remaining position slots per-analyst — if an analyst has 3 of its 5 max positions filled, the system prompt tells it it can only open 2 more. This was fixed in PR #86 (March 16, 2026) — previously the slot check was portfolio-level across ALL analysts, causing crons to skip when any analyst had positions." },
      { label: "Concurrency", value: "Only one morning-research function runs at a time. If it's still running from a previous trigger, the new one waits." },
    ],
  },
  {
    heading: "Trigger",
    items: [
      { label: "Inngest function", value: "morning-research (lib/inngest/functions/morning-research.ts)" },
      { label: "Function ID", value: "\"morning-research\"" },
      { label: "Cron schedule", value: "TZ=America/New_York 0 8 * * 1-5 — 8:00 AM ET, Monday through Friday" },
      { label: "Also fires on", value: "Event \"app/research.run.manual\" — sent by POST /api/research/trigger with optional { agentConfigId }" },
      { label: "Concurrency", value: "limit: 1 — only one morning-research function runs at a time across all analysts" },
      { label: "Retries", value: "1 retry on failure" },
    ],
  },
  {
    heading: "Analyst selection",
    items: [
      { label: "Query", value: "prisma.agentConfig.findMany({ where: { enabled: true } }) — all enabled analysts" },
      { label: "Target filter", value: "If event.data.agentConfigId is set, filters to just that one analyst" },
      { label: "Empty check", value: "Returns { ran: 0, reason: \"no-enabled-configs\" } if no enabled analysts found" },
      { label: "Iteration", value: "Runs each analyst sequentially in a for loop (not parallel)" },
    ],
  },
  {
    heading: "Per-analyst: slot check (fixed in PR #86)",
    items: [
      { label: "Open position count", value: "prisma.position.count({ userId, status: \"OPEN\", analystId: config.id }) — counts only OPEN positions belonging to THIS specific analyst" },
      { label: "Slots remaining", value: "Math.max(0, config.maxOpenPositions - openCount)" },
      { label: "Zero slots", value: "Never skips the run — agent still researches, just won't place new trades. maxOpenPositions in the system prompt is set to slotsRemaining (not the config max)." },
      { label: "PR #86 fix", value: "Before March 16, 2026, this query counted ALL open trades for the user (across all analysts). If Analyst A had 5 positions, Analyst B's cron would see 0 remaining slots and the system prompt would say max positions = 0. Fixed to filter by agentConfigId so each analyst only counts its own positions." },
      { label: "Advisory only", value: "The slot limit is enforced via the system prompt instruction only — the place_trade tool itself has no programmatic gate. The agent reads \"Max open positions: 2\" and self-regulates." },
    ],
  },
  {
    heading: "Run creation",
    items: [
      { label: "Creates", value: "ResearchRun row in Prisma for each analyst" },
      { label: "source", value: "\"AGENT\"" },
      { label: "status", value: "\"RUNNING\"" },
      { label: "parameters", value: "{ markets, sectors, minConfidence, signalTypes, tickers: watchlist, triggeredBy: \"morning-cron\", agentMode: true, analystName }" },
      { label: "agentConfigId", value: "Linked to this analyst's AgentConfig row" },
    ],
  },
  {
    heading: "Agent execution",
    items: [
      { label: "Model", value: "GPT-4.1 via openai(\"gpt-4.1\")" },
      { label: "Method", value: "generateText() — NOT streaming (no client to stream to). Returns { text, steps, response }" },
      { label: "Prompt", value: "\"Begin your research session. Follow all phases in order.\"" },
      { label: "Step limit", value: "stopWhen: stepCountIs(30) — same 30-step limit as manual" },
      { label: "Tools", value: "18 tools from createResearchTools({ runId, userId, watchlist, exclusionList, sectors, maxPositionSize })" },
      { label: "System prompt", value: "buildSystemPrompt(agentConfig) + identical historical context block" },
    ],
  },
  {
    heading: "Config passed to buildSystemPrompt",
    items: [
      { label: "name", value: "config.name" },
      { label: "analystPrompt", value: "config.analystPrompt — the full strategy document" },
      { label: "directionBias", value: "config.directionBias (LONG/SHORT/BOTH)" },
      { label: "holdDurations", value: "config.holdDurations (DAY/SWING/POSITION)" },
      { label: "sectors", value: "config.sectors" },
      { label: "signalTypes", value: "config.signalTypes" },
      { label: "minConfidence", value: "config.minConfidence" },
      { label: "maxPositionSize", value: "Number(config.maxPositionSize)" },
      { label: "maxOpenPositions", value: "slotsRemaining (NOT config.maxOpenPositions — adjusted for open trades)" },
      { label: "watchlist", value: "config.watchlist" },
      { label: "exclusionList", value: "config.exclusionList" },
    ],
  },
  {
    heading: "Historical context (identical to manual)",
    items: [
      { label: "Briefings", value: "Last 3 AnalystBriefing rows for this analyst — narrative + strategyNotes" },
      { label: "Open positions", value: "All OPEN trades for this analyst — with \"Do NOT open duplicate positions\" instruction" },
      { label: "Closed trades", value: "Last 20 CLOSED trades — outcome, P&L, agentEvaluation snippets" },
      { label: "Shadow trades", value: "Last 10 SHADOW_CLOSED trades — pass tracking with GOOD/BAD PASS labels" },
      { label: "Accuracy stats", value: "Latest AccuracyReport — winRate, tradesAnalyzed, narrativeSummary" },
    ],
  },
  {
    heading: "After completion",
    items: [
      { label: "Stats logged", value: "steps.length, toolCalls count, elapsed time in ms" },
      { label: "Position count", value: "prisma.position.count({ decisions: { some: { thesis: { researchRunId: run.id } } } }) — counts positions the agent opened via place_trade tool" },
      { label: "Belt-and-suspenders", value: "If run.status is still RUNNING, marks it COMPLETE with completedAt + appends tradesPlaced, agentSteps, agentToolCalls, elapsedMs to parameters" },
      { label: "Message persistence", value: "Deletes existing RunMessage rows, creates one RunMessage with role=\"thread\" containing the user prompt + all response.messages" },
      { label: "Briefing update", value: "Calls updateAnalystBriefing({ analystId, runId, userId }) — same GPT-4o-mini briefing generation as manual" },
      { label: "On failure", value: "Marks run status=\"FAILED\", sets completedAt, appends error message + failedAt to parameters" },
    ],
  },
  {
    heading: "Return value",
    items: [
      { label: "Per analyst", value: "{ tradesPlaced, steps, toolCalls, elapsedMs } on success, or { error: message } on failure" },
      { label: "Final return", value: "{ ran: configs.length, totalTradesPlaced } — aggregate across all analysts" },
    ],
  },
];

// ── Post-run briefing details ─────────────────────────────────────────────────

const LEARNING_LOOP_DETAILS: DetailSection[] = [
  {
    heading: "What it does (plain English)",
    items: [
      { label: "When", value: "Immediately after every run finishes — both manual runs (you click Run) and cron runs (8 AM daily). It's the very last thing that happens before the run is done." },
      { label: "Purpose", value: "The analyst writes itself a memo about what just happened. Think of it like a trader's journal entry: what did I research, what did I buy, how's my portfolio doing, what should I focus on tomorrow?" },
      { label: "What goes in", value: "Everything from the run: the theses it wrote, the trades it placed, all currently open positions, the last 30 closed trades with win/loss outcomes, shadow trades (stocks it passed on and whether that was the right call), and the previous briefing for continuity." },
      { label: "What comes out", value: "Two pieces: a 400-600 word narrative (portfolio status, recent activity, performance review, pass accuracy, tomorrow's focus) and 100-200 words of strategy notes (what's working, what's not, what to change)." },
      { label: "How it feeds forward", value: "The next time this analyst runs, its system prompt includes the last 3 briefings. So the analyst remembers what it did yesterday, what worked, what it said it would focus on. It builds on itself — each run is informed by all prior runs." },
      { label: "Why it matters", value: "Without this, every run would start from scratch. The briefing is the analyst's memory. Over time, it develops a track record and adjusts its strategy based on actual outcomes — not just market data." },
    ],
  },
  {
    heading: "When it fires",
    items: [
      { label: "Manual runs", value: "In the onFinish callback of streamText(). Uses Vercel's waitUntil() to keep the serverless function alive after the stream closes, so briefing generation doesn't block the UI." },
      { label: "Cron runs", value: "Called directly after generateText() completes and the run is marked COMPLETE. Runs synchronously since there's no client waiting." },
      { label: "Function", value: "updateAnalystBriefing({ analystId, runId, userId }) in lib/agent/update-analyst-briefing.ts" },
      { label: "Error handling", value: "Non-fatal — if briefing generation fails, the error is logged but never thrown. The run is already complete; a missing briefing won't break anything." },
    ],
  },
  {
    heading: "Data collection (9 parallel queries)",
    items: [
      { label: "AgentConfig", value: "The analyst's config — name and analystPrompt (core strategy document)" },
      { label: "Open trades", value: "All trades with status OPEN for this analyst, including each trade's thesis (confidence, reasoning summary, direction, signal types)" },
      { label: "Closed trades", value: "Last 30 CLOSED trades for this analyst — ticker, direction, entry/close prices, shares, P&L, outcome (WIN/LOSS), close reason, thesis confidence + reasoning" },
      { label: "This run's theses", value: "All Thesis rows created during this specific run — ticker, direction, confidence, reasoning, bullets, risk flags, entry/target/stop, hold duration, signal types, sector" },
      { label: "This run's trades", value: "All Trade rows created during this run — ticker, direction, entry price, shares, status, target, stop" },
      { label: "Run summary event", value: "The run_summary RunEvent (if the agent called summarize_run) — contains market summary, ranked picks, risk notes, overall assessment" },
      { label: "Total run count", value: "Count of all COMPLETE ResearchRuns for this analyst — used as \"session number\" in the briefing" },
      { label: "Previous briefing", value: "Most recent AnalystBriefing for this analyst — narrative + strategyNotes + createdAt, used for continuity" },
      { label: "Shadow trades", value: "Last 10 SHADOW_CLOSED trades — stocks the analyst passed on, with outcome (WIN = good pass, avoided a loss; LOSS = bad pass, missed a gain)" },
    ],
  },
  {
    heading: "Portfolio stats (computed from queries)",
    items: [
      { label: "totalInvested", value: "Sum of (entryPrice × shares) across all open trades — total capital currently deployed" },
      { label: "closedPnl", value: "Sum of realizedPnl across all recent closed trades — net profit/loss from completed trades" },
      { label: "wins / losses", value: "Count of closed trades with outcome WIN vs LOSS" },
      { label: "winRate", value: "wins / (wins + losses) — null if no closed trades yet" },
    ],
  },
  {
    heading: "Structured data saved to the briefing row",
    items: [
      { label: "marketContext", value: "From the run_summary event: summary text, rankedPicks, riskNotes, overallAssessment" },
      { label: "theses (Json)", value: "Array of this run's theses: ticker, direction, confidence_score, reasoning_summary, thesis_bullets, risk_flags, entry/target/stop, hold_duration, signal_types" },
      { label: "trades (Json)", value: "Array of this run's trades: ticker, direction, entryPrice, shares, status, targetPrice, stopLoss" },
      { label: "portfolioSnapshot", value: "{ openPositions, totalInvested, closedPnl, winRate, wins, losses, totalTrades, totalRuns }" },
    ],
  },
  {
    heading: "AI generation",
    items: [
      { label: "Model", value: "GPT-4o-mini via generateObject() (structured output, not free text)" },
      { label: "Schema", value: "{ narrative: string (400-600 words), strategyNotes: string (100-200 words) }" },
      { label: "Persona", value: "\"You are [analyst name], an AI research analyst managing a paper trading portfolio. Generate your daily standup briefing — as if a portfolio manager just called and asked 'How's my portfolio? What's our strategy?'\"" },
      { label: "Prompt includes", value: "Core strategy (analystPrompt), open positions with thesis excerpts, 15 recent closed trades with P&L and outcome, this run's thesis/trade counts, run summary JSON (capped at 500 chars), previous briefing (400 char narrative + 200 char strategy notes), shadow trade pass/fail results, total session count" },
      { label: "Narrative sections", value: "1) Portfolio Status — open positions and why held. 2) Recent Activity — buys/sells + outcomes. 3) Performance Review — win rate, P&L trends. 4) Pass Accuracy — shadow trade good/bad pass analysis. 5) Tomorrow's Focus — what to look for next." },
      { label: "Strategy notes", value: "Specific, data-driven adjustments: what patterns emerge in wins vs losses, what to do differently, honest about failures" },
    ],
  },
  {
    heading: "Database storage",
    items: [
      { label: "Table", value: "AnalystBriefing" },
      { label: "Fields", value: "id, analystId, runId (unique — one briefing per run), userId, narrative (String), marketContext (Json?), theses (Json?), trades (Json?), portfolioSnapshot (Json?), strategyNotes (String?), createdAt" },
      { label: "Insert", value: "prisma.analystBriefing.create() — always creates a new row, never updates" },
      { label: "Uniqueness", value: "runId is unique — if a briefing already exists for this run, it will error (but this shouldn't happen since briefings fire once per run)" },
    ],
  },
  {
    heading: "How the next run uses it",
    items: [
      { label: "Loaded by", value: "Both /api/research/agent (manual) and morning-research.ts (cron) load historical context before calling the LLM" },
      { label: "Query", value: "Last 3 AnalystBriefing rows for this analyst, ordered by createdAt desc" },
      { label: "Injected as", value: "\"Your Recent Briefings\" section appended to the system prompt, after buildSystemPrompt(config)" },
      { label: "Truncation", value: "Each briefing's narrative is capped at 600 chars, strategyNotes at 300 chars — keeps the prompt from getting too long" },
      { label: "Effect", value: "The analyst reads its own past journal entries before starting. It knows what it traded yesterday, what it's holding, what it said it would focus on, and how its strategy has been performing. This is the memory loop." },
    ],
  },
];

// ── Context loading details ──────────────────────────────────────────────────

const CONTEXT_LOADING_DETAILS: DetailSection[] = [
  {
    heading: "What it does (plain English)",
    items: [
      { label: "When", value: "Before the agent makes its first tool call — both manual runs and cron runs. This is the invisible setup step that happens after the trigger but before any research begins." },
      { label: "What happens", value: "The system builds the agent's \"brain\" for this session. It loads the analyst's full strategy prompt (its personality and trading rules), then appends a block of historical context: what it's currently holding, what it traded recently, how those trades turned out, what it passed on and whether that was smart, and its statistical accuracy. The agent reads all of this before deciding what to research." },
      { label: "Why it matters", value: "Without this step, every run would be blind — the agent wouldn't know it already holds 3 positions, that its last 5 trades lost money, or that it said yesterday it would focus on biotech. This is what makes the agent learn and adapt rather than start fresh every time." },
      { label: "What the agent sees", value: "The system prompt starts with buildSystemPrompt(config) which has the analyst's name, strategy, rules, and parameter limits. Then a history block is appended with 6 sections: Recent Briefings, Open Positions, Recent Trade History, Shadow Trade Results, Performance Stats, and Recent Research Sessions." },
    ],
  },
  {
    heading: "1. Strategy prompt (buildSystemPrompt)",
    items: [
      { label: "Source", value: "AgentConfig row loaded from DB — either by analystId from the request body, or from the run's linked agentConfig" },
      { label: "Contains", value: "Analyst name, analystPrompt (the full strategy document from the builder), directionBias, holdDurations, sectors, signalTypes, minConfidence, maxPositionSize, maxOpenPositions, watchlist, exclusionList" },
      { label: "Renders as", value: "\"You are [name], an autonomous AI research analyst for a paper trading platform.\" Followed by: Your Mission, Your Rules (all config fields), Your Strategy (analystPrompt), How to Work (6 phases of instructions)" },
      { label: "Key rules", value: "Direction bias, hold duration, sector focus, minimum confidence to trade, max position size ($), max open positions, watchlist (research first), exclusion list (never trade)" },
    ],
  },
  {
    heading: "2. Recent briefings (analyst memory)",
    items: [
      { label: "Query", value: "prisma.analystBriefing.findMany({ where: { analystId }, orderBy: { createdAt: \"desc\" }, take: 3 })" },
      { label: "Format", value: "\"## Your Recent Briefings\" section with each briefing labeled \"Latest\", \"2 sessions ago\", \"3 sessions ago\" with date" },
      { label: "Truncation", value: "Narrative capped at 600 chars, strategyNotes at 300 chars per briefing" },
      { label: "Purpose", value: "The agent reads its own prior journal entries. It knows what it researched yesterday, what it said it would focus on, and how its strategy has been evolving. This is the primary memory mechanism." },
    ],
  },
  {
    heading: "3. Open positions (current holdings)",
    items: [
      { label: "Query", value: "prisma.position.findMany({ where: { userId, status: \"OPEN\", analystId } })" },
      { label: "Fields", value: "symbol, direction, avgCost, quantity, targetPrice, stopLoss, createdAt" },
      { label: "Format", value: "\"## Your Open Positions\" — each position as: LONG/SHORT shares $TICKER @ $price (target: $X, stop: $Y)" },
      { label: "Instruction", value: "Includes: \"Do NOT open duplicate positions in tickers you already hold.\" The agent sees exactly what it's holding and avoids doubling down." },
      { label: "Scope", value: "Filtered by agentConfigId — only this analyst's positions, not other analysts. This is critical for multi-analyst setups." },
    ],
  },
  {
    heading: "4. Closed trade history",
    items: [
      { label: "Query", value: "prisma.position.findMany({ where: { userId, status: \"CLOSED\", analystId }, orderBy: { closedAt: \"desc\" }, take: 20 })" },
      { label: "Fields", value: "symbol, direction, outcome (WIN/LOSS), avgCost, closePrice, quantity, realizedPnl, closeReason, closedAt, agentEvaluation" },
      { label: "Format", value: "\"## Recent Trade History\" — win/loss tally, then each trade: WIN/LOSS | LONG/SHORT $TICKER | entry → exit | P&L | Eval snippet (200 chars)" },
      { label: "Instruction", value: "\"Learn from these results. Avoid repeating losing patterns. Double down on what's working.\"" },
      { label: "Eval snippets", value: "The agentEvaluation field comes from the trade evaluator (GPT-4o post-trade analysis). So the agent reads what a different model said about why each trade won or lost." },
    ],
  },
  {
    heading: "5. Shadow trades (pass tracking)",
    items: [
      { label: "Query", value: "prisma.position.findMany({ where: { userId, status: \"SHADOW_CLOSED\", analystId }, orderBy: { closedAt: \"desc\" }, take: 10 })" },
      { label: "Fields", value: "symbol, avgCost, closePrice, realizedPnl, outcome, closedAt" },
      { label: "Format", value: "\"## Shadow Trade Results — Passes You Tracked\" — good/bad pass tally, then each: GOOD/BAD PASS | $TICKER | passed at $X, now $Y (+Z%) | Missed/Avoided $PnL" },
      { label: "How they're created", value: "When show_thesis is called with direction=PASS, it creates a shadow trade (status: SHADOW, direction: LONG, exits after 7 calendar days). The price monitor tracks it hourly and closes it as SHADOW_CLOSED with outcome WIN (good pass, price dropped) or LOSS (bad pass, price rose)." },
      { label: "Instruction", value: "\"Use these results to calibrate your pass decisions. If you're frequently making bad passes, consider being more aggressive.\"" },
    ],
  },
  {
    heading: "6. Accuracy stats",
    items: [
      { label: "Query", value: "prisma.accuracyReport.findFirst({ where: { userId }, orderBy: { createdAt: \"desc\" } })" },
      { label: "Fields", value: "winRate, tradesAnalyzed, narrativeSummary (300 chars)" },
      { label: "Format", value: "\"## Your Performance Stats\" — win rate %, trades analyzed, calibration narrative" },
      { label: "Instruction", value: "\"Use this data to calibrate your confidence scores. If your win rate is low, be more selective. If you're overconfident (high confidence but low win rate), lower your confidence estimates.\"" },
      { label: "Source", value: "Generated weekly by the accuracy-scorer Inngest cron (Sunday 10 AM ET). Includes calibration buckets, signal accuracy, direction stats." },
    ],
  },
  {
    heading: "7. Recent research sessions",
    items: [
      { label: "Query", value: "prisma.researchRun.findMany({ where: { userId, status: \"COMPLETE\", agentConfigId }, orderBy: { completedAt: \"desc\" }, take: 5 })" },
      { label: "Format", value: "\"## Recent Research Sessions: N completed\" — count only, no details" },
      { label: "Purpose", value: "Gives the agent a sense of how many sessions it's run. A new analyst with 2 sessions behaves differently than a veteran with 50." },
      { label: "Note", value: "This section is only in manual runs (/api/research/agent). The cron version (morning-research.ts) loads the same 5 other sections but does NOT load recent run IDs." },
    ],
  },
  {
    heading: "Differences between manual and cron context loading",
    items: [
      { label: "Same", value: "Both load: briefings, open positions, closed trades, shadow trades, accuracy stats. Both use buildSystemPrompt(config) + historyBlock. Both filter trades by agentConfigId (per-analyst)." },
      { label: "Manual only", value: "Loads last 5 completed ResearchRun IDs + timestamps. Passes full config.maxOpenPositions (no slot calculation)." },
      { label: "Cron only", value: "Calculates slotsRemaining = maxOpenPositions - currentOpenCount. Passes slotsRemaining as maxOpenPositions to the system prompt. So if the analyst already has 3 of 5 positions, the prompt says \"Max open positions: 2\"." },
      { label: "Same model", value: "Both use GPT-4.1 via openai(\"gpt-4.1\"). Both get all 18 tools from createResearchTools(). Both have stopWhen: stepCountIs(30)." },
    ],
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

// ── Detail list component (for key-value detail sheets) ──────────────────────

function DetailList({ sections }: { sections: DetailSection[] }) {
  return (
    <div className="space-y-5">
      {sections.map((section, i) => (
        <div key={i}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
            {section.heading}
          </h3>
          <div className="space-y-1.5">
            {section.items.map((item, j) => (
              <div key={j} className="flex items-start gap-2">
                <span className="text-[11px] font-medium text-foreground shrink-0 w-28 pt-px">
                  {item.label}
                </span>
                <span className="text-[11px] text-muted-foreground leading-relaxed flex-1">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
          {i < sections.length - 1 && <Separator className="mt-4" />}
        </div>
      ))}
    </div>
  );
}

// ── Sheet exports ───────────────────────────────────────────────────────────

type FlowType = "agent-run" | "analyst-builder" | "manual-run" | "cron-run" | "learning-loop" | "context-loading";

interface FlowConfig {
  title: string;
  description: string;
  content: { type: "flow"; steps: FlowStep[] } | { type: "details"; sections: DetailSection[] };
}

const FLOW_CONFIG: Record<FlowType, FlowConfig> = {
  "agent-run": {
    title: "How a Research Run Works",
    description:
      "Each run follows a structured discovery funnel — from reading the market, to finding candidates, to placing paper trades.",
    content: { type: "flow", steps: AGENT_RUN_STEPS },
  },
  "analyst-builder": {
    title: "How the Analyst Builder Works",
    description:
      "GPT-4o with 14 tools (suggest_config + 13 of the agent's 18 research tools — excludes trading and thesis persistence). 4-phase workflow: understand → research → craft → refine. Max 15 tool steps per response.",
    content: { type: "flow", steps: ANALYST_BUILDER_STEPS },
  },
  "manual-run": {
    title: "Manual Run — Full Details",
    description:
      "Click \"Run\" → POST /api/research/agent-run → redirect to /runs/[id] → AgentThread renders → streamText() with GPT-4.1 and 18 tools. Response streams to UI in real time.",
    content: { type: "details", sections: MANUAL_RUN_DETAILS },
  },
  "cron-run": {
    title: "Cron Run — Full Details",
    description:
      "Inngest cron fires at 8 AM ET Mon–Fri. Loads all enabled analysts, runs each sequentially with generateText() and GPT-4.1. Same 18 tools, same system prompt, same historical context.",
    content: { type: "details", sections: CRON_RUN_DETAILS },
  },
  "learning-loop": {
    title: "Post-Run Analyst Briefing — Full Details",
    description:
      "After every run, GPT-4o-mini reviews the analyst's theses, trades, portfolio state, and shadow trades, then writes a narrative briefing and strategy notes. The last 3 briefings feed into the next run's system prompt — this is how the analyst remembers and learns.",
    content: { type: "details", sections: LEARNING_LOOP_DETAILS },
  },
  "context-loading": {
    title: "Context Loading — Full Details",
    description:
      "Before the agent starts researching, it loads its full history into the system prompt: strategy rules, recent briefings (memory), open positions (current holdings), closed trades (outcomes), shadow trades (pass accuracy), and performance stats (calibration). This is what makes the agent aware of its portfolio and past decisions.",
    content: { type: "details", sections: CONTEXT_LOADING_DETAILS },
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
          {config.content.type === "flow" ? (
            <FlowDiagram steps={config.content.steps} />
          ) : (
            <DetailList sections={config.content.sections} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
