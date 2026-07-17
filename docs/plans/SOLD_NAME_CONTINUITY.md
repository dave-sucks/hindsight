# Sold-Name Continuity — the thread breaks when we sell

> **What this is:** the design frame for a gap surfaced 2026-07-17 while reviewing
> the first post-Spine week + the first discovery session in months. **A name we
> sell loses all continuity with its past** — in *both* directions: it either
> never comes back (protective exits go terminal, no re-watch), or it comes back
> *blind* (discovery re-mints it as a brand-new thesis with zero awareness that we
> just held and sold it). These are two halves of one problem: **selling severs
> the thread between a thesis and its own history.**
>
> Companion to [`THESIS_GAME_PLAN.md`](./THESIS_GAME_PLAN.md) (this is the natural
> sequel — you built "protect the gain," this is "and keep the name's story
> intact after you do"). Proposed GAPS entries staged in [`../GAPS.md`](../GAPS.md)
> → "Proposed — pending triage". **Nothing here is built; this frames the fix.**

---

## 0. The motivating cases (2026-07-14 → 07-17, all Catalyst Event PM, LIVE)

- **ARQT** — sold 7/14 on a protective stop (+$845, green). Went `RETIRED (SOLD)`,
  terminal, off every radar. Nothing watches it for a reclaim. The thesis
  ("$34 reachable") may still be alive — we exited on *price*, not on the belief
  breaking. It is now dark.
- **VRDN, XENE** — same shape, sold 7/16 on trailing stops (+$445, +$966).
- **XENE, ~9 hours later** — a Grok-seeded discovery batch (run through
  PRINCIPAL_CHAT → THESIS_WRITER) **re-minted XENE from scratch**: fresh
  `LONG WATCHING`, entry **$67** (it was stopped out at ~$66.53 that afternoon),
  target $100, stop $55, **`parentThesisId = null`**, `sourceKind = WEB_SEARCH`.
  The minting writer's tool calls were `web_search / get_stock_data /
  record_thesis / write_thesis_research` — **it never called `get_theses`**, so
  it could not have known XENE was a position sold that same day. The old row and
  the new row have **zero connection in the database.**

One name, both failure modes on the same day: sold → went dark (ARQT/VRDN), and
sold → came back with amnesia (XENE).

## 1. Half A — protective exits don't recycle (the "did we sell the dip?" gap)

**Current behavior** (`lib/proposals/thesis-flips.ts`, `closeThesisForPosition`,
the single close chokepoint): the fork is `isProfitTakeReentry(closeReason)` at
[`thesis-flips.ts:150`](../../lib/proposals/thesis-flips.ts) —

- `closeReason === "TARGET"` → thesis flips `HOLDING → WATCHING`, keeps the
  belief, clears held-side triggers, `nextReviewAt = now`. **Recycled.** The next
  run re-arms an entry or archives it. (No new thesis is minted — the row is
  reused.)
- **Everything else** (STOP, trailing, MANUAL, free-text) → `HOLDING → RETIRED
  (SOLD)`. Terminal. Off the watchlist. Re-mintable only by Discovery.

**The asymmetry is inverted for the risk that matters.** A TARGET exit means we
sold into *strength* (low "sold the dip" risk) — and it recycles. A STOP/trailing
exit means we sold into *weakness* (**high** "sold the dip" risk) — and it goes
terminal. The case where re-evaluation is most valuable gets none.

**The Game Plan makes this worse, not better.** `TRAILING_FROM_HIGH` is designed
to bank a giveback *regardless of whether the thesis is intact*. So a large and
growing fraction of exits are now "the belief survived, we just protected the
gain" — exactly the set worth watching for a reclaim. The code comment on the
fork even names its own conservatism: *"erring toward keeping a proven winner on
the radar without over-keeping loss/damage exits."* That conflates two exits:

1. Stopped because the **thesis broke** (invalidation tripped, catalyst failed) →
   correctly terminal.
2. Stopped on **price** while the belief held (a trailing giveback; `SOLD ≠
   INVALIDATED`) → should recycle. Currently doesn't.

**Proposed fix — belief-gated recycle on protective exits.** Generalize
`isProfitTakeReentry` from "closeReason == TARGET" to "the closing agent attests
the belief survived the exit." On a STOP/trail close, the tactical agent (already
validating the exit and writing a rationale) classifies: belief broken → RETIRED;
belief intact, risk-managed on price → route to WATCHING with a **reclaim** entry
trigger (e.g. "back above the stop level and hold," or "reclaim the 20-day on
volume"). Three-layer-correct: the *agent* decides (judgment), the *tool* provides
the WATCHING-flip + retains belief (mechanism), no blunt rule clogs the watchlist
with genuinely-broken names. Safe against buy-the-dip-right-back: re-entry runs
through an ENTER trigger on a *reclaim*, never an auto-rebuy at the stop.

## 2. Half B — re-mints are blind to the sold thesis

When a sold name *does* come back (via discovery/ingest), nothing connects it to
its past. Four independent failures compound:

1. **The mint guard is blind to terminal rows.** `record_thesis`'s same-ticker
   check ([`record-thesis.ts:1382`](../../lib/agent/tools/record-thesis.ts))
   queries `status IN ('HOLDING','WATCHING','PROMOTED')` only. A `RETIRED` row is
   invisible — so the guard that would redirect to `update_thesis` or auto-chain a
   `parentThesisId` never fires on a name we just sold. It mints a fresh,
   unchained row.
2. **The minting agent never reads history.** The XENE writer child made no
   `get_theses` call. The soft prompt rule ("on re-encounter, call
   `get_theses(include_history)` and chain via `parent_thesis_id`" — the only
   thing that links a re-mint to its past) is unenforced and simply didn't happen.
3. **No parent chain → institutional memory severed.** `parentThesisId = null`.
   `get_theses(include_history)` on XENE can't walk new→old. The actual entry, the
   +20% captured, *why the stop fired* — all orphaned. The re-mint re-underwrites
   from a blank prompt as if the position never existed.
4. **Re-underwritten at the stop-out price, hours later, and re-buyable.** Entry
   $67 ≈ the $66.53 stop-out. And the new row is `WATCHING` with an ENTER trigger;
   `place_trade` only blocks on an *open* position (none — it's closed), so a fired
   ENTER would propose re-entry. Nothing gates "sold < 24h ago."

**Aggravator — wrong mode for minting.** This ran as PRINCIPAL_CHAT dispatching
THESIS_WRITER → `record_thesis`, bypassing the DISCOVERY prompt's `existingTickers`
guard entirely. And even that guard is built from non-terminal names, so it shares
the exact RETIRED blind spot as (1).

**Proposed fixes:**
- **Extend the `record_thesis` same-ticker guard to look back at recent RETIRED
  rows** (sold within N days) → auto-set `parentThesisId` + surface the prior exit
  (price, reason, realized gain) to the minting agent, instead of minting blind.
- **Require the mint/writer path to read `get_theses(include_history)` for the
  ticker before `record_thesis`** — a hard precondition, not prompt hope.
- **A "recently-sold" awareness signal into discovery/ingest** so a re-mint of a
  name sold in the last N days carries the exit context and cannot set an entry
  at/above the stop-out price without an explicit attestation.

## 3. Why they're one problem

Selling severs the thread. Half A means a sold name usually **can't** come back
(terminal, and daily/tactical can't mint — only Discovery can). Half B means when
it **does** come back, it comes back with amnesia. The unifying fix is
**continuity**: a sold thesis's history must stay reachable from whatever comes
next — whether that's a recycle-to-WATCHING (Half A) or a fresh re-mint (Half B),
the new state is *chained to and aware of* the exit it came from.

## 4. Acceptance test

Replay the week under the fix:
- ARQT sold on the trail → agent attests belief intact → returns to WATCHING with
  a "reclaim > $27.50" entry trigger, instead of going dark.
- XENE re-encountered by discovery → `record_thesis` sees the RETIRED row sold
  hours ago, chains `parentThesisId`, hands the agent the prior exit, and either
  (a) blocks the entry at/above the $66.53 stop-out pending attestation, or (b)
  routes to `update_thesis` on the recycled WATCHING row rather than minting a
  parallel one.

If a change doesn't move toward that replay, it's off-plan.

## 5. Open design questions (decide before building)

1. **Recycle vs re-mint precedence.** If Half A recycles a stopped name to
   WATCHING, Half B's guard should find that WATCHING row (not a RETIRED one) and
   redirect to `update_thesis` — so Half A may substantially shrink Half B. Build
   A first?
2. **N-day "recently-sold" window** — 7d? 14d? Tie to horizon?
3. **Attestation shape** — reuse the reject-dialog `principalDirective` channel,
   or a new structured field on `record_thesis`?
4. **Does the recycle re-arm automatically or wait for the next daily run?**
   (Today's TARGET path clears triggers and leans on the next run — leaves a gap.)
