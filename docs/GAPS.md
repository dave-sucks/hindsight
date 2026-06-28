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

### P1-29 — Reject-message instructions are write-only (the agent never acts on them)
**Status:** open, filed 2026-06-22 (principal; verified against prod, read-only). Severity: **P1 behavior + trust** — the user gives the agent an explicit instruction in the reject dialog and it's silently ignored, run after run.

**Prod evidence (CRDO, 2026-06-22):** held LONG, entry $216.21, **stop still $198.91** (never moved), price ~$302 (+40%). The thesis carries a **$270 TARGET exit trigger**, so every run re-validates it and re-proposes the close. The user rejected that close repeatedly with the instruction stored verbatim — 06-18 *"Increase the limits, so that nearly as soon as we start to go down we sell…"*, 06-22 *"IT JUST KEEPS GOING UP. PLEASE INCREASE MY STOP LOSS TO JUST ABOUT AS HIGH AS THE CURRENT PRICE."* The message **is** written (ThesisUpdate `PROPOSAL_REJECTED`) — so this is NOT a P1-27-style audit gap. Nothing **reads the instruction and acts** (raise stop / adjust target); the stop has never changed.

**Two parts:**
1. **Write-only feedback (primary).** A rejection rationale containing an actionable directive ("raise my stop", "ride past target", "hold longer") is stored but never executed. The agent's only handling of a rejection is "soft no, don't re-propose" — it never translates the instruction into a `manage_position` / `update_thesis` action.
2. **#445 carve-out hole (secondary).** CRDO's closes are `closeReason=TARGET`, and the P1-28 cooldown **exempts** STOP/TARGET ("always material"). So a TARGET exit the user has rejected 5× is NOT dampened — the cooldown doesn't even stop the nagging here.

**Fix directions (product choice — needs a decision):**
- **(a) Narrow the P1-28 carve-out** — a STOP/TARGET exit recently rejected by the user should also cool down, not blanket-exempt. Quick stopgap so CRDO stops nagging.
- **(b) Act on the instruction** — surface the reject message as a "user directive" in `get_theses` (L2) and have the review flow execute it (raise stop / raise-or-drop target), reconciling the directive with the thesis's own triggers.
- **(c) Direct control (likely the real answer)** — a real "adjust stop / target" affordance on the position so position management isn't routed through free-text in a reject box. The dialog currently invites instructions it can't honor.

**In progress (#457):** ships **(b)** softened — `get_theses` surfaces the principal's most recent review decision verbatim (`principalDirective`) and a reject-with-comment flags the thesis for `REVIEW` so the agent reads + responds with judgment (no hard-forcing gate) — and **(c)** — inline target/stop editing in the trigger popover + "Edit & approve" on proposals. **(a)** (narrow the #445 carve-out) still open. Closes when #457 merges and (a) is decided.

---

## P2 — Backlog

### Active
- **External thesis ingest — write theses from a flat-rate chat.** Cost play: do the expensive LLM drafting in a regular Claude/GPT chat (or via MCP), then write the thesis into Hindsight through a thin ingest that **reuses the `record_thesis` server logic** (validation + trigger generation + status taxonomy) — NOT a raw Supabase insert (that skips every invariant the P1-24 taxonomy + position-thesis-desync fixes protect). Options: paste/email-ingest (mirrors `/api/intelligence/email-ingest`) or an MCP tool. Prereq: extract `record_thesis`'s validate+persist core out of the tool wrapper into a shared fn. **Principal is spinning up a dedicated session** → promote to `docs/plans/EXTERNAL_THESIS_INGEST.md`.
- ~~**Trailing stop as a first-class trigger predicate**~~ — **built then removed.** A `TRAILING_STOP` predicate was added, but the principal wanted a **directional daily % move** ("Movement Amount": up/down X% on the day), not a peak-trailing stop. Shipped that instead as `PRICE_MOVE_PCT` (window `1D`, fires on the cron via the quote's daily % change); `TRAILING_STOP` was fully removed (predicate + all switches + the trailing conversion path). See `docs/TRIGGERS.md`. Not a backlog item — recorded so it isn't re-attempted.
- **`/performance` is deposit-naive.** `analytics.actions.ts` still hardcodes `STARTING_CAPITAL=100k` (the homepage was fixed via `lib/portfolio/contributions.ts`; /performance + the chart's Unrealized-Only / vs-S&P toggles weren't). Reuse the contributions helper. See the recurring-bug entry in `CLAUDE.md`.

### Parked / done (not active items)
- **Activity feed "Sold" → "Rejected"** — **shipped.** Cancelled (rejected/expired) buy proposals render as a `REJECTED` activity item ("Rejected — buy N @ $X"), not a "Sold" card (`lib/actions/portfolio.actions.ts:1085-1093`; confirmed in the live feed). Removed from the board. (Minor residual not tracked: rejected SELL orders on a still-OPEN position aren't surfaced as a feed event yet.)
- **Paused intelligence infra + Sunday `discovery-run.ts` cron** — **paused and parked.** Fine as-is; the principal will revisit / maybe rebuild discovery later. **Not an open decision — don't re-raise each session.**

---

## See also

- [`GAPS_HISTORY.md`](./GAPS_HISTORY.md) — **closed items** (the 4-day live-trading sprint + the thesis-architecture rework). The PRs are the full record.
- [`GAPS_LEGACY.md`](./GAPS_LEGACY.md) — the prior 6-week-rework tracker (mostly closed).
- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — the live reference for the thesis system (5 roles + lifecycle).
- [`VISION.md`](./VISION.md) — product north star.
