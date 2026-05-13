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

## How to use this file

- Spotted a code smell that's not tied to the thesis architecture
  rework? Add it here with a "why not urgent" justification.
- Spotted something that IS tied to the thesis rework? → GAPS.md.
- Closed something? Delete it from here. GitHub PR is the record.
- Don't add items just because they exist; only add items you'd
  actually fix one day. This isn't a venting file.
