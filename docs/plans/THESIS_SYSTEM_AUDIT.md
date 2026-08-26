# The thesis system — audit and verdict

> **What this is:** the architectural judgment Dave asked for on 2026-08-24.
> Not a plan, not a build. Every claim below is checked against the code in
> this repo and against production data (Supabase project `Hindsight`,
> queried 2026-08-24). Where a doc, a comment, or a previous session's
> claim turned out to be wrong, it says so.
>
> **Companion reading:** `THREE_SYSTEMS.md` (critiqued in §6),
> `LEVELS_AS_TRIGGERS.md` (confirmed and sharpened in §2), `docs/PRINCIPLES.md`.
>
> ## ⚠️ CORRECTION — 2026-08-24, after the DAV-195 doc landed
>
> **I got the PRAX/SRRK/EME severity wrong on first pass. Corrected here and
> in §2b, §5 and §8.**
>
> I read `Thesis.triggers` raw and concluded those three positions had no
> trailing stop. They do. `inheritableDefaultLadder()`
> (`lib/agent/triggers/defaults.ts:258`) puts the 8% trailing EXIT at the
> **DEFAULT level of the cascade** for every HELD thesis, and
> `resolveThesisLadder` merges it in on every read and every cron tick. A
> trailing stop absent from the stored array is still in force.
>
> **Proof it's live:** EME fired *"Gives back 8% from the high — exit position"*
> on 2026-08-24 with no stored trail. And PRAX's peak $390.54 × 0.92 =
> **$359.30 — exactly the `Position.stopLoss` the agent has been writing.**
>
> **What that changes:**
> - PRAX is **not** an unprotected +22% winner. Its effective floor is ~$359.30,
>   locking in roughly +12.7% against a $318.81 entry.
> - The protective ratchet did **not** fail on SRRK today. Omitting an
>   inherited trigger is legal *by design* — the inherited one still covers the
>   bucket. That is correct behavior and the gate is right.
> - "Wholesale replace is an active protection leak" — **withdrawn.**
>
> **What survives unchanged:** the 12 `manage_position` writes still went into
> a field that fires nothing; the three stores still disagree (`Thesis.stopLoss`
> $315 vs effective $359.30 — the sheet now *understates* protection); the ABT
> $96-vs-$98 and MSFT $418-vs-$520 entry desyncs are untouched by inheritance;
> and WATCHING names inherit **nothing** (`if (state !== "HELD") return []`), so
> BWXT genuinely has no floor.
>
> The corrected headline: **the agent is hand-recomputing, every day, a floor
> the system already enforces — and writing it somewhere nothing reads.** That
> is waste and a display bug, not an unprotected position.

---

## 0. The short answer

**The thesis system is not a billion times more complicated than it needs to
be. It is roughly twice as complicated as it needs to be, and the complexity
is in the wrong half.**

The parts that are genuinely complex — the trigger evaluator, the read-side
resolver, the proposal/approval path — are well built: pure modules, single
responsibility, heavily tested, no duplication. That's about 8,000 lines and
I'd change very little of it.

The accidental complexity is concentrated in three places:

1. **Two 2,000-line tool functions** (`update_thesis`, `record_thesis`) that
   have no internal seams — ~40 rejection points inside two single `execute`
   bodies you cannot read, test, or change one at a time.
2. **A level is stored in three places and only one of them fires**, so gates
   got built on the copies that don't. Verified live: **PRAX's stop has been
   raised 12 times in 18 days into a field that fires nothing — the agent
   hand-recomputing, daily, a floor the cascade already enforces — while the
   thesis sheet shows a third number $44 lower than the real one.**
3. **Large subsystems that are wired, gated, documented, and dead** — the
   signal router (last routed 2026-05-31), the discovery cron (last ran
   2026-05-31), the PROMOTED thesis state (zero rows, ever), the podcast
   feature (last run 2026-05-01). Together ~9,000 lines that still impose
   gates and prompt rules on live paths.

The single most useful number in the audit: **71% of all thesis updates since
July 1 changed nothing** (767 empty-diff rows out of 1,086). The dominant
activity of a 4,000-line write layer is recording that an agent looked and did
nothing.

Dave's self-diagnosis — "code, then code to ignore that code, then code to
override that" — is accurate as a description of the two big files and the
level stores. It is **not** accurate about the trigger engine, which is the
best-built thing in the repo.

---

## 1. The map — every path that touches a thesis

Baseline: 123,875 non-test lines in `app` + `lib` + `components`; 36,847 in
`lib/agent`. Dave's figures were right.

The live book is **27 theses** (19 WATCHING, 8 HOLDING) and **8 open
positions**, all LIVE. There are 898 thesis rows total; 871 are history.

### 1a. Paths that CREATE a thesis

| # | Path | File | Runs in prod? | Gates it passes | What it can see |
|---|---|---|---|---|---|
| 1 | `record_thesis` from **discovery** | `lib/agent/tools/record-thesis.ts` (1,981) | **NO — zero runs since 2026-05-31** | all 20 | stock data, signals (empty), money context |
| 2 | `record_thesis` from **thesis-writer** (server-side `.execute()`) | `lib/agent/run-thesis-writer.ts:1156` | yes — 158 runs, last 08-20 | all 20 | stock data, money context, prior-exit history |
| 3 | `record_thesis` from **principal chat** | same tool | yes — 104 runs | all 20 | wide reads |
| 4 | `addWatchlistItem` (UI / builder seed) | `lib/actions/watchlist.actions.ts:254` | yes | **none** | nothing |
| 5 | `promoteAnalystToLive` | `lib/actions/promote-analyst.actions.ts` | **never produced a row** | n/a | n/a |
| 6 | Thesis ingest (paste) | `app/api/intelligence/thesis-ingest/route.ts` | rarely | partial | pasted text |

