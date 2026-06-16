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

### P1-23 — End-of-day Portfolio Digest (replaces the broken per-analyst briefing)
**Status:** open, filed 2026-06-08, **re-scoped 2026-06-16 (principal)**. The one active P1. Part architecture (agent memory), part customer feature.

**Why the current briefing is dead.** `AnalystBriefing` (post-run standup, `lib/agent/update-analyst-briefing.ts`) was built for the old single-Morning-Run world. In the 3-agent split it's useless:
- Written only after the DAILY run; fed only into the DAILY run (`run-input.ts` `latestBriefing`); reads only the last 1.
- **Blind to tactical + discovery activity.** If 5 daily runs buy nothing and 5 tactical runs trade, none of that tactical activity reaches the next day's briefing → run-to-run memory is broken.
- Per-analyst only — no account/portfolio-level view, for the agent OR the user (and the user-facing one is single-analyst, so also useless to read).

**The replacement: an end-of-day, account-level Portfolio Digest** — one per day, covering ALL run activity (daily + tactical + discovery) across ALL analysts, centered on the portfolio as a whole. Dual-purpose:
- **Agent-consumable** (run-to-run memory): each morning's daily + tactical runs read the last N digests so they know what every run type did, plus portfolio state (capacity used, exposure, cash, concentration) + judgment ("only 3/12 slots filled," "no aggressive entry in N days").
- **Customer-facing** (the thing the principal reads): a Perplexity-Finance-style narrative + movers + forward opinions ("consider adding to X," "book is underdeployed").

**Build principle (three-layer):** compute the day's FACTS deterministically (trades + opens/closes/trims by run type, exposure, capacity, day P&L, watchlist adds, passes) — the LLM only narrates + forms opinions FROM those facts, never does the bookkeeping. New `PortfolioDigest` store; EOD cron after close + after the last tactical run; consumed by `run-input.ts` (agent) + a UI surface (user).

**Sibling work:** dovetails with the thesis-card / annotated-chart redesign (`docs/plans/THESIS_VISUALIZATION.md`) — both are "see the story of the book over time." Plan together. Check existing `weekly-digest.ts` + `accuracy-scorer.ts` for overlap/consolidation. Light planning started 2026-06-16; promote to a `docs/plans/PORTFOLIO_DIGEST.md` when scoped.

---

## P2 — Backlog

### Parked / done (not active items)
- **Activity feed "Sold" → "Rejected"** — **shipped.** Cancelled (rejected/expired) buy proposals render as a `REJECTED` activity item ("Rejected — buy N @ $X"), not a "Sold" card (`lib/actions/portfolio.actions.ts:1085-1093`; confirmed in the live feed). Removed from the board. (Minor residual not tracked: rejected SELL orders on a still-OPEN position aren't surfaced as a feed event yet.)
- **Paused intelligence infra + Sunday `discovery-run.ts` cron** — **paused and parked.** Fine as-is; the principal will revisit / maybe rebuild discovery later. **Not an open decision — don't re-raise each session.**

---

## See also

- [`GAPS_HISTORY.md`](./GAPS_HISTORY.md) — **closed items** (the 4-day live-trading sprint + the thesis-architecture rework). The PRs are the full record.
- [`GAPS_LEGACY.md`](./GAPS_LEGACY.md) — the prior 6-week-rework tracker (mostly closed).
- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for the thesis system (5 roles + lifecycle).
- [`VISION.md`](./VISION.md) — product north star.
