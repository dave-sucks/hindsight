# Hindsight Lifecycle Audit — 2026-05-11

Snapshot of where the V2 thesis lifecycle actually stands on production data,
the morning after PRs #248–#251 merged. Captured because the user has spent
~50 sessions post-refactor with no measurable progress and needs a fixed
reference point to work from instead of relitigating each session.

## The chain that was traced

Single longest real A→D chain in production:

1. **Stage A — Discovery** mint, 2026-05-07 04:04
   Run `cmouyogse001d04l2p15jhaqs` (Intraday Momentum Scalper, COMPLETE).
   Minted Thesis `cmouyp07t001e04l24xbikzxu` (MU, WATCHING) and
   `cmouyp4cw001h04l2gpivmb80` (MRVL, WATCHING).

2. **Stage B — Daily review** , 2026-05-07 12:09
   Run `cmovg0i0700e904l89pcos0zc` (MORNING_PLAN, COMPLETE, decision WATCH).
   `update_thesis` on MU: target 750→705, stop 600→655, confidence 80→75.
   Also minted AMD + SMCI theses in the same daily run.

3. **Stage B (2) — Daily review + place_trade**, 2026-05-11 12:05
   Run `cmp15o3eb001j04ji175dzdds`. `place_trade` opened Position
   `cmp15ov7z001k04jipm359ywp` on MU. Status persisted as COMPLETE while
   also carrying `parameters.error` = OpenAI quota exhaustion string.
   No RunMessage row written.

4. **Stage C — Trigger fired**, 2026-05-11 14:01
   MU ENTER trigger (PRICE_ABOVE $750) fired. Tactical run spawned.
   Fired on a thesis whose position was already open (1h55m earlier).

5. **Stage D — Tactical**, 2026-05-11 14:02
   Run `cmp19tjxn000g04ibp9a74wh2`, FAILED in 30s. Zero RunEvent rows,
   zero RunMessage rows, `parameters.error = null` despite PR #250.

6. **Stage E — Close**: not reached. Position still OPEN.

## Defects to fix, in pipeline order

These are the concrete problems. Each one is a candidate flow-by-flow
target. Some block downstream stages; some are quality issues that the
user explicitly deprioritized for now ("ignoring the quality of discovery
which has tons of issues").

### Stage A — Discovery mint

- `read_signals` returned zero discovery candidates and the agent still
  minted theses from training-data prior (MU, MRVL out of thin air). No
  enforced fence between "what discovery should mint" and "what GPT-4o
  remembers about tech tickers."
- `coreBelief` is **NULL** on both sampled minted theses. The create
  path is not enforcing it.
- MRVL ENTER trigger predicate ($195) equals targetPrice ($195).
  Unactionable on its face.
- MU ENTER trigger predicate ($750) is above targetPrice ($705) and
  above the level the daily run later moved target to. Same defect.
- Numeric levels detached from reality on every minted thesis.
- Discovery 2026-05-10 cohort regressed: 6 FAILED / 7 attempted; the
  one COMPLETE minted zero theses.
- Discovery output is effectively write-only: 6 minted in past 30 days,
  1 ever produced a trade, 0 invalidated.

### Stage B — Daily review

- 05-07 12:09 daily run updated MU target/stop but did not fix the
  broken ENTER trigger that was still set above target.
- 05-11 12:05 daily run: status = COMPLETE simultaneously with
  `parameters.error` populated. Schema oddity that masks failures.
- 05-11 12:05 daily run has zero RunMessage rows. Replay broken.
- `place_trade` did not promote the MU thesis from WATCHING → ACTIVE.
  Thesis status never reflects the open position. Triggers stay armed.

### Stage C — Trigger evaluator

- ENTER trigger fires on a thesis that already has an OPEN position
  (because Stage B did not promote thesis status).
- Double-firing on the same predicate within seconds:
  TSM ENTER spawned tactical runs at 13:02:49 + 13:03:15;
  AVGO ENTER at 13:02:03 + 13:02:09;
  AMD ENTER+EXIT spawned 3 seconds apart.

### Stage D — Tactical

- 21 FAILED / 116 total tactical runs in past 14 days (18%). Spot-check
  of 4 different failures (ICLN, AMD, TSM, AVGO) — **all** have
  `parameters.error = null` and zero RunEvent rows. PR #250 is not
  catching this failure path.
- Tactical EXIT path writes inconsistent TradeDecision rows. SMCI EXIT
  wrote a TradeDecision (decision=EXIT); ATRA, CAPR, FSLY EXITs all
  wrote a CLOSED ThesisUpdate with **no** TradeDecision row. Means the
  thesis says "closed" while there's no trade record corresponding.

### Stage E — Position close

- Past-14d close composition: 11 closed by `price_monitor` cron,
  3 closed by `agent`. The agent-driven close path is the minority —
  the cheap price-driven cron is doing most of the actual closing,
  bypassing the agent decision loop V2 was built around.
- No discovery-minted thesis has reached a clean close yet.

### Cross-cutting

- CAPR thesisId is a UUID (`02e05a5c-…`), not a cuid. Every other
  thesisId is a cuid. Some code path mints with a different ID scheme.
- "Actions collapsed card" the user expects to see above the run
  summary aggregating "Buying 2 stocks, selling 1, editing watchlist"
  does not exist in code. `components/agent/renderers/` has 7 renderers
  and none of them aggregate run actions.
- `record_thesis` called 4 times in a run while only 2 CREATED rows
  exist for that run — calls are succeeding without writing rows
  (validation rejecting silently?).

## How to use this doc

Future sessions should read this top to bottom before touching anything
in the V2 pipeline. The flow-by-flow plan: take Stage A first, fix the
concrete defects listed, delete the runs + theses that prove it works,
re-run, only move to Stage B once Stage A is producing the right
artifacts. Do not "improve" downstream stages while upstream stages
are still producing garbage.

Cross-reference with `docs/THESIS_ARCHITECTURE.md` (the design intent)
and `docs/MORNING_RUN_V2_DESIGN.md` (the target architecture). This
doc is the gap between those and reality on 2026-05-11.
