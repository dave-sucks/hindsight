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

### P1-27 — Proposal audit (`ThesisUpdate.PROPOSAL_*`) is unreliable — fire-and-forget write loses the serverless race
**Status:** open, filed 2026-06-18 (principal; verified against prod DB, read-only). **Prior "fixed" claim does NOT hold.** Severity: **P1 data-integrity** — auditing approvals from `ThesisUpdate` returns wrong answers, AND it starves P1-28.

**Prod evidence (2026-06-18):** **47** rejected SELL Orders (`status=REJECTED`: 45 CLOSE + 1 OPEN + 1 PARTIAL_CLOSE) but only **7** `PROPOSAL_REJECTED` ThesisUpdate rows (~15% captured). `PROPOSAL_EXPIRED` 7 vs **29** `EXPIRED/CLOSE` Orders (~24%). `PROPOSAL_APPROVED` 18 vs 75 filled sells. A reviewer reasoning from `ThesisUpdate(type LIKE 'PROPOSAL_%')` reached the FALSE conclusion "sells bypass approval" — the table is just sparse.

**Root cause (verified in code).** The audit write is a **detached, un-awaited, post-transaction fire-and-forget** — `void (async () => { … await writeThesisUpdate(…) })()` in BOTH `approveProposal` (`lib/proposals/execute.ts:274`) and `rejectProposal` (`:383`). Launched *after* the tx commits and never awaited → on Vercel the function tears down before the promise resolves (the write races teardown). Compounded by: (a) `try/catch → console.warn` only (fail-soft); (b) depends on `findRelatedThesisId(...)` resolving — no thesis → no row. The expiry path (`proposal-expiry.ts:136`) runs inside a cron `step.run` (more reliable, ~24%) but is still fail-soft + thesis-dependent.

**Canonical ledger = the Order table** (`status`, `intent`, `alpacaOrderId` null = never sent to broker). Reason about approvals from Order, not ThesisUpdate.

**Layer-correct fix (Layer 1 — data integrity, per PRINCIPLES).** Write the `PROPOSAL_*` ThesisUpdate **inside the same Prisma transaction** as the Order status flip (atomic), or at minimum `await` it before the handler returns — kill the `void (async()=>{})()`. Resolve `thesisId` before the tx; if no thesis, still write the audit keyed to position/order (don't gate the audit on a thesis link). Decision: make it reliable (recommended — P1-28 needs this data) **or** formally demote `ThesisUpdate.PROPOSAL_*` to "best-effort" and document Order as canonical at every read site. Either way, **do not keep the fire-and-forget.**

### P1-28 — Agent re-proposes the same rejected exit every run (proposal fatigue) — the Layer-3 prompt fix doesn't hold
**Status:** open, filed 2026-06-18 (principal; verified against prod DB). **Prior "fixed" claim (the prompt block) does NOT hold.** Severity: **P1 behavior** — proposal fatigue; the user re-rejects the same trade ~daily, raising accidental-approval odds + queue clutter.

**Prod evidence (2026-06-18, `Order side=SELL intent=CLOSE`):** MU **23** close proposals (17 rejected, still held), NVDA **33** (19 rejected), AVGO/MRVL/IREN 8 each — re-proposed ~daily across 06-09 → 06-18 with no dampening.

**The prior fix + why it doesn't hold.** A Layer-3 prompt block exists (`lib/agent/system-prompt.ts:189`, "Read rejected proposals like a soft no … do NOT re-propose unless the stated reason materially changed"). It fails because it (a) is the **wrong layer** — prompt text for an agent-does-the-wrong-thing problem (PRINCIPLES says Layer 1/2), and (b) is **starved by P1-27**: the agent reads rejections via `get_theses(include_history)` (`get-theses.ts:269`), but ~85% of rejections have no `PROPOSAL_REJECTED` row, and surviving rows fall outside the default N=5 history window. The only real suppression today is #381's **4h tactical-run snooze** (load-context bail) — that killed the GPT-5.5 cost runaway (P0-14) but does nothing about cross-run re-proposal by the daily run.

**Layer-correct fix.**
- **L1 (the real fix):** a proposal-creation gate — refuse to stage a new CLOSE/PARTIAL_CLOSE proposal for a position with a REJECTED close Order inside a cooldown window (read from the **Order** ledger), unless the thesis materially changed (new EXIT trigger fired / price crossed stop). Extends #381's 4h tactical snooze into a real cross-run cooldown on the *proposal* side.
- **L2 (surface state):** pre-digest a `rejectedExitCount` ("proposed this exit N×, rejected each") onto the thesis in `get_theses`, derived from the **Order** table (reliable), not ThesisUpdate.
- **L3 (keep, not primary):** the existing prompt as belt-and-suspenders.

**Linked to P1-27:** B's data paths (L2 surfacing, L3 prompt) must read the **Order** ledger, OR P1-27 must make `ThesisUpdate.PROPOSAL_*` reliable first.

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
