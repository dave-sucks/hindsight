# Trigger Lifecycle, Authority & Visibility — the contract

> **What this is:** the definitive answer to "who sets which trigger, at which
> level, when — and how do I see that it worked." Written 2026-07-12 after the
> Game Plan stack (#477/#481/#480 merged, #483/PR-C open) because the principal
> could not answer "the +10% fires and then WHAT happens?" from the existing
> docs. If a reader can't trace a rung from authoring → fire → decision →
> proposal → ladder re-edit using this file, the file has failed.
>
> Companion to [`THESIS_GAME_PLAN.md`](./THESIS_GAME_PLAN.md) (the behavioral
> blueprint) and [`../TRIGGERS.md`](../TRIGGERS.md) (predicate mechanics).
> Open items extracted to `GAPS.md` P1-33 (visibility) and P1-34 (signals
> rethink).

---

## 1. The authority model — who sets levels, at which layer, when

Five layers, most-specific wins. "Set at the right times" = each layer has a
defined moment when it writes.

| Layer | Sets | When it writes | Nuance? | Status |
|---|---|---|---|---|
| **1. Code constants** | The universal minimums: +10% checkpoint, 8% trail, −12% loser review, ±7% scale rungs, RUNNING_WINNER/UNPROTECTED_GAIN thresholds | Deploy time | None — the floor of floors | ✅ live (`defaults.ts`, `winner-signal.ts`, `ladder-health.ts`) |
| **1b. Account standing rules** | Account-wide overrides of layer 1, applying to every analyst | `/settings/triggers` (principal edits) | Book-level | ✅ live (2026-08-13) — `Account.triggers` |
| **2. Analyst standing rules** | Per-analyst overrides of layer 1b ("Momentum trails 5%, Compounder trails 12%") | Analyst config → Triggers tab (principal edits) | Strategy-level | ✅ live (2026-08-13) — `AgentConfig.triggers` |
| **3. Horizon templates** | The rung *skeleton* per CATALYST/TRADE/TARGET/COMPOUNDER (which rung kinds exist, stop/target shape) | Mint + the `place_trade` WATCHING→HOLDING flip (verified: `place-trade.ts:898-951` regenerates held-side defaults at fill) | Horizon-level | ✅ live |
| **4. The agent (writer / daily / tactical)** | The **actual levels** — add at the breakout shelf, floor under the swing low, trail width fitted to the name's volatility; plus every maintenance edit | Mint (writer authors) · every review ("re-earns the ladder") · every tactical fire (re-ladder duty) | **Full nuance — this is the analyst brain** | ✅ prompts shipped in PR-C (#483); **behavior unvalidated until the first post-merge run** |
| **5. The principal** | Anything, anytime | Thesis-sheet trigger UI · **proposal reject dialog** (retune stop/target/%, add rungs while rejecting) · direct level edits | Human | ✅ live (incl. % Gain / % Trail minting from #480) |

Merge semantics: **thesis → analyst → account → code default, most-specific
wins per (predicate, action) bucket** (`resolveLadder`, `lib/agent/triggers/levels`).
Within the thesis level, an agent-authored rung still beats the horizon
template (`mergeTriggers`); principal edits beat everything and are fed back
to the agent as `principalDirective`.

**The one-way rule is enforced in code (DAV-185, shipped 2026-08-19).** On a
held stock, layer 4 (the agent) may only move protective sell levels toward
MORE protection. `update_thesis` hard-rejects an edit that lowers a stop,
widens a trailing give-back, deletes a protective sell rung, or demotes one
from automatic (DIRECT) to judgment-first — including the sneaky form where a
thesis override is deleted so a weaker inherited value shows through. The
check runs on the effective ladder (`protectiveRatchetViolations`,
`lib/agent/triggers/ratchet.ts`); the principal's paths (thesis sheet, reject
dialog) are exempt. Prompt-only versions of this rule failed live on
2026-08-18 (the MU 948→814 violation).

A rung's LEVEL is which record it is stored on, never a field — deriving it
means it cannot drift from reality. Two consequences worth knowing:

- **Deleting a thesis rung reveals the inherited rung beneath it.** That is
  the only "revert to default", and it needs no separate affordance.
- **Only constant rungs can live above the thesis.** "Trail 6%" means the
  same on every name; "exit below $64.00" does not. `LEVEL_ELIGIBLE_PREDICATE_KINDS`
  (`lib/actions/level-triggers`) enforces it server-side.

Because a rung above the thesis is SHARED by every thesis under it, its
`lastFiredAt` cannot live on the rung — one thesis firing would put every
sibling into cooldown. Per-thesis fire state for inherited rungs lives in
`Thesis.triggerState` (`{ [triggerId]: ISO }`) and is overlaid at resolve time.

## 2. The decision model — what happens when each rung fires

The critical distinction the principal asked for: **a rung firing never
changes a level by itself.** Firing either (a) stages a mechanical proposal,
or (b) summons judgment. Which one is declared per-rung by `action` +
`fireMode`:

| Rung shape | On fire | Who decides | Latency |
|---|---|---|---|
| `EXIT` + fireMode `DIRECT` (floors, trails) | Close **proposal** staged directly — no agent | Nobody (mechanical) → **you approve** | ~5 min from the move |
| `EXIT`/`ADD`/`TRIM`/`ENTER` + `TACTICAL` | Tactical run wakes (~15 steps): validates, decides press/hold/take/pass, **re-ladders**, proposes | **Agent, with nuance** → you approve | minutes |
| `REVIEW` (any predicate — incl. the +10% checkpoint) | `TRIGGER_FIRED` row written, **batched to next morning run** (no intraday agent; BREAKING signals excepted) | **Agent next morning, with nuance** | next 8 AM |
| `UNPROTECTED_GAIN` / `RUNNING_WINNER` (computed flags, not stored rungs) | Flag on the thesis row every morning until resolved | Agent (must act or explicitly attest) | daily until fixed |

**The worked example (IONS replay, annotated with WHO):**
1. +10% from entry prints intraday → checkpoint rung **fires** → audit row. *(machine)*
2. Next 8 AM: thesis arrives flagged; agent pulls data, **decides** floor $65→$78 (under the breakout shelf — its judgment), re-arms +20% checkpoint, writes one `UPDATED` row with exact field changes. *(analyst nuance)*
3. Any morning it hasn't done step 2: `UNPROTECTED_GAIN` shoves it back in its face; a no-op review is rejected by prompt contract; run-close warns structurally. *(machine forcing the conversation)*
4. Peak $86.24 → trail floor ratchets to ~$79.30 with **zero memory required**. *(machine)*
5. Crash day: trail fires → close proposal + email + push. *(machine → **you**)*

## 3. Run-type relationship map

| Runner | Cadence | Reads | May write | May trade |
|---|---|---|---|---|
| Trigger-evaluator cron | 5 min, market hours | quotes + ladders | `lastFiredAt`, `TRIGGER_FIRED` rows, emits fire events | never |
| Signal path (same cron file) | on `app/signal.routed` | routed signals | same | never |
| Tactical run | on non-REVIEW fire | ONE thesis + full ladder + fresh data | surgical `update_thesis` (incl. ladder) | proposals |
| Daily run | 8 AM Mon–Fri | whole book + flags + ladder-health | ladder patches, reviews, status | proposals |
| Thesis-writer | dispatched (promotion / staleness) | deep research | full research + authored ladder — never status | never |
| Price-monitor | hourly | positions | peak/trough water marks, near-target events | never |
| Principal | anytime | everything | any level, any rung, approve/reject | approvals ARE the trades |

## 4. Visibility audit — trace a rung end-to-end today?

**Data: every step IS recorded.** Authoring/edits → `ThesisUpdate UPDATED`
rows with exact `fieldChanges`; fires → `TRIGGER_FIRED` rows carrying
`triggerId`; tactical decisions → run transcript + close-out `update_thesis`
carrying the same `triggerId`; proposals → approve/reject/expire rows +
`principalDirective` feedback loop; ladder re-edits → more `UPDATED` rows.
**The chain is complete in the database.**

**Surfaces: fragmented.** What exists vs missing:

| Question | Today | Gap |
|---|---|---|
| What rungs does this name carry? | ✅ thesis-sheet pills (+ % editing, fire-mode control) | — |
| What WILL a new holding get, at what thresholds? | ✅ `/settings/triggers` — account rules solid, code defaults dashed and read-only | — |
| Did a trigger fire? What woke? What did the agent decide? | data ✅ / UI ❌ — requires spelunking thesis history + runs list separately | **P1-33**: per-trigger timeline in the thesis sheet ("fired 7/14 → tactical → pressed: +$2k add, floor 64→71") + fires/decisions/edits in the activity feed (PR8 ship-now slice) |
| Is my whole book protected right now? | data ✅ (`ladderHealth`) / UI ❌ | **P1-33**: a book-level protection strip (per holding: gain, floor locks, trail?, nearest rung) — the "trust it's working" view |
| Was I notified? | ✅ proposal email + ntfy push (#479) | fires/warnings notify nothing (fine for REVIEW; consider push on `ladder_warning`) |

**P1-33 build order (after PR-C validates):** (1) trigger timeline on the
thesis sheet — pure read of existing rows, highest trust-per-effort; (2)
protection strip on the dashboard; (3) PR8 feed slice; (4) PR-E settings.

## 5. Additional trigger/data primitives actually justified

- **RSI implementation** — predicate exists, hard-coded `false` since v1. Unlocks "trim into RSI>70" (principal's 7/07 ask). Needs candle history on the evaluation path.
- **Earnings-date awareness** — a holding should never be surprised by its own earnings. Cheapest: pin `nextReviewAt` ahead of the next confirmed report date during reviews (data already in `get_earnings_data`). Alternative: an `EARNINGS_IN_N_DAYS` predicate (cron-evaluable off a cached calendar).
- **Portfolio-level conditions** (P1-31's second half): "any holding" standing rules, concentration/%-deployed guards. Design with PR-E.
- **Volume-confirmation rung** (`VOLUME_RATIO_ABOVE`) — optional; today volume lives in tactical confirmation gates, which may be enough.
- Explicitly NOT needed now: more % predicate variants (5D/30D windows exist but don't fire on the cron — wire candles before inventing new kinds).

## 6. The signals / news rethink — FRAMED, not solved (own session — P1-34)

History (principal, 2026-07-12): all-day routed signals = trash + expensive,
mostly discovery-oriented; morning-run reading = every thesis × all news daily
= unaffordable and unfocused; currently routing is severed (0 routes in 14d,
so every news/earnings/filing rung on every ladder is decorative) while
signals still flow (327/14d) from email-ingest + earnings producers.

The principal's three candidate models, to be decided in a dedicated session:
1. **Vetted push** — signals routed only when they match a thesis trigger + materiality check; a match elevates to a tactical/review; everything else is read only during reviews.
2. **Review-time pull** — no standing routing at all; when ANY trigger fires a review, the agent pulls news *scoped to what the review is asking* (this is PR6 generalized).
3. **Hybrid (likely answer)** — mechanical/price rungs stay push (already live); news becomes **event-class push for HELD names only** (earnings, guidance, 8-K/FDA, analyst actions on ~12 tickers — cheap, bounded) + **review-time targeted pull** for everything else; discovery firehose stays parked.

Decision inputs for that session: cost per model, which event classes have
producers today (earnings ✅, filings ?, guidance ?), materiality gate design
(urgency threshold vs LLM vet), and how monitor-ROI crediting (Pillar 5)
re-attaches. **Do not rebuild the pipeline before this session.**

## 7. Sequencing

1. **Validate PR-C (#483)** — merge → one manual Run → grade (reviews engage ladders? checkpoint handling? re-ladder on fires?) → Monday cron.
2. **P1-33 visibility slice** (trigger timeline → protection strip → PR8 feed).
3. **PR-E** — analyst-level standing rules + settings (P1-31/32).
4. **Signals session** (P1-34, §6) → then the event wire, scoped per its outcome.
5. Learning-loop reconnection (monitor ROI) rides the signals decision.
