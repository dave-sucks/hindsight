// ── Workflow Data ──────────────────────────────────────────────────────────
// Pure data for the HowItWorksSheet and agent-workflow page.
// No React components — just types and arrays.

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Search,
  LineChart,
  ShoppingCart,
  Briefcase,
  MessageCircle,
  Brain,
  Wrench,
  CheckCircle2,
  Globe,
  Newspaper,
  Database,
  User,
  Cpu,
  Landmark,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SourceDef {
  icon: LucideIcon;
  description: string;
}

export interface FlowStep {
  title: string;
  icon: LucideIcon;
  sources: string[];
  summary: string;
  phase?: string;
}

export interface DetailSection {
  heading: string;
  items: { label: string; value: string }[];
}

// ── Source registry (for flow diagram badges) ──────────────────────────────

export const SOURCE_REGISTRY: Record<string, SourceDef> = {
  Finnhub: { icon: BarChart3, description: "Real-time stock quotes, company metrics, earnings calendar, and market news from Finnhub API." },
  "Finnhub News": { icon: Newspaper, description: "Financial news headlines aggregated by Finnhub from major business publications." },
  FMP: { icon: Database, description: "Financial Modeling Prep — market movers, analyst ratings, SEC filings, economic calendar, and insider transactions." },
  SEC: { icon: Landmark, description: "SEC EDGAR filings — 10-K, 10-Q, 8-K, and insider Form 4 transaction reports." },
  Alpaca: { icon: ShoppingCart, description: "Alpaca paper trading API — places simulated market orders and tracks positions." },
  Internal: { icon: Cpu, description: "Hindsight's internal analytics — portfolio exposure, trade history, and performance tracking." },
  "All research": { icon: Globe, description: "Synthesizes all data gathered in previous steps into a single analysis." },
  "All above": { icon: Globe, description: "Combines everything from all previous steps into the final output." },
  You: { icon: User, description: "Your input — trading interests, risk preferences, and strategy ideas." },
  "Market context": { icon: BarChart3, description: "Live market data gathered from earlier research steps." },
  "Your input": { icon: User, description: "Your preferences and feedback from the conversation." },
  "Strategy logic": { icon: Brain, description: "Derived from the strategy prompt and market research above." },
  "Intelligence Pipeline": { icon: Globe, description: "V3 intelligence backbone — background jobs gather signals from source packs, intelligence queries, and portfolio monitoring. The agent reads pre-gathered intelligence instead of rediscovering from scratch." },
  Sonar: { icon: Search, description: "Perplexity Sonar API — domain-filtered web search used by intelligence jobs to gather signals from tracked sources." },
  Firecrawl: { icon: Newspaper, description: "Firecrawl web scraping — extracts full article content from URLs found by Sonar, stored as Artifacts." },
};

// ── Analyst builder flow steps ─────────────────────────────────────────────

export const ANALYST_BUILDER_STEPS: FlowStep[] = [
  {
    phase: "Phase 1 — Understand Vision",
    title: "Ask about trading interests",
    icon: MessageCircle,
    sources: ["You"],
    summary: "The builder asks what excites you about trading — what patterns catch your eye, what sectors interest you, how much risk you're comfortable with. It's like brainstorming with a hedge fund PM who pushes you to think deeper about your edge. Typically 1–2 exchanges.",
  },
  {
    phase: "Phase 2 — Research & Brainstorm",
    title: "Read the market context",
    icon: BarChart3,
    sources: ["Finnhub", "FMP"],
    summary: "Before suggesting anything, the builder reads the market — SPY, VIX, 11 sector ETFs, macro events. It must research live data before proposing any strategy. It has access to 4 of the agent's research tools: market context, stock data, earnings, and SEC filings (it can't trade or write theses — it's just researching to inform the strategy).",
  },
  {
    title: "Deep-dive specific stocks",
    icon: LineChart,
    sources: ["Finnhub", "FMP", "SEC"],
    summary: "For promising candidates, the builder can pull full stock data, earnings data, SEC filings, and options flow. Shows you what your analyst would actually find on a typical morning.",
  },
  {
    phase: "Phase 3 — Craft Strategy",
    title: "Write the strategy prompt",
    icon: Brain,
    sources: ["Market context", "Your input"],
    summary: "Writes a 3–5 paragraph strategy document — the analyst's playbook. Covers: the core edge, what patterns to look for, which data sources matter most, entry/exit criteria, risk management philosophy, and unique angles. This is the most important output — it guides every future research session.",
  },
  {
    title: "Configure trading parameters",
    icon: Wrench,
    sources: ["Strategy logic"],
    summary: "Sets the dials: direction bias (long/short/both), hold durations, sectors, signal types, confidence threshold, position sizing, watchlist, and exclusion list.",
  },
  {
    title: "Propose intelligence setup",
    icon: Globe,
    sources: ["Strategy logic", "Market context"],
    summary: "Proposes the analyst's intelligence pipeline: a source pack with 4-6 curated domain sources (e.g. Electrek for EV, STAT News for biotech), 3-5 permanent intelligence queries for the daily morning sweep, and an intelligence policy controlling signal budgets, attention weights (holdings vs watchlist vs discovery), and quality floors. This powers the background discovery that feeds the analyst before each run.",
  },
  {
    title: "Propose the complete analyst",
    icon: CheckCircle2,
    sources: ["All above"],
    summary: "Presents the complete analyst profile as a confirmation card — including strategy, parameters, source pack, queries, and intelligence policy. You can refine any part through conversation. Click 'Create Analyst' when you're happy — it saves everything: the config, source pack with sources, intelligence queries, and structured watchlist items.",
  },
  {
    phase: "Phase 4 — Refine",
    title: "Iterate on changes",
    icon: MessageCircle,
    sources: ["Your input"],
    summary: "After the initial config, you can request changes to any field. The builder updates and re-proposes until you're happy and click Create.",
  },
];

