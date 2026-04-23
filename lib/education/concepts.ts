// ── Education Concepts ─────────────────────────────────────────────────────
// Centralized definitions for key concepts used across the app.
// Powers tooltips, empty states, onboarding, and education cards.

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Brain,
  FileText,
  LineChart,
  Radar,
  Search,
  ShoppingCart,
  Target,
  Eye,
  RotateCcw,
  Newspaper,
  Globe,
  BarChart3,
  PlayCircle,
  Sparkles,
  ArrowLeftRight,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Concept {
  /** Short label for the concept */
  label: string;
  /** Icon for visual identification */
  icon: LucideIcon;
  /** One-line tooltip description */
  tooltip: string;
  /** Longer description for empty states and education cards */
  description: string;
  /** Even longer product-oriented explanation for onboarding */
  explanation?: string;
}

export interface EmptyStateConfig {
  /** Key concept this empty state is about */
  concept: ConceptKey;
  /** Title shown in the empty state */
  title: string;
  /** Description with context on what to do */
  description: string;
  /** Optional call-to-action */
  action?: {
    label: string;
    href: string;
  };
  /** Optional HowItWorksSheet flow to link to */
  learnMoreFlow?: string;
}

// ── Concept Registry ───────────────────────────────────────────────────────

export type ConceptKey =
  | "analyst"
  | "thesis"
  | "signal"
  | "monitor"
  | "brief"
  | "run"
  | "trade"
  | "position"
  | "watchlist"
  | "intelligence"
  | "learning-loop"
  | "pipeline";

