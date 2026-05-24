# Hindsight — Vision

> **The one-sentence test:** *Can the system pick a stock I've never heard of, decide it's worth watching, notice when it crosses into buy territory, place the trade with a thesis that survives contact with reality, and then manage that position correctly until exit — whether that exit is 30 minutes or 6 months later?*
>
> Today (2026-05-07) the answer is **partially yes, mostly no**. This document describes the answer we're working toward.

This is the source of truth for **what Hindsight is supposed to be**. For what it actually does today, read [`/agent-workflow`](../app/(root)/agent-workflow/page.tsx) (the interactive page, driven by [`lib/agent/workflow-registry.ts`](../lib/agent/workflow-registry.ts)). For the gap between the two, read [`GAPS.md`](./GAPS.md).

---

## Part 1 — The product, in one paragraph

Hindsight is an AI-operated paper trading platform. You configure a small team of AI analysts, each with its own strategy (catalyst events, momentum breakouts, secular themes, earnings drift, ETF macro, etc.). The analysts run autonomously: a background intelligence pipeline gathers signals from the market every morning, a signal router routes those signals into each analyst's inbox, and the analysts wake up daily, evaluate their portfolio + watchlist, react to fresh evidence, and place trades on Alpaca paper. Trigger-fired tactical runs handle the mid-day reactions. Background evaluators learn from each closed trade and credit the source monitors that fed it. Over time, the analyst learns which sources are worth listening to and which trade structures actually compound.

You are one user. You're not the operator; you're the principal. The system runs itself and shows you the receipts.

---

## Part 2 — The hold-style spectrum (the load-bearing concept)

The single concept Hindsight has to get right is **hold-style awareness**. A trade is not a trade is not a trade. The same ticker, on the same day, can be:

| Style | Hold | Exit policy | What "the system worked" looks like |
|---|---|---|---|
| **DAY trade** | minutes to hours | EOD flatten + tight stop (-1% to -2%) + small target (+2-5%) | Open at 9:45 ET on a momentum break, close by 15:45 ET. P&L per minute matters. |
| **TRADE (swing)** | up to 14 days | stop hit / target hit / maxHoldDays | Buy a 2-week breakout pattern. Exit when target hit, stop hit, or 14 days elapsed. |
| **CATALYST** | days around an event | exit at event firing OR 30 days after `catalystDate` | Buy AAPL the week before earnings on a beat thesis. Exit on the print, regardless of price. |
| **TARGET** | weeks to months | only exits at target / stop / thesis invalidation | "I think MSFT is worth $500. I'll wait. Stop at -8%." Open-ended. |
| **COMPOUNDER** | months to years | only on thesis invalidation | "This is a multi-year secular hold. I close it if the thesis breaks." |

**The user's anchor scenario** (which the system must handle correctly):

> *"I'd plan to hold this for 6 months at +150% target unless it drops 5%."*

For that to work end-to-end:

1. The agent must pick the right horizon (TARGET or COMPOUNDER, not TRADE).
2. The triggers must enforce the +150% / -5% bounds.
3. The price monitor must NOT alarm on a -2% intraday move just because it's "near the stop."
4. The daily run must NOT panic-close on a bad week if the thesis is intact.
5. The agent must NOT take profits at +20% — the target was +150%.
6. If the thesis evolves and the agent realizes this is actually a multi-year hold, there must be a path to **promote** TARGET → COMPOUNDER without minting a new thesis from scratch.
7. The data the agent fetches each day must match the horizon: a COMPOUNDER cares about quarterly earnings + secular trends, not the day's options flow.

**Why this matters:** if the system applies the same exit policy to a 6-month compounder as it does to a 2-week swing, every long-term hold gets killed at day 14 and every short-term trade overstays its welcome. The spectrum is not optional.

---

## Part 3 — The five pillars

Each pillar is something the system must do well. The grade is *today's grade*, sourced from the audit on 2026-05-07. Target state is what "good" looks like.

### Pillar 1 — Discovery
**The system finds stocks worth knowing about.**

- The intelligence pipeline (firm market sweep, portfolio/watchlist monitors, domain monitors, email ingest) gathers raw evidence from the world.
- Each Signal is normalized (tickers, themes, sectors, urgency, sentiment, sources).
- The signal router fans signals out to each analyst's universe based on sectors / industries / themes / market cap / feeds, with hard bypass for watchlist + open positions.
- The Sunday Discovery Run gives every analyst a focused weekly window to convert standout discovery signals into new WATCHING theses (or, with high conviction, ACTIVE + a starter trade).