// ── Intelligence Pipeline Steps ─────────────────────────────────────────────

export const INTELLIGENCE_PIPELINE_STEPS: FlowStep[] = [
  {
    phase: "6:30 AM ET",
    title: "Firm Market Sweep",
    icon: Search,
    sources: ["Sonar", "FMP", "Finnhub"],
    summary: "Executes all firm-level intelligence queries via Perplexity Sonar web search. Also fetches FMP market movers (gainers/losers/actives) and Finnhub earnings calendar for the next 7 days. Creates signals for everything found.",
  },
  {
    phase: "7:00 AM ET",
    title: "Portfolio & Watchlist Monitor",
    icon: Briefcase,
    sources: ["Sonar"],
    summary: "Searches for news about every open position and watchlist item across all analysts. Deduplicates tickers so NVDA is only searched once even if 3 analysts hold it.",
  },
  {
    phase: "7:15 AM ET",
    title: "Source Pack Monitor",
    icon: Newspaper,
    sources: ["Sonar", "Firecrawl"],
    summary: "Checks all tracked domain sources in each pack for new content. Extracts full articles via Firecrawl and stores them as Artifacts linked to signals.",
  },
  {
    phase: "7:30 AM ET",
    title: "Signal Router",
    icon: Brain,
    sources: ["Internal"],
    summary: "Routes all new signals to relevant analysts. Scores relevance using ticker match (40 pts), sector overlap (20 pts), theme keywords (15 pts), and urgency bonuses. Minimum threshold: 15/100.",
  },
  {
    phase: "7:45 AM ET",
    title: "Morning Brief Generator",
    icon: Brain,
    sources: ["Internal"],
    summary: "GPT-4o-mini synthesizes each analyst's routed signals into a structured brief: market context, portfolio alerts, watchlist updates, new opportunities, and risk flags. This is what the analyst reads first when it runs.",
  },
];

export const INTELLIGENCE_PIPELINE_DETAILS: DetailSection[] = [
  {
    heading: "How intelligence replaces scanning",
    items: [
      { label: "Before (V2)", value: "The analyst spent 3-5 tool calls scanning for candidates during every run — calling FMP market movers, checking StockTwits, searching Reddit. This wasted time and API budget rediscovering the same news every run." },
      { label: "After (V3)", value: "5 background jobs run before the analyst wakes up. They gather market movers, earnings calendars, web news, portfolio alerts, and social signals into a persistent signal database. A router assigns signals to analysts by relevance. A brief generator synthesizes everything into a morning intelligence brief." },
      { label: "The analyst's job now", value: "Call read_morning_brief (1 tool call) to get the full picture. Call read_signals if it wants to dig into specific tickers or signal types. Call read_artifact to read a full article. That's it — no more scanning." },
    ],
  },
  {
    heading: "What the agent reads in Phase 1",
    items: [
      { label: "Morning brief", value: "Market context (SPY, VIX, regime, themes), portfolio alerts (positions near targets/stops, earnings this week), watchlist updates (news/catalysts for watched tickers), new opportunities (matched to analyst's mandate), and risk flags." },
      { label: "Routed signals", value: "Filterable by tickers, themes, signal type (NEWS, EARNINGS, MACRO, SECTOR, etc.), and urgency. Each signal has a headline, summary, tickers, sentiment, urgency, and source attribution." },
      { label: "Full articles", value: "When a signal headline is interesting, the analyst can read the full extracted article (up to 4000 chars). Stored as Artifacts by the Firecrawl extraction step." },
    ],
  },
  {
    heading: "Signal types from structured APIs",
    items: [
      { label: "MACRO signals", value: "FMP market movers — top gainers, losers, and most active stocks with price change data. Created by the firm market sweep." },
      { label: "EARNINGS signals", value: "Finnhub earnings calendar — companies reporting in the next 7 days with expected EPS and revenue. Urgency: HIGH if within 2 days." },
      { label: "NEWS signals", value: "Web search results from Perplexity Sonar — financial news, analysis, press releases matched to intelligence queries." },
      { label: "SECTOR signals", value: "Sector-level themes and rotations detected by firm-level queries." },
    ],
  },
];

