# Hindsight — Tech Debt

> **What this is:** known fragility and code smells **outside the
> thesis architecture rework**. Active work on the thesis rework lives
> in [`GAPS.md`](./GAPS.md). What shipped lives in GitHub PRs.
>
> **The distinguishing question:** *if we ignore this for 6 months,
> does the product break?* If yes → it's an active gap; goes to
> GAPS.md. If no → it's tech debt; goes here.
>
> Items here should be ≤ a dozen at any time. If the file grows past
> that, we've stopped being honest about what's actually a gap.

---

## TD-1 — Pre-existing TypeScript implicit-any errors throughout the codebase

Many call sites have `(t) =>` and `(m) =>` parameters without
annotations, which `tsc --noEmit` flags as `TS7006: Parameter
implicitly has an 'any' type`. Commit `759edac` ("fix pre-existing TS
errors") chipped at this; many remain. They're tolerated — every PR
filters errors to "errors on touched lines only" because fixing the
whole list would be a separate week of work.

**Files with the highest count:** `app/(root)/runs/page.tsx`,
`app/(root)/trades/[id]/page.tsx`,
`app/(root)/analysts/[id]/edit/page.tsx`,
`lib/agent/tools/read-signals.ts` (in branches we didn't touch).

**Why not urgent:** doesn't break runtime, just degrades TS coverage.
The pre-commit hook is configured to accept the baseline.

**Fix shape:** one PR per file, adding the type annotations. Or one
mega-PR if someone wants to bang it out in a session.

---

## TD-2 — Intelligence pipeline crons aren't Inngest-chained

The four intelligence crons (firm-market-sweep, portfolio-watchlist-
monitor, domain-monitor, signal-router) run on independent schedules
6:30 / 7:00 / 7:15 / 7:30. There's no `.after()` or `.waitFor()`
between them — if one lags, downstream fires anyway with whatever data
landed in time.

**Why not urgent:** in practice this has never bitten us. Inngest is
reliable enough that the 15-30 min gaps between crons absorb any
single-cron slowness. Worth chaining when we have a confirmed instance
of stale data flowing downstream.

**Fix shape:** ~2 hours. Each cron emits its completion event; the next
cron's trigger gates on the event instead of (or in addition to) its
cron. Note that signal-router already has an `intelligence/route-
signals` event trigger declared but no producer — that's GAPS § P1-10,
not tech debt.

---

## TD-3 — `prisma migrate dev` is broken; migration history out of sync with prod

Three orthogonal-but-compounding issues mean the standard
`prisma migrate dev` workflow no longer works against this repo's DB.
The workaround (used in PR #277) is `prisma migrate diff` →
hand-written `migration.sql` → `prisma db execute` →
`prisma migrate resolve --applied`.

1. **Duplicate migration timestamp prefix.** Two migrations share
   `20260310000000_*` (`_add_run_events_streaming` and
   `_add_run_events_messages_strategy`). `migrate dev` rebuilds the
   shadow DB by replaying migrations from scratch and dies on the
   second one with "relation already exists." Fix shape: rename one
   directory to a distinct timestamp + run `prisma migrate resolve`
   on prod's `_prisma_migrations` table to match.

2. **`_prisma_migrations` out of sync with prod.** `migrate status`
   reports 8 local migrations as "have not yet been applied"
   (including ones whose columns clearly ARE on prod, e.g.
   `20260512000000_trading_environment`) and 1 prod migration
   (`20260317100000_drop_old_trade_tables`) missing locally. Fix
   shape: for each name, decide truth (apply locally / mark applied
   / mark rolled-back) and reconcile.

3. **Schema-vs-prod drift.** `prisma migrate diff --from-config-
   datasource --to-schema` reports unrelated cleanup the schema
   "wants" against prod: drop `Artifact.sourceId`, drop
   `Monitor.legacyQueryId`/`legacySourceId`, alter
   `Monitor.updatedAt` default, and ~10 renamed FK/index names on
   `PodcastSegment*` tables. Either prod has columns no model
   references (safe to drop) or someone applied SQL without checking
   it in (need to backfill a migration). Fix shape: audit each
   delta, write one reconciliation migration, then `migrate resolve
   --applied`.

**Why not urgent:** the workaround works, every new migration just
needs ~3 extra commands. But it's a sharp edge anyone new to this
repo will cut themselves on, and every additional `migrate dev`
attempt by an unsuspecting session burns time before falling back to
the workaround.

**Fix shape:** half-day session focused on (1) → (2) → (3) in order.
(1) is mechanical; (2) needs careful per-row reasoning; (3) needs
spot-checks against code references for each dropped column.

---

## TD-4 — `tsc --noEmit` fails cold on origin/main with ~31 PROMOTED-enum errors

**Source:** 2026-05-24 — every fresh `git checkout` or `git clone` of
origin/main shows ~31 TypeScript errors on the `PROMOTED` enum added in
PR #324. All resolve with `npx prisma generate`.

**Why:** the generated Prisma client (in `lib/generated/prisma/`) isn't
checked in (correct), but the husky post-checkout hook from PR #308
only regenerates when `prisma/schema.prisma` is newer than the
generated client — and on a fresh clone there's no generated client to
compare against. So tsc reads the schema's `PROMOTED` status as known
but the generated client lacks the matching union arm.

**Symptoms:** the next session that runs `tsc --noEmit` cold without
first running `prisma generate` will see ~31 spurious errors and may
chase them as a regression. P2-21's predev hook helps on `npm run dev`
but doesn't fire for raw `tsc`.

**Why not urgent:** every existing session already has a generated
client; the trap only catches fresh clones / new contributor setups /
worktree-create flows. But it WILL bite — the discovery review session
already lost time to it once.

**Fix shape:** add `prisma generate` as a `postinstall` script in
`package.json` — fires automatically on `npm install` / `npm ci`.
Cleanest path; ~5 min. Alternative is a `pretsc` hook, but `postinstall`
covers more entry points (CI, new clones, worktree creation).

---

## How to use this file

- Spotted a code smell that's not tied to the thesis architecture
  rework? Add it here with a "why not urgent" justification.
- Spotted something that IS tied to the thesis rework? → GAPS.md.
- Closed something? Delete it from here. GitHub PR is the record.
- Don't add items just because they exist; only add items you'd
  actually fix one day. This isn't a venting file.
