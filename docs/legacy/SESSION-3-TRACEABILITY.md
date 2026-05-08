# Session 3 — Signal→Thesis→Monitor Traceability (original Session 6)

**Session 3 of 4.** Wave 2, runs parallel to Session 4 (Observability). Prereqs: Wave 1 (Session 1 routing/scoring + Session 2 brief grounding) must be merged first — this session reads from the cleaned-up routing data.

## Before you start (required reading)

1. `CLAUDE.md` (full file) — data model, tool architecture, agent flow
2. `docs/AGENT_OVERHAUL_PLAN.md` — Session 6 scope in particular
3. `/Users/davebixler/.claude/projects/-Users-davebixler-hindsight/memory/project_pipeline_audit_2026_04_22.md`
4. **Also read PR #156** (`gh pr view 156 --json title,body`): it introduces a `Suggestion` model + approval workflow. Our Monitor archival will plug into that as a new suggestion kind in a later session — stay out of Suggestion code in this session.
5. Verify baseline SQL below before coding.

## Goal

Close the learning loop: make it possible to ask "which signals drove this winning trade?" and "which monitors actually produce winning signals?" Walk Position → Thesis → Signal → Monitor when a position closes, and increment monitor counters.

## Evidence the gap exists (2026-04-22 audit)

```
"AnalystSignalRoute"."status" distribution across ALL time:
  PENDING: 10,483 rows
  READ:       571 rows
  ACTED_ON:     0 rows — never written, ever
"Thesis"."sourcesUsed" — JSON populated but contains no signalId references
Monitor has no successScore / tradesSourced / winsSourced / lossesSourced / lastOutcomeAt columns
```

Right now the agent reads signals (`READ` flips), writes a thesis, places a trade, closes it, gets evaluated — and nothing in the data model connects the signal that drove the decision to the outcome that validated it.

## Files to touch

- `prisma/schema.prisma` — schema additions
- `prisma/migrations/<timestamp>_signal_outcome_trace/migration.sql` — new migration
- `lib/agent/tools/read-signals.ts` — return signal IDs agent can cite
- `lib/agent/tools/record-thesis.ts` — accept + persist `sourceSignalIds`, flip route status
- `lib/inngest/functions/trade-evaluator.ts` — walk chain on position close
- `lib/agent/system-prompt.ts` — tell agent to cite signal IDs when recording a thesis (small prompt patch in Stages 4/6 where record_thesis is called)
- Maybe `lib/intelligence/routed-signals.ts` — if Session 2 extracted it, reuse; otherwise create

## Scope — four fixes, one PR

### Fix 1: Schema additions

```prisma
model Thesis {
  // ...existing fields...
  sourceSignalIds String[] @default([])
  // ...
}

model Monitor {
  // ...existing fields...
  successScore    Float?
  tradesSourced   Int      @default(0)
  winsSourced     Int      @default(0)
  lossesSourced   Int      @default(0)
  lastOutcomeAt   DateTime?
  // ...
}
```

Migration: additive only, no backfill needed (historical theses get empty array). Zero-downtime.

### Fix 2: `read_signals` returns IDs

Currently the tool returns headline + ticker + summary. Add each signal's `id` into the rendered output so the agent has a specific ID to cite. Keep existing shape otherwise (the `ui` discriminator must not break the renderer).

Also: when the tool is called, update the returned routes' `status` from `PENDING` → `READ` and set a `seenByRunId` stamp. This last bit may already be half-wired — check before adding.

### Fix 3: `record_thesis` accepts + persists + flips status

1. Extend the Zod schema on `record-thesis.ts` with `sourceSignalIds: z.array(z.string()).default([])`. Optional-ish but prompted for.
2. On execute: persist `sourceSignalIds` onto the `Thesis` row.
3. In the same transaction, update `AnalystSignalRoute` rows where `signalId IN sourceSignalIds AND analystId = ctx.analystId` → `status = 'ACTED_ON'`. This flips the dormant status and closes issue #7.
4. System prompt patch (`lib/agent/system-prompt.ts`): in the stages where `record_thesis` is called, add one sentence: "When recording a thesis, pass the IDs of the signals that informed it as `sourceSignalIds`. This is how the system learns which monitors produced winning theses."

### Fix 4: `trade-evaluator` walks the chain

On position close (existing Inngest function): fetch the Thesis → its `sourceSignalIds` → each Signal's `monitorId`. Group by `monitorId`, then for each monitor:

- `tradesSourced += 1`
- If position outcome is win: `winsSourced += 1`
- If loss: `lossesSourced += 1`
- Recompute: `successScore = (winsSourced - lossesSourced) / tradesSourced` (range -1..+1)
- `lastOutcomeAt = now()`

One Signal can contribute to multiple Monitors only if `Signal.monitorId` is multi-valued (it's not — it's a scalar FK). So the walk is straightforward.

If `sourceSignalIds` is empty or all referenced Signals have null `monitorId`, skip silently — that's historical data.

## Verify baseline (run before coding)

```sql
-- Prove #9 gap
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'Thesis' AND column_name = 'sourceSignalIds') AS thesis_col_exists,
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_name = 'Monitor' AND column_name = 'successScore') AS monitor_col_exists;

-- Prove #7 gap
SELECT status, COUNT(*) FROM "AnalystSignalRoute" GROUP BY status;
-- Expect: no row with status = 'ACTED_ON'
```

## Verify success (after coding)

1. Run migration. `npx prisma migrate dev --name signal_outcome_trace`. `npx prisma generate`.
2. `npx tsc --noEmit` clean.
3. Start a manual run for Tech Momentum Trader (`analystId = cmmofy6t3000004l7858o1xma`) that picks at least one signal and records a thesis.
4. Query: at least one `Thesis.sourceSignalIds` should have ≥1 entry, at least one `AnalystSignalRoute.status` should be `ACTED_ON`.
5. Manually close one test position (via the close-position tool or directly via Alpaca paper account).
6. Verify trade-evaluator ran: `Monitor.tradesSourced > 0` on at least one monitor, `successScore` is non-null.

## Out of scope

- Manager agent consumer / PR #156 `MONITOR_ARCHIVE` suggestion kind — separate follow-up
- Auto-archive logic (Monitor archival based on successScore)
- `/intelligence` Monitor ROI UI table — that's Session 4's dashboard work
- Provenance chips on Thesis cards — Session 4
- Router scoring changes — Session 1 already shipped
- Brief generator changes — Session 2 already shipped
- Historical backfill of sourceSignalIds — impossible, existing theses stay empty-array

## Commit

`feat(trace): sourceSignalIds on Thesis + successScore on Monitor + ACTED_ON route status`

## Notes for Session 4 (Observability)

- The `/intelligence/health` page should render a Monitor ROI table reading from `Monitor.successScore` / `tradesSourced` / `winsSourced` / `lossesSourced` that this session ships.
- Thesis provenance chips on `/runs/[id]` (reading `sourceSignalIds`) are Session 4's job, not this one.