// ── Detail sections ────────────────────────────────────────────────────────

export const MANUAL_RUN_DETAILS: DetailSection[] = [
  {
    heading: "What happens when you click Run",
    items: [
      { label: "Trigger", value: "You click the \"Run\" button on any analyst's page. The system creates a new research session and takes you to the run page." },
      { label: "What you see", value: "A live-streaming chat where the analyst thinks out loud, makes tool calls that render as data cards (market overview, stock analysis, thesis, trade confirmation), and explains its reasoning between each step." },
      { label: "Time limit", value: "5 minutes maximum, up to 30 tool calls. Most sessions complete in 60-120 seconds." },
      { label: "Model", value: "GPT-4.1 — chosen for its tool-calling accuracy and instruction following. Streams tokens to your browser in real time." },
    ],
  },
  {
    heading: "How it differs from the daily cron",
    items: [
      { label: "Same agent", value: "Same model (GPT-4.1), same 13 tools, same system prompt, same analyst memory. The research quality is identical." },
      { label: "Streaming", value: "Manual runs stream to your browser so you watch it happen. Cron runs execute on the server with no UI — you see the results after." },
      { label: "Position limits", value: "Manual runs give the agent the full max positions setting (e.g. 5). Cron runs calculate how many slots are left and only allow that many new positions." },
    ],
  },
  {
    heading: "What happens after the session ends",
    items: [
      { label: "Messages saved", value: "The entire conversation (agent text + tool calls + results) is saved so the run can be replayed later." },
      { label: "Briefing agent runs", value: "A separate GPT-4o briefing agent reads the full research conversation transcript, reviews portfolio state, and writes a standup brief. This is NOT self-reported — it's an external review of what the analyst actually did." },
      { label: "Safety net", value: "If the agent ran out of time before calling complete_run, the system marks the session as complete and generates the briefing automatically." },
    ],
  },
];

export const CRON_RUN_DETAILS: DetailSection[] = [
  {
    heading: "The daily morning routine",
    items: [
      { label: "Schedule", value: "Every weekday at 8:00 AM Eastern, before the US market opens. Runs automatically — no human needed." },
      { label: "What happens", value: "The system finds all enabled analysts and runs each one sequentially. Each analyst gets its own full research session — just like clicking Run manually, but unattended." },
      { label: "Same agent", value: "Same GPT-4.1 model, same 13 tools, same 8-phase workflow, same analyst memory. The only differences: it runs on the server (no streaming UI), each analyst gets a 4-minute time limit, and position slots are calculated automatically." },
    ],
  },
  {
    heading: "How position limits work",
    items: [
      { label: "Slot calculation", value: "Before each analyst runs, the system checks how many positions it already has open. If the analyst is configured for 5 max positions and already holds 3, the system tells it \"you can open 2 more.\" The analyst sees this in its prompt and self-regulates." },
      { label: "Never skips research", value: "Even when an analyst has zero available slots, it still runs the full research session — it just won't place new trades. It'll still review holdings, update its watchlist, and write a briefing." },
      { label: "Per-analyst isolation", value: "Each analyst only counts its own positions, not other analysts'. If Analyst A has 5 positions, that doesn't affect Analyst B's available slots." },
    ],
  },
  {
    heading: "Safety and reliability",
    items: [
      { label: "Time limit", value: "4-minute hard timeout per analyst. If it gets stuck, it's killed cleanly — any work done before the timeout (theses, trades) is preserved." },
      { label: "One at a time", value: "Only one morning research job runs at a time across all analysts. If it's still running from a previous trigger, the new one waits." },
      { label: "Stale run cleanup", value: "After all analysts finish, the system sweeps for any runs that got stuck in a \"running\" state for more than 10 minutes and marks them as failed. This catches edge cases like server restarts." },
      { label: "Briefing always runs", value: "The briefing agent runs after every session regardless of how it ended — normal completion, timeout, or error. It reads the conversation that was persisted and writes the standup. The analyst always gets its memory for next time." },
    ],
  },
];