export const CONCEPTS: Record<ConceptKey, Concept> = {
  analyst: {
    label: "Analyst",
    icon: Bot,
    tooltip: "An AI persona with its own strategy, universe, watchlist, and trading rules that researches stocks and places paper trades autonomously.",
    description: "Analysts are AI personas you create through conversation. Each has a strategy document (its playbook), a universe (sectors + industries + themes + marketCap fence), risk parameters, a watchlist, and an intelligence policy. They run structured research sessions — reviewing holdings, discovering opportunities inside the universe, and placing paper trades — then a separate briefing agent writes memory that carries forward to the next session.",
    explanation: "Think of analysts as autonomous research associates at a trading desk. You describe the edge you're hunting, and the AI builder grounds every proposal in a strategy playbook and real signal discovery before writing the config. Each analyst manages its own portfolio independently, runs daily at 8 AM, and gets smarter over time through memory and post-trade evaluation.",
  },
  thesis: {
    label: "Thesis",
    icon: Target,
    tooltip: "The analyst's verdict on a stock — LONG, SHORT, or PASS — with confidence, price targets, reasoning, and source provenance.",
    description: "Every stock an analyst researches gets a thesis: a documented verdict (LONG, SHORT, or PASS) with a confidence score, entry/target/stop prices, bullet-point reasoning, risk flags, and a source_kind (ROUTED_SIGNAL, WEB_SEARCH, WATCHLIST_REVIEW, POSITION_REVIEW) with the specific signal IDs that informed it. Even stocks the analyst decides to pass on get recorded.",
    explanation: "Theses are the core output of every research session. They're not just trade signals — they're full written analyses that explain why the analyst likes or doesn't like a stock, what the risks are, and exactly where it would enter and exit. Because every thesis declares which signals informed it, trade outcomes flow back to credit (or penalize) the monitors that found those signals — that's how Hindsight measures intelligence ROI.",
  },
  signal: {
    label: "Finding",
    icon: Newspaper,
    tooltip: "A piece of market intelligence — news, earnings, filing, newsletter — gathered by background jobs and routed to analysts whose universe matches.",
    description: "Findings are normalized pieces of market intelligence gathered by the overnight pipeline and inbound email. Each has a headline, summary, affected tickers, sectors/industries/themes, sentiment, urgency, and source attribution. They're routed to analysts by the signal router, which checks each analyst's universe fence (sectors + industries + themes + marketCap) and tags every route with a reason code: POSITION, WATCHLIST, DIRECT_TICKER, SECTOR_MATCH, INDUSTRY_MATCH, THEME_MATCH, DISCOVERY, or CROSS_ANALYST.",
  },
  monitor: {
    label: "Monitor",
    icon: Search,
    tooltip: "A search query, tracked website, API feed, or inbound newsletter that the intelligence pipeline uses to gather findings.",
    description: "Monitors are the inputs to the intelligence pipeline. Search monitors run queries via Perplexity Sonar. Domain monitors track specific websites (Firecrawl extracts the full article). API monitors pull FMP movers and Finnhub earnings. Email ingest creates monitors from newsletters you forward to your Resend inbox. Every monitor tracks its own ROI — tradesSourced, winsSourced, lossesSourced, successScore — so you can see which ones produce signals that actually lead to winning trades.",
  },
  brief: {
    label: "Brief",
    icon: FileText,
    tooltip: "A structured summary — either a morning intelligence brief or a post-run standup memo — that feeds the analyst's next session.",
    description: "There are two types of briefs. Morning intelligence briefs are generated at 7:45 AM by GPT-4o from today's routed signals (validated against the day's route pool — no recycling yesterday's IDs). Each has market context, portfolio alerts (one per open position when holdings-attention is on), watchlist updates, new opportunities (at least one real discovery when the bucket is non-empty), attention priority, and risk flags. Post-run briefs are written by a separate briefing agent after each research session — narrative, strategy notes, watch-tomorrow items, self-corrections, and up to 5 temporary search monitors.",
  },
  run: {
    label: "Run",
    icon: PlayCircle,
    tooltip: "A single research session where an analyst uses 17 tools in a 6-stage flow to research stocks, form theses, and execute paper trades.",
    description: "A run is a structured research session following a 6-stage flow: Orient (read intelligence), Research (live data on holdings + watchlist + discovery), Theses (LONG / SHORT / PASS for every researched ticker, with source_kind and signal IDs), Act (manage existing positions, place new trades, update watchlist), Recap (ranked picks + exposure breakdown), Complete (triggers the briefing agent inline). Each run uses GPT-4o at temperature 0.2 with a 50-step budget. Runs happen manually (you click Run) or automatically at 8 AM daily.",
  },
  trade: {
    label: "Trade",
    icon: ArrowLeftRight,
    tooltip: "A simulated buy or sell order executed on the Alpaca paper trading platform.",
    description: "Trades are paper orders executed through Alpaca's simulated brokerage. When an analyst has high enough confidence in a thesis, it places a market order. The system tracks entry price, target, stop-loss, and calculates real P&L as prices move. Trades are the measurable output that lets you evaluate whether an analyst's strategy actually works.",
  },
  position: {
    label: "Position",
    icon: ShoppingCart,
    tooltip: "An open paper trade being tracked — with entry price, target, stop-loss, and live P&L.",
    description: "A position is an active holding in an analyst's paper portfolio. Each tracks direction (long/short), entry price, shares, target price, stop-loss, and unrealized P&L updated from live prices. The analyst reviews all open positions at the start of every run and decides whether to hold, add, reduce, or exit.",
  },
  watchlist: {
    label: "Watchlist",
    icon: Eye,
    tooltip: "Stocks an analyst is monitoring but hasn't traded yet — prioritized with catalysts and target entries.",
    description: "The watchlist is an analyst's 'come back to this' list. Each item has a priority (HIGH/MEDIUM/LOW), upcoming catalyst, conviction level, and target entry price. High-priority items get reviewed first in every session. When an analyst trades a watchlist stock, it automatically graduates off the list.",
  },
  intelligence: {
    label: "Intelligence",
    icon: Radar,
    tooltip: "The background system that gathers findings, routes them by universe fence, and writes grounded morning briefs before analysts run.",
    description: "The intelligence pipeline is five background jobs that run every weekday morning between 6:30–7:45 AM ET, plus inbound email ingest on demand. They run firm-wide Sonar sweeps, check each analyst's portfolio + watchlist, extract tracked domains via Firecrawl, score and route findings by universe match (position +50, watchlist +45, industry +22, sector +20, theme +18, with urgency bonuses and a 7-day novelty multiplier — HIGH/BREAKING gets a carve-out), reserve 20% of each analyst's slots for DISCOVERY, and synthesize everything into personalized morning briefs grounded to today's routes. By 8 AM, each analyst has a curated inbox — no scanning from scratch. The /intelligence (Health tab) dashboard surfaces dead crons, signal funnel, novelty distribution, and per-monitor ROI.",
    explanation: "Without the intelligence pipeline, each analyst would waste 3-5 tool calls every morning rediscovering the same news. The pipeline front-loads all that work overnight, routes each signal through every analyst's universe fence, and then the brief generator forces each holding to get an alert and each run to have at least one real discovery. It's the difference between an analyst who reads a curated morning paper and one who starts each day from zero.",
  },
  "learning-loop": {
    label: "Learning Loop",
    icon: RotateCcw,
    tooltip: "The memory system — a separate GPT-4o agent reviews each session and writes a standup that feeds the next run.",
    description: "After every research session, a separate briefing agent (GPT-4o) reads the full conversation transcript, portfolio state, and trade outcomes. It writes a structured standup: narrative, strategy notes, watch-tomorrow items, unresolved items, self-corrections, and dynamic monitors. This brief feeds into the next session's system prompt, creating run-to-run memory and accountability.",
  },
  pipeline: {
    label: "Pipeline",
    icon: Globe,
    tooltip: "The full daily cycle: intelligence gathering (6:30 AM) → analyst runs (8 AM) → briefing + memory (after each run).",
    description: "The complete Hindsight cycle runs daily: background intelligence jobs gather market data and route findings (6:30–7:45 AM), analysts run structured research sessions (8 AM), and post-run briefing agents write memory that feeds forward. The loop repeats every weekday, with each cycle building on the last.",
  },
};

