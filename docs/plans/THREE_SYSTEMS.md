# The Three Systems — how 1000 mechanisms become 5 concepts

> **What this is:** the write-path review Dave ordered on 2026-08-20 (DAV-207),
> widened per his direction into the consolidation plan: everything pending —
> and most of what shipped in the last 20 days — rolls up into **three
> infrastructures**. His words, verbatim, as the acceptance test:
>
> *"I shouldn't have a thesis minted with a target price that makes no sense
> based on the live price, that then goes through 5 daily runs and triggers
> firing, and it still be wrong. That is fucking insane."*
>
> *"Everything should be a trigger and our trigger system should be well
> designed… We need to get to the point where there's only a few concepts and
> processes across everything."*
>
> **Status:** review document — Dave rules, then the projects execute.
> Companion to `LEVELS_AS_TRIGGERS.md` (absorbed into System 2 below) and
> `docs/PRINCIPLES.md` (the three-layer law this builds on).

---

## 1. The diagnosis — why 20 days produced 20 fences

Every serious bug since Aug 1 has the same anatomy. Not bad rules — **blind
writers**. An agent authored or judged a plan without being shown the one
piece of live context that would have made the mistake obvious, the bad value
persisted, and we responded with a gate at the tool layer:

| Incident | The blind spot | The fence we built |
|---|---|---|
| MU floor lowered $948→$814 (live) | Nothing enforced "protective lines only tighten" | Ratchet gate (#531, #538) |
| HPE trail alarm talked down with an invented peak | Validator never given the tracked peak | Peak in tactical context (#533) |
| Five theses minted un-fillable (sub-floor sizing) | Writer never saw equity or the $7k floor | Sizing context + mirror (#540) |
| CAPR entry 20% below market, MNKD stop inside daily noise | Minter never compared its plan to the live chart | *Not yet built* (DAV-188) |
| Review reminders re-firing daily on reviewed names | Review "cadence" is a bare date column, not a rule that participates in reviews | Clock-advance patch (#541) |
| Stop-loss sales labeled "manual" | Close tools never told why the run woke | Label enforcement (#535) |

Each fence is individually correct — the three-layer principle says hard
rules belong in tools. But the *accumulation* is the disease: **we kept
adding rules where the missing thing was inputs.** A well-fed analyst
doesn't need most of these fences; a blind one defeats any number of them.

And Dave's "5 daily runs and it's still wrong" is the sharpest version: even
when a bad plan gets through, *nothing in the review loop re-checks the plan
against reality.* Reviews check the STORY (belief, bear case, news). Nobody's
job is the arithmetic: "entry $400, stock's at $590 — this plan is nonsense."
A wrong number, once written, is wrong forever unless a human notices.

---

## 2. The five concepts

The target state. Everything the platform does is expressible in five nouns —
anything that isn't one of these is plumbing, and plumbing must not carry
business rules:

1. **Thesis** — a belief about a stock plus a plan (direction, conviction,
   levels-as-triggers, narrative). The only durable record of "what we think."
2. **Trigger** — a condition → action pair. **The only place a price level,
   a schedule, or a "wake up when" lives.** Entries, floors, targets, review
   cadence, max-hold, scale rungs: all triggers, one schema, one evaluator,
   one cascade (thesis → analyst → account → default).
3. **Run** — the only venue where an agent decides anything (daily, tactical,
   writer, discovery). A run receives **the standard context bundle** (§3)
   and owes **plan-sanity** (§4) on every thesis it touches.
4. **Proposal** — the only path money moves. Approval-gated, labeled
   honestly, carries its context (held-through history, decline counts).
5. **Signal** — the only input from the outside world (news, filings,
   earnings). System 3, parked until Dave's design session.

Everything on today's board maps into the three systems that own these:

| System | Owns concepts | Linear project | Rolls up |
|---|---|---|---|
| **1. Thesis lifecycle** | Thesis + Run | *Thesis Lifecycle* (new) | DAV-188, 198, 205, 206, 207; shipped: #540, #541, #530-family, conviction gates |
| **2. Triggers as the spine** | Trigger + Proposal | *Levels Are Triggers* (existing, widened) | DAV-193, 195, 200, 203; shipped: #518/#511/#523/#531/#533/#535/#538/#539 |
| **3. Signals** | Signal | *Signals Rebuild* (existing, parked) | DAV-196 and every news/earnings trigger that can't fire today |

(Orphans that fit none: DAV-199 vendor alerting — ops, stays standalone.)

---

## 3. System 1 — Thesis lifecycle

### The inventory: six ways a thesis gets written today

**The split that matters: the runs Dave watches are the well-fed ones.**
The daily run — the surface reviewed every day — starts with the portfolio
check-in INJECTED (Phase 0, before any tool), and its staged prompt FORCES
the data pulls (signals, book, live snapshots) before any thesis is touched.
Dave's daily-run transcripts showing exactly that are accurate. The blind
paths are the ones that run **offstage** — the writer at 4 AM, discovery on
Sunday — which is precisely why their defects felt like ambushes: bad plans
are born where nobody is watching, and the well-fed daily run then inherits
and works around them.

| Path | Watched? | Live price | Equity/band | Portfolio/digest injected | Gates bolted on |
|---|---|---|---|---|---|
| Daily run | ✅ daily | ✅ forced pulls | ✅ (#524/#525) | ✅ Phase-0 check-in | ~9 gates¹ |
| Tactical run | sometimes | ✅ + peak (#533) | ✅ | ✅ digest + thesis context | close-out + ratchet gates |
| Thesis-writer (V2) | ❌ offstage | ✅ (data pull) | ✅ *since #540* | ❌ | R/R + sub-floor + prior-exit mirrors |
| Discovery run | ❌ offstage | tools, unforced | ❌ | ❌ | mint caps only |
| Builder/editor chat | ✅ live | ❌ | ❌ | ❌ | none (research-only tools) |
| UI (sheet, reject dialog) | human | n/a | n/a | n/a | exempt by design |

¹ zero-trigger, goalpost, shape, structural-belief, conviction coherence ×2,
ENTER-shape, ratchet, narrative-collapse — accumulated one incident at a time.

### The two moves

**Move 1 — one context bundle.** Make every agent start the way the daily
run already starts. A single builder (one module) assembles the same context
for every agent invocation: portfolio + digest, live quote + day range,
account equity + the seat's sizing band, the analyst's existing thesis/order
history on the name, and the resolved trigger ladder. The daily run's
Phase-0 injection and #540's writer wiring are the two working instances;
the move is to extract ONE module and feed **all** paths from it — the
offstage ones first. Discovery is the glaring hole: it mints watchlist
names completely blind. Standing law from here: **no agent write path
ships without the bundle.**

**Move 2 — plan-sanity is a RUN duty, not a mint-time gate.** This is Dave's
"5 runs and still wrong" fix, and it's arithmetic, not judgment: every run
that touches a thesis receives a computed `planSanity` block alongside it —
entry vs. live price (%), stop vs. daily volatility, size vs. floor, target
staleness — with anything absurd flagged in words ("entry $400 is 32% below
the live price — this can never sensibly fill"). The run must resolve the
flag: fix the number, or explain it, or stop watching. Same enforcement
shape as `UNPROTECTED_GAIN` (a linter on the thesis, nagging until resolved).
DAV-188 should be built as **this**, not as another write-time refusal —
write-time checks catch birth defects; run-time sanity catches drift, and
drift is what survived five runs.

### What DAV-205 decides here

Whether `target_size_pct` remains an authored field or becomes derived at
entry from conviction × band × live equity. Recommendation stands: derive it
(model 2). Under this doc it's the same principle again — sizing decided
where the information lives.

---

## 4. System 2 — Triggers as the spine

`LEVELS_AS_TRIGGERS.md` already specifies the core: **a level exists because
a trigger says so.** Stop/target/entry/review-date/max-hold columns become
read-models derived from the ladder; the backfill arms today's decorative
stops (Dave approves the list — that's DAV-195). This doc widens it to the
full principle:

**If it schedules, prices, or wakes anything — it is a trigger.** One schema,
one evaluator, one cascade, one edit surface, one audit shape.

The duplicate mechanisms that dissolve when that lands:

| Today's parallel mechanism | Becomes |
|---|---|
| `Thesis.stopLoss` / `targetPrice` / `entryPrice` columns | derived from the canonical rungs |
| `Position.stopLoss` / `targetPrice` (display-only twins) | same derivation (kills the P1-42 dual-store) |
| `nextReviewAt` + the #541 clock patch | a review-cadence trigger, batched to morning runs |
| `maxHoldDays` | the existing time-elapsed trigger, minted once |
| RUNNING_WINNER computed flag | an account-level review trigger |
| Review-date "am I overdue" logic scattered in needsAction | the evaluator, like every other trigger |
| The stop-mirroring code in the UI edit path | unnecessary — editing the pill IS editing the only store |

What **stays law** regardless (these are not consolidation casualties):
the protective ratchet (one-way lines), the approval gate (all money moves
are proposals), honest sale labels, and the standing ruling (triggers fire
every day their condition holds; only Dave moves a line down).

**Sequencing inside System 2:** DAV-195 ruling → derive-on-write → backfill
(Dave approves) → review-cadence + max-hold migration → kill the parallel
stores. The ratchet gates (#531/#538) were built ladder-aware, so they
survive unchanged.

---

## 5. System 3 — Signals (parked, boundary only)

Dave's next big project after cleanup; no code before the DAV-196 design
session. The boundary this doc draws so Systems 1–2 don't smear into it:
signals are **inputs to triggers and runs** — they never write theses, never
move levels, never propose trades. When the session happens, the trigger
spine (System 2) is what signal-driven rungs plug into; that's why System 2
sequences first.

---

## 6. The kill list — how ~1000 becomes ~5

What actually gets *deleted or collapsed* if Dave blesses this:

1. Five level/schedule stores → one (the ladder). §4 table.
2. Six write paths with six context assemblies → six paths, **one** bundle.
3. Write-time sanity gates that only exist because writers were blind →
   demoted to backstops once the bundle lands (they stay, but stop being
   the process; new ones require a missing-input justification first).
4. `useV2Prompt`-style dead columns + the deprecated GAPS/roadmap process —
   already gone; listed for completeness.
5. Review-cadence logic in three places (column, patch, needsAction) → one
   trigger kind.

What this does **not** promise: fewer PRs next week. Systems 1 and 2 are
each multi-PR builds. It promises the *next* incident gets fixed by feeding
a bundle field or a trigger kind — not by fence #21.

---

## 7. What Dave rules on (the whole ask, in order)

1. **Bless the three-system rollup** (this doc) — or redraw the boundaries.
2. **DAV-195** — the Levels spec + backfill list. Unlocks System 2's build.
3. **DAV-205** — authored size % vs. derived-at-entry. Shapes System 1.
4. Signals stays parked until you call DAV-196. Nothing else needs you.
