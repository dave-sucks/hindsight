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

_None open._ P1-26 (legacy briefing tables) + P1-29 (reject-message write-only) both closed 2026-06-26 — see [`GAPS_HISTORY.md`](./GAPS_HISTORY.md).

---

## P2 — Backlog

### Active
- **`/performance` is deposit-naive.** `analytics.actions.ts` still hardcodes `STARTING_CAPITAL=100k` (the homepage was fixed via `lib/portfolio/contributions.ts`; /performance + the chart's Unrealized-Only / vs-S&P toggles weren't). Reuse the contributions helper. See the recurring-bug entry in `CLAUDE.md`.
- **Narrow the P1-28 cooldown carve-out (optional stopgap, ex-P1-29 (a)).** The #445 cooldown exempts `closeReason ∈ {STOP,TARGET}`, so an agent-decided TARGET exit the principal keeps rejecting isn't dampened. One-line change: don't blanket-exempt a STOP/TARGET close that has a recent USER rejection. **Low value now** — P1-29's #457 fix means the agent reads the directive + the principal can edit the target/stop directly, so the root cause of the nagging is addressed. Only bother if residual re-proposals annoy in practice.

### Parked / done (not active items)
- **External thesis ingest** — **shipped ([#460](https://github.com/dave-sucks/hindsight/pull/460)):** mint theses from flat-rate-chat JSON via a thin ingest that reuses the `record_thesis` server logic. (An MCP-tool variant remains a possible future extension.)
- ~~**Trailing stop as a first-class trigger predicate**~~ — **built then removed** ([#458](https://github.com/dave-sucks/hindsight/pull/458)). A `TRAILING_STOP` predicate was added, but the principal wanted a **directional daily % move** ("Movement Amount": up/down X% on the day), not a peak-trailing stop. Shipped that instead as `PRICE_MOVE_PCT` (window `1D`, fires on the cron via the quote's daily % change); `TRAILING_STOP` was fully removed (predicate + all switches + the trailing conversion path). See `docs/TRIGGERS.md`. Recorded so it isn't re-attempted.
- **Activity feed "Sold" → "Rejected"** — **shipped.** Cancelled (rejected/expired) buy proposals render as a `REJECTED` activity item ("Rejected — buy N @ $X"), not a "Sold" card (`lib/actions/portfolio.actions.ts:1085-1093`; confirmed in the live feed). Removed from the board. (Minor residual not tracked: rejected SELL orders on a still-OPEN position aren't surfaced as a feed event yet.)
- **Paused intelligence infra + Sunday `discovery-run.ts` cron** — **paused and parked.** Fine as-is; the principal will revisit / maybe rebuild discovery later. **Not an open decision — don't re-raise each session.**

---

## See also

- [`GAPS_HISTORY.md`](./GAPS_HISTORY.md) — **closed items** (the 4-day live-trading sprint + the thesis-architecture rework). The PRs are the full record.
- [`GAPS_LEGACY.md`](./GAPS_LEGACY.md) — the prior 6-week-rework tracker (mostly closed).
- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for the thesis system (5 roles + lifecycle).
- [`VISION.md`](./VISION.md) — product north star.
