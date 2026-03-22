// ── Workflow Data ──────────────────────────────────────────────────────────
// Pure data for the HowItWorksSheet and agent-workflow page.
// No React components — just types and arrays.

import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  TrendingUp,
  Search,
  LineChart,
  MessageSquare,
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
  Reddit: { icon: MessageSquare, description: "Retail trader sentiment from r/wallstreetbets, r/stocks, r/options, and r/investing." },
  StockTwits: { icon: TrendingUp, description: "Trending tickers and social momentum from the StockTwits trader community." },
  SEC: { icon: Landmark, description: "SEC EDGAR filings — 10-K, 10-Q, 8-K, and insider Form 4 transaction reports." },
  Alpaca: { icon: ShoppingCart, description: "Alpaca paper trading API — places simulated market orders and tracks positions." },
  Internal: { icon: Cpu, description: "Hindsight's internal analytics — portfolio exposure, trade history, and performance tracking." },
  "All research": { icon: Globe, description: "Synthesizes all data gathered in previous steps into a single analysis." },
  "All above": { icon: Globe, description: "Combines everything from all previous steps into the final output." },
  You: { icon: User, description: "Your input — trading interests, risk preferences, and strategy ideas." },
  "Market context": { icon: BarChart3, description: "Live market data gathered from earlier research steps." },
  "Your input": { icon: User, description: "Your preferences and feedback from the conversation." },
  "Strategy logic": { icon: Brain, description: "Derived from the strategy prompt and market research above." },
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
    summary: "Before suggesting anything, the builder reads the market — SPY, VIX, 11 sector ETFs, macro events, market themes. It must research live data before proposing any strategy. It has access to 7 of the agent's research tools (it can't trade or write theses — it's just researching to inform the strategy).",
  },
  {
    title: "Scan candidates",
    icon: TrendingUp,
    sources: ["Finnhub", "FMP", "StockTwits", "Reddit"],
    summary: "Finds real candidate stocks with attached catalysts. This grounds the strategy in what's actually moving — a momentum strategy needs active momentum, an earnings strategy needs upcoming reports.",
  },
  {
    title: "Deep-dive specific stocks",
    icon: LineChart,
    sources: ["Finnhub", "FMP", "Reddit", "SEC"],
    summary: "For promising candidates, the builder can pull full stock data, social sentiment, earnings data, SEC filings, or search Reddit. Shows you what your analyst would actually find on a typical morning.",
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
    title: "Propose the complete analyst",
    icon: CheckCircle2,
    sources: ["All above"],
    summary: "Presents the complete analyst profile as a confirmation card. You can refine any part through conversation — the builder updates and re-proposes. Click 'Create Analyst' when you're happy.",
  },
  {
    phase: "Phase 4 — Refine",
    title: "Iterate on changes",
    icon: MessageCircle,
    sources: ["Your input"],
    summary: "After the initial config, you can request changes to any field. The builder updates and re-proposes until you're happy and click Create.",
  },
];

// ── Detail sections ────────────────────────────────────────────────────────

export const MANUAL_RUN_DETAILS: DetailSection[] = [
  {
    heading: "What happens when you click Run",
    items: [
      { label: "Trigger", value: "You click the \"Run\" button on any analyst's page. The system creates a new research session and takes you to the run page." },
      { label: "What you see", value: "A live-streaming chat where the analyst thinks out loud, makes tool calls that render as data cards (market overview, stock analysis, thesis, trade confirmation), and explains its reasoning between each step." },
      { label: "Time limit", value: "120 seconds maximum, up to 30 tool calls. Most sessions complete in 60-90 seconds." },
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
      { label: "Briefing generated", value: "GPT-4o-mini writes a 400-600 word briefing memo based on everything the analyst did. This memo is read by the analyst at the start of its next session — it's the analyst's memory." },
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
      { label: "Briefing fallback", value: "If an analyst times out before calling complete_run, the system generates the briefing automatically. The analyst still gets its memory for next time." },
    ],
  },
];

export const LEARNING_LOOP_DETAILS: DetailSection[] = [
  {
    heading: "The analyst's journal",
    items: [
      { label: "When", value: "Immediately after every session finishes — both manual runs and daily crons. It's always the last thing that happens." },
      { label: "What it is", value: "Think of it like a trader's daily journal entry. The analyst writes itself a memo: what did I research, what did I trade, how's my portfolio doing, was I right about the stocks I passed on, what should I focus on tomorrow?" },
      { label: "Why it matters", value: "Without this, every session would start from scratch. The briefing IS the analyst's memory. Over dozens of sessions, it builds up a track record, recognizes its own patterns, and adjusts its strategy based on actual outcomes." },
    ],
  },
  {
    heading: "What goes into the briefing",
    items: [
      { label: "This session's work", value: "Every thesis written, every trade placed, the overall summary — what the analyst did today and why." },
      { label: "Portfolio snapshot", value: "All currently open positions with unrealized P&L, total capital deployed, win rate, and recent trade outcomes." },
      { label: "Pass tracking", value: "Stocks the analyst decided NOT to trade, recorded with the price at that moment. Later, we check if those stocks went up or down — this measures whether the analyst is too conservative." },
      { label: "Previous briefing", value: "The last memo the analyst wrote to itself, for continuity. So the new briefing can say things like \"yesterday I said to watch AMD — here's what happened.\"" },
    ],
  },
  {
    heading: "What the briefing produces",
    items: [
      { label: "Narrative", value: "A 400-600 word portfolio status update covering: current holdings and why they're held, recent buys/sells and outcomes, performance trends, pass accuracy, and tomorrow's focus areas." },
      { label: "Strategy notes", value: "100-200 words of specific, data-driven adjustments: what patterns are emerging in wins vs losses, what to do differently, honest self-assessment of mistakes." },
      { label: "Watch tomorrow", value: "Specific tickers with triggers — like \"watch AMD if it breaks above $180\" or \"check COIN before earnings Thursday.\" These get priority attention in the next session." },
      { label: "Self-corrections", value: "Things the analyst noticed about its own behavior — like \"I've been too aggressive with momentum plays\" or \"my confidence scores for biotech are consistently too high.\" These feed back into the next session's reasoning." },
    ],
  },
  {
    heading: "How memory feeds forward",
    items: [
      { label: "Next session reads it", value: "When this analyst runs again (tomorrow morning or when you click Run), the system loads the last 3 briefings into the system prompt. The analyst literally reads its own journal before starting." },
      { label: "Continuity", value: "The analyst knows what it traded yesterday, what it's holding, what it said it would watch, and how its strategy has been evolving. Session 50 is informed by everything that happened in sessions 1-49." },
      { label: "Model", value: "GPT-4o-mini writes the briefing. It's a smaller model optimized for structured output — cheaper and faster than the main research agent, but good enough for narrative generation." },
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
      { label: "Plus the 8-phase contract", value: "The exact workflow the analyst must follow — check in on portfolio, read the market, review holdings, review watchlist, discover new ideas, synthesize decisions, execute, and brief." },
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
      { label: "Last briefing", value: "The most recent briefing memo: market posture, what to watch today, unresolved items from last session, self-corrections. This is the analyst's primary memory." },
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
