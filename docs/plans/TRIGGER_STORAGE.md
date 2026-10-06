# Trigger storage: triggers in their own table, fire history in its own log

> A proposal for the plan review after the trigger cutover (`TRIGGER_TYPES.md`,
> PR 3) and the translator's removal (PR 4). Document only; nothing here is
> built. Numbers were measured on production, read-only, on 2026-10-06.

## 1. The answer

Today a trigger is one entry in a JSON list stored on its owner's row: the
thesis, the analyst or the account. The entry holds both what the rule is
(its condition, action, note, fire mode) and what it has done (when it last
fired, which filings and reports it fired on). Rules a thesis inherits keep
their fire state in a second JSON map on the thesis.

The proposal:

1. **Each trigger becomes a row** in a `Trigger` table, owned by exactly one
   thesis, analyst or account.
2. **What a trigger has done goes in an append-only `TriggerFire` log**: one row
   per fire, per stock. Cooldowns and "once per filing / per report" are
   read from the log, not stamped onto the rule.
3. **The plan's levels stay authored once, as triggers** (that's already true).
   The two cached copies are the open question; §5 recommends keeping them,
   with the reasons.

What it fixes is correctness under concurrent writes, a clean line between a
rule and its history, and one way to read fire state for every level. It
doesn't change what any trigger means, when it fires, or what anyone sees.

**Size:** about 3–5 PRs. Roughly 53 app files touch trigger lists today and
21 of them write one. The data is small (871 thesis triggers, 24 rules,
1,951 fire rows), so the migration itself takes seconds; the work is in the
code.

## 2. What is stored today (measured)

| What | Where | Production, 2026-10-06 |
|---|---|---|
| A stock's triggers | `Thesis.triggers` (JSON list) | 871 across 943 theses; 188 on the 43 live ones |
| An analyst's rules | `AgentConfig.triggers` (JSON list) | 12 across 5 analysts |
| The account's rules | `Account.triggers` (JSON list) | 12 |
| Fire state for inherited rules | `Thesis.triggerState` (JSON map, per thesis) | 39 entries on live theses |
| Fire state for a stock's own triggers | inside each trigger: `lastFiredAt`, `firedFilings`, `firedReports` | 23 of the 188 live triggers carry some |
| A fire, as a line in Activity | `ThesisUpdate` row, `type = TRIGGER_FIRED`, with `triggerId` and `priceAtTime` | 1,951 rows; 251 in the last 30 days |
| The plan's buy / target / floor | the price triggers (`canonicalLevels` in `lib/agent/triggers/price-levels.ts`) | — |
| A cached copy of those levels | `Thesis.entryPrice / targetPrice / stopLoss` | all 43 live theses match their triggers exactly |
| A second cached copy for a held stock | `Position.targetPrice / stopLoss` | written alongside the thesis copy |

A live thesis's trigger list is small: 1,346 characters at the median and
3,474 at most.

**Writes.** Once a thesis exists, every trigger change goes through one
function, `applyTriggerOps` (`lib/agent/triggers/ops.ts`). It recomputes the
cached levels from the result. The trigger check stamps fire state through
`stampLastFiredAt` (`lib/inngest/functions/trigger-evaluator.ts`).
`manage_position` moves a stop by editing the floor trigger first, then
copies the number onto the position.

## 3. What is wrong with that

### 3.1 A write can overwrite a fire (structural, no incident found)
`update_thesis` reads the thesis (`lib/agent/tools/update-thesis.ts:443`),
does its work (live quotes included), then writes the whole trigger list
back (`:1436`). There's no row lock and no version check. If the five-minute
check stamps a fire on that thesis in the gap, the tool's write replaces the
list with the copy it read, and the fire's `lastFiredAt` is gone. The next
pass then fires the trigger again despite its cooldown.

`stampLastFiredAt` re-reads the row inside a transaction. That keeps two fire
stamps from overwriting each other in most cases, but Postgres's default
isolation doesn't lock a row on read, so it doesn't close the gap with
`update_thesis`. I haven't measured whether it has happened. It's a gap the
storage allows, not a recorded failure.

### 3.2 A rule and its history are one object
Every editor has to carry fire state it doesn't own. `applyTriggerOps` has
to keep `lastFiredAt` and the fired-filing memory through an edit by id. The
agents' view strips them out (`triggerForAgent`), and a hand edit of the JSON
could wipe them. The same fact (this trigger fired on this stock) is also
kept twice: as state on the rule, and as a `ThesisUpdate` row.

### 3.3 Inherited rules keep state a different way
A stock's own trigger keeps its fire time on itself. An analyst's or the
account's rule keeps it in the stock's `triggerState` map, because one
analyst rule serves every stock under it. Each reader merges the two
(`resolveLadder` overlays the map). That's two code paths for one question:
when did this rule last fire for this stock?

### 3.4 The database can't help
A JSON list has no foreign keys, no index on a trigger id, and no
per-trigger history query beyond scanning `ThesisUpdate` by `triggerId`.
Nothing at the database level stops a malformed entry; the app's parser
repairs or drops it on every read (`parseLevelTriggers` logs these, e.g.
"EXEL: repaired 1 rung with an out-of-range cooldown").

## 4. The proposal

