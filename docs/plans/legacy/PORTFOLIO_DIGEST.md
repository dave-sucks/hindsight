> **SHIPPED (P1-23, #434/#436) — see [`../../THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md); kept as build history.**

# Portfolio Digest + Coverage Table — Plan

> Filed 2026-06-16 (principal + QB). Closes GAPS **P1-23**. Two **separate** features that both live on the homepage. North-star mockup: the `daily_portfolio_digest_draft` widget from the 2026-06-16 session (Perplexity-style article + tabbed table).
>
> **Anti-goal:** the old Morning Discovery Brief — schema-per-sentence, a JSON shape for every kind of clause. We are NOT doing that. The brief is freeform markdown prose. The only structure is inline reference tokens.

---

## The two features (do not conflate them)

| | A — Daily Portfolio Digest (the brief) | B — Coverage Table |
|---|---|---|
| What | A few paragraphs of prose summarizing the whole book's day across ALL runs | A sortable table of every covered name, by status |
| Audience | The principal (reads it) **and** the agents (run-to-run memory) | The principal (mainly), agents secondarily |
| Shape | Freeform markdown + inline reference tokens | Tabbed table (Active / Watching / Passed) |
| Risk | Touches the live agent's morning context (rewire) | Additive, read-only UI |

They ship independently. B is lower-risk and can land first.

---

## Feature A — Daily Portfolio Digest (the brief)

### What it is
ONE account-level digest per day, covering activity across **all run types** (daily + tactical + discovery) and **all analysts**, centered on the portfolio as a whole. Replaces the dead per-analyst `AnalystBriefing`. ~4–6 short paragraphs — a bit longer/more robust than the mockup, not a wall.

### Storage — `PortfolioDigest` (one row/day, account-level)
```
model PortfolioDigest {
  id         String   @id @default(cuid())
  accountId  String                 // account-level, NOT per-analyst
  date       DateTime               // the trading day (ET)
  narrative  String                 // markdown prose w/ inline reference tokens
  facts      Json                   // the deterministic facts blob (below)
  model      String?                // which LLM wrote the narrative
  createdAt  DateTime @default(now())
  @@unique([accountId, date])
}
```
Two fields do the work: `narrative` (LLM) + `facts` (computed). Nothing else.

### Reference tokens (the ONLY structure in the prose)
Plain markdown links with a typed scheme — degrades to text if unrendered:
- `[MU](thesis:<thesisId>)` — a ticker. Renders as the **existing prose ticker chip**. Click → opens that **thesis** (all digest tickers have a thesis).
- `[Momentum Breakout](analyst:<analystId>)` — renders as an **underlined link** → `/analysts/[id]`.
- `[tactical 18:46](run:<runId>)` — renders as an **underlined link** → `/runs/[id]`.
- **Default rule:** any token whose `kind` has no custom style → render as a basic underlined link. So new reference kinds work for free; only tickers get the special chip treatment (for now).

Renderer: extend the existing cited-markdown renderer (`components/assistant-ui/cited-markdown-text.tsx`) or a thin `DigestMarkdown` wrapper that maps link schemes → ticker chip / link. Reuse the existing prose-ticker component — do not build a new ticker style.

### The facts aggregator (deterministic — `lib/portfolio/digest-facts.ts`)
Pure function `buildDigestFacts(accountId, date) → DigestFacts`. NO LLM. Pulls:
- **Runs today** — `ResearchRun` grouped by `mode` (daily / tactical / discovery) + analyst + time + status.
- **Decisions today** — `ThesisUpdate` rows today: entries, exits, trims, reviews, passes — each with ticker, run, analyst, time.
- **Trades today** — `Position` opens/closes + `Order`/`PositionManagementAction` (adds/trims/stops).
- **Book snapshot** — open positions (held vs capacity), cash/buying power, exposure, sector concentration.
- **P&L** — day + cumulative, via the **deposit-adjusted** path (`lib/portfolio/contributions.ts` — DO NOT reintroduce the `STARTING_CAPITAL` baseline bug).
- **Passes aged** — recent PASSED theses + their since-pass move (the regret signal).
- **Capacity/cadence signals** — slots used (N/max), idle cash, days since last new entry, pending proposals awaiting approval.

This blob is the single source of truth: the narration consumes it, the agent can read it, and (optionally) it backs parts of the UI.

### The narration writer (`lib/agent/digest-writer.ts`)
Cheap model (GPT-4o or -mini). Input: the `facts` blob only. Output: the markdown narrative with reference tokens. Prompt rules:
- 4–6 short paragraphs. Lead with portfolio-level state + the daily-vs-tactical split.
- Embed `[TICKER](thesis:id)` for every name, `[Analyst](analyst:id)` / `[run label](run:id)` where it adds traceability.
- Form opinions FROM the facts only ("book is fully deployed," "two passes running without us") — never invent numbers. The facts are computed; the writer narrates + judges.
- Include the **agent-memory lines**: what each run type did + how passes/entries have aged (the "reviewed X at $A, now $B" timeline).

### EOD trigger
New Inngest cron, **after market close + after the last tactical settles** (e.g. 8:00 PM ET, Mon–Fri). One digest per account per day. Idempotent on `(accountId, date)`.

### Agent consumption (the rewire — REVIEW before merge, off-cron)
- `run-input.ts`: **drop** `latestBriefing` (per-analyst). **Add** the latest `PortfolioDigest` (account-level), fed into **both** daily and tactical prompts. Most recent **1** by default (extend to last N trivially later — start with 1).
- Feed the agent the `narrative` (tokens kept — they're informative) + a compact structured slice of `facts`.
- Prompt slot: replace "Yesterday's standup" with "Yesterday's portfolio digest."

### Deprecate the old briefing
- Stop calling `update-analyst-briefing.ts` after the daily run.
- Remove the `latestBriefing` read in `run-input.ts`.
- Leave the `AnalystBriefing` table for now (drop in a later cleanup); just stop writing + reading it.
- The single-analyst user-facing brief view is replaced by the account digest.

---

## Feature B — Coverage Table (Active / Watching / Passed)

### What it is
The principal's **main stock-overview table** — every covered name, grouped by real `Thesis.status`, with performance anchored to the decision. Largely inspired by the existing `/trades` table (`components/trades/TradesPage.tsx`) — **reuse the one trade-row design** (per the standing rule), don't invent a new row.

### Tabs + columns
- **Active** (`HOLDING`): Name · Price · Day · Since entry · (target proximity). = held positions.
- **Watching** (`WATCHING`): Name · Price · Day · Since added / since last review · buy-above level. The "wish I'd bought" lens.
- **Passed** (`PASSED`): Name · Price · Since pass · **Verdict (Dodged / Missed)**. The regret/validation lens.

**Verdict, not raw color** — on the Passed tab a stock going *up* is regret (bad), so normal green/red P&L coloring is backwards. Show a `Dodged` (green) / `Missed` (red) tag driven by direction-of-move-vs-pass, with the raw % muted beside it.

### The time math
- **Phase 1 (cheap):** "since [anchor]" = stored anchor price (entry / pass / watch) vs live quote. Ships with no history dependency.
- **Phase 2:** fixed windows ("5d / 10d / 30d after pass") — needs daily candles per ticker (Finnhub), cached per-day. This is where the regret tracker gets powerful.
- **Data gap to close:** capture the **decision price** (price at pass / at watch-add) so the regret clock has a clean anchor. Going forward, stamp it on the `ThesisUpdate`/thesis; for existing rows, approximate from the pass-date close. Flag in the build.

### Data
Theses by `status` (now clean post-P1-24) + positions + live quotes + (phase 2) candle history. The clean WATCHING/PASSED/RETIRED statuses are what make this buildable at all.

---

## Homepage integration (layout — proposal)
Equity graph on top (existing), then a tabbed section:
- **Snapshot** — the digest brief (Feature A) + the coverage table (Feature B).
- **Activity** — the existing activity feed.
- **Theses** — the existing theses view.

(Layout is a proposal; the two features don't depend on it — they can drop into the current homepage first and get reorganized later.)

---

## Sequencing — what's safe to build now vs needs review

**Safe to build unattended (additive, no real-money path, draft PRs for review):**
1. **A-backend** — `PortfolioDigest` schema + `digest-facts.ts` aggregator + `digest-writer.ts` + EOD cron. Writes digests; nothing consumes them yet. Pure addition.
2. **B-UI** — the Coverage Table (Active/Watching/Passed), phase-1 "since anchor" math, reusing trade-row. Renderable in preview. Pure addition.

**Hold for principal review (off-cron, touches live surfaces):**
3. **A-rewire** — `run-input.ts` swap (digest in, AnalystBriefing out) + prompt slot rename + deprecate `update-analyst-briefing`. Agent-behavior change → review + off-cron merge + an eval that a run still gets coherent morning context.
4. **Homepage layout** — the tabbed restructure (principal's eye on UX).
5. **Phase-2 table** — candle-backed 5/10/30d windows + decision-price capture/backfill.

**Consolidate (later):** fold `weekly-digest.ts` + `accuracy-scorer.ts` into the digest system instead of three parallel summary jobs.

---

## Open decisions (minimal — everything else is decided above)
1. EOD cron time (default 8 PM ET — confirm it's after the latest tactical run).
2. How many past digests the agent reads (default 1).
3. Whether the Coverage Table replaces or sits beside the current homepage positions panel.
