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