// ── Empty State Configs ────────────────────────────────────────────────────
// Centralized configs for all empty states across the app.

export const EMPTY_STATES: Record<string, EmptyStateConfig> = {
  // ── Analysts ───────────────────────────────────────────────
  "analysts-list": {
    concept: "analyst",
    title: "Create your first analyst",
    description: "Analysts are AI personas that research stocks and trade autonomously. Describe your trading style, and the AI builder creates a complete strategy, watchlist, and intelligence setup.",
    action: { label: "Create Analyst", href: "/analysts/new" },
    learnMoreFlow: "builder",
  },
  "analyst-briefs": {
    concept: "brief",
    title: "No briefs yet",
    description: "Morning briefs are generated at 7:45 AM from overnight intelligence. Post-run briefs are written after each research session. Run this analyst or wait for the daily cron to see briefs here.",
    learnMoreFlow: "briefing",
  },
  "analyst-findings": {
    concept: "signal",
    title: "No findings routed yet",
    description: "The intelligence pipeline gathers findings overnight and routes them to analysts by relevance. Set up search and domain monitors on this analyst to start receiving findings.",
    learnMoreFlow: "intelligence",
  },
  "analyst-trades": {
    concept: "trade",
    title: "No trades yet",
    description: "Trades appear here when this analyst places paper orders during a research run. The analyst needs enough confidence in a thesis before it trades.",
  },
  "analyst-watchlist": {
    concept: "watchlist",
    title: "No stocks on watchlist",
    description: "The watchlist tracks stocks this analyst is monitoring. Items are added during runs when the analyst finds something interesting but isn't ready to trade yet.",
  },

  // ── Runs ───────────────────────────────────────────────────
  "runs-list": {
    concept: "run",
    title: "No runs yet",
    description: "Research runs happen when you click Run on an analyst or automatically at 8 AM daily. Each run is a structured session where the analyst researches, analyzes, and trades.",
    action: { label: "View Analysts", href: "/analysts" },
    learnMoreFlow: "agent",
  },

  // ── Trades ─────────────────────────────────────────────────
  "trades-list": {
    concept: "trade",
    title: "No paper trades yet",
    description: "Paper trades are placed automatically when an analyst finds a high-confidence setup during a research run. They're executed on Alpaca's simulated brokerage with real market prices.",
    action: { label: "View Analysts", href: "/analysts" },
  },

  // ── Dashboard ──────────────────────────────────────────────
  "dashboard-picks": {
    concept: "thesis",
    title: "No recent picks",
    description: "Theses appear here after an analyst runs a research session. Each pick includes the analyst's verdict, confidence score, and price targets.",
    action: { label: "Run an Analyst", href: "/analysts" },
  },
  "dashboard-positions": {
    concept: "position",
    title: "No open positions",
    description: "Positions appear here when an analyst places a paper trade. Each shows live P&L tracked from real market prices.",
  },
  "dashboard-closed": {
    concept: "trade",
    title: "No closed trades",
    description: "Closed trades appear here after an analyst exits a position — either hitting a target, stop-loss, or manual decision.",
  },
  "dashboard-equity": {
    concept: "trade",
    title: "No trade history",
    description: "The equity chart tracks portfolio value over time as trades open and close. Start trading to see your performance curve.",
  },

  // ── Intelligence ───────────────────────────────────────────
  "intelligence-signals": {
    concept: "signal",
    title: "No findings yet",
    description: "Findings are gathered by the intelligence pipeline — search monitors, domain monitors, and API monitors running every morning. Trigger the pipeline manually or wait for the 6:30 AM cron.",
    learnMoreFlow: "intelligence",
  },
  "intelligence-monitors": {
    concept: "monitor",
    title: "No monitors configured",
    description: "Monitors are search queries and tracked websites that the pipeline checks daily. Create an analyst with intelligence setup to automatically generate monitors.",
    action: { label: "Create Analyst", href: "/analysts/new" },
  },
  "intelligence-briefs": {
    concept: "brief",
    title: "No briefs generated",
    description: "Morning briefs are synthesized at 7:45 AM from routed findings. Run the Morning Brief job from the pipeline trigger, or wait for the daily cron.",
    learnMoreFlow: "intelligence",
  },

  // ── Performance ────────────────────────────────────────────
  "performance-empty": {
    concept: "trade",
    title: "No performance data",
    description: "Performance charts populate as analysts complete trades. Win rate, accuracy reports, and sector breakdowns are calculated weekly.",
  },
};

