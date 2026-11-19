## NEVER add custom classes to ShadCN components. Use them as-is with only variants and sizes. Do not override styling with className overrides.

# CLAUDE.md — Hindsight Trading Platform

## What This App Is
AI-powered paper trading simulator. An autonomous AI agent
researches stocks, generates trade theses, places paper trades
via Alpaca, tracks performance, and learns from results.
Built for one user now, marketed later.

## Agents: how they're built (read before touching any agent)
An agent is five things, each with one home. If a change doesn't fit one of them, the design is wrong.
- **Instructions:** one file, `lib/agent/engine/agents/<agent>.md`, the same on every run. Shared text comes in only by import (`@rules.md`, `@research-rules.md`). No code writes instruction text.
- **Context:** facts from the catalog in `lib/agent/context/` (one loader per fact), ticked on the agent's record (`lib/agent/engine/agents/<agent>.ts`). Data, never rules. Bulky or optional data is a tool.
- **Tools:** one job each, with only the fields the action needs; code fills what it knows. A rule a tool enforces is a refusal in its code that says what to do instead.
- **Message:** written by whoever starts the run (you, another agent's brief, a trigger fire, a fill, the schedule).
- **When it runs:** `SCHEDULE` (`lib/agent/engine/schedule.ts`) or an event.

**Never:**
- choose instruction text in code by a stock's state, the day or a setting (situations are the one existing case, and they are becoming short skills; add nothing to them without the owner);
- patch a failure with a prompt sentence: find the layer (tool refusal, fact, or the job itself), then measure;
- put fields, variables or calculations in an agent's text;
- build agent-specific plumbing (a special loader path, a prompt builder, a flag one run reads);
- copy a shared rule into one agent;
- merge a change to what an agent is sent before it is scored: `--inputs-only` first, rescore only the cases whose request changed, 4 runs each.

More context for an agent = a loader for the fact, ticked on its record. A new action = a tool. A new agent = a record, an `.md`, its ticks and a `SCHEDULE` line or event. Full version: `docs/PRINCIPLES.md` and the guide's "How an agent is built". The work is tracked on the Hindsight Roadmap, milestone E.

## The Trigger Game Plan (shipped 2026-07-12 — read before touching anything trigger/position-related)
Every thesis carries a **trigger ladder** (condition → action: ENTER/ADD/TRIM/
EXIT/REVIEW) the agents author and maintain. The move from our entry
(cumulative % vs entry) and the trail (the give-back off the tracked peak)
protect gains. Every HOLDING inherits its sell rules from its ANALYST
(the analyst's Triggers tab — its style) and the account's universal rules
(Settings → Triggers). Nothing
stamps them onto the thesis: a thesis rung beats every rule above it, so a
stamped copy would freeze the old numbers. See TRIGGERS.md §2a.
`resolved.ladderHealth` + the `UNPROTECTED_GAIN` needsAction flag nag winners
whose floor lags their gain; `complete_run` warn-gates unprotected holdings.
Every trade a fire leads to goes through the approval switch (on: a proposal,
which has no 24 hours: it waits while its trigger holds and the 16:20 ET close
pass withdraws it when it doesn't, `lib/proposals/trigger-proposals.ts`). **On fire
is three choices (2026-10-22), two on a sell or trim (2026-11-14):** Auto (`DO_IT`: the
trade with no agent deciding, sized and gated by the tool an agent would call;
then its own agent, the post-trade write-up, writes it up with no trade tools,
and its note is the trade's reason (`lib/proposals/auto-writeup.ts`; the agent
is `lib/agent/engine/agents/post-trade-writeup.ts`; an Auto buy or add sent at
once, with approval off, is written up after its fill by After the buy instead);
Auto-sell / Auto-trim / Auto-buy / Auto-add, never a review), Send to Agent
(`ASK_NOW`: a trigger run now) or Flag for Review (`NEXT_MORNING`: the morning
run answers it; never a sell or trim, since a sale can't wait for the morning).
Unset, a review is Flag for Review and everything else Send to
Agent; every stored trigger names one. Auto on a buy, add or trim is the
owner's alone, on a stock (not an account or analyst rule)
(`lib/agent/triggers/fire-mode.ts`, TRIGGERS.md §4). **Triggers work like
orders (2026-11-17):** a trigger fires when it becomes true (one already true
when written, or when its condition or action is changed, fires at the next
check); after a fire it does not fire again until a market close (the 16:20 ET
pass) finds its condition false (`falseAtCloseAt`, inline on the stock's own,
in `Thesis.triggerState` for an inherited rule), never on a 5-minute check. A
trade it leads to uses it up: when a trim or add fills, the stock's own trim or
add triggers behind it (named on the order, or fired and not found false since)
come off with one Activity line (`lib/agent/triggers/filled.ts`; never another
action; a sale closes the position); a declined, expired or withdrawn proposal does not. There are no
waits. A filing fires once per filing, a heads-up once per report, and a buy or
add never fires on a stale quote — see `shouldFire` in
`lib/agent/triggers/evaluate.ts`. A sale that fired stays on the morning list
(PROTECTIVE_SALE) until a close finds it false. "Either one" is two triggers:
two conditions together are "and" only, one level deep. Inside an "and", a date
count before the event is a window (`window` on its catalog entry): the
pre-catalyst buys fire only within 70 days before the event. A trigger on our
position (a move from our buy price or the high since we bought, days since the
buy) is refused at the save on a stock we only watch (`POSITION_ON_A_WATCH`). The three
docs: `docs/plans/TRIGGER_MODEL.md` (conceptual shape),
`docs/plans/TRIGGER_LIFECYCLE.md` (authority/visibility contract),
`docs/plans/THESIS_GAME_PLAN.md` (the blueprint + IONS motivating failure).
Triggers are edited one at a time: `edit_triggers` takes `add`, `edit` (by id)
and `remove` (by id), each with its reason; that is the only way a trigger
changes, besides the playbook's watch triggers the Writer's save writes. An
`add` is one of the stock's playbook triggers by its reference (W1, H2…), or
one of the agent's own; a price in it is a chart key (`{swingLow}`) or a live
line (the 50-day average), and code writes today's number from the chart
(`pricedTemplate`, `lib/agent/knowledge/playbooks.ts`). The Writer, the Holding
refresh and After the buy never type a price. **A stock has triggers and nothing else
(2026-11-16):** no plan, no price target of our own ("target" is Wall
Street's number, the StreetConsensus card), no level fields on any save, and
no code that stamps a buy, floor, target or review clock: a playbook's lines
are its templates (`lib/agent/knowledge/playbooks.ts`, Settings → Playbook).
The Writer names the playbook and its save writes the watch triggers, each
marked `playbook: "WATCH"` and priced by code from the chart; the Writer
tailors them with `edit_triggers`, a reason each. After a buy, After the buy
puts on the playbook's holding triggers the same way. Every price is a chart
key or a live line, never a number typed from memory. "The buy" and "the floor" are names
for kinds of trigger. **A trigger means what it says, whatever the stock's
state (2026-11-16):** "Stop watching if below $X" is its own action
(`STOP_WATCHING`), only on a stock we watch; fired on its saved timing it
retires the thesis as DROPPED with one Activity line, no run and no approval
(`lib/agent/triggers/stop-watching.ts`). "Sell if" (`EXIT`) is only on a stock
we hold; the other is refused with the fix, never converted (`actionProblem`,
`condition/actions.ts`). The holding's sale comes with the buy: `place_trade`
takes `sell_if_below` + `sell_reason`, or neither, for the playbook's floor
priced by code from the chart (`priceTheFloor`); either is held to the
playbook's sale rules (`saleRuleProblem`) and stored on the pending position
(`stopLoss`, `stopReason`; `targetPrice` stays empty). Edit & Approve changes
only the sell price. At the fill, `armHeldLadderOnFill` writes only the floor:
the buy, the Stop watching triggers and every `playbook: "WATCH"` trigger come
off, a trigger written by hand stays, and "Sell if below" goes on at the
approved price (with stop when buying, when it is on). The playbook's holding
triggers are then put on by After the buy, one run after every buy and add fill
(`lib/proposals/after-buy.ts`, `lib/inngest/functions/after-buy-run.ts`, agent
`AFTER_BUY`), by reference (H1, H2…) through `edit_triggers`, each fitted to the
thesis with its reason. It can't touch the floor and can't trade.
Every op is one line in the Activity feed; a refused
op comes back by id and the rest of the call lands. The shared core is
`lib/agent/triggers/ops.ts` — the UI popover and the agent go through it.
**A condition is one shape** (shipped 2026-10, `docs/plans/TRIGGER_TYPES.md`):
`{ watch, is?, value?, variable?, settings? }`, or `{ match: "all", conditions }`
for two or more that must all hold — the form's own fields. Each measure (`price`, `move`, `volume`,
`rsi`, `strength`, `gap`, `report`, `surprise`, `filing`, `insiders`, `repeat`,
`from_date`) is ONE catalog entry in `lib/agent/triggers/condition/measures/`
carrying its words, number, variables, settings, what the
check loads, how it reads and what numbers it takes (`fits` / `valid`,
read by `whenValid`); nothing switches on a kind. Storage holds the same
shape; anything else in a trigger list reads as a removed condition. A
trigger reads as one sentence everywhere ("Sell if below $150", "Review every
30 days") from `condition/describe.ts`.
The chart measures (a price against an average or a high, a move near one,
volume, RSI, strength vs the S&P, a gap, the 5- and 20-day move, insiders)
read the daily indicator snapshot
(`TickerIndicators`, written 06:30 ET from `lib/market-data/price-structure.ts`);
a price level read on the close (`settings.close`) fires only on the 16:20 ET close pass. A
trigger fires on the timing it saved; nothing changes it at check time. A
watch's Stop watching line is written "only on the close", so we stop
watching on a close below it, never an intraday dip. There is
no buy-now option: buying now is a buy trigger at or near the current price,
which fires on the next check because it is true. The
signal kinds (SIGNAL_TYPE / GUIDANCE_CHANGE / FILING) were deleted in DAV-247 —
news routing is paused (design doc `docs/plans/SIGNALS_REDESIGN.md`).

## Situations (shipped 2026-10-08 — the one flag system, and the one home for situation text)
`computeNeedsAction` (`lib/agent/needs-action.ts`) returns EVERY flag true on a
stock, today's lead first. `situationsFor` (`lib/agent/situations.ts`) maps that
list plus the row's facts to its situation codes (eight in all, 2026-11-15:
one per trigger action, a sale or trim, a buy, an add, a review, and four the
code finds with no trigger: floor to fix, a note to answer, just sold,
promoted to live), and `SITUATIONS` in the same file is the ONE table of the
text an agent gets for each (under 2,200 characters each; the buy, the
review and the note end in one paragraph per case they took in, and are
capped just above their length in `situations.test.ts`). `loadWorkInputs` (`lib/agent/work-inputs.ts`) is the one feed
for the flag math and `loadStockFacts` (`lib/agent/stock-facts.ts`) the one set
of facts; `get_theses`, the thesis sheet, the quote route and `complete_run`'s
close-out all go through them, so no two surfaces can disagree about a stock.
`get_theses` puts `situations` on every row and one `guidance` block per read
carrying only the codes on today's work list; the trigger run computes its
stock's codes through the same function and prints the same texts. **The
prompts carry no situation text.** A rule that applies when a stock is in a
situation goes into the table, never into `system-prompt.ts` or
`intraday-tactical.ts`. Nothing is stored: a situation is derived at read time.
The plan and its step numbers: `docs/plans/AGENT_ARCHITECTURE.md` §11.

## Activity (shipped 2026-10-30 — one list, one paragraph per trade)
A stock's Activity is one list (`lib/thesis/activity-feed.ts`): its saved
lines (`ThesisUpdate`) plus each proposal's steps built from its `Order`
(Proposed / Approved / Declined / Expired; the Order is the truth, the
PROPOSAL_* rows are never trusted), and the fill of an order never proposed.
The homepage Activity is the same lists cut to trades and watch status by
stored fields alone (`lib/thesis/account-activity.ts`), beside the attempts
that never became a proposal (`lib/portfolio/attempt-outcomes.ts`). The Activity tab shows the whole list,
and the next run on the stock reads the newest 8 (`RECENT_ITEMS`) exactly as
they read in the feed (`saidBlock` in `lib/agent/stock-context.ts`); the
Activity tab marks where those 8 end. The Overview's "Agent insights" is a
different cut (the owner's call, 2026-11-04): the newest 5 lines with a
written paragraph (`notedItems`, `NOTED_ITEMS`), a trigger fire's figures
not counting as one. A waiting proposal is pinned
to the top of the Overview as the card. The app gives every line it makes a
title and never a paragraph (guarded by the scan in `lib/agent/voice.test.ts`);
every paragraph is an analyst's words or the owner's. One paragraph per
trade: inside a run the trade tools have no reason field (`schemaFor`), and
at the end of the run the note the run wrote on the stock becomes the
proposal's reason and the note row is stamped with the order
(`putNotesOnRunProposals`, `lib/proposals/auto-writeup.ts`), so the feed
shows the proposal and its note as one line. Only the owner's chat gives a
trade its reason at once. A rule's note reaches an agent only when a person
or an analyst wrote it (`writtenNote`, `lib/agent/triggers/note.ts`).

## Where to put what (doc navigation)
| You want to... | File |
|---|---|
| **Learn what Hindsight is and how its parts fit (start here)** | **`docs/guide/README.md`**, one doc per agent and concept |
| **Build or change an agent (its instructions, context, tools, schedule)** | **"Agents: how they're built" above, then `docs/PRINCIPLES.md`** |
| Change what the /docs pages say | `docs/guide/` (`agents/`, `concepts/`, `deep-dives/`, `reference/`); the pages draw those files (pictures are `<!-- asset: name -->` lines). The reference docs (Situations library, Trigger measures, Setups) are generated: `UPDATE_GUIDE=1 npx jest lib/docs/guide` |
| **Change what an agent is told when a stock is in a situation (a flag)** | **`SITUATIONS` in `lib/agent/situations.ts`; never a prompt** |
| **The Agent Rebuild: steps 6–11, the current plan and its numbers** | **`docs/plans/AGENT_ARCHITECTURE.md` §11** |
| Understand the agent design rules (three-layer principle) | `docs/PRINCIPLES.md` |
| Read / update the product north star | `docs/VISION.md` |
| Read the live thesis-system reference | `docs/THESIS_ARCHITECTURE.md` |
| Understand triggers (predicates, which fires on which path, fire modes) | `docs/TRIGGERS.md` |
| **The trigger CONCEPTUAL model (condition·action·mode·timing; what is/isn't a trigger)** | **`docs/plans/TRIGGER_MODEL.md`** |
| **Trigger authority + visibility contract (who sets which level, when; what wakes an agent)** | **`docs/plans/TRIGGER_LIFECYCLE.md`** |
| **Why the trigger ladder exists (conviction management: press winners / protect gains)** | **`docs/plans/THESIS_GAME_PLAN.md`** |
| Change how agents write what the user reads (notes, proposal reasons, Activity lines, run-summary lines) | `lib/agent/engine/agents/rules.md` ("## How you write") and the field description that points at them |
| Track open work (issues, not markdown) | Linear — team Davesucks |
| Note a code smell outside the rework | `docs/TECH_DEBT.md` |
| Spec a big multi-PR plan | `docs/plans/<NAME>.md` |
| Write a daily run review | `docs/run-reviews/<YYYY-MM-DD>.md` |
| **Start a discovery session (find buyable stocks, review what lands)** | **`docs/prompts/DISCOVERY_SESSION.md`** |
| Write a discovery run review | `docs/discovery-reviews/<YYYY-MM-DD>-<TICKER>.md` |
| Kick off a code session | `docs/prompts/SESSION_BOOTSTRAP.md` |
| Kick off a run-review session | `docs/prompts/REVIEW_DAILY_RUN.md` |
| **Start the QB (review + product) session** | **`docs/prompts/QB_SESSION.md`** |
| **The two build lanes (Signals + Agents) and how they work together** | **`docs/plans/LANES.md`** |
| Start the Agents lane / the Signals lane | `docs/prompts/AGENTS_SESSION.md` / `docs/prompts/SIGNALS_SESSION.md` |
| **Find discovery query templates per analyst (Grok / Perplexity / Reddit)** | **`docs/DISCOVERY_PLAYBOOK.md`** |
| **Reference why the analyst lineup looks like it does** | **`docs/plans/ANALYST_LINEUP.md`** |
| Reference what shipped in a PR | GitHub PRs |
| Onboard a fresh session to the codebase | `CLAUDE.md` |

**Keep the guide true.** `docs/guide/` is what humans and agents read to learn the system, and `/docs` draws it. When a change alters behaviour a guide doc describes (a schedule, a rule, a default, who may change what, a tool an agent has), update that doc in the same PR, with the code as the source of truth. Each doc's Technical details names the files behind it, so a change to those files is the cue. Agent facts (model, steps, tools) and the reference docs are tested against the code: `npx jest lib/docs` fails when they drift, and `UPDATE_GUIDE=1 npx jest lib/docs/guide` regenerates the references.

**Rule:** open work lives in Linear (team Davesucks), one issue per cause. `docs/GAPS.md` and its history files were deleted 2026-09-15 — they're in git history. Code smells outside current work still go in `docs/TECH_DEBT.md`. Written output (run reviews, audits, discovery prep) goes in the folders above; prune anything older than about a month unless it's marked a reference.

## Stack — DO NOT DEVIATE
- Next.js App Router, TypeScript
- ShadCN + Tailwind CSS only for UI
- Supabase (Postgres + Auth + Realtime)
- Prisma ORM (v7 with adapter-pg)
- Inngest for background jobs and crons
- Vercel (Next.js only — no Railway). **Functions run in `pdx1`
  (Portland)** — `vercel.json` `regions`. That is AWS us-west-2, where the
  database, its pooler and Supabase auth live. In the default `iad1` every
  query crossed the country (~75 ms a trip, ~650 ms for a new connection,
  ~280 ms per auth check). Don't move functions away from the database.
  **Migrations auto-apply on
  production deploys** — `build` starts with `scripts/deploy-migrate.mjs`
  (`prisma migrate deploy`, production only, using `DIRECT_URL`). Merging a
  migration is enough; don't apply it by hand. Preview deploys deliberately
  skip it. See `docs/plans/PROD_DEPLOYMENT_PLAN.md` → "Deploying schema
  changes". One-off data heals still live in `prisma/manual-sql/` and are
  still run by hand.
- Vercel AI SDK v6 + AssistantUI (@assistant-ui/react)
- TradingView Lightweight Charts for price charts
- Recharts for performance/analytics charts

## Architecture — the agent and what feeds it

**There is no live news pipeline.** The Signals producers — the market sweep,
portfolio/watchlist monitor, domain monitor, the signal router, their cleanup
cron and the newsletter extraction — were deleted 2026-09-15. The tables and
rows are **kept**: `Signal`, `Monitor`, `AnalystSignalRoute`, `SignalBatch`,
`Artifact` are readable on `/intelligence` (read-only) and via `read_database`,
but nothing adds to them. The `read_signals` / `read_artifact` tools that read
them were deleted 2026-10-23. Outside facts reach an agent through a
measure the five-minute check can evaluate, or a data field the agent
pulls mid-run — see `docs/plans/LANES.md` §2.

### The Agent (what the "Run" button and morning cron both use)
- User clicks "Run" → POST /api/research/agent-run creates ResearchRun
- Redirects to /runs/[id] → renders AgentChat (components/agent/AgentChat.tsx)
- AgentChat wraps ChatRuntime (DefaultChatTransport + useChatRuntime) →
  POST /api/agent/research-run
- GPT-5.4 (maxSteps 65, temperature 0.2) + the full tool catalog
  autonomously researches, updates theses, manages positions, and
  places trades via Alpaca
- Tools render via ToolCallGroup → ToolCallRow dispatching on result.ui
- All research persisted to DB via tool execute functions
- Morning cron (8 AM ET) runs same agent via generateText

## Universe (the analyst's discovery fence)
The "Universe" is the set of fields on AgentConfig that define what the
analyst will look at — which discovery candidates are in scope, and which
names the builder/editor may put on a watchlist. (The signal router also
filtered on it until it was deleted 2026-09-15.)

Universe fields on AgentConfig (checked by `checkUniverse` in `lib/agent/universe.ts`):
- `sectors` — canonical GICS sectors ["Information Technology", "Energy", ...]
- `marketCapMin` / `marketCapMax` — BigInt? in dollars; null = no bound
- `exclusionList` — tickers always skipped (hard reject)

Match semantics: empty array / null numeric = no filter
on that dimension. AND across dimensions, OR within. exclusionList wins;
held and watched stocks bypass the rest. The industries and themes an
analyst hunts are words in its strategy text (`analystPrompt`), not
fields: `industries`, `themes`, `markets`, `exchanges` and `tickerUniverse`
filtered nothing and were removed 2026-10-31. A new analyst's playbook
(`lib/agent/knowledge/strategy-archetypes.ts`) supplies a market-cap band
only where its edge needs one; the sectors are the owner's choice.

Routing output on AnalystSignalRoute (history — the router that wrote these
rows is deleted; `/intelligence` still labels them):
- `routeReasonCode` — "DISCOVERY" | "WATCHLIST" | "POSITION" | "DIRECT_TICKER"
  | "SECTOR_MATCH" | "INDUSTRY_MATCH" | "THEME_MATCH" | "CROSS_ANALYST"
  | "FIRM_AGGREGATE_FEED" (historical — the feeds subscription was deleted
  2026-09-11) | "AGGREGATE_TICKER_MATCH"
- `matchedUniverse` Json — { sectors, industries, themes, inWatchlist,
  inPositions, fromAnalystId?, feed? }

### How firm-wide facts reach an analyst
`get_earnings_calendar` and `get_market_movers` are pull tools any analyst can
call mid-run (`scope:"universe"` = names it doesn't already cover;
`scope:"all"` = the full firehose). There is no push path: the router is
deleted, and the `AgentConfig.feeds` subscription went 2026-09-11. Don't
re-add either. The builder and editor seed a watchlist from these two tools
plus `get_stock_data`.

### What runs before the analysts wake up
- **06:25 ET — vendor probe.** Every market-data endpoint probed with a mid-cap
  book name; emails when a source is empty or erroring.
- **06:30 ET — indicator snapshot.** The chart numbers every trigger reads,
  into `TickerIndicators`.
- **08:00 ET — the Daily Run**, per analyst. It reads durable state directly
  via `get_theses(include_history: true)`; there is no inbox.
- The **trigger evaluator** is the other clock: every 5 min during regular US
  market hours (gated on `isMarketOpen()`) plus a close pass at 16:20 ET; it
  fires `app/thesis.trigger.fired` when a thesis predicate matches, which
  wakes a tactical run (or makes an Auto trade, which that run then writes up); a fire set to
  Flag for Review is written down and wakes nothing. See
  `docs/TRIGGERS.md`. (Its `app/signal.routed`
  path was deleted with the router.)
- The 6:30–7:30 intelligence jobs (sweep, portfolio monitor, domain monitor,
  router) and the 11 PM `pipeline-cleanup` are **deleted** (2026-09-15).

### Data Sources
- Alpaca market data: **the live price** (since 2026-09-29) and every bar.
  One snapshot call prices the whole book off the consolidated tape (SIP),
  10,000 calls a minute per key; paper, live and env keys all get it
  (probed with SMMT, SRRK, IOT). `lib/market-data/live-quote.ts` is the one
  place a live price comes from; Finnhub `/quote` is its fallback.
  Between 9:30 and the bell the price is the latest trade with its own
  timestamp; outside the session it is the last close stamped at the bell —
  pre-market and after-hours prints are on the tape and are not served as
  the price. The older helpers in `lib/alpaca.ts` (`getLatestPrice(s)`,
  `getLatestPricesWithMeta`, `getDailyRangePcts`) wrap it since 2026-10-31:
  they read the raw latest trade at any hour until FINRA's extended-hours
  industry test (Fri 2026-10-30 11 PM on the production feed; again Nov 6,
  Nov 20, Dec 4; the tape runs overnight every night from Dec 6) put fake
  prints on the tape and every page showed MSFT at $445 against a $521.91
  close while the sheet showed the close. Never read `/trades/latest`. The
  feed is named once: `MARKET_DATA_FEED` in `lib/alpaca.ts`.
- Finnhub: earnings calendar, company metrics, profile, news,
  recommendations, filed statements, insider transactions — and the quote
  fallback
- FMP: **REMOVED 2026-09-08.** The tier we held refused 26 of the 28
  names on the book ("this value set for 'symbol' is not available under
  your current subscription") while every pull reported "ok" with an
  empty body. Statements now come from Finnhub `/stock/financials-reported`
  (`lib/market-data/finnhub-financials.ts`), ratios from `/stock/metric`,
  movers from Alpaca's screener (`lib/market-data/alpaca-screener.ts`).
  Analyst price targets and the EPS consensus come from Nasdaq's website
  JSON instead (`lib/market-data/street-consensus.ts`, one
  `StreetConsensus` row per stock per day). Forward revenue estimates are
  on no plan we hold — the tools report them as absent, never guess.
  Do not re-add an FMP client without a plan that covers all US symbols,
  and probe it with a mid-cap (SMMT, not AAPL) — the free list covers the
  mega-caps, which is how the August audit was fooled.
- Alpaca: paper trade execution, order fill, position tracking
- Perplexity Sonar: web search for intelligence pipeline + agent
- Firecrawl: full-page extraction for artifacts
- SEC EDGAR: filings (10-K, 10-Q, 8-K, Form 4)

## Data Model (Prisma)
### Core
- AgentConfig — analyst persona config (name, analystPrompt,
  setups, sectors, market-cap band, direction
  bias, hold durations, position sizing, exclusionList; the watchlist
  is its WATCHING theses). A new row's defaults are a new analyst's
  (`NEW_ANALYST_DEFAULTS`, `lib/analyst-settings.ts`), and Create, Apply
  and Settings all save through `normalizeAnalystPatch` there.
  **Position sizing is three plain settings:**
  `minPositionSize` (smallest trade — a normal buy), `maxPositionSize`
  (largest trade — a STRONG/HIGH conviction buy), `maxPositionTotal` (most
  in one stock — where adding to a winner stops; 0 = twice the largest
  trade). The agent does not size trades: inside a run, `place_trade` and
  `add` have no size field at all (the schema
  is built per caller — `schemaFor` on `defineTool`) and the buy or add is
  sized by risk (`sizeByRisk`: risk dollars ÷ distance to the stop, ×
  conviction, clamped to the band; an add at half the entry's risk). Only
  the principal's chat may name a `notional`, and it is honored as given,
  with a line when it sits outside the band. `realMaxPosition` (the
  LIVE-only "promotion cap") and the hidden ×2 add multiple were deleted
  2026-09-08. All sizing math is `lib/agent/position-sizing.ts` — the tool
  gates and the Settings UI both call it, so the number on screen can't
  drift from the number that rejects a trade.
- ResearchRun — one execution; links to AgentConfig; status
  (RUNNING/COMPLETE/FAILED); parameters JSON snapshot
- RunEvent — SSE event from a run (type, title, message, payload)
- RunMessage — persisted AI SDK messages for run replay
- Thesis — stock analysis (direction, confidence, reasoning,
  bullets, risk flags, signal types, sourcesUsed, triggers). No level
  columns (2026-11-16): a stock has triggers and nothing else, shown as
  their sentences; nothing sums them into a buy, floor or target. What we
  paid is `Position.avgCost`.
  **Status taxonomy (P1-24 — see `docs/plans/STATUS_TAXONOMY.md`):**
  `status` = WATCHING | HOLDING | PASSED | RETIRED (+`retiredReason`
  DROPPED/SOLD/INVALIDATED/REPLACED) | PROMOTED; `direction` = LONG | SHORT | null.
  Legacy mapping: ACTIVE→HOLDING, direction=PASS→PASSED,
  CLOSED/INVALIDATED/ARCHIVED/SUPERSEDED→RETIRED, direction=PENDING→null.
  An agent reaches these stored values one tool at a time: `pass_on_stock` lands
  PASSED; `stop_watching` lands RETIRED (DROPPED); `watch_again` lands WATCHING;
  a sale lands SOLD. `record_thesis` and `update_thesis` are on no agent's list:
  code runs them as the Writer's save (`lib/agent/run-thesis-writer.ts`), and
  they still accept the old verbs.
- Position — paper position via Alpaca (symbol, direction, avgCost,
  qty, status, closePrice, outcome, agentEvaluation)
- PositionEvent — position lifecycle log (OPENED, PRICE_CHECK,
  NEAR_TARGET, CLOSED, EVALUATED)
- AccuracyReport — weekly per-analyst calibration
### Intelligence (V3)
- Monitor — unified tracked item (SEARCH/DOMAIN/API type, method,
  config JSON, scope, analyst link, lastRunAt)
- Signal — normalized evidence unit (headline, summary, tickers,
  themes, sentiment, urgency, sourceUrls)
- SignalBatch — groups signals by job run for dedup
- AnalystSignalRoute — signal→analyst routing with relevance score
- Artifact — extracted page content (markdown, summary, contentHash)
- MorningBrief — per-analyst daily brief (market context,
  portfolio alerts, watchlist updates, new opportunities, risk flags)

## Pages
- / (Dashboard) — MarketPulseStrip (Finnhub WebSocket), portfolio
  summary, Today's Picks, the activity feed
- /analysts — analyst card grid with enable/disable toggles
- /analysts/new — AI-driven analyst creation (AgentChat in builder mode + AnalystConfigPanel)
- /analysts/[id] — 2-col: Overview + config | floating editor chat;
  tabs for Runs and Trades
- /runs — research run feed with status dots, analyst names,
  thesis counts, logo stacks
- /runs/[id] — run detail; ONE renderer (AgentChat) for both live and
  completed runs. RUNNING → live stream (autoStart, guarded off for
  server-side modes); COMPLETE/FAILED → replay hydrated from the
  persisted `thread` RunMessage via convertPersistedToUIMessages
- /trades — paper trade list with live P&L
- /performance — two tabs: Trading (closed trades, realized, on the book the app is set to: P&L over time, results, how trades ended, best gain vs exit, by analyst and setup; `lib/performance/trading.ts` on the same closed-trade rows as the setup scorecard; account return stays on the Dashboard) and Agent work (runs by type, situations by category and what each led to, triggers fired with their outcomes and worst re-firers, proposals and a per-stock table; `lib/performance/agent-work.ts`, read-only)
- /stocks — stock search
- /stocks/[symbol] — TradingView chart + stock detail
- /intelligence — read-only view of the kept signal history (Findings +
  Health). No pipeline trigger, no monitor editing — the jobs are deleted.
- /docs — the guide (docs/guide/ markdown), its own shell; /how-it-works — the tour and The Framework; /agent-workflow redirects
- /settings — app settings

## API Routes
- /api/agent/[mode] — unified agent route. Modes:
  - research-run: GPT-5.4, temperature 0.2, maxSteps 65 (the daily-run agent)
  - builder: GPT-4o, research tools only + suggest_config
  - editor: GPT-4o, research tools only + suggest_config
  - tactical: GPT-5.4, maxSteps 15 (single-thesis, single-decision)
  - podcast-builder / podcast-segment-run / podcast-editor
- /api/research/agent-run — creates ResearchRun row, returns runId
- /api/research/trigger — Inngest manual trigger
- /api/chat/run-followup — post-run discussion with trade tools
- /api/intelligence/* — read-only signal history (signals, batches, routes,
  health) + sync-health. email-ingest is a 200-and-drop stub
  so Resend stops retrying. The trigger, monitors and coverage routes are
  deleted.
- /api/quotes — Finnhub quote fallback
- /api/stocks/search — Finnhub symbol search
- /api/inngest — Inngest webhook handler

NOTE: `manage_watchlist` was deleted 2026-05-13 in the watchlist collapse. To add to a watchlist, an agent calls `watch_stock` (a seed is otherwise minted by the app). To remove, call `stop_watching` (lands status=RETIRED, retiredReason=DROPPED).
Each tool is defined in its own file using `defineTool()` from
`lib/agent/define-tool.ts`. The factory wraps execute() in timing/
logging/try-catch and returns a `ToolResult<T>` envelope with a `ui`
discriminator that drives rendering in ToolCallRow. Three additional
podcast-only tools (`read_past_transcripts`, `suggest_podcast_config`,
`write_segment_transcript`) live alongside but are out of scope for the
trading workflow — see `lib/podcast/` and `docs/PODCAST_PLAN.md`.

### Intelligence Tools (read pre-gathered data)
1–2. read_signals / read_artifact — DELETED 2026-10-23 (on no mode's list
   since the router that filled the inbox went, 2026-09-15). The signal history
   is on /intelligence and through `read_database`.
3. get_theses — read the analyst's durable thesis library (default HOLDING+WATCHING; include_history=true for the activity log)
4. get_portfolio_context — open positions, exposure, available buying power, recent fills
5. web_search — live Perplexity Sonar search (budget-limited)
   NOTE: read_morning_brief was DELETED in PR 3 — agent reads
   durable state directly via get_theses

### Research Tools (live data validation)
6. get_market_context — SPY/VIX/sector ETFs, macro events, regime
7. get_stock_data — quote + company profile + financials + technicals + news
8. get_earnings_data — per-ticker EPS history, beat rate, next report date
9. get_earnings_calendar — firm-wide upcoming earnings calendar; `scope:"universe"`
   fences to watchlist + positions, `scope:"all"` returns the full firehose.
10. get_market_movers — today's gainers / losers / most-actives from the Alpaca screener;
    `scope:"universe"` fences to watchlist + positions, `scope:"all"` returns
    the full top list.
11. get_sec_filings — SEC EDGAR filings
    NOTE: `get_options_flow` was DELETED 2026-08-19 (DAV-191) — options
    chains are dead on both vendors (FMP 404, Finnhub 403), so the tool
    could not return data on any plan we hold. Don't re-add it without a
    vendor that actually serves the chain.

### Action Tools (one job each since #1050)
- sell — sell all or part of a holding (`percent`). Code labels the sale (a protective fire's STOP or TARGET, else MANUAL; `belief_survived` says whether the case still holds, `enforce-close-reason.ts`). A whole sale retires the thesis as Sold, or puts it back on watch on a target or when the belief survived (`shouldRecycleToWatching`, `thesis-flips.ts`).
- add — buy more of a holding; code sizes it (half the entry's risk).
- place_trade — a buy: the stock, the side and the floor. `sell_if_below` is optional: with none, code prices the playbook's floor rule from the chart; a named floor needs its `sell_reason` and passes `saleRuleProblem`. The buy is sized by risk to the floor; the pending Position holds it (`stopLoss`, `stopReason`).
- edit_triggers — the only way a trigger changes: `add` (a playbook trigger by reference, or the agent's own), `edit` and `remove` by id, each with a reason. The Writer, the Holding refresh and After the buy price triggers only through chart keys or live lines, and can't write a buy or add that is already true.
- write_note — a note on a stock. Only a note answers a fire or a due review and moves the review clock.
- set_conviction, set_catalyst_date — the stock's conviction, and its event date.
- stop_watching, watch_again, pass_on_stock, watch_stock — watch status: end a watch, reopen a sold or promoted one, a researched no, and the chat's soft watch with a look-again.
- record_run_summary, complete_run — the morning run's end-of-run bookkeeping; the summary's action check credits a sale from the `Order` table.

`record_thesis` and `update_thesis` are on no agent's list: code runs them as the Writer's save. To add a stock to a watchlist, send it to the Writer (or the chat's `watch_stock`); to remove one, `stop_watching`.

### Builder/Editor-only Tools
19. read_knowledge_library — strategy archetypes, source catalog, signal types
20. ask_question — structured 2-5 quick-reply interview, one call per turn
    NOTE: `discover_signals_for_fence`, `read_analyst_inbox_stats` and the
    principal's `list_monitors` were deleted 2026-09-15. The first two read
    routed signals; with routing gone they returned zero, and the prompts
    treated zero as a hard stop, so the builder refused every fence. The
    builder/editor now seed and check a fence with `get_market_movers` +
    `get_earnings_calendar` + `get_stock_data`.
23. suggest_config — emit the full proposed analyst config as a side-panel diff

## How to Add a New Agent Tool

1. **Create `lib/agent/tools/my-tool.ts`**
   ```ts
   import { z } from "zod";
   import { defineTool } from "@/lib/agent/define-tool";

   export const myTool = defineTool({
     description: "...",
     schema: z.object({ ticker: z.string() }),
     ui: "ticker",         // one of: generic | ticker | source | stock-card |
                           //   trade-card | thesis-card | portfolio |
                           //   decision-summary | config-preview
     groupId: "research",  // optional — groups tool calls visually in chat

     execute: async (args, ctx) => {
       // ctx: { runId, userId, analystId?, watchlist?, alpacaCreds?, ... }
       const data = await fetchSomething(args.ticker);
       return {
         summary: `Fetched ${args.ticker}`,   // shown in compact row
         data,                                  // drives the renderer
         sources: [],                           // optional ToolSource[]
       };
     },
   });
   ```

2. **Export from `lib/agent/tools/index.ts`**
   ```ts
   export { myTool } from "./my-tool";
   ```

3. **Register in `lib/agent/tools/index.ts`** (the `createResearchTools()` wrapper)
   ```ts
   import { myTool } from "@/lib/agent/tools/my-tool";
   // inside createResearchTools():
   my_tool: myTool(newCtx),
   ```

4. **Give it to the agents that get it:** its name in the agent's record
   `tools` list (`lib/agent/engine/agents/<agent>.ts`). The morning run, the
   trigger run and chat take theirs from the allowlists in `lib/agent/modes.ts`.

5. **Wire a renderer if `ui` is new** in `components/agent/ToolCallRow.tsx`
   or pick an existing renderer from `components/agent/renderers/`

**ToolResult shape** (what the route streams, what renderers receive):
```ts
{ ok: true, ui, groupId?, summary, data, sources }  // success
{ ok: false, error, retryable, sources }             // failure
```

## Domain Components (components/domain/)
Shared domain cards and blocks (agent config card, decision summary, earnings
card, thesis chart and carousel, onboarding, the proposal note…). Read the folder;
a list here goes stale.

## Inngest Crons (lib/inngest/functions/)
### Pre-market (Mon-Fri)
- vendor-probe.ts — 6:25 AM, market-data health
- indicator-snapshot.ts — 6:30 AM, the chart numbers every trigger reads
- (firm-market-sweep, portfolio-watchlist-monitor, domain-monitor,
  signal-router, pipeline-cleanup and backfill-signal-fingerprint were
  DELETED 2026-09-15. Their tables are kept. Re-sync Inngest after the
  deploy so they leave the dashboard.)
### Reactivity (PR 2)
- trigger-evaluator.ts — every 5 min during market hours plus a close pass
  at 16:20 ET; fires app/thesis.trigger.fired when a thesis predicate
  matches
- tactical-run.ts — event-driven, consumes app/thesis.trigger.fired,
  spawns a focused single-thesis agent (~15 steps), or makes an Auto
  trigger's trade and then writes it up with no trade tools
### Agent + Trading
- morning-research.ts — 8 AM ET Mon-Fri, per-analyst Daily Run
- agent-scheduler.ts — every agent on the schedule (`lib/agent/engine/schedule.ts`): the Portfolio Manager Tue/Thu 10 AM; Discovery, off
- after-buy-run.ts — consumes `app/buy.filled`: the After the buy agent on every buy and add fill
- market-reviewer.ts — 7:30 AM ET market days, the Market Reviewer
- trade-evaluator.ts — GPT-4o post-trade evaluation (on close)
- eod-evaluation.ts — end-of-day price snapshots
- daily-run-digest.ts — 10 AM ET Mon–Fri, one email per owner on what
  the 8 AM morning runs did
- portfolio-digest.ts — 8 PM ET Mon–Fri, the Daily Portfolio Digest, saved
  as a read-only run (mode PORTFOLIO_DIGEST) whose page shows the request
  its model call sent (`lib/agent/run-requests.ts`, RunMessage role "request")
  (one per account per trading day)
- accuracy-scorer.ts — Sunday 10 AM, weekly AccuracyReport

## AI Elements Components (components/ai-elements/)
- **tool-progress** — the primitive every tool row renders into (see "Tool UI architecture")
- **inline-citation** — inline source citation
- **json-block** — a code block for JSON

## Agent Run Flow (AgentChat)
The agent run page (`/runs/[id]`) renders via:
1. **page.tsx** renders `<AgentChat>` for BOTH live and completed runs.
   `isLive` (status RUNNING) drives `autoStart`; COMPLETE/FAILED runs
   hydrate `messages` from the persisted `thread` RunMessage through
   `convertPersistedToUIMessages` (`lib/agent/convert-messages.ts`).
   Not live and no persisted thread → empty state instead. `autoStart` is
   suppressed for server-side modes (INTRADAY_TACTICAL,
   THESIS_WRITER, PRINCIPAL_CHAT, Inngest podcast segment runs) so the
   page can't launch a second competing agent on the same runId.
2. **AgentChat** connects to `/api/agent/[mode]` via **ChatRuntime**
   (`components/chat/chat-runtime.tsx` — DefaultChatTransport +
   useChatRuntime + AssistantRuntimeProvider) and renders
   **Thread** (`components/assistant-ui/thread.tsx`).
3. **ToolCallGroup** (registered as the ToolGroup slot in Thread) reads all
   tool-call parts from `useMessage`, groups by `result.groupId`, and renders
   each via **ToolCallRow** dispatching on `result.ui`. **Only 5 trading
   renderers exist** (see "Tool UI architecture" below; the podcast feature
   adds 2 more — `podcast-config-preview`, `transcript-card`):
   - `tool-ui` → **ToolUIRenderer** — the ONE generic renderer. ~90% of tools
     route here. Reads `data.items[]` where each item is either ticker-kind
     (logo + chip + text) or generic-kind (dot + text). No per-tool wrappers.
   - `thesis-card` → ThesisCardRenderer → full ThesisCard with sheet
   - `run-summary` → RunSummaryRenderer → ranked-picks DecisionSummaryCard
   - `config-preview` → ConfigPreviewRenderer (builder/editor diff view)
   - `ask-question` → AskQuestionRenderer (interactive QuickReply flow)
4. Extended thinking blocks render via the **Reasoning** component
   (`components/agent/Reasoning.tsx`), registered as Thread's Reasoning slot.
5. Follow-up conversation happens in the SAME AgentChat instance (its
   composer stays live after the run finishes) — there is no separate
   post-run chat component or route.
6. A run page is the chat alone: no tab bar, the Context and expand buttons
   at the right. Only a podcast segment run keeps a tab, Transcript, its output.

## Tool UI architecture
The primitive is `components/ai-elements/tool-progress.tsx` (`ToolProgress` +
`ToolProgressHeader` + `ToolProgressContent` + two item components:
`ToolProgressTickerItem` for ticker rows, `ToolProgressItem` for generic prose
rows). That's the "fake chain of thought" every tool row renders into.

**Tools return items[], the renderer just iterates.** Simple tools set
`ui: "tool-ui"` and return `data.items: ToolUIItem[]` where each item is
either `{ kind: "ticker", ticker, tag?, text, actionIcon? }` or
`{ kind: "generic", text }`. `ToolUIRenderer` wraps the items in a
`ToolProgress` and maps each to the right component — no per-tool logic.

**Never invent a new renderer** for a list-shaped tool (header + items +
maybe sources). If you're tempted: add a generic row or a ticker row to
`data.items` instead. The 5 renderers listed above are the full surface —
4 specialty (thesis card, run summary table, config diff, interactive
question) and 1 generic (`ToolUIRenderer`). Adding a sixth is almost
always the wrong choice.

**Never shove non-ticker content into a ticker row.** Narrative prose
(market context, run wrap-up, a briefing status line) is a generic-kind
item. A fake `$MARKET` ticker is a bug, not a fix — the UI will render
it with a ticker chip as if it were a traded security.

## Design Rules — READ BEFORE ANY UI WORK
- ONLY use ShadCN components from /components/ui
- NEVER create a new component if an existing one can be extended
- ALL cards: use Card from shadcn, padding p-6, same border
- ALL numbers: use tabular-nums class always
- Positive P&L: text-positive ONLY (the `--positive` token, app/globals.css)
- Negative P&L: text-negative ONLY (the `--negative` token)
- The app's blue: brand-blue (the `--brand-blue` token)
- Never hardcode hex colors, use CSS variables only
- Page titles: text-2xl font-semibold
- Section headers: text-lg font-medium
- Body text: text-sm text-muted-foreground
- Labels: text-xs font-medium uppercase tracking-wide
- Empty/loading/error states on every page and data fetch
- **Switch controls — one job each, never hand-rolled:** `Tabs` for sections
  of a page, sheet or panel; `TabsList size="sm"` for view settings over the
  same data (date ranges, % / $, Lifetime / 1D, Shares / Dollars); `ChipTabs`
  for which slice of a list you see (Trades / Sold / Watching / Passed, All /
  Open / Closed). A filter with many options, or several filters together, is
  a `Select` (`SelectTrigger size="sm"`) that starts on a real "All …" item and
  passes `items` so the closed trigger shows the label, never the raw value.
- A section folder with more than one page (`app/(root)/<section>/`) has a
  `loading.tsx` (`components/PageLoading.tsx` unless it has its own); so do
  `app/(root)/` and `app/(settings)/settings/`. Without one, a click between
  two pages there shows nothing until the server finishes.

## Key Technical Notes
- AI SDK v6: useChat sends UIMessage[] (parts array), streamText
  needs ModelMessage[] — ALWAYS convert with convertToModelMessages()
- Tool parts in v6: part.type === "tool-{toolName}", part.input
  for args, part.state === "output-available" when done
- DefaultChatTransport({ api, body }) is the transport for useChat
- ToolCallGroup reads tool parts directly from useMessage — it does NOT
  use useAssistantToolUI hooks. All rendering is data-driven via result.ui.
- Prisma Json fields (sourcesUsed, parameters) typed as unknown —
  always cast with type guard
- async params in Next.js App Router: params: Promise<{ id: string }>
- Live prices come from `lib/market-data/live-quote.ts` (Alpaca, Finnhub
  behind it) — never a new direct vendor call
- Model strategy (post-2026-05-15):
  - **research-run + tactical**: GPT-5.4 (provider: openai; gpt-5.5 from
    2026-05-15, swapped to gpt-5.4 on 2026-06-15 for cost,
    `docs/plans/OPENAI_COST_REDUCTION.md`; `lib/agent/modes.ts` is the truth).
    research-run uses temperature 0.2 + maxSteps 65; tactical maxSteps 15.
    Vercel Pro plan required — the 800s function
    timeout headroom is needed because gpt-5.5 with implicit reasoning
    runs ~13s/tool-call vs gpt-4o's faster cadence. modes.ts maxDuration
    is 800 for both; the cron/route AbortSignal derives 770s from
    `(maxDuration - 30) * 1000`.
  - **builder + editor**: GPT-4o still (user-facing latency matters in
    the chat panel; gpt-5.5 would feel slow when interactively
    iterating on a fence).
  - **principal-chat**: Claude Sonnet 4.6 with thinking budget 4000.
  - **GPT-4o-mini**: lightweight summaries (trade evaluator etc.).
  - **Do NOT swap to Claude for research-run** — the 30k context limit
    crashes the run.
- Agent thinking config lives in lib/agent/modes.ts (thinkingBudget field)
- gh auth switch --user dave-sucks before pushing

## Run Flow (Button Click → Completion)
1. Click "Run" → POST /api/research/agent-run → creates ResearchRun
2. Redirect to /runs/[id] → AgentChat renders with autoStart
3. AgentChat → ChatRuntime → POST /api/agent/research-run
4. Route loads config + historical context (portfolio, watchlist,
   briefs, trades, accuracy)
5. GPT-5.4 (temperature 0.2) follows the per-thesis review flow with
   Phase-0 check-in:
   Phase 0: Portfolio check-in (injected context, no tools)
   Stage 1 — Orient: get_theses(include_history: true),
     get_portfolio_context, get_market_context, web_search
   Stage 2 — Per-thesis review: for every stock on the work list,
     decide: trigger fired / new evidence → research + write_note;
     scheduled review due → research + write_note; nothing changed →
     write_note with a REVIEWED-only verdict
   Stage 3 — Theses: write_note and edit_triggers are the default for held
     names; a stock that needs new research goes to the Writer with
     dispatch_thesis_research (the run never writes a claim)
   Stage 4 — Act: sell / add for held names that warrant action;
     place_trade for new entries; stop_watching to remove from watchlist.
     Daily run can't ADD to watchlist — that's Discovery's job.
   Stage 5 — Recap: record_run_summary (ranked picks + exposure)
   Stage 6 — Complete: complete_run. Old "blocked until every
     researched ticker has a thesis" gate was relaxed in #205 as a
     documented false-fail; current gate is "no work output" (no
     theses + no trades + no summary)
6. Each tool result streams with a ToolResult envelope (ok, ui, data, sources)
7. ToolCallGroup groups results by groupId; ToolCallRow dispatches on ui
8. The Writer's save persists Thesis to DB + ThesisCardRenderer shows full card
9. place_trade calls Alpaca + creates Position + renders TradeCard
10. complete_run marks run COMPLETE, triggers briefing agent

## Known Issues / Tech Debt

### RECURRING BUGS — READ BEFORE TOUCHING THESE FILES

**NEVER put a live quote in the Next.js Data Cache** (`lib/alpaca.ts` → `marketDataGet`, `lib/actions/finnhub.actions.ts` → `getStockQuote`, `lib/agent/research-helpers.ts` → `finnhub()`)
- **The rule:** any fetch whose value is "the price right now" uses `cache: 'no-store'`. Never `next: { revalidate: N }`, never `force-cache` — *no matter how small N is*. Slow-moving endpoints (profile, metrics, financials, daily candles) keep the normal cache.
- **Why `revalidate: 30` does NOT bound staleness to 30s:** the Data Cache is **stale-while-revalidate** — past the window the next request is *still served the stale value* and the refresh happens in the background. On Vercel that cache also persists across invocations and deploys. So the bound is not the revalidate window, it's **how often the surface is hit**. A page loaded once a morning is served whatever was cached last — the prior session's close.
- **What it looked like (2026-08-14):** the thesis sheet rendered SNOW at `$337.38 +$5.12 +1.54%` at 11:38 AM ET while the live price was `$329.43 −2.36%`. The displayed numbers were a perfectly self-consistent snapshot of the *previous* session's close (note `pc: 337.38` in the live payload) — which is exactly why it never looked like corrupt data.
- **The tell that localizes it instantly:** on the same sheet, the **1D chart was correct** while the header price was a day stale. Both are "live price," but the chart polls `/api/stocks/intraday` every 30s (`thesis-chart.tsx`) so its second poll always lands fresh, while the header fetches `/api/theses/:id/quote` **once on open** and never re-polls. **Polling masks this bug; single-fetch surfaces expose it.** If a chart and a price label disagree, suspect cache staleness on the single-fetch side, not the vendor.
- **Confirm before rewriting anything:** ask the vendor directly — `curl -H "APCA-API-KEY-ID: $ALPACA_API_KEY" -H "APCA-API-SECRET-KEY: $ALPACA_API_SECRET" "https://data.alpaca.markets/v2/stocks/snapshots?symbols=SNOW&feed=sip"`. If the vendor is right and the app is wrong, it's caching — do not go blame Finnhub/FMP/Alpaca.
- **Blast radius when it regresses:** `getStockQuote` feeds the sheet header, `/stocks/[symbol]`, `/trades/[id]`, `update_thesis` conviction gates, `complete_run`, and the `lib/alpaca.ts` position-quote fallback. `getLiveQuotes` (`lib/market-data/live-quote.ts`) feeds `get_stock_data`, `get_market_context`, `getStockQuote` **and the trigger evaluator** — so a stale quote there scores the move from our entry and the trail against a wrong price, i.e. protective stops evaluated against yesterday's close right after an overnight gap. Actual fills are unaffected (Alpaca market orders execute at the real price).
- **The freshness guard:** every quote carries `t` (unix seconds — Alpaca's trade timestamp, or Finnhub's on the fallback) and nothing read it for months — a day-old quote is structurally identical to a live one. How old a price is, is decided in ONE place: `lib/market-data/quote-age.ts` (`quoteAgeMs`, `freshQuotePrice`, `staleForTrading`, `readPrice`). The trigger evaluator still scores sells and reviews on a stale quote (skipping a stop is the worse failure) but a **buy never fires on one** (DAV-261 — ETN 2026-09-14: at 09:30 Friday's close was served as "now"). `get_stock_data` and `get_market_context` tell the agent, in words, when the price isn't live — a rate-limited quote used to leave the chart measured from the last close with nothing said (NVDA 2026-09-14). **The trigger check has first claim on the quote budget** (`lib/market-data/quote-budget.ts`): every vendor reply says how many calls the key has left this minute, and once that falls to the reserve (a fifth of Alpaca's 10,000, 45 of Finnhub's 60) every caller but the trigger check is refused a quote until the minute turns over. On 2026-09-15 the pages' polling spent the one Finnhub key and ~29 stocks went unpriced on a trigger pass.

**Portfolio P&L must be net of deposits — never measure against a fixed baseline** (`lib/portfolio/contributions.ts`, `lib/actions/portfolio.actions.ts`, `components/dashboard/DashboardClient.tsx`, `lib/alpaca.ts`)
- **The model:** an account's gain is `equity − net contributed capital`, where net contributed = `Σ deposits − Σ withdrawals`. NOT `equity − $100k` and NOT `latestEquityPoint − firstEquityPoint`. A cash deposit raises equity without being a gain; measuring against a fixed seed (or a pre-deposit chart point) reports the deposit itself as profit.
- **What it looked like (2026-06-07):** funding the live account with $88k showed `+$81,275.95 / +1015.95%` on the homepage and a phantom `−$11,937` "Unrealized Gain." Root cause: `STARTING_CAPITAL = 100_000` hardcoded as the P&L baseline, and the header delta read the raw Alpaca equity curve (which steps up on every deposit). It was invisible on paper because Alpaca seeds paper at exactly $100k — so the wrong constant happened to match.
- **The fix (this is the Alpaca-recommended approach — there is no built-in deposit-adjusted P&L):** pull funding events from the account-activities endpoint (`CSD` = deposit, `CSW` = withdrawal) via `getFundingActivities()`, build `netContributed` + a deposit-adjusted P&L curve (`equity − cumulativeContributions(date)`), and measure all P&L against that. Pure, unit-tested math lives in `lib/portfolio/contributions.ts` (`contributions.test.ts`). LIVE only — paper has no real transfers and falls back to the `STARTING_CAPITAL` seed.
- **Header semantics:** "Balance" = the portfolio snapshot's value (`lib/portfolio/load-snapshot.ts`: cash plus every holding at the app's price, deposits included). The broker's `equity`, which marks holdings at after-hours trades, stands in only when the snapshot can't be read, and the database's sum of open trades only when the broker can't either. "{Range} P&L": 1D = the snapshot's day (every stock against its prior close; without a snapshot, the broker's `equity − last_equity` less deposits today); All-Time = the snapshot's lifetime (value − net contributed); 1W/1M/1Y = the deposit-adjusted curve's delta, the curve ending at the snapshot's value. % base is `netContributed` for All-Time, the account at the prior close for 1D, equity-at-range-start for 1W/1M/1Y.
- **Don't reintroduce:** any `equity − STARTING_CAPITAL` math, or a header/chart delta off the raw equity curve, brings the bug straight back. Keep the deposit-adjusted curve as the single source for displayed P&L.
- **Known still-deposit-naive (follow-ups):** the chart's secondary **Unrealized-Only** + **vs-S&P** toggles. The sub-period % is simple net-deposit return, not time-weighted (slightly high if a deposit lands mid-window — TWR is the proper upgrade).

**Stage structure in the agent system prompt** (`lib/agent/system-prompt.ts`, `components/assistant-ui/cited-markdown-text.tsx`)
- The Run Flow section MUST use `### Stage N — NAME` markdown headers for each of the 6 stages. GPT-4o relies on that structural cue to treat the stage boundary as a mandatory tool-call emission point.
- Replacing the `###` headers with inline bold (e.g. `**Record theses —**`) has been tried and **destroys the run**: the model narrates the transition as prose ("I'll proceed to thesis drafting…"), generateText terminates on that text-only step, and the run ends with 0 theses, 0 trades, 0 summary. Every analyst fails identically. Do not do this — it was attempted in commit 364b63a (Apr 20 2026) and broke the entire 8 AM cron the next morning.
- GPT-4o occasionally leaks `### Stage N — NAME` verbatim into its narration output. That cosmetic issue is handled at the renderer — the h3 filter in `cited-markdown-text.tsx` (around line 342) strips any heading matching `/^(Stage|Phase)\s+\d+\s*[—–\-]/`. That renderer filter is the durable defense; it's safe to keep the headers in the prompt.
- The `FORBIDDEN OUTPUT PATTERNS` list in Section 8 of the prompt is belt-and-suspenders. Keep it. Do not rely on it alone.

**A run summary must match what the run did — check the ACTION, never the prose** (`lib/agent/summary-action-check.ts`, `lib/agent/tools/complete-run.ts`)
- **The real bug, still real:** the agent decides to sell and never calls `close_position`. Seen 2026-05-20 (EV Catalyst, ON) and three times on 2026-05-22 (Catalyst Event Raider on MRVL+OKTA; Secular Theme on SMTC). `complete_run`'s preflight catches it and refuses before the run goes terminal, so the agent can recover in-conversation.
- **How it is caught now (DAV-309):** every ranked pick in `record_run_summary` carries a one-word action. For a stock we HOLD, EXIT needs a close or a sale proposal this run, REDUCE needs a trim or close, ADD needs an add. Everything else owes nothing, **including a stop move** — stops move through `edit_triggers`, one trigger at a time, and they show in Activity.
- **What it used to do, and why that was wrong:** it read the summary's English for "exit" / "sell" / "tightened" near a ticker. That blocked 11 runs; `close_position` had been called in 8 of them. It fired on negations ("held, not sold"), on descriptions of a trigger ("the trailing exit fired"), on the analyst community ("sell-side tone"), and on stocks we only watch. FIVE on 2026-09-23 had genuinely tightened its stop and was refused twice.
- **The harm was the rewording, not the blocking.** To finish, analysts made true summaries vaguer: MU 09-02 went from EXIT "Below trail; protect gain" to HOLD "no finalized position change"; SRRK 09-14 from EXIT to HOLD. No money moved, but what Dave reads got less true. If you are tempted to add a word list back, that is the cost.
- **Credit comes from the `Order`, not the run feed.** `position_closed` RunEvents have not been written since 2026-08-01 — 105 close orders in that window, 64 by an agent, zero events — so anything matching against run events alone will refuse runs that really did sell. An order with intent CLOSE / PARTIAL_CLOSE / ADD since the run started counts, AWAITING_APPROVAL as much as FILLED.

**Prose-termination after Step 1's parallel data tools** (`lib/agent/system-prompt.ts`, `lib/inngest/functions/morning-research.ts`)
- 2026-05-07: 3 of 7 morning-cron runs (Catalyst Event Raider, Global Event-Driven ETF Strategist, EV Catalyst Event Trader) terminated after one round of tool calls. Toolstats showed exactly 3 calls per run: read_signals + get_portfolio_context + get_theses (all parallel). Then the model emitted a markdown thesis-by-thesis review ending with phrases like "Next, I'll proceed to..." or "Let me now focus on..." — text-only assistant turn, no tool call. AI SDK v6's generateText loop terminates when an assistant turn produces no tool calls, so the run ended at msg=4 (user → asst-with-tools → tool-results → asst-text-only).
- The existing coverage retry SHOULD have caught it but was gated behind `response?.messages` being truthy; on a text-only tail that field came back empty/undefined and the retry was bypassed. The 3 failed runs all have `count: 1` per data tool with no retry tools accumulated.
- FIXED BY: (1) "Tool-call discipline — read this first" block in `system-prompt.ts` BEFORE Step 1, naming the forbidden phrases ("Next, I'll proceed to...", etc.) and explaining that text-only turns terminate the loop. (2) `morning-research.ts` retry gate now also fires on `prematureExitViolation` (only data-loading tools called, zero action tools) and reconstructs `responseMessages` from `steps[].response.messages` when the top-level field is empty — same fallback already used by the persistence block. The retry's nudge text branches on the violation kind: prematureExit gets a Step-2-restart prompt, processViolation keeps the original "you researched but didn't record a thesis" prompt.
- If the discipline block is moved out of system-prompt.ts or the responseMessages fallback is removed, the regression returns. The coverage-retry gate (`expectedCoverage > 0 && preRetryThesisCount < expectedCoverage`) is also load-bearing for analysts with active theses; don't replace it with prematureExit alone.

**Never invent per-tool renderers** (`components/agent/renderers/`, `components/agent/ToolCallRow.tsx`)
- The renderer surface is exactly 5 files: `ToolUIRenderer` (the generic one) + 4 specialty (`ThesisCardRenderer`, `RunSummaryRenderer`, `ConfigPreviewRenderer`, `AskQuestionRenderer`). Every prior attempt to add a sixth (`TickerRenderer`, `TickerListRenderer`, `SourceRenderer`, `GenericRenderer`, `DecisionSummaryRenderer`, `MorningBriefRenderer`) was a thin wrapper that should have been a row shape inside `ToolUIRenderer`. All six have been deleted.
- The fix for "my tool's content doesn't show up" is never a new renderer. It is `data.items` with the right row kinds. See "Tool UI architecture" above.
- The fix for "my narrative paragraph doesn't have a ticker" is never to invent a fake ticker. It is `{ kind: "generic", text }`. The `$MARKET` fake-ticker bug lived for weeks because a prior session did this exact thing.
- This applies equally to **firehose pull tools** like `get_earnings_calendar` and `get_market_movers` — opening generic row + ticker rows in `data.items[]`, no `EarningsCalendarRenderer` / `MoversRenderer`. The cap-and-truncate "and N more" line is a `{ kind: "generic", text }` row, not a ticker.

**Position-thesis status desync** (`lib/agent/tools/place-trade.ts`, `lib/agent/tools/get-theses.ts`, `lib/agent/tools/get-portfolio-context.ts`)
- **What it looks like:** `get_portfolio_context` shows a position as OPEN; `get_theses` shows the same ticker as WATCHING. The agent reads both simultaneously and treats an already-held name as a watchlist candidate — narrates "Entry executed within max position size limits" in `reasoningSummary` while `status = WATCHING`.
- **Why it confuses the agent:** the agent's reasoning anchors on the prose `reasoningSummary` field over the structured `status` enum. It sees "Entry executed" → classifies as portfolio-held → ignores the WATCHING-thesis needsAction work → may re-evaluate an ENTER trigger on a position it already holds.
- **Root cause:** before PR #265, `place_trade` created the Position row but left the thesis in WATCHING status. Four production theses (AMD, AVGO, GOOGL, TSM) required a manual DB patch on 2026-05-13 (ThesisUpdate IDs prefixed `mfix`).
- **Fixed by PR #265** — `place_trade` now atomically flips WATCHING → HOLDING in the same DB transaction as the Alpaca order. No new trade can produce this desync.
- If you see a production thesis with `status=WATCHING` and a matching OPEN Position, it's a pre-PR-#265 row. Fix: `UPDATE "Thesis" SET status='HOLDING' WHERE id='...'` + write a manual ThesisUpdate STATUS_CHANGED row.

**V1/V2 prompt dispatch only honored in cron, not in route.ts** — ~~ACTIVE BUG~~ **RESOLVED 2026-05-16 (PR #270)**
- Historical context: `app/api/agent/[mode]/route.ts:232` always called the V1 prompt builder while `morning-research.ts` correctly read `config.useV2Prompt`. The UI "Run" button served the 600-line legacy prompt while the 8 AM cron used V2 — silent drift between the two surfaces.
- **Fix:** PR #270 deprecated the V1 builder (`buildV2SystemPrompt` — misnamed) and made route.ts call `buildDailyRunSystemPromptV2` unconditionally. The `useV2Prompt` flag is no longer read; column stays for migration cleanup.
- (History: the GAPS files were deleted 2026-09-15; see git history.)

**The router's aggregate bug, for whoever rebuilds a routing layer** (router deleted 2026-09-15; in git history)
- Firm-wide aggregate signals carried empty `sectors`/`industries` by design, so routing them through the news-signal fence silently dropped every one — the bug #163/#164/#165/#166 chased. Whatever replaces routing, a firm-wide fact must not be matched on dimensions it structurally can't carry.

- FMP historical-price-full may 403 on legacy plan (affects
  technical analysis for small-cap/ADR tickers)
- Morning brief tool UI shows counts but not full briefing content

(Most other items previously here are now tracked in
Linear (open work) or `docs/TECH_DEBT.md` (orthogonal fragility).
When you spot something new, file it there — not here.)

## Active multi-PR plans
- **`docs/THESIS_ARCHITECTURE.md`** — **The live reference for the thesis system.** Read this before touching anything thesis-related. Documents the end-to-end lifecycle (state machine + 9 canonical scenarios), legal `(direction, status)` pairs, producers + gates, consumers, and the 5-bucket run-summary derivation.

### Recently closed
- **Watchlist collapse (2026-05-13)** — `AnalystWatchlistItem` deleted, `manage_watchlist` deleted, `Thesis` is now the single watchlist store. `direction=null` for seeds awaiting first research; terminal-without-trade is `PASSED` (researched-decline) or `RETIRED` (dropped watch). See `docs/THESIS_ARCHITECTURE.md` for the post-collapse model.

## Key Files
### Agent System
- lib/agent/tools/ — 18 individual tool files, each using defineTool()
- lib/agent/tools/index.ts — single export + createResearchTools() wrapper
- lib/agent/define-tool.ts — defineTool() factory with timing/logging
- lib/universe/feeds.ts — the aggregate-type vocabulary + display labels (mirrors Signal.aggregateType)
- lib/agent/tools/get-earnings-calendar.ts — the earnings calendar, on demand
- lib/agent/tools/get-market-movers.ts — today's gainers / losers / most-actives, on demand
- lib/agent/tool-result.ts — ToolResult<T> discriminated union + normalizer
- lib/agent/tool-context.ts — ToolContext interface + createToolContext()
- lib/agent/modes.ts — model, provider, thinking budget, tool allowlists
- lib/agent/system-prompt.ts — agent persona + instructions
- components/agent/AgentChat.tsx — THE chat component (run, builder,
  editor, podcast, principal). Replaced AgentThread + the Analyst*Chat family.
- components/chat/chat-runtime.tsx — ChatRuntime (DefaultChatTransport)
- components/assistant-ui/thread.tsx — Thread; registers ToolCallGroup as
  the ToolGroup slot and Reasoning as the Reasoning slot
- components/agent/ToolCallGroup.tsx — groups tool calls by groupId
- components/agent/ToolCallRow.tsx — dispatches on result.ui to renderers
- components/agent/renderers/ — one renderer per ui discriminator
- components/agent/sheets/ThesisSheet.tsx — ThesisSheetBody + ThesisSheet
- app/api/agent/[mode]/route.ts — unified route (research-run/builder/editor)
- app/api/research/agent-run/route.ts — creates ResearchRun row

### Triggers (the living ladder)
- lib/agent/triggers/ops.ts — THE write path once a thesis exists: applyTriggerOps (add / edit by id / remove by id; a buy fill's level op writes the approved order's stop and upside level) + checkLadder (the one post-op check). update_thesis, the UI popover and a buy fill all go through it (DAV-242)
- lib/agent/triggers/stop-watching.ts — a STOP_WATCHING line on a watched stock, fired on its saved timing: the thesis retires as DROPPED, one Activity line
- lib/agent/triggers/condition/ — the condition shape, one catalog entry per measure (measures/*), the rules that read it (rules.ts: a protective sale's close reason, levels, states), the check (read.ts), the words (describe.ts), and what the save accepts (valid.ts)
- lib/agent/triggers/types.ts — the Trigger type
- lib/agent/triggers/evaluate.ts — shouldFire: the condition, a stale quote, the wait
- lib/agent/triggers/defaults.ts — accountStandingRules() (the account's add prompts)
- lib/agent/knowledge/playbooks.ts — each playbook's trigger templates (seed: playbook-templates.ts; an account's list: Account.playbooks once seeded, read by `loadPlaybooks`, null when unread); `playbookTriggerText` prints a playbook's triggers by reference (W1…, H1…) for the Writer, After the buy and a watch's row; `playbookWatchTriggers` writes the watch triggers the Writer's save puts on, `pricedTemplate` prices any one from the chart for `edit_triggers`, and `playbookFloor` prices the floor a buy gets when it names none
- lib/agent/triggers/enforce-close-reason.ts — the sale-label rule: a close from a protective fire stores STOP/TARGET (auto-corrected + audit note), and with no fire a declared STOP/TARGET is stored MANUAL; THESIS_INVALIDATED stays distinct via belief_survived
- lib/inngest/functions/trigger-evaluator.ts — 5-min cron + close pass; one catch per trigger, so one it can't read never stops the pass
- lib/inngest/functions/tactical-run.ts — TACTICAL agent / DIRECT close consumer
- lib/actions/thesis-edit.ts — UI add / edit / delete / fire-mode write paths
- Mechanics: docs/TRIGGERS.md · model: docs/plans/TRIGGER_MODEL.md · lifecycle: docs/plans/TRIGGER_LIFECYCLE.md · why: docs/plans/THESIS_GAME_PLAN.md

### Run Pages
- app/(root)/runs/[id]/page.tsx — run detail; renders AgentChat for live
  AND completed runs, and owns the per-mode autoStart guards
- lib/agent/convert-messages.ts — convertPersistedToUIMessages(), the
  replay hydrator for COMPLETE/FAILED runs

### Analyst System
- app/(root)/analysts/new/client.tsx — AI creation chat (AgentChat, builder mode)
- components/analysts/AnalystEditClient.tsx — AI editing chat (editor mode)
- components/analysts/AnalystDetailClient.tsx — analyst detail 2-col

### What's left of the intelligence code
- lib/intelligence/sonar.ts — Perplexity Sonar client (behind `web_search`)
- lib/intelligence/types.ts — shared signal types (the per-analyst
  IntelligencePolicy was deleted 2026-10-31: no run ever read it; every
  run gets the fixed five web searches, `LIVE_SEARCH_BUDGET` in
  `lib/agent/tools/web-search.ts`)
- app/(root)/intelligence/page.tsx — read-only signal history
- (firecrawl.ts, signals.ts, data-payload-extractor.ts, trading-day.ts,
  email-signal-extractor.ts, urgent-trigger.ts and the four pipeline
  functions were deleted 2026-09-15.)
- lib/inngest/functions/morning-brief-generator.ts — brief generation

### Inngest Crons
- lib/inngest/functions/morning-research.ts — daily agent run
- lib/inngest/functions/trade-evaluator.ts — post-trade GPT-4o eval
- lib/inngest/functions/eod-evaluation.ts — end-of-day snapshots
- lib/inngest/functions/accuracy-scorer.ts — weekly accuracy

### Core Lib
- lib/alpaca.ts — Alpaca paper trading client
- lib/trade-exit.ts — exit strategy evaluation
- lib/market-hours.ts — isMarketOpen() with ET + holidays
- lib/prisma.ts — Prisma client (adapter-pg)

## Repo
https://github.com/dave-sucks/hindsight
