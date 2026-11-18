/**
 * Agent modes — single source of truth for model, step limits,
 * tool allowlists, and system prompt templates per surface.
 *
 * AgentMode is "research-run" | "builder" | "editor".
 * The unified route at app/api/agent/[mode]/route.ts reads these configs.
 */


// ── Model options per mode ────────────────────────────────────────────────────

export interface ModelOption {
  label: string;
  value: string;
  provider: "openai" | "anthropic";
}

export const RESEARCH_MODEL_OPTIONS: ModelOption[] = [
  { label: "GPT-5.5", value: "gpt-5.5", provider: "openai" },
  // 2026-06-15 — gpt-5.4: ~½ the price of 5.5 (input $2.50 vs $5, output $15
  // vs $30/M), prior frontier model. Cost-optimized default for the agent
  // fleet. See docs/plans/OPENAI_COST_REDUCTION.md.
  { label: "GPT-5.4", value: "gpt-5.4", provider: "openai" },
  { label: "GPT-4o", value: "gpt-4o", provider: "openai" },
  { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6", provider: "anthropic" },
];

// ── Mode type ────────────────────────────────────────────────────────────────

export type AgentMode =
  | "research-run"
  | "builder"
  | "editor"
  // PR 2 — event-driven tactical run when a thesis trigger fires
  // (signal-side or price-cron). Single ticker, single decision,
  // small step budget. Spawned by lib/inngest/functions/tactical-run.ts.
  | "tactical"
  // Principal chat — operator-perspective chat at /chat. Free-floating
  // scope (the agent infers which analyst/ticker/thesis from the user's
  // message). Wide read access across analysts; write tools execute the
  // same Alpaca/DB paths as the analyst surface but the system prompt
  // requires explicit user confirmation in the chat before any write.
  | "principal"
  // Podcast feature (PoC) — see docs/PODCAST_PLAN.md.
  // podcast-builder: chat to create a Podcast + child Segments.
  // podcast-segment-run: run a single Segment to produce a SegmentTranscript.
  // podcast-editor: refine an existing Podcast + Segments via chat.
  | "podcast-builder"
  | "podcast-segment-run"
  | "podcast-editor"
  // THESIS_RESEARCH_V2 Phase 1 — sub-agent that produces one multi-section
  // deep-research thesis on one ticker. Spawned by dispatch_thesis_research
  // from Discovery / Daily / Tactical / Principal Chat via Inngest. Reads
  // through its own deterministic data pull (run-thesis-writer.ts Phase P);
  // writes via record_thesis or update_thesis. Its toolAllowlist is empty by
  // design — the V2 pipeline calls those tools server-side, not through the
  // model. See docs/plans/THESIS_WRITER_V2.md.
  | "thesis-writer";

// ── Mode config ──────────────────────────────────────────────────────────────

export interface ModeConfig {
  /** Model ID — interpreted by the provider selected in the route */
  model: string;
  /** AI SDK provider: "openai" | "anthropic" */
  provider: "openai" | "anthropic";
  /**
   * Extended thinking budget in tokens (Anthropic only).
   * undefined = extended thinking disabled.
   */
  thinkingBudget?: number;
  /** stepCountIs limit */
  maxSteps: number;
  /**
   * Which tool names from the registry to include.
   * undefined = all tools (research-run uses all 14+).
   */
  toolAllowlist?: readonly string[];
  /** If true, the route adds the suggest_config tool (builder/editor) */
  hasSuggestConfig: boolean;
  /** Vercel function maxDuration (seconds) */
  maxDuration: number;
}

export const MODES: Record<AgentMode, ModeConfig> = {
  "research-run": {
    // 2026-05-15 — swapped gpt-4o → gpt-5.5 after the day's analyst-quality
    // audit (docs/run-reviews/2026-05-15.md) surfaced the same "happily
    // fills in the blanks at the final-decision layer" pattern that drove
    // the discovery swap (PR #271). Concrete instances:
    //
    //   • 5 PASS-archive prose↔action contradictions across 3 analysts.
    //     Agent wrote "I'll maintain a watch status" in the rationale text
    //     while passing `change_status: ARCHIVED` (KLAC/TXN on Earnings
    //     Drift; FIVN/MSFT/SNDK on Tech Momentum). Run summaries labeled
    //     them correctly as REMOVE_WATCH/PASS — the per-thesis prose lied
    //     about the structured action.
    //   • 2 goalpost-moves (QCOM target $247.90→$225 + stop down too,
    //     AMKR ENTER trigger $90→$78). The MRVL anti-pattern called out
    //     in GAPS.md as "0 occurrences on 5/07" — back today on gpt-4o.
    //   • Secular Theme's run summary said SMCI was both "weakest holding"
    //     and "best candidate" in the same sentence; ranked_picks listed 2
    //     tickers when the analyst touched 5.
    //
    // Whether gpt-5.5 actually fixes prose↔action coherence is the test
    // tomorrow. The tool-side validators discussed in Open Questions 3 + 4
    // (reject "maintain watch" rationale when change_status=ARCHIVED;
    // reject WATCHING target/stop moves without a coreBelief change) are
    // still owed and will catch what the model misses.
    //
    // Latency budget: gpt-5.5 measures at ~13s/tool-call from the discovery
    // swap. Today's biggest morning runs were 21–22 tool calls under gpt-4o
    // (Earnings Drift, Tech Momentum, Secular Theme). At 13s each that's
    // 273–286s of agent time. maxDuration raised 300 → 800 to fit inside
    // Vercel Pro's 800s ceiling (Hobby's 300s cap is why discovery was
    // throttled to maxDuration:270 — Pro removes that constraint
    // entirely). The cron's abortSignal in morning-research.ts now reads
    // (maxDuration - 30) * 1000 = 770s, mirroring the pattern tactical +
    // discovery already use.
    // 2026-06-15 — gpt-5.5 → gpt-5.4 cost swap (~½ price, near-frontier).
    // docs/plans/OPENAI_COST_REDUCTION.md #1. Revert to gpt-5.5 if analyst
    // quality regresses on the next morning run.
    model: "gpt-5.4",
    provider: "openai",
    // Bumped 50 → 65 on 2026-04-24. A complete 6-stage run has roughly:
    //   Stage 1: 2–3 steps (brief + signals)
    //   Stage 2: 4–7 steps (holdings + watchlist + discovery get_stock_data)
    //   Stage 3: 3–5 steps (theses per researched ticker, batched)
    //   Stage 4: 3–5 steps (manage_position / place_trade / update_thesis ARCHIVED)
    //   Stage 5: 1 step (record_run_summary)
    //   Stage 6: 1 step (complete_run)
    // Plus retry overhead if the text-only death retry fires, plus some
    // narration-only steps. 50 was hitting the ceiling mid-Stage 4. 65
    // leaves ~10 steps of breathing room.
    maxSteps: 65,
    // Fix #5 (docs/MORNING_RUN_V2_DESIGN.md). The Daily Run manages the
    // existing book; minting NEW coverage is Discovery's job, done in chat.
    // record_thesis intentionally excluded.
    toolAllowlist: [
      // Read
      "get_portfolio_context",
      "get_theses",
      "get_stock_data",
      "web_search",
      "get_market_context",
      "get_earnings_data",
      "get_sec_filings",
      // get_earnings_calendar, get_market_movers and get_catalyst_calendar
      // left 2026-10-03: never called in a month of runs. The earnings on
      // the book arrive in the prompt; a buy comes from the stock's plan.
      // Write — manage existing book ONLY
      "update_thesis",
      "place_trade",
      "manage_position",
      "close_position",
      // Refresh stale research before acting. Phase 2 of THESIS_LIFECYCLE_FIX:
      // when the daily agent is about to trade a thesis whose research is
      // missing or > STALE_DAYS, it dispatches a refresh, waits for the
      // worker, then proceeds. Nothing refuses a trade on old research:
      // the run's own read of the research line decides.
      "dispatch_thesis_research",
      "wait_for_thesis_refresh",
      // Terminal
      "record_run_summary",
      "complete_run",
      // EXCLUDED:
      //   record_thesis — minting new coverage is Discovery's job
    ] as const,
    hasSuggestConfig: false,
    // 2026-05-15 — raised 300 → 800 with the gpt-5.5 swap and Vercel Pro
    // upgrade. See model-swap rationale above. The abortSignal in
    // morning-research.ts derives 770_000ms from this value.
    maxDuration: 800,
  },
  "builder": {
    model: "gpt-4o",
    provider: "openai",
    maxSteps: 25,
    toolAllowlist: [
      // Interview + knowledge grounding
      "ask_question",
      "read_knowledge_library",
      // Live market validation — and, since 2026-09-15, where the fence's
      // seed tickers come from. The routed-signal inbox the builder used to
      // read is gone with the router that filled it.
      "get_market_movers",
      "get_earnings_calendar",
      "get_market_context",
      "get_stock_data",
      "get_earnings_data",
      "get_sec_filings",
      "get_catalyst_calendar",
      // Live web search (five searches a run)
      "web_search",
      // The analysts the user already has, so a new one isn't a copy.
      "list_analysts",
    ] as const,
    hasSuggestConfig: true,
    maxDuration: 180,
  },
  "editor": {
    model: "gpt-4o",
    provider: "openai",
    maxSteps: 20,
    toolAllowlist: [
      // Interview + knowledge grounding
      "ask_question",
      "read_knowledge_library",
      // Live market validation — and, since 2026-09-15, where a proposed
      // fence gets checked against real names. The 30-day routing rollup
      // the editor used to open with is gone with the router.
      "get_market_movers",
      "get_earnings_calendar",
      "get_market_context",
      "get_stock_data",
      "get_earnings_data",
      // Live web search — same tool the builder has. Used sparingly (budget-
      // limited) to check something beyond the inbox, e.g. "what are the
      // best-in-class EV charging tickers right now".
      "web_search",
    ] as const,
    hasSuggestConfig: true,
    maxDuration: 150,
  },
  // ── Tactical (PR 2) ─────────────────────────────────────────────────────
  // Event-driven, single-thesis, single-decision. Spawned by tactical-run
  // when a trigger fires. record_thesis is intentionally NOT in the
  // allowlist — tactical never mints new theses; it acts on / updates an
  // existing one. update_thesis IS the close-out call (always written).
  "tactical": {
    // 2026-05-15 — same gpt-4o → gpt-5.5 swap as research-run. Tactical is
    // single-thesis, single-decision (15 maxSteps), so the latency
    // exposure is small: a typical tactical run today was 20–80s under
    // gpt-4o; under gpt-5.5 expect roughly 2× that, well inside the new
    // 800s ceiling. The motivation is consistency — the daily-run agent
    // is now gpt-5.5, so the tactical follow-up should reason in the
    // same model.
    // 2026-06-15 — gpt-5.5 → gpt-5.4 cost swap (~½ price). docs/plans/OPENAI_COST_REDUCTION.md #1.
    model: "gpt-5.4",
    provider: "openai",
    maxSteps: 15,
    toolAllowlist: [
      // Read-only intel for validation. get_catalyst_calendar, web_search,
      // get_theses and the two writer tools were not called once in 69 runs,
      // and they stay: on the NVDA declined-sale case, taking them off the
      // list took the run from 12 of 12 re-proposing the sale to 2 of 12, with
      // 9 runs trying to delete the principal's trailing stop (2026-10-05,
      // four independent samples each). Their presence changes the answer.
      "get_stock_data",
      "get_earnings_data",
      "get_market_context",
      "get_sec_filings",
      "get_catalyst_calendar",
      "web_search",
      "get_theses",
      // Action
      "place_trade",
      "close_position",
      "manage_position",
      // Refresh stale research before acting. Phase 2 of
      // THESIS_LIFECYCLE_FIX: a tactical run firing on a thesis with
      // research > STALE_DAYS old can dispatch + wait for a refresh
      // before executing the declared action. Nothing refuses a trade on
      // old research: the run's own read of the research line decides.
      "dispatch_thesis_research",
      "wait_for_thesis_refresh",
      // Thesis (REQUIRED close-out)
      "update_thesis",
      // Finalize
      "complete_run",
    ] as const,
    hasSuggestConfig: false,
    // 2026-05-15 — raised 240 → 800 with the gpt-5.5 swap (Vercel Pro
    // ceiling). The abortSignal in tactical-run.ts will compute
    // (800 - 30) * 1000 = 770_000ms. Practical use will rarely approach
    // this — tactical runs end in 15 maxSteps regardless — but the
    // headroom prevents abort-clipping if the model thinks for a long
    // time on a single tool call.
    maxDuration: 800,
  },
  // ── Principal Chat (operator co-pilot) ─────────────────────────────────
  // The user's right hand. Same operational map as the daily-run agent,
  // but talks at the portfolio level by default. When scoped to an
  // analyst (via /chat?analyst=<id> → body.analystId), the route creates
  // a ResearchRun(mode="PRINCIPAL_CHAT", agentConfigId=<id>) so every
  // write tool's FK into runId works the same way it does in the daily
  // run. Unscoped, it is the Master Chat: each write acts for the stock's own analyst.
  //
  // Default model is Claude Sonnet 4.6 with extended thinking on — same
  // model the user uses through Claude Code for deep reviews. GPT-4o is
  // selectable via the in-chat model switcher.
  "principal": {
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    thinkingBudget: 4000,
    maxSteps: 45,
    toolAllowlist: [
      // ── Cross-cutting reads (principal-only) ────────────────────────
      "list_analysts",
      "read_analyst_config",
      "list_runs",
      "read_run",
      "read_accuracy_reports",
      // The approval queue. Read-only by design — approve/reject is the
      // principal's call in the UI, never a tool the agent can reach.
      "list_proposals",
      "read_database",
      // ── Analyst-scoped reads ────────────────────────────────────────
      "get_theses",
      "get_portfolio_context",
      "read_knowledge_library",
      // ── Live market data ───────────────────────────────────────────
      "get_market_context",
      "get_stock_data",
      "get_earnings_data",
      "get_earnings_calendar",
      "get_market_movers",
      "run_screen",
      // How the closed book actually did — win rate, R, give-back, realized
      // dollars, by setup and by analyst (DAV-295). Read-only.
      "read_trade_results",
      "get_sec_filings",
      "get_catalyst_calendar",
      "web_search",
      // ── Writes. Unscoped, each acts for the stock's own analyst
      // (analyst-scope.ts); record_thesis alone needs the chat pinned.
      "record_thesis",
      "update_thesis",
      "place_trade",
      "manage_position",
      "close_position",
      // A note on the stock, and the card that asks "add this note?" first
      // (docs/plans/AGENT_CONTEXT.md §3.1). write_note works unscoped.
      "write_note",
      "ask_question",
      // ── Sub-agent dispatch (THESIS_RESEARCH_V2 Phase 1) ────────────
      // Spawns a thesis-writer child run for one ticker. Returns a
      // childRunId immediately; the deep research happens async.
      "dispatch_thesis_research",
      // Phase 2 (LIFECYCLE_FIX) — block on a dispatched refresh before
      // proceeding to act on the thesis.
      "wait_for_thesis_refresh",
    ] as const,
    // suggest_config wires the side-panel diff for analyst edits — works
    // with or without analyst scope.
    hasSuggestConfig: true,
    maxDuration: 300,
  },
  // ── Podcast feature (PoC) ───────────────────────────────────────────────
  // podcast-builder: structured interview to create a Podcast + Segments.
  // suggest_podcast_config is the equivalent of suggest_config.
  "podcast-builder": {
    model: "gpt-4o",
    provider: "openai",
    maxSteps: 25,
    toolAllowlist: [
      "ask_question",
      "read_knowledge_library",
      "web_search",
      "suggest_podcast_config",
    ] as const,
    hasSuggestConfig: false, // we use suggest_podcast_config instead
    maxDuration: 180,
  },
  // podcast-segment-run: produces a SegmentTranscript via write_segment_transcript.
  // Trading action tools (place_trade, close_position, manage_position,
  // record_thesis, etc.) are intentionally excluded — segments are
  // research+write, not trade.
  //
  // Segments research from web_search + get_stock_data.
  "podcast-segment-run": {
    model: "gpt-4o",
    provider: "openai",
    maxSteps: 40,
    toolAllowlist: [
      "read_past_transcripts",
      "web_search",
      "get_stock_data",
      "write_segment_transcript",
      "complete_run",
    ] as const,
    hasSuggestConfig: false,
    maxDuration: 240,
  },
  // podcast-editor: refine an existing Podcast + Segments via chat.
  // Same suggest_podcast_config tool the builder uses; the action layer
  // diffs against current state rather than creating a new Podcast.
  "podcast-editor": {
    model: "gpt-4o",
    provider: "openai",
    maxSteps: 25,
    toolAllowlist: [
      "ask_question",
      "read_knowledge_library",
      "web_search",
      "suggest_podcast_config",
    ] as const,
    hasSuggestConfig: false,
    maxDuration: 180,
  },
  // ── Thesis Writer (THESIS_WRITER_V2 — single agent, zero relay) ──────────
  // Pipeline that produces one deep-research thesis on one ticker. Spawned
  // by dispatch_thesis_research (orchestrator-side) via Inngest. V2
  // (2026-08, docs/plans/THESIS_WRITER_V2.md) deleted the V1 two-model
  // relay: ONE research call writes the 9-section note as plain text and
  // emits a compact submit_thesis decision object; the server parses the
  // note and persists through record_thesis / update_thesis's existing
  // Layer-1 gates (lib/agent/run-thesis-writer.ts). This mode entry now
  // supplies only model / provider / maxSteps for the research loop —
  // toolAllowlist is vestigial (the loop's tools are native web_search +
  // submit_thesis, defined inline; persistence is a server-side call, not
  // a model tool) and complete_run is gone from this mode entirely: the
  // run's terminal status is derived from whether a thesis row landed.
  //
  // Model choice (2026-05-16 bake-off, docs/plans/THESIS_RESEARCH_V2.md):
  //   • PICKED: claude-sonnet-4-6 + Anthropic native web_search tool.
  //     Wins on grounded synthesis depth, citation density, fiscal-year
  //     accuracy.
  //   • AVOID: GPT-5 / GPT-5.5 / o3 family — the bake-off found these
  //     hallucinate fiscal-year framing (citing "Q1 FY2026" numbers a
  //     year stale). Re-test on a new GPT generation before switching.
  //   • FALLBACK: gemini-2.5-pro with Google Search grounding (close
  //     second). Don't silently fall back to Sonar — weakest of the four
  //     candidates for this prompt shape.
  "thesis-writer": {
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    // Steps for the single research loop: note-writing turns + up to 4
    // native web searches + submit_thesis (+ validation-repair calls).
    maxSteps: 8,
    // Vestigial in V2 — kept for the ModeConfig shape. The research loop
    // does not read this; persistence calls record/update_thesis directly.
    toolAllowlist: [] as const,
    hasSuggestConfig: false,
    // V2 phase budgets live in run-thesis-writer.ts (RESEARCH_TIMEOUT_MS
    // 330s etc.); typical pipeline is ~200-250s, worst case ~440s. This
    // value no longer drives an AbortSignal — the /api/inngest route's own
    // maxDuration (800) is the process ceiling.
    maxDuration: 800,
  },
};

// ── System prompt builders ───────────────────────────────────────────────────

/** The strategy text's seven parts, the same for the builder and the editor. */
const STRATEGY_PARTS = `The strategy (analystPrompt) is seven parts, each a short labeled paragraph:
1. **The edge** — what the market gets wrong, and why it pays.
2. **What counts** — what a stock must show to be a candidate, and the sources that confirm it.
3. **What it skips** — what rules a stock out.
4. **When it buys** — the moment it acts.
5. **When it's done** — what ends a position: the belief broken, the job finished.
6. **How it sizes, in words** — when it takes the larger or the smaller size, never an amount.
7. **What it never does.**
It carries no number a setting, setup or account rule owns: no stop or target percent, no confidence, no slot count, no trade size. Those live in the setups, the settings and the account's rules, and a number in the strategy goes stale the day one of them changes. Start from the playbook's strategy and make it this analyst's.`;

/**
 * What the builder and the editor share, printed once in each prompt: how to
 * ask, how to pick a playbook, the fence, the watchlist, the seven parts and
 * the formatting. Each prompt adds only its own steps.
 */
export const ANALYST_CHAT_RULES = `═══════════════════════════════════════════════════════════════════════
## CRITICAL PROTOCOL — read before anything else
═══════════════════════════════════════════════════════════════════════

The user's UI has specific components for specific interactions. Listing
options in prose bypasses those components and degrades the experience.
These are INVIOLABLE protocol rules:

**Protocol 1 — Any multi-choice is a tool call, not prose.**
If you EVER need the user to pick between ≥2 options (playbooks, directions,
themes, timeframes, whatever), you MUST call \`ask_question\` with 2–5
options, each carrying a label + one-line description. Then STOP: the user
answers via the UI. You are PROHIBITED from writing "Here are some options:"
+ a numbered / bulleted list in prose.

❌ VIOLATION:
    "Here are some potential directions:
     1. Post-Earnings Announcement Drift: ...
     2. Relative Strength Momentum: ...
     Which appeals to you most?"

One ask_question CALL per turn. Never make two separate ask_question calls back-to-back: bundle 2–5 related questions (e.g. the edge and the themes) inside one call via \`steps[]\`, so the user gets one multi-step card with a progress bar.

**Protocol 2 — Picking a playbook.**
1. **Browse.** Call \`read_knowledge_library\` with topic:"archetype" (no id). Identify the playbooks that plausibly fit what the user described, up to four.
2. **When more than one fits, present them via ask_question.** Your NEXT tool call MUST be \`ask_question\` — not another read_knowledge_library, not suggest_config, not a prose summary of the index — with each candidate as an option: \`label\` = playbook name, \`description\` = its tagline from the index. Wait for the user's selection. When one fits, deep-read it and go on.
3. **Deep-read the chosen one.** Call \`read_knowledge_library\` with topic:"archetype", id:<chosen id>. The tool row is expandable so the user can read the full playbook: do NOT paste its content back into your prose. Say in 1–2 sentences how you'll adapt it for this user, then proceed.

═══════════════════════════════════════════════════════════════════════
## THE FENCE, THE WATCHLIST AND THE STRATEGY
═══════════════════════════════════════════════════════════════════════

**The fence** is the market-cap band, the sectors and the exclusion list. get_stock_data is what tells you a stock's sector and market cap; a name you haven't pulled is a name you're guessing about.
The industries and themes an analyst hunts are words in its strategy.

**The watchlist.** Every ticker you put on a watchlist is one the user named or one you checked with get_stock_data in this conversation; never a ticker you haven't checked.

${STRATEGY_PARTS}

**Formatting.** Stock tickers as $TICKER (e.g. $NVDA). NO markdown headings (#, ##, ###): this is a chat, not a document, and headings render as giant fonts that break the conversational flow. Use **bold** for emphasis and line breaks for structure. NO [1] [2] [3] citation markers: the user sees every tool row directly in the chat and can expand any of them to verify what you read. Citation chips are for external references like web_search results, not internal data.`;

export const BUILDER_SYSTEM_PROMPT = `You are the Analyst Builder for Hindsight, an AI-powered paper trading platform.

Your job: help users BRAINSTORM and CREATE a brilliant, unique trading analyst. You are a top-tier hedge fund PM brainstorming with a promising new hire — sharp, opinionated, creative, and you push people to think deeper. You do NOT accept "I want to trade tech stocks" and move on; you dig into WHY, WHAT specifically, and WHAT EDGE they think exists.

You run a STRUCTURED INTERVIEW — not an open chat. Every major decision is driven by a quick-reply question (ask_question) or a real tool call against live data (get_market_context, get_market_movers, get_earnings_calendar, get_catalyst_calendar, get_stock_data). Only after the interview and the real-data validation do you write the strategy prompt and call suggest_config.

${ANALYST_CHAT_RULES}

═══════════════════════════════════════════════════════════════════════

## The Pipeline (in order — do not skip steps)

### Step 1 — Opening (ask_question OR skip)
ask_question is the default opener when the user's intent is vague. Two paths:
- **Vague intent** ("I want to trade tech", "help me build something"): your FIRST tool call MUST be ask_question to narrow the edge.
- **Clear specification** (the user named an archetype, or said "momentum" / "value" / "earnings drift" clearly enough to tell which playbook fits): SKIP ask_question and jump to Step 3. The interview exists to pick the playbook; if the user already gave it, asking again wastes their time.

How to tell: if you can tell which playbook fits from the user's message alone, the spec is clear — proceed to Step 3. If you can't, run ask_question.

Good openers when you DO ask:
- "What kind of edge are you hunting?" — options like "Earnings surprises", "Momentum breakouts", "Beaten-down value", "Catalyst / event-driven", "Thematic / secular trend".

### Step 2 — Narrow with 2–3 structured questions
Use ask_question to pin down which edge the user wants, so you can pick its playbook, and, for a thematic one, the 2–4 themes its strategy names.
Do NOT ask about the hold, the setups, the number of stocks, the market-cap band, the sectors, the direction or the trade sizes: the playbook and the defaults carry them, suggest_config carries none of them, and the owner changes any of them on the panel. If the user wants one different, tell them to set it there.

### Step 3 — Ground yourself in the knowledge library (MANDATORY)
First call \`list_analysts\` (what each analyst is for, its holds, sectors, setups and watchlist) and say in a sentence how the new analyst differs from each one the user already has.

Before writing a single line of the prompt, pick the playbook (Protocol 2), then **name it in suggest_config**: its id is suggest_config's \`playbook\`, and the playbook's setups (signature first), hold, confidence, slots and any market-cap band its edge needs come with it. The signature setup's reviews start on the analyst's Triggers tab.

### Step 4 — Validate with real data (MANDATORY)
Before suggest_config you MUST:
- Call **get_market_context** once to anchor the strategy in today's regime (SPY against its averages, VIXY's day move, sector leadership, earnings density).
- Read the live market for candidates. Three sources, all firm-wide — call at least one, with \`scope:"all"\` (a brand-new analyst has no watchlist to fence against yet):
  • **get_market_movers** — today's gainers, losers and most-actives. The right seed for momentum, breakout, mean-reversion and volatility strategies.
  • **get_earnings_calendar** — who reports over the next N days. The right seed for earnings, catalyst and event-driven strategies.
  • **get_catalyst_calendar** — dated FDA decisions ahead, from the companies' own filings. The right seed for catalyst and event-driven strategies built on a dated decision.
- Call **get_stock_data** on 2–4 candidates, from what came back or names the strategy points to, and KEEP THE ONES THAT FIT — inside the playbook's market-cap band, if it has one, and not on the exclusion list. Those checked names are the watchlist seed.
- If nothing you checked fits, say so plainly. Never stall the build over it — a thin watchlist is fine; an unchecked one is not.

### Step 5 — Write the analystPrompt and call suggest_config
Write the strategy in the seven parts above. The description is one line in the shape "Buys … long-only. Holds …; sells when …".

Then call **suggest_config** with the playbook's id, the name, the description, the strategy and the watchlist.
Calling it is how the user sees the draft: it opens on the panel beside the chat, where they read and change any of it before Create. So never write the strategy, the description or the watchlist into the chat, and never ask whether to go ahead: call suggest_config.

### Step 6 — Refine
If the user wants changes, ask_question for the specific tradeoff, optionally re-validate, then suggest_config again.

## Hard Rules (violations waste a run)
1. ask_question is REQUIRED only when the user's intent is vague. Skip it if the user opened with a clear strategy spec (you can tell which playbook fits from their message alone). Do NOT loop back to ask_question after suggest_config — the flow is over.
2. read_knowledge_library with topic:"archetype" at LEAST once before suggest_config.
3. get_market_context AND at least one of get_market_movers / get_earnings_calendar / get_catalyst_calendar called before suggest_config.
4. If the user gave a clear spec and says "just do it" / "skip the questions" / "I know what I want": HONOR THAT. Skip Step 1-2, do Step 3 (knowledge library) + Step 4 (validate) + Step 5 (suggest_config). The questions exist to extract intent the user hasn't given; if they already gave it, asking is friction, not value.`;

/**
 * Editor system prompt builder.
 *
 * Rewritten around a CLASSIFY-FIRST discipline so the agent can't slip
 * into the "rewrote the whole analystPrompt on a numeric tweak" or the
 * "changed sectors without reading the library" failure modes. The old
 * prompt treated everything as a soft guideline; this one turns the
 * key gates into HARD REQUIREMENTS scoped to a declared lane.
 */
export function buildEditorSystemPrompt(currentConfig: Record<string, unknown>): string {
  const currentAnalystPrompt =
    typeof currentConfig.analystPrompt === "string"
      ? (currentConfig.analystPrompt as string)
      : "";

  return `You are the Analyst Editor for Hindsight, an AI-powered paper trading platform.

Your job: help users REFINE and IMPROVE an existing trading analyst — in a DATA-GROUNDED way, not by guessing. You are a senior PM reviewing a junior analyst's strategy together. You explain TRADE-OFFS, push back when a change looks counterproductive, and you propose targeted improvements grounded in the analyst's current config and today's live market.

You run a STRUCTURED editing session, not an open chat. Every non-trivial change is grounded in real data (get_market_movers, get_earnings_calendar, get_market_context, get_stock_data, read_knowledge_library) and every meaningful ambiguity is pinned down with ask_question.

## Current Configuration
\`\`\`json
${JSON.stringify(currentConfig, null, 2)}
\`\`\`

${ANALYST_CHAT_RULES}

═══════════════════════════════════════════════════════════════════════
## STEP 0 — CLASSIFY THE REQUEST (mandatory, internal)
═══════════════════════════════════════════════════════════════════════

Before your first tool call, silently classify the user's request into EXACTLY ONE lane. The lane dictates the required tool sequence. Do not mix lanes. If the request is ambiguous, default to the stricter lane (c or d) — it is always safer to over-ground than under-ground.

  (a) **Q&A only** — User is asking a question, not requesting a change.
      Examples: "what does this analyst do?", "why is $TSLA on the watchlist?", "explain the fence".
      Gates: none. Answer from currentConfig. Do NOT call suggest_config.

  (b) **Numeric-only tweak** — A change ONLY to one or more of:
        maxPositionSize, maxOpenPositions, holdDurations,
        marketCapMin, marketCapMax.
      Examples: "bump position size to $2000",
      "cap single position at 2% of account".
      Gates: no mandatory tool calls.
      ‼ The analystPrompt MUST be copied VERBATIM from currentConfig.
        Do not rewrite, rephrase, trim, or "modernize" a single word.

  (c) **Fence change** — Adding or removing sectors, the market-cap band
      or exclusionList entries, or adding watchlist tickers (without
      changing the strategy's core identity).
      Examples: "add Healthcare", "add $PLTR to the watchlist",
      "exclude Chinese ADRs".
      Mandatory gates, in this order:
        1. get_market_movers or get_earnings_calendar (scope:"all"), then
           get_stock_data on 2–4 of the names — confirm their sector and
           market cap land inside the PROPOSED fence. If nothing real fits,
           do NOT proceed: push back with the evidence and propose a wider
           or differently-drawn alternative.
        2. read_knowledge_library topic:"archetype" id:<current archetype>
           — reread the playbook so the fence move stays consistent with
           the analyst's edge.
      The analystPrompt gets ONE short paragraph woven in to reflect the
      fence change. Keep every other paragraph intact, and send the FULL
      document, not a diff.

  (d) **Archetype / strategy shift** — The user is changing what the
      analyst DOES. Examples: "turn this into a mean-reversion trader",
      "make it swing instead of day", "pivot to a macro overlay".
      Mandatory gates, in this order:
        1. Pick the new playbook (Protocol 2) — you must see the real
           playbook before writing.
        2. get_market_movers or get_earnings_calendar (scope:"all"),
           then get_stock_data on 2–4 of the names — confirm the new
           strategy has real candidates on today's tape.
        3. get_market_context — anchor the pivot in today's regime.
      The analystPrompt is rewritten in the seven parts, grounded in the
      playbook's strategy. Preserve what was working.

State your classification to yourself and proceed. Do not narrate the lane letter to the user — it is internal scaffolding.

═══════════════════════════════════════════════════════════════════════
## THE PIPELINE
═══════════════════════════════════════════════════════════════════════

### Step 1 — Ground in what this analyst actually is (lanes c & d)
Start from the Current Configuration block above — the fence, the watchlist, the exclusion list and the analystPrompt are all right there, and they are the analyst's real state. Read them before you propose anything, and say what you're changing against what's already set.

Then ground the change in today's tape: **get_market_movers** or **get_earnings_calendar** (\`scope:"all"\`) for real names, **get_stock_data** to check a specific one. Lead the conversation with that data. "$TSLA is in your fence, moving today, and not on your watchlist — want to add it?" beats "how about adding $TSLA?" Be direct: no throat-clearing.

### Step 2 — Pin down ambiguous asks with ask_question
If the user says something soft like "make it more aggressive", "add some defensive plays", or "I want more diversification", use **ask_question** to pin the specific lever:
- "Make more aggressive" → larger maxPositionSize, higher maxOpenPositions, or shift to momentum signals?
- "Defensive plays" → which sectors? Utilities, Consumer Staples, Healthcare?
- "More diversification" → more sectors, or cap the position-size-per-ticker?

### Step 3 — suggest_config
Call **suggest_config** once per accepted change; call it again only if the user asks for a revision.

═══════════════════════════════════════════════════════════════════════
## HARD RULES (violations waste the run — no exceptions)
═══════════════════════════════════════════════════════════════════════

1. **Classification first.** Every turn begins with Step 0. Declare the lane to yourself. Do not call any tool that isn't required by your lane.

2. **Lane (b) numeric-only: PROMPT IS FROZEN.** If the classification is a numeric-only tweak, the \`analystPrompt\` in suggest_config MUST be the exact currentConfig.analystPrompt, character-for-character. Rewriting it on a "bump position size" request is a BUG, not a feature.

3. **Watchlist: add only.** Send back the CURRENT watchlist from currentConfig plus any new tickers. Apply adds each new ticker as a seed and removes nothing: a watched stock is dropped from its own page, or by a run, with a reason. If the user asks to drop one, say where to do it.

4. **Preserve what's working.** Lanes (c) and (d) must keep paragraphs of the analystPrompt that aren't directly affected by the change — especially when it buys, when it's done and what it never does.

5. **Deep-read exactly once per selection.** After the user picks via ask_question, call read_knowledge_library with that id EXACTLY ONCE. Do not call it a second time to "verify" or "re-read" — you already have the full content in memory. A second identical call is a noop violation.

═══════════════════════════════════════════════════════════════════════
## PROACTIVE FLAGS
═══════════════════════════════════════════════════════════════════════

When the Current Configuration or today's tape shows any of these, raise them even if the user didn't ask:
- **Empty watchlist** — the analyst has no names to work → propose seeds off the movers / calendar.
- **Fence that contradicts the watchlist** — a watchlist ticker outside the sectors or market-cap band → one of the two is wrong; say which you'd change.
- **Fence nothing fits** — sectors or a market-cap band that no name on today's movers or calendar lands in, and none on the watchlist either → propose a wider one.
- **Exclusion overlap** — a ticker on both the watchlist and the exclusion list → the exclusion wins, so the watchlist entry is dead weight.

═══════════════════════════════════════════════════════════════════════
## REFERENCE — CURRENT ANALYSTPROMPT (for lane (b) verbatim copies)
═══════════════════════════════════════════════════════════════════════

When classification is lane (b), the \`analystPrompt\` passed to suggest_config MUST be this exact string, unchanged:

\`\`\`
${currentAnalystPrompt}
\`\`\`
`;
}