### 4.1 `Trigger`: one row per rule
```
Trigger
  id            text primary key        -- the id the trigger has today (kept)
  thesisId      text null  references Thesis
  agentConfigId text null  references AgentConfig
  accountId     text null  references Account     -- exactly one of the three is set
  condition     jsonb                   -- the condition shape, as today
  action        text                    -- ENTER | ADD | TRIM | EXIT | REVIEW
  rationale     text
  fireMode      text                    -- TACTICAL | DIRECT
  cooldownDays  int null
  source        text null
  writtenPrice  float null              -- a buy's price when written (crossing rule)
  writtenAt     timestamptz null
  createdAt / updatedAt
  removedAt     timestamptz null        -- removed rules stay, so old Activity lines still point somewhere
```
The condition stays one JSON value: it's the catalog's shape, and it grows
by catalog entry, not by migration. Only the rule's frame becomes columns.

### 4.2 `TriggerFire`: what a rule has done, per stock
```
TriggerFire
  id          text primary key
  triggerId   text references Trigger
  thesisId    text references Thesis   -- the stock it fired for (an analyst rule fires per stock)
  firedAt     timestamptz
  price       float null
  filingId    text null                -- once per filing
  reportDate  text null                -- once per report
  kind        text                     -- FIRED | REARMED
  index (triggerId, thesisId, firedAt desc)
```
- **Cooldown** = the latest `FIRED` for (trigger, stock), unless a later
  `REARMED` lifts it, as `rearmedAt` does today.
- **Once per filing / report** = a `FIRED` row with that filing or date exists.
- Every fire is a new row, so two writers never overwrite each other's
  history, and editing a rule never touches it. That closes §3.1 and §3.2.
- Stock-owned and inherited rules read state the same way, which closes §3.3.
- `ThesisUpdate` keeps writing the Activity line. `TriggerFire` is the
  machine's record; the Activity line is the reader's.

### 4.3 Edits
`applyTriggerOps` keeps its job and its rules: one bucket per slot, edit by
id, the stop only tightens, the plan check after all ops. It writes rows
inside one transaction instead of rewriting a list, and an edit carries the
row's `updatedAt`. A stale edit is refused and retried, never applied over a
newer one.

## 5. The plan's levels: stored once?

The levels are **authored** once already: buy, target and floor are price
triggers, and nothing types into the cached columns. Two copies are cached:
the thesis's three columns and the open position's target and stop. Both are
written only from the triggers. On 2026-10-06 all 43 live theses matched
their triggers exactly.

Dropping the caches would mean computing levels on read in about 30 files
that read them off a thesis today, plus the position screens, emails and the
chart. The gain is removing a copy that has stayed correct.
**Recommendation: keep both caches.** Make `Trigger` rows their only input,
and add the same "columns match the triggers" query to the run-review
invariants, so drift would show up the day it happens. Revisit only if that
check ever finds a mismatch.

(`entryPrice` on a held stock is what we paid, written from the fill. It
isn't derived from a trigger and stays a column either way.)

## 6. Migration

Each phase is its own PR and is safe to stop after.

1. **Tables, written alongside the lists.** Migration creates `Trigger` and
   `TriggerFire` with deny-all row-level security (every public table has
   it). Every trigger write also writes rows. A script copies today's lists,
   `triggerState` and the `TRIGGER_FIRED` rows (which carry `triggerId` and
   price) into the tables. Ids are kept, so history lines up.
2. **Read both, compare.** The trigger check and the ladder resolver read
   both and log any difference: the same idea as the checker's shadow days,
   with the same gate (three trading days, zero differences).
3. **Read the tables.** The lists stop being read. Writes still go to both,
   so the next step can be undone.
4. **Stop writing the lists**, then drop `Thesis.triggers`,
   `Thesis.triggerState`, `AgentConfig.triggers` and `Account.triggers`. The
   drop is its own PR after the code that read them is gone (a column dropped
   with code still reading it broke writes for four hours once).

## 7. Risks

- **The one write path must cover everyone.** 21 files write trigger lists
  today. Phase 1 has to find all of them; phase 2's comparison is what proves
  it did.
- **Atomic multi-row edits.** One `update_thesis` call can add, edit and
  remove. Today that's one row write; it becomes several rows in one
  transaction. A partial write would be worse than today's whole-list write.
- **The trigger check's load.** One query loads theses with their lists today.
  It becomes a join plus the inherited rules. At 188 live triggers the cost is
  nothing, but the pass's 5-minute budget and its per-trigger catch have to
  carry over.
- **Tests.** The replay harness's in-memory database (`lib/replay`) has to
  learn the new tables, or every replay test stops seeing triggers. This is
  most of the test work.
- **Cascade and overrides.** A stock's trigger overrides an inherited rule by
  slot. That logic reads three owners; it must give the same answer from rows
  as from lists. Phase 2 checks it.
- **Removed rules.** Old Activity lines carry trigger ids. Removing a rule
  sets `removedAt` instead of deleting the row, so those ids still resolve.

## 8. Size

| Part | Estimate |
|---|---|
| Schema + migration + copy script | 1 PR, small |
| One write path writing rows (ops, level rules, seeding, the fill, set-down, promote) | 1 PR, ~21 files |
| Fire state from the log (check, resolver, re-arm, filings, reports) | 1 PR, ~10 files |
| Readers moved to rows, the comparison removed | 1 PR, ~30 files |
| Drop the JSON columns | 1 PR, tiny |
| Replay harness | inside the PRs above |

Roughly 1,500–2,500 changed lines in total. No prompt or agent-facing
change.

## 9. What this doesn't change

The condition shape, the catalog, the check's decisions, fire modes,
approvals, the one-at-a-time edit contract, the agents' tools and every
sentence anyone reads. If it's done right, the only difference visible from
outside is that a fire can't be lost to a concurrent edit.