The **daily run cannot mint** — `record_thesis` is deliberately excluded from
its allowlist. So with discovery dead, the only live minting paths are the
thesis-writer (dispatched by the daily/tactical run) and Dave typing into chat
or the watchlist box.

### 1b. Paths that EDIT a thesis

| # | Path | File | Prod volume | Ratchet gate? | Writes audit row? |
|---|---|---|---|---|---|
| 1 | `update_thesis` (daily, tactical, principal, writer) | `lib/agent/tools/update-thesis.ts` (2,073) | 1,335 UPDATED + 953 REVIEWED | **yes** (`triggers/ratchet.ts`) | yes |
| 2 | `place_trade` → WATCHING→HOLDING + regenerate triggers | `place-trade.ts:975-1030` | 17 fills since 07-01 | n/a | yes |
| 3 | `promoteThesisOnApproval` → same flip on proposal approval | `lib/proposals/thesis-flips.ts:39-135` | this is the live path | n/a | yes |
| 4 | `manage_position` (`update_targets`, `move_stop_to_breakeven`) | `manage-position.ts:991-1160` | 12 on PRAX alone in 18 days | **yes, on the wrong field** | **no ThesisUpdate row** |
| 5 | UI trigger add/edit/delete/fire-mode | `lib/actions/thesis-edit.ts` (722) | occasional | **deliberately skipped** (principal's act) | yes |
| 6 | `closeThesisForPosition` / `shouldRecycleToWatching` | `thesis-flips.ts:189-355` | 25 fills | n/a | yes |
| 7 | `removeWatchlistItem` (UI) | `watchlist.actions.ts:402` | occasional | none | yes |
| 8 | `housekeeping-overdue-theses` cron | `lib/inngest/functions/housekeeping-overdue-theses.ts` | **381 synthetic fires** (24% of all TRIGGER_FIRED) | n/a | yes (fake triggerId) |
| 9 | `trigger-evaluator` cron (fire bookkeeping) | `trigger-evaluator.ts` | 1,185 real fires | n/a | yes |
| 10 | 7 one-off scripts in `scripts/` | `backfill-default-triggers`, `regen-active-triggers`, `convert-static-floors-to-trails`, `dedupe-*` ×3, `strip-promoted-orphan-exit-triggers` | manual | none | varies |

**Items 2 and 3 are the same ~50 lines of logic in two files**, including the
same `if (horizon) … else strip ENTER triggers` fallback and the same
`fieldChanges` shape. Item 3 is the one that actually runs (everything is
approval-gated); item 2 fires only on the paper path.

### 1c. Paths that READ a thesis

52 files call `prisma.thesis.find*`. The ones that matter:

- **`get_theses`** (`get-theses.ts`, 1,196) — the agent's eyes. Composes
  `needs-action.ts` (482) + `resolved-thesis.ts` (408), which in turn compose
  `ladder-health.ts` (395), `winner-signal.ts` (105), `plan-sanity.ts` (151),
  `triggers/evaluate.ts` (387), `triggers/load-levels.ts` (211).
- **`run-input.ts`** (885) — the daily run's Phase-0 injection. Loads its own
  equity, its own positions, its own trigger resolution. Does **not** use
  `context-bundle.ts`.
- `get_portfolio_context`, `list_theses_all`, `list_proposals` — three more
  partial views of the same rows.
- API: `/api/theses/[id]`, `/quote`, `/updates`, `/triggers`,
  `/analyst-coverage`.
- Emails/digest: `daily-run-digest.ts`, `emails/trade-card.ts`,
  `portfolio/digest-facts-builder.ts` — these read `Position.stopLoss`, not
  the trigger list. See §2.

### 1d. Paths that RETIRE a thesis

| Path | Lands as |
|---|---|
| `update_thesis(change_status:"INVALIDATED")` | RETIRED + INVALIDATED |
| `update_thesis(change_status:"ARCHIVED")` | RETIRED + DROPPED |
| `record_thesis(direction:"PASS")` | PASSED (terminal at write) |
| Sell fills → `closeThesisForPosition` | RETIRED + SOLD, **or** recycled back to WATCHING if the exit was a profit-take or a belief-survived protective exit |
| `removeWatchlistItem` (UI) | RETIRED + DROPPED |
| `record_thesis` same-ticker re-mint | old row → RETIRED + REPLACED |

### 1e. What each run mode actually sees and may do

| Mode | Prod runs (all time) | Mint | Edit | Trade | Money context | Signals |
|---|---|---|---|---|---|---|
| Daily (`MORNING_PLAN`) | 535 | ❌ | ✅ | ✅ | via `run-input.ts` | removed from allowlist |
| Tactical (`INTRADAY_TACTICAL`) | **818** | ❌ | ✅ | ✅ | via digest + thesis context | n/a |
| Thesis-writer | 158 | ✅ | ✅ | ❌ | via `context-bundle.ts` | n/a |
| Principal chat | 104 | ✅ | ✅ | ✅ | partial | ✅ (empty) |
| Discovery | **24, none since 05-31** | ✅ | ❌ | ✅ | via `context-bundle.ts` | ✅ (empty) |
| Builder / editor | live | ❌ | ❌ | ❌ | ❌ | ❌ |
| Podcast ×3 | 11, none since 05-01 | ❌ | ❌ | ❌ | — | — |

**Tactical is the most-used mode by a factor of 1.5 over the daily run**, and
its system prompt is 532 lines against the daily run's ~170. That inversion is
worth noticing: the surface Dave watches least has the most prompt.

### 1f. The complete gate inventory

**`record_thesis` — 20 rejection points** (Dave's estimate of ~10 was for
`update_thesis` and was itself low):

provenance required · PASS-on-held-position · `get_stock_data`-called-this-run ·
ROUTED_SIGNAL needs analyst context · signal ids must be in today's inbox ·
thesis shape · structural belief (core belief + 2 assumptions + 2 invalidations) ·
CATALYST needs a date · TRADE needs max-hold-days · conviction tier required ·
conviction rationale required · variant view required for STRONG/HIGH ·
target size required · sub-floor sizing · chat-dispatch LONG/SHORT clamp ·
discovery WATCHING cap · ENTER-trigger guard · same-direction guard ·
recently-sold guard · cross-analyst overlap guard.

**`update_thesis` — 22 rejection points:**

not found · scope mismatch · analyst mismatch · terminal status ·
writer-can't-change-PROMOTED · PROMOTED illegal transition · PROMOTED needs
resolution · terminate-active-without-close · pending-update-without-direction ·
direction-change-only-from-pending · pending-promotion-missing-fields ·
pending-PASS-missing-invalidation · conviction rationale required · variant
view required · **zero-trigger** · **goalpost-moving** · **shape** ·
sub-floor sizing · WATCHING-transition-from-non-PROMOTED · **missing ENTER
trigger** · **protective ratchet** · **structural belief unchanged**.

**`place_trade` — 6 numbered guardrails** (direction committed, composite ≥
threshold, open-position count, target/stop ordering, live-price sanity,
position band) plus a research-staleness gate.

**`complete_run` — 4 preflight failures** (`no_run_summary`,
`run_already_failed`, `narration_execution_gap`, `unaddressed_theses`) with
per-mode exemptions carved out for tactical and thesis-writer because the gate
was unsatisfiable there.

**Total: ~52 server-side rejection points on the thesis path.**

---

## 2. The verdict — what's real complexity, what's accident

### 2a. GENUINELY COMPLEX, WELL BUILT — leave it alone

**The trigger engine.** `lib/agent/triggers/` is 3,861 source lines across 17
focused modules, with 3,383 lines of tests. One pure evaluator, one schema, one
cascade (thesis → analyst → account → default), one close-reason enforcer, one
ratchet, one bucket resolver. No duplication. The ratchet gate correctly covers
REMOVED / LOWERED / FIREMODE_DEMOTED and resolves against the *effective*
ladder so inherited rules can't be gamed. This is the best-engineered code in
the repo and the audit found nothing to cut in it.

**The read-side resolver.** `resolved-thesis.ts` composing `ladder-health`,
`winner-signal`, `plan-sanity`, and the evaluator is exactly the Layer-2
pattern `PRINCIPLES.md` prescribes. All pure, all unit-tested, all computed at
read. Correct.

**The proposal path.** `lib/proposals/` (2,030 lines) implements "nothing
auto-trades" with expiry, sibling cancellation, held-through context, and
honest sale labels. Load-bearing for live money.

### 2b. ACCIDENTAL — the three real problems

#### Problem 1: a level lives in three places, one of them fires

`Thesis.stopLoss` · `Position.stopLoss` · the EXIT trigger. Only the trigger
fires. This is what `LEVELS_AS_TRIGGERS.md` says, and the audit confirms it —
but the doc understates it in two ways.

**(a) It is worse than "decoration." It is actively misleading, right now, on
live money.** Two of eight open positions have three different numbers for
"the stop":

| Ticker | `Thesis.stopLoss` (sheet) | `Position.stopLoss` (emails, digest, `get_portfolio_context`) | What actually sells |
|---|---|---|---|
| PRAX | $315 | **$359.30** | **$315** |
| SRRK | $53 | $52 | $53 |

**(b) The doc says the entry price "⚠️ fires." It mostly doesn't.** Across the
19 WATCHING names, `Thesis.entryPrice` disagrees with the ENTER trigger on 4 of
them, and 3 more have an ENTER trigger with no price level at all:

- **MSFT**: sheet says buy at $418.57. What fires is $520. A 24% gap.
- **NOW**: sheet says $110. What fires is $130.
- ABT $96 vs $98; ETN $391.39 vs $380; GD / GEV / VST — no level.

And **zero of the 19 WATCHING names has a trigger matching its stop or its
target.** Every watchlist stop and target on screen is inert. On the HOLDING
side, 8 of 8 stops now have a matching trigger (this was fixed) but only 2 of 8
targets do.

#### The PRAX case — read this one carefully

This is the whole disease in one position, and it is happening today.

```
PRAX  entry $318.81  peak $390.54 (+22.5%)  currently ~+18%
  Thesis.stopLoss      $315      ← the sheet (UNDERSTATES protection)
  Position.stopLoss    $359.30   ← digest email, get_portfolio_context — fires nothing
  Stored EXIT trigger: PRICE_BELOW $315
  INHERITED 8% trail:  $390.54 x 0.92 = $359.30   ← THE REAL FLOOR
```
**Corrected:** the inherited trail (cascade DEFAULT level) is the binding floor
at ~$359.30, locking ~+12.7%. The position is protected. Three numbers on
screen, none of which is the one that fires, and the sheet shows the *lowest*
of them.

Timeline from the audit log:

- **07-20** — proposal approved, `promoteThesisOnApproval` regenerates the
  held-side trigger set. That set includes the standing 8% trailing stop.
- **07-28** — the trail fires: *"Gives back 8% from the high — exit position."*
- **07-28, same day** — the agent calls `update_thesis(triggers: […])` with a
  hand-written array. `update_thesis.triggers` is wholesale-replace. **The
  trail is gone and never comes back.**
- **08-06** — one legitimate raise through `update_thesis`: stop $255 → $315,
  ladder follows. Correct behavior, the only time it happens.
- **08-07 through 08-24** — **twelve** `manage_position(update_targets)` calls,
  each with a long, articulate rationale about protecting a winner:
  $319 → $344 → $339 → $347 → $347 → $347 → $347 → $347 → $359 → $359.30 →
  $359.30 → $359.30. **All twelve wrote `Position.stopLoss`. None touched
  the trigger list. The floor is still $315 — below what we paid.**

Four of those twelve recorded `prevStopLoss = newStopLoss = 347`: the agent
wrote a paragraph about raising the stop and changed nothing at all.

Three things this proves:

1. **The agent is hand-recomputing a floor the system already enforces.** Its
   $359.30 *is* the inherited trail value, recalculated by hand and written to
   a column nothing fires on — twelve times, with a fresh paragraph each time.
   That is pure waste, plus a sheet that understates the real floor by $44.
2. **The ratchet gates were installed on the wrong field.** DAV-201 (#538) put
   a ratchet on `manage_position`'s `Position.stopLoss` — and the code comment
   says so out loud: *"Today nothing sells off this column."* A gate guarding a
   number that fires nothing, on the exact path that was silently defeating the
   protection rule.
3. **The ratchet is correct — withdrawn as a finding.** Omitting an inherited
   trigger is legal by design because the inherited one still covers the
   bucket. Verified: EME fired the 8% trail on 08-24 with no stored copy. No
   repair is needed and no gate failed.

**Correction to an earlier draft of this audit:** PRAX, SRRK and EME have no
*stored* trail but do inherit the 8% one. `CLAUDE.md`'s claim that every HOLDING
carries the standing minimums is **true** — via the cascade, not via stamping.
The wording ("stamped at mint AND at the buy fill") describes the wrong
mechanism, which is what misled me; the protection itself is real.

One more audit hole worth naming: trigger `fieldChanges` rows record only `to`,
never `from`. The activity log physically cannot tell you what protection was
deleted. DAV-190 shipped as "repair the two audit-log holes" — this is a third.

#### Problem 2: the two big files have no seams

| File | Total | Comments | Code | `.describe()` calls | Rejection points |
|---|---|---|---|---|---|
| `update-thesis.ts` | 2,073 | 600 (29%) | 1,418 | 36 | 22 |
| `record-thesis.ts` | 1,981 | 550 (28%) | 1,373 | 50 | 20 |

Two important corrections to the obvious reading:

- **These are not copy-paste twins.** I diffed them: only 36 identical lines.
  The shared *math* is properly extracted (`subFloorTargetSize`,
  `validateThesisShape`, `validateThesisBelief`, `enter-guard`,
  `protectiveRatchetViolations`). Whoever built this did extract the helpers.
- **The 28% comment ratio is mostly institutional memory**, not noise — each
  gate carries the incident that caused it, with dates and tickers. That
  content is valuable and should survive any refactor.

The actual defect is structural: `update_thesis` is **one `execute` body from
line 412 to 2,017** — 1,600 lines, 22 exit points, no internal function
boundaries. You cannot read one gate without the whole thing, cannot unit-test
one gate in isolation (the four gate tests that exist all boot the full tool),
and cannot change one without re-reasoning about the other 21. That's why every
new incident adds a block instead of replacing one.

And because there's no shared gate shape, the two tools return **two different
rejection protocols for the same check**. Sub-floor sizing rejects as
`{thesis_id: null, status: "FAILED", note}` in one file and
`{ok: false, error, message}` in the other.

#### Problem 3: dead subsystems still charging rent

| Subsystem | Last live | Lines | Still imposes |
|---|---|---|---|
| Signal router + 3 intelligence crons | **routed nothing since 2026-05-31** | ~2,059 + `lib/intelligence` | 2 gates in `record_thesis` (ROUTED_SIGNAL context, signal-ids-in-today's-inbox); **46% of all triggers on the live book** |
| Discovery cron + prompt | **zero runs since 2026-05-31** (81 days) | ~938 | the *only* mint path in the allowlist; a whole mode config; the WATCHING cap gate |
| PROMOTED thesis state | **never occurred — 0 rows, 0 `promotedAt`, ever** | 761 + 421 UI | 4 gates in `update_thesis`, a `place_trade` branch, a `close_position` guard, a `needsAction` kind, 4 columns |
| Podcast | last run 2026-05-01 | ~5,300 | 3 modes, 3 tools, 2 renderers, a `complete_run` branch |
| `revalidationTriggers`, `thoughtTrace` columns | never | — | schema noise |

**Signals is the loudest one.** 421 signals were ingested in August (all via
the email path) and **zero were routed**. `app/signal.routed` therefore never
fires, so the signal-side trigger path is dead. Counting the live book's 200
triggers by kind:

| Kind | Count | Can fire today? |
|---|---|---|
| EARNINGS_BEAT / EARNINGS_MISS / GUIDANCE_CHANGE / FILING / SIGNAL_TYPE | **92 (46%)** | **no** |
| PRICE_* / GAIN_FROM_ENTRY / TRAILING_FROM_HIGH / TIME_ELAPSED / VS_SMA | 108 | yes |

MSFT is the extreme case: 6 triggers, 4 of which are structurally incapable of
firing. Agents spend tokens authoring them, the sheet renders them, and the
evaluator skips them.

### 2c. Two more findings worth having

**The trigger system fires far more than the book can absorb.** 15–20 fires per
day against 27 names — the ladder fires on more than half the book daily, and
most fires read *"deferred to the next daily review."* Meanwhile the approval
loop is drowning: since July 1, of 100 CLOSE proposals, **41 expired, 34 were
rejected, 25 filled**. The system's throughput bottleneck is Dave's attention,
and the trigger cadence is tuned as if it weren't. (DAV-213 has half of this.)

Part of the re-fire volume is self-inflicted: agents author trigger ids like
`"exit-255"`, `"exit-stop-315"`, `"review-8k"` instead of stable UUIDs, so a
wholesale replace changes the id and the `lastFiredAt` cooldown resets. IONS
fired *"Price above $54.65 — consider entry"* ten times.

**Review scheduling is implemented three times.** `Thesis.nextReviewAt` (the
column), the `housekeeping-overdue-theses` cron (which writes a synthetic
`TRIGGER_FIRED` with a fake trigger id `__OVERDUE_REVIEW__` and a hand-rolled
24h cooldown — **381 rows, 24% of all trigger fires**), and `REVIEW_DUE` inside
`needs-action.ts`. PR #541 added a fourth site: a clock advance in
`update_thesis` that duplicates a bump already present in the same file's
empty-patch branch.

---

## 3. Dave's three known findings — verified, refuted, or corrected

### Finding 1 — "Only two doors" (DAV-209): **confirmed for agents, but the fix is far cheaper than it looks**

Confirmed: `record_thesis.direction` is `z.enum(["LONG","SHORT","PASS"])`. An
agent must produce a full priced plan or a terminal PASS. And there's no
demotion: `update_thesis.change_status` is
`["INVALIDATED","ARCHIVED","WATCHING"]`, so a watch name can be bought or
killed, never set down. The `zero_trigger_thesis` gate additionally forbids
leaving a thesis with no triggers unless you invalidate it.

Confirmed downstream: seven plans were dropped on 2026-08-24 (CRWD, KLAC,
NTNX, NVDA, ON, PANW, SNPS) — the rot Dave described.

**The correction: the cheap tier already exists in the schema and in the UI.**
`addWatchlistItem` mints `direction: null, status: WATCHING` with no plan, no
levels, no triggers, and zero gates, and the whole read side already handles it
(`isUnresearchedSeed`, `thesis-direction.ts`, the `needsAction` REVIEW_DUE
path). The only thing missing is that agents can't write it. This is not a new
tier to design; it is one enum value plus a demotion verb. DAV-209's title
already says the right thing — "derived from the plan, not a new status."

### Finding 2 — levels stored twice: **confirmed, and it's three stores, not two**

Covered in §2b. The additions to `LEVELS_AS_TRIGGERS.md` that the data
supports: `Position.stopLoss` is a third store read by emails, the digest and
`get_portfolio_context`; the entry price *also* desyncs (MSFT $418 vs $520); and
the live desync exists right now on PRAX and SRRK, not just historically on
SNOW. The Levels session should take the PRAX trace as its acceptance test.

### Finding 3 — bulk-cleanup "sold" rows distorting analysis: **confirmed, with a firmer number**

161 theses are RETIRED/SOLD. Only 35 have a trade-linked audit row. **83 of
them have `direction = null`** — a thesis that never had a direction cannot
have been sold. And only 103 positions have ever closed (81 paper, 22 live), so
at minimum 58 SOLD rows correspond to no exit that ever happened.

Dave's "99 of ~140" is the right order of magnitude; my defensible floor is
**58 of 161 provably not a sale, with 83 strongly suspect.** Any win-rate or
hold-period analysis over `retiredReason='SOLD'` is currently wrong. The clean
population is `Order` rows with `intent IN ('CLOSE','PARTIAL_CLOSE') AND status
= 'FILLED'` — 25 since July 1. The same distortion applies to REPLACED (360
rows, almost all from the pre-`update_thesis` era when every daily run re-minted
the whole book).

---

## 4. The deletion list

Ordered by confidence. Line counts are measured, not estimated.

### Delete outright — no live dependency

| What | Where | Lines | Why it's safe |
|---|---|---|---|
| Podcast feature (3 modes, 3 tools, 2 renderers, 2 crons, pages, components, `lib/podcast`) | `lib/podcast/`, `app/(root)/podcasts/`, `components/podcasts/`, `podcast-*` tools + inngest | **~5,300** | 11 runs, none since 2026-05-01. Removes 3 mode configs, a `complete_run` branch, 2 renderer types. |
| `Thesis.revalidationTriggers`, `Thesis.thoughtTrace` | `prisma/schema.prisma` | ~10 + readers | 0 non-null rows out of 898 |
| 6 completed one-off scripts | `scripts/dedupe-*`, `backfill-default-triggers`, `regen-active-triggers`, `strip-promoted-orphan-exit-triggers` | ~600 | already run; `convert-static-floors-to-trails` should stay until §5 item 2 lands |
| The `no_run_summary` gate's two mode exemptions | `complete-run.ts:340-400` | ~60 | replace the gate + 2 exemptions with "the gate applies only to modes whose allowlist contains `record_run_summary`" — one condition instead of three |

**Subtotal: ~5,970 lines.**

### Merge — same job, two implementations

| What | Lines saved | Notes |
|---|---|---|
| `close_position` folded into `manage_position(action:"close")` | ~350 of 423 | Both already do full close, both enforce sale labels (DAV-192), both write proposals. Keep `close_position` as a thin alias if the prompts depend on the name. |
| `place-trade.ts:975-1030` and `thesis-flips.ts:70-135` (the WATCHING→HOLDING trigger regeneration) | ~50 | Two copies including the same horizon-null fallback. One function, two callers. |
| Review scheduling: `nextReviewAt` column + `housekeeping-overdue-theses` cron + `needsAction.REVIEW_DUE` + the #541 clock patch | ~250 | One review trigger, batched to the daily run. This is System 2's `nextReviewAt → trigger` item; it also removes the synthetic-triggerId hack and 24% of all TRIGGER_FIRED rows. |
| `manage_position(update_targets)` and `manage_position(move_stop_to_breakeven)` stop writing `Position.stopLoss` and write the trigger instead | ~120 net, and the `stopMoveWeakensProtection` ratchet becomes redundant | **This is the PRAX fix.** See §5 item 1. |

**Subtotal: ~770 lines.**

### Retire behind a decision — needs Dave's ruling, not a code judgment

| What | Lines | The question |
|---|---|---|
| PROMOTED thesis state: 4 gates in `update_thesis`, `place_trade` branch, `close_position` P1-21 guard, `needsAction` kind, `promote-analyst.actions.ts`, `PromoteAnalystDialog`, 4 columns, 1 status enum value | **~1,400** | Zero rows, ever. Are you going to promote another analyst paper→live through this flow, or is that a one-time thing you'd do by hand again? If the latter, this deletes and `update_thesis` loses 4 of its 22 gates. |
| Discovery mode + cron + prompt | ~938 | Dead 81 days (DAV-211). Delete it, or fix it — but it can't stay as the only allowlisted mint path while producing nothing. |
| Signal-side trigger kinds (EARNINGS_BEAT/MISS, GUIDANCE_CHANGE, FILING, SIGNAL_TYPE) and the 2 signal-provenance gates in `record_thesis` | ~200 code, **92 live triggers** | Signals Rebuild (DAV-196) is parked. Until it isn't, agents should stop authoring triggers that cannot fire. Cheapest interim: reject them at the schema with "signal triggers are paused" — one gate that *deletes* the need for four dead ones. |
| 4 paused intelligence crons | ~2,059 | Keep or cut with the Signals design session, not before. |

**Subtotal if all three go: ~4,600 lines.**

### Load-bearing — do not touch

- `lib/agent/triggers/*` (3,861) — the ratchet, the cascade, the evaluator, the
  close-reason enforcer. All of it.
- `lib/proposals/*` (2,030) — the approval gate is the safety property.
- `resolved-thesis.ts` / `needs-action.ts` / `ladder-health.ts` /
  `winner-signal.ts` / `plan-sanity.ts` — the read side is correct.
- The **comment blocks** in `update-thesis.ts` and `record-thesis.ts`. When
  those files get split, the incident history moves with the gate. It's the
  only record of why half of this exists.
- `place_trade` Guardrails 3, 4, 5 (ordering, live-price sanity, position band).

**Realistic total: 6,700 lines deletable now; ~11,300 if the three parked
subsystems are called.** That's 5–9% of the app, and — more to the point —
it takes `update_thesis` from 22 gates to about 15 without weakening a single
live safety rule.

---

## 5. The five things that would most improve it

Ordered by impact ÷ effort. Nothing here is a rewrite and nothing adds an
abstraction layer.

### 1. Make `manage_position` write the trigger, not the column — 1 PR, ~150 lines net negative

**Impact: highest in the audit.** Right now the agent's most common protective
act writes to a field that fires nothing, and it has done so twelve times on
your best-performing position. Change `update_targets` and
`move_stop_to_breakeven` to edit the EXIT trigger (deriving `Position.stopLoss`
and `Thesis.stopLoss` from it in the same transaction, which the UI edit path
already does via `applyTriggerValueEdit`).

Three things fall out for free: `stopMoveWeakensProtection` becomes redundant
because the real ratchet already covers the trigger list; DAV-198 ("stop moves
are invisible in thesis history") closes because the edit now writes a
`ThesisUpdate`; and the PRAX-class desync becomes structurally impossible.

This is a slice of Levels-Are-Triggers, but it's the one slice that doesn't
need the backfill ruling and doesn't change what fires — it only makes the
agent's existing intent reach the thing that fires. **It can ship before
DAV-195.**

> **Needs Dave:** PRAX right now is a +18% winner with a floor at −1.2%, no
> trailing stop, and a displayed stop of $359.30 that will not sell. SRRK and
> EME are the same shape. That's a today problem, separate from the code fix.

### 2. ~~Re-arm the standing protections~~ — WITHDRAWN. Replaced by: show the effective floor, and fix trigger ids

The re-arm is unnecessary — inherited protections were never lost (see the
correction at the top). What survives from this item is smaller and still worth
doing:

- **Show the resolved floor, not the stored column.** The thesis sheet says
  PRAX's stop is $315; the binding floor is $359.30. That is exactly what L2 in
  `LEVELS_AS_TRIGGERS.md` fixes, so it is already covered — no separate work.
- **Reject agent-authored trigger ids that aren't UUIDs** (~10 lines). Agents
  write `"exit-255"`, `"exit-stop-315"`, `"review-8k"`; a wholesale replace
  changes the id, `lastFiredAt` is lost, and the cooldown resets. IONS fired
  *"Price above $54.65 — consider entry"* ten times. This is a real cause of the
  15–20 fires/day.

### 3. Split the two big tools into gate modules — 2 PRs, ~0 net lines, huge readability win

**Not** a gate framework. Literally: move each of the ~40 gate blocks into a
named exported function in `lib/agent/thesis-gates/` — `gateStructuralBelief`,
`gateGoalpost`, `gateSubFloorSizing`, `gateEnterTrigger`, `gateRatchet` — each
taking the loaded thesis + args and returning `null | Rejection`. `execute`
becomes a readable list of calls. Comments move with their gate.

Two payoffs: each gate becomes unit-testable in isolation (today the four gate
tests boot the whole tool), and the two files stop being unreadable, which is
the precondition for ever deleting a gate. Unify the rejection shape on
`{ok:false, error, message}` while you're in there.

This is what DAV-210 should be. It doesn't reduce line count much — and it
shouldn't; the honest deletions are §4, not here.

### 4. Let agents write the cheap tier and set a name down — ~1 day, DAV-209

Add `null` to `record_thesis.direction` (mints `WATCHING` with no plan, no
levels, skipping the ~8 plan-shape gates that only apply to a priced thesis).
Add a demotion verb to `update_thesis.change_status` that clears the plan and
returns a name to unresearched-watch.

The read side already handles this shape. The `zero_trigger_thesis` gate needs
one exception for unresearched seeds. This is the cheapest structural fix in
the audit and it's the one that stops the expensive tier from rotting — the
seven names dropped on 08-24 should have been demoted months earlier.

### 5. Fix the reporting population before any more analyst-quality work — half a day

Stop reading `retiredReason='SOLD'` as "a trade happened." Point every outcome
query at `Order(intent IN ('CLOSE','PARTIAL_CLOSE'), status='FILLED')`, and
backfill `Order.thesisId` where it's resolvable. 58–99 of your 161 "sold" rows
are cleanup artifacts and every accuracy number computed over them is wrong.
Cheap, and it unblocks DAV-212 and DAV-214, both of which are currently
reasoning over a poisoned population.

**Deliberately not on this list:** the ENTER re-fire tax, the proposal-fatigue
economics (DAV-213), and the Signals rebuild. All real, all bigger than this
audit's scope, and two of them are already yours to schedule.

---

## 6. What the last session got wrong

Dave's framing was: *"it wrote the architecture review I asked for and then
kept BUILDING instead of executing the consolidation that review called for.
Net lines went up. Nothing was deleted."*

**Verdict: substantially accurate on the arithmetic, too harsh on two of the
specific PRs, and it missed the worst thing.**

### Where the self-assessment is right

Net lines went up, measurably. Of 41 commits since 2026-08-10, exactly three
had a negative net delta, and one of those was a docs sync. The two-week total
is strongly positive. `THREE_SYSTEMS.md` §6 lists a kill list and none of it
was executed — item 1 (five level stores → one) is still five stores, item 5
(review-cadence logic in three places) is now in *four* places.

The scaffolding-on-scaffolding charge about #541 is fair in kind: it adds a
second clock-advance site in a file that already had one, in a mechanism the
same author's review said should collapse into a trigger. It's a correct ~30-line
bug fix for a real production regression (overdue backlog 2 → 9 in a day), so
I would **not** revert it — but it is exactly the pattern.

### Where the self-assessment is too harsh

**#546 / plan-sanity was built right and shouldn't be counted as "another
gate."** I checked: `computePlanSanity` is consumed only by
`resolved-thesis.ts` and promotes flagged rows into the daily run's work list.
It is a read-time linter, not a write gate — precisely the shape
`THREE_SYSTEMS.md` Move 2 argued for, and precisely what DAV-188 asked for. The
one fair criticism is that it makes resolution *mandatory in the prompt*, which
adds procedure to a Layer-3 that `PRINCIPLES.md` says should carry goals only —
and it lands on a book where 71% of updates already change nothing.

**#531 / #538 (the ratchet gates) are correct code aimed at the wrong field.**
`triggers/ratchet.ts` is genuinely well built — pure, tested, covers removal and
fire-mode demotion, resolves against the effective ladder. #531 (on
`update_thesis`) is right. #538 (on `manage_position`'s `Position.stopLoss`) is
the one that's misplaced, and the PR's own comment admits the column fires
nothing. That's one misplaced gate, not two.

### What the session missed — and this is the bigger miss

**#544 shipped the context bundle "fed to discovery." Discovery has not run
since 2026-05-31.**

`getMoneyContext` has exactly two consumers: `run-thesis-writer.ts` (live, 158
runs — real value, this half was worth shipping) and `discovery-run.ts` (24
runs total, none in 81 days). Meanwhile the two paths that actually run — the
daily run at 535 runs and tactical at 818 — still assemble their own equity
context in `run-input.ts` and don't import the bundle at all.

So the PR that was supposed to be "one context bundle for every path" produced
a module used by one live path and one dead one, while the two busiest paths
kept their own copies. `THREE_SYSTEMS.md` §3 explicitly named discovery as "the
glaring hole… it mints watchlist names completely blind" — and nobody checked
whether it was minting anything at all.

A later session did file this as DAV-211 (Urgent, still Backlog), so it's
known. But it invalidates the framing of #544, and it means the standing law
the review declared — *"no agent write path ships without the bundle"* — is
still unmet on the two paths that matter.

### Should anything be reverted?

**No.** Nothing shipped is wrong enough to revert, and reverting #541 or #538
would restore live bugs. But three things should be *superseded* rather than
built on:

1. **#538's `manage_position` ratchet** — superseded by §5 item 1. When
   `manage_position` writes the trigger, the column ratchet is dead code.
   Delete it in that PR rather than maintaining two ratchets.
2. **#541's clock advance** — superseded by review-cadence-as-a-trigger (§4
   merge list). Keep until then.
3. **#544's discovery wiring** — either revive discovery (DAV-211) or drop the
   discovery consumer. It shouldn't sit as the only justification for a module
   the live paths ignore.

### The one process change I'd argue for

`feedback_stop_adding_gates_start_deleting` already says a new gate requires
answering *"what INPUT or TIER was missing?"* first. The PRAX case suggests a
second question, because that rule wouldn't have caught #538 — the input wasn't
missing, the **write target** was wrong:

> **Before adding a gate: name the field it protects, and name the code that
> reads that field to make a decision. If nothing reads it, you're guarding a
> decoration.**

`manage_position`'s ratchet would have failed that test in one line. So would
half the review-scheduling machinery.

---

## 7. Answers to the two loose ends

- **PR #549** (name history) is already **closed** — nothing to do. Two PRs are
  open: **#547** (dashboard pinned stocks) and **#545** (analyst-quality docs).
  Neither touches the thesis system.
- **Overlap with the Levels session:** §5 item 1 (`manage_position` writes the
  trigger) and §5 item 2 (re-arm deleted protections) are both inside Levels
  territory. Item 1 does **not** need the DAV-195 backfill ruling — it changes
  where an edit lands, not what fires — so it can ship first and independently.
  Item 2 *does* change live behavior (it arms floors that are currently inert)
  and belongs in the backfill approval list. The PRAX / SRRK / EME trace in
  §2b is the best acceptance test that session could have.

---

## 8. Addendum — 2026-08-24 runs, checked against the database

The run-review session read today's 8 runs as "3 for 3 on plan sanity." Checked
against `Thesis.triggers` and the audit log, **it is 1 for 3 — and the miss is
on the case that review praised most.** The reasoning quality was real; the
numbers the reasoning was about were not the numbers that fire.

| Name | What the review said | What the ladder says | Verdict |
|---|---|---|---|
| **PLTR** | "triggers updated (entry was $128 against a $180 price)" | `entryPrice` 128.47 → **183**, ENTER `PRICE_ABOVE@183`. Column and trigger agree. | ✅ **clean — the model fix** |
| **BWXT** | "stop moved $160 → $145… Now coherent." | Column moved to $145. Ladder is `ENTER:PRICE_ABOVE@170 \| REVIEW:PRICE_BELOW@150 \| …` — **no EXIT trigger exists at all.** Its only price-below is a REVIEW. | ❌ **prose coherence, not risk.** Nothing on that plan sells, before or after. |
| **ABT** | "the best outcome of the three" — the agent consciously owned the flag: *"the buy level stays deliberately parked at $96 because this is a pullback-only compounder entry by design."* | `entryPrice` = $96. ENTER trigger = `PRICE_BELOW@98`. | ⚠️ **best reasoning in the run, aimed at the wrong number.** The agent deliberately defended $96; the system buys at $98. |

ABT is the sharpest evidence in this whole audit. The prompt worked, the flag
worked, the agent engaged thoughtfully and made a correct judgment call — about
a value the evaluator does not read.

### SRRK — today's "correct" move is the PRAX mechanism, mid-flight

The review called SRRK's $46 → $53 raise a ratchet-respecting win. It is: the
update went through `update_thesis`, moved **both** the column and the EXIT
trigger to $53, and the ladder now fires there. That part is right. Two things
it didn't catch:

1. **`Position.stopLoss` is still $52.** `update_thesis` writes `Thesis` + the
   ladder but not `Position`; `manage_position` writes `Position` but not
   `Thesis` or the ladder. **Neither write path updates all three stores.** The
   digest and emails will show $52 tonight against a real floor of $53.
2. ~~The wholesale replace left SRRK with no trailing stop.~~ **Withdrawn** —
   see the correction at the top of this document. The stored array lost its
   trail copy, but the 8% trail is inherited from the cascade's DEFAULT level
   and remains in force. The ratchet allowed the write because omitting an
   inherited trigger is legal by design. Nothing broke.

The surviving item is the display, not the protection: `Position.stopLoss` $52
vs a real floor of $53, on a sheet that reads neither from the resolved ladder.
`LEVELS_AS_TRIGGERS.md` L2 fixes exactly this.

### Confirmed without caveat

- **PBH fill validates DAV-204.** 134 shares @ $52.975 = **$7,098.65**, clearing
  PEAD's $7,000 floor. First entry since the sizing fix, exact failure mode it
  was built for. And PBH's post-approval ladder **does** carry the 8% trail —
  `promoteThesisOnApproval` works correctly when a later replace doesn't undo it.
- **Held-through context (#539)** reached the no-agent MU sell card.
- **EME's belief-vs-price close reasoning** is the honest-label behavior working.

### Two small corrections to the review's "losses"

- **MU attribution is right at the data layer.** Both MU close orders carry
  `closeReason = STOP`, not TRAIL — the $935 floor is credited correctly in the
  `Order`; it is the *card text* that cites the trail. The cause is visible:
  `"Price below $935 — exit position"` and `"Gives back 8% from the high"` fired
  **15 milliseconds apart** in the same evaluator tick, and the proposal
  rationale picked one. Same root cause as the duplicate tombstone — one tick,
  two protective exits, one proposal.
- **The rejected duplicate is not an empty row.** Its `rejectionMessage` reads
  *"Duplicate close — folded into pending proposal cmt79y4s00006"* — the dedup
  is annotating itself correctly. Junk row, yes; uninformative, no.

### The MU day is §2c live

MU produced **5 `TRIGGER_FIRED` rows and 3 `REVIEWED — no changes` rows in one
day** on a 27-name book. That is the 71%-empty-diff pattern and the
over-firing pattern in a single ticker, on a single day.

### Ruling requested: should the one-way rule cover watch plans?

The review asked, and leaned "fair game." **Recommend deferring the ruling —
today it is a question about a field that does nothing.** BWXT has no EXIT
trigger, so "lowering the stop from $160 to $145" lowered no protection; it
edited a label. Once levels are triggers, re-pricing an unowned plan means
deleting and re-adding a real trigger, and the question becomes concrete and
answerable. Ruling on it now would bind a decoration.

### What today changes about the verdict

The review's closing framing — *"the behavior is right and the question is
whether the machinery costs too much"* — is close but one step short. Today
shows the **detection layer is right** (flags fired, agents engaged, one of
three resolutions was fully correct, the sizing heal worked, money moved
correctly). It also shows the **action layer is still aimed at fields that
don't fire** on 2 of 3 plan-sanity resolutions, plus a fresh trailing-stop loss
on SRRK.

So the sharper statement is: *the inputs work; the write targets are wrong.*
That is §5 items 1 and 2, and today is the strongest argument yet for doing
them before anything else.
