# Thesis cleanup handoff — watchlist pass

> **Audience:** a parallel session running cleanup on watchlist theses while
> the main session is busy with PR 3 (daily-run prompt rewrite + producer
> stamping + discovery cron).
>
> **Predecessor work:** the 7 open-position theses were cleaned up on
> 2026-04-29 by the main session. Same pattern applies here, scoped to
> watchlist instead of held positions. Read the cleanup commit + the
> "What we learned" section below before touching anything.

---

## What this session needs to do

For every analyst with watchlist items, walk the watchlist analyst-by-analyst
and bring each watchlist row into a clean, trigger-ready state. The goal is
that every "watchlist" the user sees in the UI corresponds to a real
`Thesis` with `status='WATCHING'`, `horizon` set, and `triggers[]` populated
— so the trigger evaluator can fire on them the same way it fires on held
positions.

After this pass + the open-position cleanup that already shipped, EVERY
ACTIVE+WATCHING thesis owned by an enabled analyst will have horizon +
triggers, and the trigger evaluator will be doing real work across the
whole book.

## Order of operations (one analyst at a time)

For each enabled `AgentConfig`, in alphabetical order:

1. **Pull the analyst's watchlist** from `AnalystWatchlistItem` where
   `status='ACTIVE'`. Show the user the list + each item's current
   `(thesisDirection, targetPrice, stopPrice, conviction, catalyst,
   reason)`.
2. **For each watchlist item, find the matching WATCHING thesis.** Query
   `Thesis` where `ticker = w.symbol`, `status = 'WATCHING'`, and
   `researchRun.agentConfigId = analyst.id`. There should be one. If
   there isn't, see "Missing thesis" below.
3. **Audit each WATCHING thesis** for the same patterns we cleaned up on
   the open-position side:
   - Empty `triggers[]` (universal, since defaults aren't backfilled here yet)
   - Null `horizon` (universal, same reason)
   - Stale `nextReviewAt` or null
   - Direction is `PASS` instead of `LONG`/`SHORT` (the same zombie pattern
     from the open-position cleanup; PASS theses with status=WATCHING are
     incoherent — PASS = "researched, not trading," WATCHING = "tracking
     for promotion to ACTIVE." If you see PASS-WATCHING, treat it as a
     bug and propose either flipping direction or marking the row
     SUPERSEDED.)
4. **Propose horizon + triggers per thesis** to the user, in a table
   format like the open-position cleanup:
   - **Horizon picker:** match the analyst's archetype + the watchlist
     item's intent. A "Tech Momentum" trader's watchlist mostly wants
     TRADE horizon (short-term momentum candidates). An "EV Catalyst"
     trader's watchlist might be a mix of CATALYST (named events) and
     TARGET (swing candidates). A "Compounder" analyst's watchlist is
     COMPOUNDER. **The watchlist item's `catalyst` field is a strong
     hint** — if it's set, lean CATALYST.
   - **Triggers:** auto-derived defaults from `defaultTriggersForHorizon`
     using the watchlist's `targetPrice` / `stopPrice` (map to thesis
     `targetPrice` / `stopLoss`). Plus thesis-specific triggers based on
     the analyst's archetype (theme, sector).
   - **`nextReviewAt`:** 1 day for CATALYST/TRADE, 7 days for TARGET, 30
     days for COMPOUNDER.
   - **`expiresAt`:** if the watchlist item has a `catalyst` field
     mentioning a date, set thesis `nextReviewAt` to a few days before;
     no `expiresAt` field on Thesis today (PR 3 will add the watchlist
     collapse migration that makes this field meaningful).
5. **Show the user the proposed state, get a single "go" per analyst,
   apply via Supabase MCP.** Don't batch across analysts — one analyst's
   ok ≠ another's. Each analyst gets its own approval gate.
6. **Write ThesisUpdate audit rows** for each touched thesis (type=`UPDATED`).
   See the open-position cleanup commit for the shape.
7. **After all analysts done,** verify with: `SELECT analyst, COUNT(*),
   COUNT(*) FILTER (WHERE jsonb_array_length(triggers) > 0),
   COUNT(*) FILTER (WHERE horizon IS NOT NULL) FROM "Thesis"
   t JOIN "ResearchRun" rr JOIN "AgentConfig" ac WHERE status='WATCHING'
   GROUP BY analyst;` — every cell in the second + third column should
   match the first.

## Missing thesis case

If a watchlist item has no matching WATCHING thesis, you have three
options (same shape as the CAPR/ON resurrection on the open-position side):

- **(a) Resurrect** — find a SUPERSEDED/INVALIDATED thesis on the same
  ticker for this analyst. If one exists, mint a fresh `WATCHING` thesis
  pointing at it via `parentThesisId`, copy `targetPrice`/`stopPrice` from
  the watchlist item, set horizon + triggers, link the old one as parent.
