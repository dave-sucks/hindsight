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

### P1-26 — Delete the legacy briefs + Findings code (deferred — principal may repurpose)
**Status:** open, filed 2026-06-18 (principal). The analyst-page **Briefs** and **Findings** tabs were removed from the UI (#442), and the account-level **Portfolio Digest** (#434/#436/#439) + #433 replace the per-analyst briefing as run-to-run memory. The underlying code is **intentionally NOT deleted yet** — the principal wants to decide what to keep/repurpose first. This is the deletion checklist for when that decision lands. **Ordering: the `AnalystBriefing` writes must stop first (#433 removes them); the table/columns drop last.**

**Gate:** #433 (consume digest, deprecate per-analyst briefing) must be MERGED — it removes the 4 `updateAnalystBriefing` callsites + the `run-input.ts` read. Until then `AnalystBriefing` is still written every daily run.

**(A) AnalystBriefing — the post-run standup.** Exclusive (safe to delete): `lib/agent/update-analyst-briefing.ts` (the writer). Callsites to strip (most handled by #433): `lib/agent/tools/complete-run.ts` (briefing block), `lib/inngest/functions/morning-research.ts`, `app/api/agent/[mode]/route.ts`. Read/fetch: `lib/actions/analyst.actions.ts` `getAnalystDetail()` (the `briefings` list + the `AnalystBriefingItem` type). Prisma `model AnalystBriefing` — **drop last**, after all reads/writes gone.

**(B) MorningBrief — the OLDER per-analyst daily brief (separate from A).** No active writer (`morning-brief-generator.ts` already deleted). Reads: `lib/actions/analyst.actions.ts` (`morningBriefs` list) + `app/api/intelligence/briefs/route.ts`. Prisma `model MorningBrief` — drop last. Type `MorningBrief` in `components/intelligence/types.ts`.

**(C) Shared brief UI — prune MorningBrief/AnalystBriefing branches, do NOT delete wholesale** (these still render on `/intelligence`): `components/intelligence/brief-detail.tsx` (`RunBriefContent` = AnalystBriefing, `IntelBriefContent` = MorningBrief), `brief-types.ts` (`normalizeRunBrief`/`normalizeIntelBrief`), `brief-card(s).tsx`. Decide `/intelligence` Briefs view's fate alongside this.

**(D) Findings tab.** Exclusive (safe to delete): `components/analysts/AnalystFindingsTab.tsx`. **Do NOT delete** (shared with `/intelligence` + the agent's `read_signals`): `components/intelligence/signal-filters.tsx`, `signal-feed.tsx`, `finding-detail.tsx`, `app/api/intelligence/signals`, `lib/inngest/functions/signal-router.ts`, `lib/agent/tools/read-signals.ts`, and the `Signal` / `AnalystSignalRoute` Prisma models (core intelligence layer).

**Not blocking the live loop** — pure cleanup. Pick it up once the principal confirms nothing here gets repurposed.

### P1-27 — Proposal audit completeness — **CLOSED as not-a-bug (2026-06-19)**
Filed 2026-06-18 on a stat that turned out to be an artifact. The "47 rejected SELL Orders vs 7 `PROPOSAL_REJECTED` rows (~15%)" compared the audit against a denominator that was mostly **systemic noise**: of 48 REJECTED SELL Orders, **19 are "Duplicate close" dedup tombstones** (#379), **21 are old pre-proposal-era closes** (closeSource null, all <05-22), and only **~6 are real user rejections** — which **matches** the 8 `PROPOSAL_REJECTED` audit rows. The audit is essentially complete; there is no data-integrity bug. PR #444 (the "fix") was closed; the fire-and-forget write is mildly sloppy but isn't dropping records, and P1-28 reads the Order ledger directly so nothing depends on it. Full closure note in `GAPS_HISTORY.md`. **Lesson:** `Order.status='REJECTED'` is overloaded (user reject + dedup tombstone + broker 4xx + legacy) — never count it raw as "rejections."

### P1-28 — Agent re-proposes the same exit across days (proposal fatigue)
**Status:** **fix in review — PR [#445](https://github.com/dave-sucks/hindsight/pull/445)** (filed 2026-06-18; re-scoped + corrected 2026-06-19 after prod re-verification). Severity: **P1 behavior** — the user keeps getting the same close proposal, raising accidental-approval odds + queue clutter.

**What it actually is (corrected).** The repeated cards are **cross-day** re-proposals of a discretionary close. Two adjacent problems are already fixed and are NOT this:
- The **06-04 bursts** (NVDA 12× / IREN 8× / NVTS 5× in ~1h) were the **P0-14 EXIT-trigger runaway** — fixed by #381 (tactical 4h load-context bail, kills the compute storm) + #379 (dedup folds same-day duplicate cards). See `GAPS_HISTORY.md` 2026-06-04.
- The genuine residual neither catches: **MU re-proposed on 5 distinct days (06-09→06-16)** — each card >4h apart (past #381's snooze) and already expired (nothing for #379 to fold). CRDO 2 days. The user mostly **ignores cards to expiry**, not explicit reject (NVDA/IREN/NVTS were 0 explicit rejects).

**The fix (shipped in #445).**
- **L1 — cross-day cooldown** (`maybeAwaitApproval`): refuse to re-stage a **discretionary** CLOSE within `UNAPPROVED_EXIT_COOLDOWN_DAYS` (5) of a prior staged close that resolved **REJECTED-by-user OR EXPIRED** (Order ledger). Covers daily + tactical. Carve-out: `closeSource='price_monitor'` or `closeReason ∈ {STOP,TARGET}` always flow (verified: re-proposed cards are all untagged; real stops/targets carry tags). CLOSE-only (no staged PARTIAL_CLOSE/ADD exist; buys don't nag). Non-fatal `suppressed` result through both close tools.
- **L2 — `unapprovedExitCount`** per holding in `get_theses` (rejected + ignored, Order ledger).
- **L3 — existing prompt** kept as belt-and-suspenders only.
- Documented in `docs/plans/TRADE_AS_PROPOSAL.md` §8.3 (three suppression layers) + §9.

**Separate, larger follow-up (NOT in #445):** the agent *wants to exit names the user clearly wants to hold* (NVDA/IREN) — the cooldown suppresses the nagging; the root cause is over-eager EXIT triggers. Worth its own investigation.

---

## P2 — Backlog

### P2 — Trailing stop as a first-class trigger predicate
**Idea (principal, 2026-06-23):** add a `TRAILING_STOP` trigger kind so "exit if price falls X% from the peak" renders + edits in the trigger popover exactly like every other trigger (`Exit if · trailing stop · 4%`), instead of being a separate `Position.exitStrategy="TRAILING"` + `trailingStopPct` side-channel only the agent can set via `manage_position.set_trailing_stop`.

**Why it's more than a one-liner (scoped during the trigger-edit work):** the predicate union is referenced by *exhaustive* switches across the trigger system — adding the kind lit up 6 compile sites in one pass (`format.ts`, `evaluate.ts`, `live-evaluate.ts`, `defaults.ts` ×2, `needs-action.ts`, plus `intraday-tactical.ts` and the local helpers in `ThesisTriggersSection`). On top of the mechanical cases there are two real design pieces: (1) **enforcement** — the generic signal-driven evaluator has no peak price; cleanest is to let the **price-monitor** evaluate `TRAILING_STOP` (it already tracks `Position.peakPrice` for the existing trailing path) and treat it as never-fires in the generic evaluators, mirroring `trailPct` onto `Position.exitStrategy/trailingStopPct` on write so the existing enforcement runs untouched; (2) **creation UI** — a "change type" affordance on the stop trigger (price-below ↔ trailing), à la Notion's column "Change type."

**Effort:** moderate-multi-file, not massive (~half a day). The mechanical switch cases are trivial; the value is unifying the model so the principal sets a trailing stop the same way they edit any other trigger. Pairs with the trigger-value-edit popover already shipped (`editableTriggerField` + `applyTriggerValueEdit`).

### Parked / done (not active items)
- **Activity feed "Sold" → "Rejected"** — **shipped.** Cancelled (rejected/expired) buy proposals render as a `REJECTED` activity item ("Rejected — buy N @ $X"), not a "Sold" card (`lib/actions/portfolio.actions.ts:1085-1093`; confirmed in the live feed). Removed from the board. (Minor residual not tracked: rejected SELL orders on a still-OPEN position aren't surfaced as a feed event yet.)
- **Paused intelligence infra + Sunday `discovery-run.ts` cron** — **paused and parked.** Fine as-is; the principal will revisit / maybe rebuild discovery later. **Not an open decision — don't re-raise each session.**

---

## See also

- [`GAPS_HISTORY.md`](./GAPS_HISTORY.md) — **closed items** (the 4-day live-trading sprint + the thesis-architecture rework). The PRs are the full record.
- [`GAPS_LEGACY.md`](./GAPS_LEGACY.md) — the prior 6-week-rework tracker (mostly closed).
- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for the thesis system (5 roles + lifecycle).
- [`VISION.md`](./VISION.md) — product north star.