**What good looks like:** every analyst wakes up to a fenced inbox of signals that match its archetype. The discovery surface is the front door for new tickers entering coverage. Dead monitors get pruned; high-ROI monitors get prioritized.

### Pillar 2 — Thesis quality
**The system writes theses that mean something.**

A thesis is not a paragraph of vibes. It's a structured object with:
- **Direction + horizon** — LONG/SHORT/PASS, CATALYST/TARGET/TRADE/COMPOUNDER.
- **Core belief** — the one-sentence claim that's either true or false.
- **Key assumptions** — the things that have to remain true for the belief to hold.
- **Invalidation conditions** — the specific things that would prove the belief wrong.
- **Triggers** — structured predicates (price levels, earnings outcomes, filings, time elapsed) that fire to promote WATCHING → ACTIVE, EXIT, TRIM, MOVE_STOP, ADD, REVIEW.
- **Target + stop** — the bounds.
- **Sources** — which signals + monitors fed this thesis (used by the trade evaluator to credit success).

**What good looks like:** every active or watching thesis populates these fields. The triggers actually fire and produce action. The target/stop math respects the horizon. When evidence arrives that touches a key assumption, the agent updates the thesis durably with a `ThesisUpdate` audit row, not a free-text comment.

> **See also:** [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for how the thesis system actually works (definition, lifecycle, per-horizon shapes, producers + gates, consumers).

### Pillar 3 — Watchlist → trade promotion
**The system actually pulls the trigger.**

WATCHING is the holding pattern. ACTIVE is the trade. The transition is the system's hardest job.

- ENTER triggers (added in PR #217) sit on every WATCHING thesis. When current price crosses the entry level, the trigger evaluator fires, a tactical run spawns, and the agent decides INITIATE or REJECT-WITH-REASON.
- The daily run's per-thesis review loop also evaluates each WATCHING thesis: is the entry condition currently met? if yes, INITIATE or document why not.
- Rejection must be specific (volume too thin, regime change, fresh negative news). "Raise the target and walk away" is a documented run failure (the MRVL goalpost-moving anti-pattern).

**What good looks like:** when a watching thesis's entry condition is met, the system either trades or writes a real reason it didn't. Goalpost-moves are zero. ENTER triggers exist on every WATCHING thesis with a numeric target. The action layer (place_trade, manage_position, close_position, manage_watchlist) is called when the agent's narration says it should be.

### Pillar 4 — Daily portfolio management
**The system manages the book one ticker at a time.**

The daily run is the analyst's morning standup. For every active and watching thesis, in order:
1. Did a trigger fire overnight? Did new evidence arrive in the inbox?
2. Is a scheduled review due (per-horizon cadence — CATALYST 1d, TRADE 1d, TARGET 7d, COMPOUNDER 30d)?
3. If yes to either, do real research and act: update_thesis with what changed, manage_position to scale/trim/move stops, close_position if invalidated, place_trade if a new thesis warrants entry.
4. If no, write a REVIEWED-only audit row and move on.
5. End with a recap of what was actually touched.

**What good looks like:** every thesis is reviewed every day. Every meaningful change writes a durable update. The portfolio gets smaller, more concentrated, more deliberate over time — not bigger and noisier. Discovery slots stay full when they should.

### Pillar 5 — Learning loop
**The system gets smarter.**

When a trade closes, the evaluator runs:
1. GPT-4o reviews the closed trade — was the thesis correct? was timing right? what's the lesson?
2. The Monitor ROI tracer follows `Thesis.sourceSignalIds → Signal.monitorId → Monitor` and credits `tradesSourced / winsSourced / lossesSourced / successScore` per monitor.
3. Over time, monitors with negative ROI drift down the priority list; high-ROI monitors get prioritized in the morning routing.
4. The weekly Accuracy Scorer compares confidence buckets to actual win rate — is the analyst calibrated?
5. The briefing agent writes a standup at the end of every run, which gets injected into the next run's prompt — that's how the analyst remembers anything.

**What good looks like:** the analyst's source list narrows over months. Confidence calibration improves. Repeated mistakes show up in the briefing's "self-corrections" section. Dead monitors get auto-pruned.

---

## Part 4 — Run cadences (the daily loop)

```
06:30 ET — Firm market sweep         ┐
07:00 ET — Portfolio/watchlist scan   │ Intelligence pipeline
07:15 ET — Domain monitors            │ (background, 4 crons)
07:30 ET — Signal router (emits app/signal.routed) ┘
                       │
                       ▼
08:00 ET — Daily Run (per analyst)
                       │
   while market open ─►├─ Trigger Evaluator (hourly + on app/signal.routed)
                       │       │
                       │       ▼ (when predicate matches)
                       │   Tactical Run (consumes app/thesis.trigger.fired,
                       │                  ~15 steps, one decision)
                       │
   hourly ────────────►├─ Price Monitor (auto-close hard stops, flag near-target/near-stop)
                       │
   3:45 PM ET ────────►├─ Intraday EOD Flatten (DAY mode positions only)
                       │
   5:00 PM ET ────────►├─ EOD Snapshot (closing prices, equity curve)
                       │
   on each close ─────►├─ Trade Evaluator (GPT-4o post-mortem + monitor ROI credit)
                       │
   6:00 PM ET ────────►└─ Order reconciliation (Alpaca → Position table)

Sundays:
  09:00 ET — Discovery Run (per analyst, mints new WATCHING theses)
  10:00 ET — Weekly Digest + Accuracy Scorer
  11:00 PM ET (daily) — Pipeline Cleanup
```

---

## Part 5 — What "the system working" sounds like

A normal week, in the user's voice:

- Monday morning: 6 analysts ran. 12 theses were touched. 3 ENTER triggers fired during the run; 2 of them turned into actual buys. 1 was rejected because volume was thin. The watchlist shrank by 2 (PASS theses closed, decorative ones removed). One open position got its stop tightened on better-than-expected earnings.
- Tuesday morning: Tactical run fires at 11:14 AM ET because $NVDA's PRICE_ABOVE trigger crossed. Agent validates with fresh data, places a starter trade, updates thesis to ACTIVE.
- Friday afternoon: A position closes at +12%. Trade evaluator runs, credits the original source monitor (a domain monitor on `semianalysis.com` — score went from 0.42 to 0.51). Briefing agent writes the weekly self-correction: "Three trades this week ran past their original target — consider raising target on conviction continuation."
- Sunday: Discovery run mints 3 new WATCHING theses in semis (because semis were the dominant theme this week). Accuracy scorer reports 64% win rate, slight overconfidence at the 80%+ confidence band.

That's it. That's the product. Everything else in this codebase exists to make that loop run reliably.

---

## Part 6 — Out of scope (the no-list)

What Hindsight is **not**, so the next session doesn't drift:

- **Not a real-money trading platform.** Paper only. Alpaca paper only.
- **Not a research tool for humans.** The user is the principal, not the analyst. Read-only oversight.
- **Not multi-tenant.** One user. One org. The eventual marketing version is a separate problem.
- **Not a brokerage replacement.** Alpaca for execution, period.
- **Not a charting product.** TradingView for charts, but the chart is decoration — the trade decisions live in the agent.
- **Not real-time.** Daily cadence is the heartbeat; tactical runs handle reactivity. We do not build a streaming order book.
- **Not Slack/email-driven.** The briefing agent emits standups for context, not human-facing notifications.

---

## Part 7 — Success criteria

We'll know we're done when:

1. The Daily Run produces 5-15 TradeDecisions per analyst per day (not 1, not 50). Of those, ~2-5 are non-HOLD (INITIATE / EXIT / TRIM / WATCH).
2. The agent correctly picks horizon for the trade structure ≥ 90% of the time, validated by spot-check.
3. Every WATCHING thesis has ENTER triggers attached with non-zero entry levels.
4. Every ACTIVE thesis has structural belief fields (`coreBelief`, `keyAssumptions`, `invalidationConds`) populated.
5. The goalpost-moving anti-pattern (raising target on a watching thesis when the entry condition is met, instead of trading) is zero per week.
6. The Monitor ROI tracer credits at least 80% of closed trades back to a source monitor (not 1.5%, which is today's number).
7. A 6-month TARGET hold survives a -2% intraday move without panic-closing.
8. A 14-day TRADE that's compounding can be promoted to TARGET via `update_thesis` rather than force-closed.

That's the bar. Everything in [`GAPS.md`](./GAPS.md) is the path to clearing it.