- **(b) Fresh thesis** — no historical thesis exists. Mint a new
  `WATCHING` thesis from the watchlist item's data alone (`targetPrice`,
  `stopPrice`, `catalyst`, `reason` → `coreBelief`).
- **(c) Skip** — watchlist item is stale or low-conviction, no thesis
  worth minting. Mark watchlist item `status='REMOVED'` with a reason.

Default to (a) when historical state exists, (b) otherwise. Always show
the user the SQL before applying.

## Operating rules (carryover from main session)

- **No prod data changes via Supabase MCP without explicit per-action
  approval.** Each analyst's batch is its own approval. Don't infer.
- **Show the SQL before applying.** Format it auditably in the chat
  before calling `execute_sql`.
- **Use HEREDOC for git commit messages.**
- **`gh auth switch --user dave-sucks` before pushing.**
- **The MCP `execute_sql` does NOT honor `BEGIN;`/`COMMIT;` across calls.**
  Each call auto-commits or rolls back independently. Run UPDATE/INSERT
  statements individually. (Main session learned this the hard way —
  first transaction silently rolled back.)
- **Each trigger needs a stable UUID** — use `gen_random_uuid()::text`
  inside `jsonb_build_object('id', gen_random_uuid()::text, ...)`. Each
  call gets a distinct UUID.
- **Each thesis is capped at 20 triggers** (per `triggersArraySchema`).
  Don't over-engineer.

## What we learned (from the 7-position cleanup)

These insights drove the design of the cleanup and apply equally to
watchlist:

1. **Pre-PR-1 morning runs minted a fresh thesis every day per ticker.**
   This produced massive SUPERSEDED chains (NIO had 14, NVDA had 13).
   The chains are fine to leave as-is — they're truthful history. Don't
   rewrite them.
2. **The agent flinched and minted PASS-ACTIVE rows on held positions.**
   We cleaned these up by marking them SUPERSEDED + minting a fresh
   ACTIVE LONG with proper horizon + triggers. Same pattern likely
   exists on watchlist (PASS-WATCHING rows that should be LONG-WATCHING).
3. **Horizon dictates trigger structure.** TRADE = tight stop + max-hold
   gate. TARGET = stop + target + earnings + monthly hygiene. CATALYST
   = stop + filing + bullish/bearish news + 30d catalyst-not-resolved
   review. COMPOUNDER = stop + 8% drop review + earnings + guidance +
   8-K + quarterly hygiene.
4. **Triggers must reflect the actual entry/target/stop on the thesis,
   not generic levels.** A `PRICE_BELOW $32.50` trigger means nothing
   if the entry is $5 — the SQL must use the ticker's actual numbers.
5. **The agent persona shapes the horizon, but not always 1:1.** "Tech
   Momentum" → TRADE for the bulk of names but might have CATALYST for
   a position that's actually a binary event play. Read the
   `coreBelief` / `reasoningSummary` to confirm.
6. **`record_thesis` now requires horizon and rejects PASS-on-held.**
   See `lib/agent/tools/record-thesis.ts`. Future runs can't recreate
   the zombie pattern. The watchlist cleanup is purely backfill.

## Reference — what the main session did for open positions

Commit message: see the cleanup PR. Key SQL shape per thesis (TARGET
horizon example):

```sql
UPDATE "Thesis" SET
  horizon='TARGET',
  "holdDuration"='SWING',
  "nextReviewAt"=(now() + interval '7 days'),
  triggers = jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid()::text, 'predicate',
      jsonb_build_object('kind','PRICE_BELOW','level',<stop>),
      'action','EXIT', 'rationale', '...'),
    -- ... 8 more triggers for TARGET ...
  ),
  "updatedAt"=now()
WHERE id='<thesis_id>';
```

Plus a ThesisUpdate audit row:

```sql
INSERT INTO "ThesisUpdate" (id, "thesisId", timestamp, type,
  "fieldChanges", summary, rationale)
VALUES (gen_random_uuid()::text, '<thesis_id>', now(), 'UPDATED',
  jsonb_build_object('horizon', jsonb_build_object('from', null, 'to',
  'TARGET'), 'triggers', jsonb_build_object('from', 0, 'to', 9)),
  'Manual cleanup: assigned TARGET horizon and 9 triggers (Watchlist).',
  'Watchlist cleanup 2026-04-XX: ...');
```

Don't reinvent. Match the shape so the timeline reads consistently.

## When you're done

- Update `docs/THESIS_ARCHITECTURE_PLAN.md` Status table with watchlist
  cleanup completion + date.
- Confirm with main session that we can move on to PR 3 watchlist-
  collapse migration (which will fold `AnalystWatchlistItem` into
  `Thesis` rows entirely — your cleanup is the data foundation for that
  migration).
- Open a brief PR documenting what was cleaned (numbers per analyst).
  No code changes — pure data.
