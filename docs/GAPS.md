# Hindsight — Gaps

> **What this is:** the live tracker for what's **open** on the live-trading loop. Scoped to what affects real money, real analysts, real runs.
>
> **How this file is maintained:** **open items only.** When an item closes, move its block to [`GAPS_HISTORY.md`](./GAPS_HISTORY.md) (most-recent on top) with the PR # and date — do not leave closed items here. The PRs are the full record. Keep this file short enough to read in one screen.
>
> **The 5 roles (the mental model behind every item):**
> 1. **Daily run** — manages the portfolio. Walks the book every morning. Trades, exits, trims, adds, edits targets. Reads research; never writes deep research.
> 2. **Tactical run** — same as daily but single-thesis, wakes on triggers.
> 3. **Discovery run** — mints net-new theses (Sunday cron + operator-driven chat).
> 4. **Thesis-writer** — refreshes research on existing theses. Dispatched on promotion + agent judgment. Writes belief / target / stop / triggers / sections. **Never touches status.**
> 5. **Promotion action** — closes paper positions, flips ACTIVE → PROMOTED, fans out writer refreshes. The daily run then decides re-enter / wait / kill.

---

## P0 — Blocks the live trading loop

_None open._ The 2026-06-04 → 08 post-launch sprint cleared the live-loop blockers (compliance auto-sell #390, EXIT-vs-proposal runaway #381, cooldown runaway #377). See [`GAPS_HISTORY.md`](./GAPS_HISTORY.md).

---

## P1 — Quality is degraded but the live loop functions

### P1-23 — The post-run "briefing" doesn't fit the 3-agent model
**Status:** open, filed 2026-06-08 (principal). Architectural — decide its role before it drifts further.

In the old single-**Morning-Run** world, one run did everything — discovery, signals, mint theses, **read the last 3-5 post-run briefs**, then write a new brief. The briefing was the analyst's rolling memory inside one daily cycle.

The current `AnalystBriefing` (post-run standup, written by the separate reviewer agent in `lib/agent/update-analyst-briefing.ts`) doesn't fit the new **3-agent split** (daily / tactical / discovery):
- Written **only after the DAILY run** — not after tactical runs or discovery.
- Fed **only into the DAILY run** (`run-input.ts` `latestBriefing` → V2 prompt "Yesterday's standup"; V1 ignores it).
- Reads **only the last 1**, not the rolling last 3-5.
- So it's **blind to tactical trades + discovery activity** that now happen all day. A name a tactical run entered/exited, or one discovery surfaced, never reaches the standup the next morning's daily run reads.

**The rethink:** where does run-to-run memory live when there are 3 run types? Weigh — standup ingests tactical + discovery activity (not just the daily conversation); restore reading the last N; or a different continuity primitive. Tied to the intel-infra disposition (P2 below).

### P1-24 — Status/direction taxonomy: "Pass" lives on `direction`, surfaces disagree
**Status:** open, filed 2026-06-08 (principal). Scoped fix below + a broader audit.

**The finding.** "Pass" is stored on `Thesis.direction` (`LONG | SHORT | PASS | PENDING`), **not** `Thesis.status` (`ACTIVE | WATCHING | PROMOTED | CLOSED | INVALIDATED | ARCHIVED | SUPERSEDED`). A discovery "researched but rejected" writes `direction:"PASS"` and lands `status:ARCHIVED` — but ARCHIVED is **also** used for non-Pass cases (manual "remove from watchlist," editor cleanup), so you can't rename ARCHIVED → "Passed" wholesale.

Some surfaces check `direction==="PASS"` before reading status; others read status blind → the sheet header **contradicts** the row you clicked from:
- ✅ `components/ui/thesis-row.tsx:222`, `decision-summary-card.tsx`, `run-summary-card.tsx` — render "Pass" when direction is PASS.
- ❌ `components/agent/sheets/ThesisSheet.tsx:142` (StatusPill → `getThesisStatusDisplay(status)` blind → "Archived"), `components/domain/thesis-mini-card.tsx:75`, `components/domain/read-theses-table.tsx:56` — show "Archived."

**Scoped fix (~30-50 line PR):**
1. Add `PASSED` to `THESIS_STATUS_DISPLAY` in `lib/thesis-status.ts` — same gray dot as ARCHIVED, tooltip "Researched and declined — institutional memory" (vs ARCHIVED's "Walked away from coverage").
2. Extend `getThesisStatusDisplay(status, direction?)` — return `PASSED` when `direction==="PASS"` regardless of status; ARCHIVED-without-PASS still "Archived."
3. Update the unsafe callsites (ThesisSheet, thesis-mini-card, read-theses-table) to pass `thesis.direction`.

**Broader ask (the real scope):** revisit **every** status/direction and whether it still makes sense at the entity it lives on, post 3-agent + trade-as-proposal. PASS-on-direction is the first symptom — audit the whole taxonomy: what's the source of truth for each lifecycle question across Position.status, Thesis.status, Thesis.direction, and Order.status?

### P1-25 — Orphan thesis on declined/expired buy proposal (agent pre-flips WATCHING → ACTIVE before approval)
**Status:** open, filed 2026-06-09 (principal via prior session; QB-verified live 2026-06-09). Highest-value correctness item open — corrupts thesis-state on every declined ENTER proposal under the live approval toggle. Mechanism confirmed in code + one live in-flight case (PEAD/SNOW). **Zero *completed* orphans in the DB yet** — caught before it bites, not "already recurring" (a correction to the original framing).

**The bug.** On the proposal path `place_trade` creates the buy proposal and returns at the approval seam (`place-trade.ts:623` → awaiting envelope ~639) **without** flipping the thesis — its inline WATCHING→ACTIVE flip (`place-trade.ts:949`) sits past the early return and never runs; `maybeAwaitApproval` doesn't touch the thesis either (`maybe-await-approval.ts:203-222`). The flip is *meant* to happen later at approval via `promoteThesisOnApproval` (`thesis-flips.ts:39`, called from `execute.ts:245`). **But both prompts tell the agent to flip it manually right after place_trade** — tactical `intraday-tactical.ts:237-244`, daily `system-prompt.ts:224`. The agent's `update_thesis(change_status:"ACTIVE")` branch (`update-thesis.ts:1239-1286`) only requires `status==='WATCHING'` + target + stop — **no open-position check** — so it flips the thesis ACTIVE while the position is still `PENDING_APPROVAL`. Reject (`execute.ts:315`) and expire (`proposal-expiry.ts`) flip Position→CANCELLED and write a PROPOSAL_REJECTED/EXPIRED audit row but **never revert Thesis.status** → thesis stuck ACTIVE, no position.

**Proof (live, PEAD / SNOW, 2026-06-08):** `14:02:51` ENTER trigger fires → `14:03:41` place_trade stages Position `PENDING_APPROVAL` + Order `AWAITING_APPROVAL` (expires 2026-06-09 14:03 UTC), thesis still WATCHING → `14:04:00` STATUS_CHANGED "…WATCHING → ACTIVE, triggers updated" (same run, tradeId = the still-awaiting order). The order has never reached Alpaca; the thesis is already ACTIVE. Reject/expire it → first completed orphan; approve it → consistent ACTIVE+OPEN. Premature flip is the bug either way.

**Why SELL is immune:** the zombie-gate (`update-thesis.ts:609-661`) already refuses agent `change_status:"CLOSED"/"INVALIDATED"/"ARCHIVED"` on an ACTIVE-with-open-position unless a real close fired this run. The buy side (WATCHING→ACTIVE) has **no mirror gate**. That asymmetry is the whole bug.

**Harm on completion:** position-thesis desync (pre-PR-265 class, THESIS_ARCHITECTURE §9) — `get_theses` says ACTIVE, `get_portfolio_context` shows nothing; the name drops off the watchlist so the daily run won't re-propose the entry it still wants; the flip regenerated HELD triggers (stripped ENTER); any later EXIT/stop trigger aims a tactical `close_position` at a phantom.

**Fix direction — subtraction + a Layer-1 backstop (NOT prompt-only).** The WATCHING→ACTIVE flip is execution bookkeeping the tools already own; the agent should never flip status itself. Per PRINCIPLES.md, deleting the prompt line alone is a Layer-3 fix to a Layer-1 problem — do both:
1. **L3 (subtraction):** drop "then update_thesis(change_status:'ACTIVE')" from both prompts' ENTER branches (and the redundant `close_position → update_thesis(CLOSED)` at `system-prompt.ts:228`). The daily prompt already states the truth for PROMOTED re-entry at `:218` ("trade tool auto-flips … no separate update_thesis required") — extend it and fix the contradictory `:224`.
2. **L1 (backstop):** `update_thesis` refuses agent-initiated `change_status:"ACTIVE"`/`"CLOSED"` — owned by place_trade / close_position / approval handlers. **Watch PROMOTED:** the resolution gate (`update-thesis.ts:519`, `:563`) currently treats `change_status:"ACTIVE"` as the legal PROMOTED→ACTIVE path; move that to "place_trade fired this run" (its belt-and-suspenders flip at `:848-876` already covers it). PROMOTED→WATCHING (defer) stays agent-legal.
3. **Optional self-heal (L1, prompt-independent):** reject/expire reverts the paired thesis ACTIVE→WATCHING (restoring the ENTER trigger) when cancelling its proposal — robust even if a premature flip slips through, but must reconstruct the stripped trigger.

Deliberate ~80-120 line PR, not a one-liner. **Do not** ship the prompt deletion without the tool backstop + PROMOTED care.

---

## P2 — Backlog

### Activity feed renders rejected proposals as "Sold" — should be "Rejected"
**Status:** open, filed 2026-06-08. **PR #399 carries an interim revert — the next session implements this; do not ship the "drop" approach.**

A rejected/expired **buy** proposal (`Position.status=CANCELLED`, order `REJECTED`, never filled) is rendered by the homepage activity feed as a `type:"CLOSED"` → **"Sold"** card (proposed shares/price, $0 P&L). Root cause: the closed-positions query in `lib/actions/portfolio.actions.ts` (~line 379) pulls `status IN (CLOSED, CANCELLED)`, and the "Recent closes" loop (~996) + the Closed-tab map (~682) treat CANCELLED as a real trade. Analytics (realized P&L, win-rate, equity curve) already exclude them via outcome/realizedPnl null-checks.

**Principal's call: show them, correctly labeled — do NOT drop them.** The feed should reflect the full lifecycle: **Proposed → Bought/Sold (approved) → Rejected (buy or sell).** Implementation: add a `REJECTED` type to `ActivityFeedItem` (`portfolio.actions.ts:132`, currently `OPENED|CLOSED|MODIFIED|PROPOSED`); push REJECTED events for cancelled-buy positions **and** rejected-sell close orders (REJECTED `intent=CLOSE` on a still-OPEN position) with the right verb; add an `isRejected` branch + a muted "Rejected" badge in `components/dashboard/ActivityFeed.tsx` (currently only handles OPENED/CLOSED/MODIFIED at lines 44-46). Display-only — the DB is correct (CANCELLED is the right terminal state).

### Disposition of paused intelligence infrastructure
**Status:** open **decision** (principal's call). After #361: 4 Inngest crons paused (firm-market-sweep, portfolio-watchlist-monitor, domain-monitor, signal-router), 65 monitors disabled, `read_signals` stripped from the daily-run allowlist, `Signal`/`SignalBatch`/`AnalystSignalRoute` tables idle, `AgentConfig.feeds` unconsumed. Decide per-piece: **delete** (commit to the operator-driven pivot) vs **keep-paused-as-fallback.** QB rec (2026-06-05): delete — operator-driven discovery is the mode, paused code rots and pollutes audits. Intertwined with P1-23.

### Sunday discovery cron disposition
**Status:** open **decision**. `discovery-run.ts` (Sunday 9 AM cron) still runs per-archetype, but operator-driven discovery via chat is now primary. Kill / keep-as-fallback / repurpose (read a stored operator prompt). QB rec: kill.

---

## See also

- [`GAPS_HISTORY.md`](./GAPS_HISTORY.md) — **closed items** (the 4-day live-trading sprint + the thesis-architecture rework). The PRs are the full record.
- [`GAPS_LEGACY.md`](./GAPS_LEGACY.md) — the prior 6-week-rework tracker (mostly closed).
- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for the thesis system (5 roles + lifecycle).
- [`VISION.md`](./VISION.md) — product north star.