// ── Onboarding Steps ───────────────────────────────────────────────────────

export interface OnboardingStep {
  title: string;
  description: string;
  concept: ConceptKey;
  visual: "analyst" | "intelligence" | "run" | "trade" | "loop";
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: "Create AI Analysts",
    description: "Describe your trading style in conversation. The AI builder researches live market data and creates a complete analyst — strategy, rules, watchlist, and intelligence monitors. Each analyst is an autonomous trading persona.",
    concept: "analyst",
    visual: "analyst",
  },
  {
    title: "Intelligence Gathers Overnight",
    description: "Five background jobs run every morning before markets open. They search the web, check tracked sources, and route relevant findings to your analysts. By 8 AM, each analyst has a personalized intelligence brief.",
    concept: "intelligence",
    visual: "intelligence",
  },
  {
    title: "Structured Research Sessions",
    description: "Analysts follow a 6-stage flow — orient (read intelligence), research (live data on holdings + watchlist + 2-4 discoveries), theses (LONG/SHORT/PASS with signal provenance), act (manage positions + place trades), recap, complete. You can watch live or review the conversation after.",
    concept: "run",
    visual: "run",
  },
  {
    title: "Real Paper Trades",
    description: "When an analyst has high confidence in a thesis, it places a real paper trade on Alpaca. Every position is tracked with live P&L, targets, and stop-losses. You can measure actual performance.",
    concept: "trade",
    visual: "trade",
  },
  {
    title: "Memory That Compounds",
    description: "After every session, a separate GPT-4o agent reviews the full conversation and writes a standup brief. It tracks what worked, what didn't, and what to watch tomorrow. Each run builds on the last.",
    concept: "learning-loop",
    visual: "loop",
  },
];