export const LEARNING_LOOP_DETAILS: DetailSection[] = [
  {
    heading: "Two agents, not one",
    items: [
      { label: "The key insight", value: "The research agent (GPT-4.1) does research and trading. A separate briefing agent (GPT-4o) reviews the session afterward and writes the standup. You don't ask the trader to write their own performance review — you ask a desk editor who read the full transcript." },
      { label: "When", value: "Immediately after every session finishes — both manual runs and daily crons. Triggered in the route's onFinish callback after the conversation is persisted." },
      { label: "Why not self-reported?", value: "When the analyst wrote its own brief, it wasted tool budget on self-reflection, produced self-serving assessments, and a dumber model (GPT-4o-mini) rewrote everything anyway. Now the analyst just does its job, and an external reviewer reads the full conversation to produce the brief." },
    ],
  },
  {
    heading: "What the briefing agent reads",
    items: [
      { label: "Full conversation transcript", value: "Every message the analyst wrote, every tool it called, every result it received — the entire research session conversation from RunMessage. Capped at ~12k chars but includes all the important reasoning and decisions." },
      { label: "Portfolio state", value: "All currently open positions with unrealized P&L, total capital deployed, win rate, and recent trade outcomes." },
      { label: "This session's theses and trades", value: "Every thesis generated, every trade placed or closed, PASS decisions with reasoning." },
      { label: "Previous briefing", value: "The prior standup brief, for continuity. So the new briefing can reference whether the analyst followed through on last session's watch items and self-corrections." },
      { label: "Pass tracking", value: "Stocks the analyst decided NOT to trade, recorded with the price and confidence. The briefing agent evaluates whether those passes were the right call." },
    ],
  },
  {
    heading: "What the briefing produces",
    items: [
      { label: "Narrative", value: "A 400-600 word summary of what the analyst actually DID this session — key findings, decisions made with rationale, portfolio state. Specific enough that the analyst can quote it next session." },
      { label: "Strategy notes", value: "100-200 words of data-driven assessment: what patterns are emerging in wins vs losses, what should change. Written by the reviewer, not the analyst." },
      { label: "Market posture", value: "2-3 word stance summary (e.g. 'cautiously bullish', 'defensive') based on the analyst's actual behavior, not just what it claimed." },
      { label: "Watch tomorrow", value: "2-5 specific tickers with triggers — derived from positions near targets/stops, unresolved research, catalysts mentioned in conversation. e.g. 'AMD: breakout above $180 → INITIATE LONG [HIGH]'" },
      { label: "Unresolved items", value: "Data gaps, pending catalysts, tickers the analyst wanted to research but ran out of steps for, failed tool calls — anything that needs follow-up." },
      { label: "Self-corrections", value: "Behavioral patterns the reviewer noticed — over-concentration, momentum chasing, ignoring stop losses, skipping watchlist items. More honest than self-assessment because the reviewer has no ego." },
      { label: "Dynamic queries", value: "0-5 temporary intelligence queries for things that need monitoring but aren't covered by existing source packs or permanent queries. Examples: 'NVIDIA earnings guidance revision Q2 2026', 'FDA approval timeline for Eli Lilly GLP-1 competitor'. Each has an expiration date (3-30 days). These get picked up by the morning sweep job and generate signals automatically — the analyst sees them as routed signals in its next session." },
    ],
  },
  {
    heading: "How memory feeds forward",
    items: [
      { label: "Next session reads it", value: "When this analyst runs again (tomorrow morning or when you click Run), the system loads the latest briefing into the system prompt. The analyst sees the prior brief in Phase 0 and must reference it." },
      { label: "Accountability", value: "The analyst is required to quote Watch Tomorrow items by name in its Phase 0 check-in. If the prior brief said 'watch AMD for breakout,' the analyst must acknowledge that and check AMD first." },
      { label: "Model", value: "GPT-4o writes the briefing. The briefing is the memory system — it's the most important artifact for run-to-run continuity. Using a capable model here is worth the extra cost." },
      { label: "Dynamic queries → morning sweep", value: "Dynamic queries created by the briefing agent are picked up by the next morning's intelligence sweep job. The sweep runs them through Perplexity Sonar, generates signals, and routes them to the analyst. So if the briefing agent says 'monitor AMD Instinct MI400 benchmarks', the analyst will see any news about that as a signal in its next session — automatically, without the analyst having to remember to search for it." },
    ],
  },
];

