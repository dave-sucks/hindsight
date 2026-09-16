// ── Education Concepts ─────────────────────────────────────────────────────
// Centralized definitions for key concepts used across the app.
// Powers tooltips, empty states, and education cards.

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  ShoppingCart,
  Target,
  Eye,
  RotateCcw,
  Newspaper,
  Globe,
  PlayCircle,
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
  | "run"
  | "trade"
  | "position"
  | "watchlist"
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
    description: "Every stock an analyst researches gets a thesis: a documented verdict (LONG, SHORT, or PASS) with a confidence score, entry/target/stop prices, bullet-point reasoning, risk flags, and a source_kind (WEB_SEARCH, WATCHLIST_REVIEW, POSITION_REVIEW) saying where the idea came from. Even stocks the analyst decides to pass on get recorded.",
    explanation: "Theses are the core output of every research session. They're not just trade signals — they're full written analyses that explain why the analyst likes or doesn't like a stock, what the risks are, and exactly where it would enter and exit.",
  },
  signal: {
    label: "Finding",
    icon: Newspaper,
    tooltip: "A piece of market intelligence gathered by the old background pipeline. History — nothing produces new ones.",
    description: "Findings were normalized pieces of market intelligence gathered by an overnight pipeline of search, domain and email monitors, then routed to analysts whose universe fence matched. That pipeline was paused in May 2026 and deleted in September. Outside facts reach the analysts two ways now: a trigger condition the five-minute check can evaluate, and the data an analyst pulls itself mid-run.",
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
  "analyst-findings": {
    concept: "signal",
    title: "No findings",
    description: "Findings were routed to analysts by the intelligence pipeline, which was switched off in May and deleted in September. Nothing produces new ones; what's here is history.",
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

  // ── Performance ────────────────────────────────────────────
  "performance-empty": {
    concept: "trade",
    title: "No performance data",
    description: "Performance charts populate as analysts complete trades. Win rate, accuracy reports, and sector breakdowns are calculated weekly.",
  },
};