export const CONTEXT_LOADING_DETAILS: DetailSection[] = [
  {
    heading: "What the analyst knows before it starts",
    items: [
      { label: "When", value: "Before the agent makes its first tool call — this is the invisible setup step between the trigger and any research." },
      { label: "What happens", value: "The system builds the agent's \"brain\" for this session. It loads the analyst's strategy document (its personality and trading rules), then gathers everything it needs to be aware of: what it's currently holding, what it traded recently, how those trades performed, what it passed on, and its accuracy statistics." },
      { label: "Why", value: "A human analyst walks into the office knowing their book. Without this step, the AI analyst would be blind — it wouldn't know it already holds 3 positions, that its last 5 trades lost money, or that it said yesterday it would focus on biotech." },
    ],
  },
  {
    heading: "The analyst's strategy (its playbook)",
    items: [
      { label: "What", value: "The full strategy document written by the AI builder during analyst creation. Covers the analyst's core edge, entry/exit criteria, preferred patterns, risk management philosophy." },
      { label: "Plus rules", value: "Direction bias (long-only, short-only, or both), hold durations, sector focus, minimum confidence threshold to trade, max position size, max open positions, watchlist, and exclusion list." },
      { label: "Plus intelligence policy", value: "The analyst's intelligence policy — signal budget (max signals per run), article read budget, attention weights (how much time to spend on holdings vs watchlist vs discovery), live search permissions, source quality floors, and preferred/excluded source categories. This shapes how the agent allocates its research time." },
      { label: "Plus the 8-phase contract", value: "The exact workflow the analyst must follow — check in on portfolio, read intelligence, optionally orient with live data, review holdings, review watchlist, discover from signals, synthesize decisions, execute, and wrap up." },
    ],
  },
  {
    heading: "Portfolio state (live snapshot)",
    items: [
      { label: "Open positions", value: "Every position the analyst currently holds — ticker, direction, shares, entry price, target, stop-loss, days held, and unrealized P&L calculated from live Alpaca prices." },
      { label: "Exposure", value: "Total long exposure, short exposure, net exposure, and utilization percentage. The analyst sees exactly how much capital is deployed." },
      { label: "Account balance", value: "Cash available, buying power, and total portfolio value from the paper trading account." },
      { label: "Watchlist", value: "Active watchlist items with priority, catalyst, conviction, and how long each has been on the list. HIGH priority items get reviewed first." },
      { label: "Active theses", value: "The most recent thesis for each open position and watchlist symbol — the analyst can reference and update these during the session." },
    ],
  },
  {
    heading: "Memory (prior briefings and trade history)",
    items: [
      { label: "Last briefing", value: "The most recent standup brief from the post-run briefing agent: market posture, what to watch today, unresolved items, self-corrections. Written by GPT-4o reviewing the full conversation — this is the analyst's primary memory." },
      { label: "Closed trades", value: "The last 10 closed positions with outcome (win/loss), P&L percentage, days held, close reason, and the lesson learned. The analyst uses this to avoid repeating mistakes." },
      { label: "Pass decisions", value: "The last 10 stocks the analyst passed on, with the price at that moment and its confidence score. This lets it evaluate whether it's been too conservative or too aggressive with its passes." },
      { label: "Accuracy stats", value: "Win rate, total trades analyzed, and a calibration note from the weekly accuracy scorer. If the analyst is overconfident (high confidence but low win rate), it's told to recalibrate." },
    ],
  },
  {
    heading: "Manual vs. cron context",
    items: [
      { label: "Same core context", value: "Both manual and cron runs load the same analyst memory: strategy, portfolio, briefings, trade history, pass tracking, and accuracy stats." },
      { label: "Cron adjusts position limits", value: "The daily cron calculates how many position slots are left and tells the analyst \"you can open N more.\" Manual runs give the full configured max and let the analyst self-regulate based on what it sees in its portfolio." },
      { label: "Resilient loading", value: "Each context section loads independently. If Alpaca is down (no live prices), the rest of the context still loads — the analyst just won't see unrealized P&L for that session." },
    ],
  },
];
