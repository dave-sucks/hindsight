# Docs Consolidation Plan

> **Status:** Not started. Drafted 2026-05-13 at the end of a long debugging session.
>
> **Scope:** One focused session. ~60–90 minutes. No code changes, no audits, no fixes — pure doc reorg + two new doc creations + README/CLAUDE.md updates. Open one PR titled `docs: consolidate to PRINCIPLES + plans + templates structure`.
>
> **Why this exists:** five weeks into the thesis-architecture rework, `docs/` has accumulated mixed-purpose files at the top level (evergreen doctrine + live state + project plans + one-off reviews all sitting side by side). Future debugging sessions waste cycles re-deriving the design principles from a partially-implemented design doc and reverse-engineering the run-review format from a single example file. This plan straightens that out once.

---

## Current state (audit, 2026-05-13)

| Category | What's there | What's missing |
|---|---|---|
| **Evergreen — design doctrine** | `VISION.md` (product north star), `INTELLIGENCE.md` (V3 pipeline) | **`PRINCIPLES.md`** — the three-layer principle (tool gates / tool result shape / prompt) currently lives at `MORNING_RUN_V2_DESIGN.md` §48–109. Needs to be extracted into a standalone evergreen doc so it doesn't get archived when the V2 plan does. |
| **Live state reference** | `THESIS_ARCHITECTURE.md`, `/agent-workflow` page (runtime registry, source of truth for "what the system IS today") | — |
| **Trackers** | `GAPS.md`, `TECH_DEBT.md`, `GAPS_HISTORY.md` | — |
| **Project plans (finite lifespan)** | `MORNING_RUN_V2_DESIGN.md`, `WATCHLIST_COLLAPSE_PLAN.md`, `PROD_DEPLOYMENT_PLAN.md`, `TEAM_ACCESS_PLAN.md`, `TRADE_ALERTS_PLAN.md`, this file | A `plans/` subfolder. These currently float at top level mixed with the evergreens. |
| **Run review templates** | `run-reviews/2026-05-12.md` (single example, no template) | `run-reviews/TEMPLATE.md` |
| **Discovery review templates** | `DISCOVERY_EXPECTATIONS_INTC.md` (single example floating at top level) | A `discovery-reviews/` folder + `TEMPLATE.md` |
| **Session bootstrap prompts** | None | A `prompts/` folder with canonical "kick off a daily run review" / "kick off a discovery run review" / "review this branch's code" texts so each chat doesn't reinvent them |

---

## The 8-step plan

Execute in order. Each step is a single commit if you want fine-grained history, or batch them into one commit — your call.

### 1. Create `docs/PRINCIPLES.md`

Copy `MORNING_RUN_V2_DESIGN.md` lines 48–109 verbatim into a new file `docs/PRINCIPLES.md`. That block contains:
- The three-layer diagram (tool gates / tool result shape / prompt)
- The mapping table of every rule type to its destination layer
- The "How Cursor handles 'you must read a file before editing it'" parallel
- The Hindsight-specific mapping

Strip the V2-specific framing — the new doc should read as general agent design doctrine, not a chapter inside a V2 plan. Add a top section "How to use this when fixing a bug":

> Before adding prompt text to fix an agent failure, check which layer the fix belongs in:
> - "The agent did the wrong thing even though the prompt said not to" → Layer 1 (tool gate). Refuse the bad call.
> - "The agent didn't know what to do" → Layer 2 (result shape). Pre-digest the state.
> - "The agent needed judgment we couldn't pre-compute" → Layer 3 (prompt). Identity + goals only, never procedures.
>
> Most past failures were fixed by adding Layer 3 prompt text when the right answer was Layer 1 or Layer 2. The maze prompt was the cost.

### 2. Update `MORNING_RUN_V2_DESIGN.md`

Replace lines 48–109 (the "Where logic lives" section) with:

> → See [PRINCIPLES.md](./PRINCIPLES.md) § three-layer principle.

Also update the status header. Today it says *"Status: Draft, awaiting review. Not implemented."* That's wrong. Audit which fixes actually landed:

- Fix #0 (per-thesis triggers authoritative) — shipped per `GAPS.md` "Done since" P0-5b/c
- Fix #1 (80-line prompt rewrite) — `buildDailyRunSystemPromptV2` exists at `lib/agent/system-prompt.ts:706` and is called by `morning-research.ts:128` when `useV2Prompt` is true. All 6 analysts have the flag set. **Shipped.**
- Fix #2 (`needsAction` on `get_theses`) — shipped, see `lib/agent/needs-action.ts`
- Fix #3 (`read_signals` firehose fallback) — verify status
- Fix #4 (autonomy in user prompt) — verify status
- Fix #5 (Daily Run tool allowlist) — shipped, see `lib/agent/modes.ts:91`
- Fix #6 (read_signals bucket scope) — verify status

Rewrite the status header with per-fix shipped/not status and a "last verified" date.

### 3. Create `docs/plans/` and move project plans into it

```
git mv docs/MORNING_RUN_V2_DESIGN.md docs/plans/
git mv docs/PROD_DEPLOYMENT_PLAN.md docs/plans/
git mv docs/TEAM_ACCESS_PLAN.md docs/plans/
git mv docs/TRADE_ALERTS_PLAN.md docs/plans/
git mv docs/DOCS_CONSOLIDATION_PLAN.md docs/plans/   # this file
git mv docs/WATCHLIST_COLLAPSE_PLAN.md docs/legacy/  # done 2026-05-13
```

Fix any inbound links (CLAUDE.md, README.md, GAPS.md) that referenced the old paths. Use `grep -r 'WATCHLIST_COLLAPSE_PLAN\|MORNING_RUN_V2_DESIGN\|PROD_DEPLOYMENT_PLAN\|TEAM_ACCESS_PLAN\|TRADE_ALERTS_PLAN' .` to find them.

### 4. Create `docs/run-reviews/TEMPLATE.md`

Extract the structure from `2026-05-12.md`. Sections, in order:

1. TL;DR (1 paragraph)
2. Daily Metrics table with prior-column for diff
3. V2 Behavior (per-analyst per-failure walkthrough)
4. Failures table (run / mode / prompt version / category / root cause)
5. New Findings (anything not in prior reports)
6. Trends vs Prior Report
7. Open Questions
8. Raw Queries (the SQL used to derive the metrics — paste verbatim)

Each section gets a one-sentence "what goes here" hint. The template should be directly copy-pasteable to start a new daily review.

### 5. Create `docs/discovery-reviews/` with the same template pattern

```
mkdir docs/discovery-reviews
git mv docs/DISCOVERY_EXPECTATIONS_INTC.md docs/discovery-reviews/2026-05-13-INTC.md
```

Then write `docs/discovery-reviews/TEMPLATE.md` matching the structure of the INTC review. The naming convention `YYYY-MM-DD-TICKER.md` or `YYYY-MM-DD-ANALYST.md` (pick one, document it in the template).

### 6. Create `docs/prompts/` with the three canonical session-kickoff prompts

```
mkdir docs/prompts
```

Three files:

**`docs/prompts/SESSION_BOOTSTRAP.md`** — what any code-touching session should read first. One sentence: "Read these in order: `CLAUDE.md`, `docs/PRINCIPLES.md`, `docs/THESIS_ARCHITECTURE.md`, `docs/GAPS.md` (P0 list only)."

**`docs/prompts/REVIEW_DAILY_RUN.md`** — the bootstrap prompt to give a fresh session for the daily run review work. Includes:
- "Read `docs/run-reviews/TEMPLATE.md` for the report shape."
- "Read the most recent `docs/run-reviews/YYYY-MM-DD.md` as the prior baseline."
- "Read `docs/GAPS.md` for known open issues to flag if they recur."
- The canonical SQL block for pulling today's runs from Supabase.
- "Write to `docs/run-reviews/<today>.md`. Open a PR titled `docs(run-review): YYYY-MM-DD`."

**`docs/prompts/REVIEW_DISCOVERY_RUN.md`** — same shape, for discovery reviews. Points to `docs/discovery-reviews/TEMPLATE.md` and the most-recent example.

### 7. Rewrite `docs/README.md`

Replace the current "three living artifacts" framing with the new structure:

```markdown
# Hindsight — Docs

## Evergreen (design doctrine — read first)
- VISION.md — product north star
- PRINCIPLES.md — agent design rules (three-layer principle)

## Live state (current system reference)
- THESIS_ARCHITECTURE.md — how the thesis system works today
- /agent-workflow page in the app — runtime registry of crons + tools + prompts

## Trackers (the deltas)
- GAPS.md — open P0/P1/P2 items in the thesis architecture rework
- TECH_DEBT.md — fragility outside the rework
- GAPS_HISTORY.md — archive of closed items

## Plans (project-scoped, finite lifespan)
- plans/MORNING_RUN_V2_DESIGN.md
- plans/PROD_DEPLOYMENT_PLAN.md
- plans/TEAM_ACCESS_PLAN.md
- plans/TRADE_ALERTS_PLAN.md
- plans/DOCS_CONSOLIDATION_PLAN.md
- (Done plans go to legacy/)

## Recurring work templates
- run-reviews/TEMPLATE.md + run-reviews/YYYY-MM-DD.md
- discovery-reviews/TEMPLATE.md + discovery-reviews/YYYY-MM-DD-TICKER.md

## Session kickoff prompts
- prompts/SESSION_BOOTSTRAP.md
- prompts/REVIEW_DAILY_RUN.md
- prompts/REVIEW_DISCOVERY_RUN.md

## Reference
- INTELLIGENCE.md — V3 intelligence pipeline architecture

## Archive
- legacy/ — historical plans and session handoffs
```

### 8. Update `CLAUDE.md` "Where to put what" table

The current table in CLAUDE.md must match the new structure or sessions will keep getting conflicting guidance. Edit the table near the top of CLAUDE.md to:

| You want to... | File |
|---|---|
| Understand the agent design rules (three-layer principle) | `docs/PRINCIPLES.md` |
| Read / update the product north star | `docs/VISION.md` |
| Read the live thesis-system reference | `docs/THESIS_ARCHITECTURE.md` |
| Add an open item on the thesis architecture rework | `docs/GAPS.md` |
| Note a code smell outside the rework | `docs/TECH_DEBT.md` |
| Spec a big multi-PR plan | `docs/plans/<NAME>.md` |
| Write a daily run review | `docs/run-reviews/<YYYY-MM-DD>.md` (template in same folder) |
| Write a discovery run review | `docs/discovery-reviews/<YYYY-MM-DD>-<TICKER>.md` |
| Kick off a code session | `docs/prompts/SESSION_BOOTSTRAP.md` |
| Kick off a run-review session | `docs/prompts/REVIEW_DAILY_RUN.md` |
| Reference what shipped in a PR | GitHub PRs |
| Onboard a fresh session to the codebase | `CLAUDE.md` |

---

## Kickoff prompt for this session

When you open the session that executes this plan, give it:

> Execute the 8-step plan in `docs/DOCS_CONSOLIDATION_PLAN.md`. No code changes, no audits, no debugging. Pure doc reorg + two new doc creations (PRINCIPLES, templates) + README/CLAUDE.md updates. Open one PR titled `docs: consolidate to PRINCIPLES + plans + templates structure`.

That's it. The plan is self-contained — the session has everything it needs.

---

## Done criteria

- `docs/PRINCIPLES.md` exists and contains the three-layer principle as evergreen doctrine, not V2-specific framing.
- `docs/plans/` exists and contains the 5 active plans. `WATCHLIST_COLLAPSE_PLAN.md` is in `legacy/`.
- `docs/run-reviews/TEMPLATE.md` and `docs/discovery-reviews/TEMPLATE.md` both exist and are directly copy-pasteable.
- `docs/prompts/` exists with `SESSION_BOOTSTRAP.md`, `REVIEW_DAILY_RUN.md`, `REVIEW_DISCOVERY_RUN.md`.
- `docs/README.md` reflects the new structure.
- `CLAUDE.md` "Where to put what" table matches.
- All inbound links to moved files are fixed (no `[link](./MORNING_RUN_V2_DESIGN.md)` pointing to a non-existent path).
- One PR opened, no code touched.

---

## After this plan ships

The "Where do I put the V2 design doctrine?" problem goes away. Future bugs get filed in `GAPS.md`. Future plans get drafted in `docs/plans/`. Future run reviews get written from a template. Future sessions get kicked off from a one-line prompt. The chat-history-as-source-of-truth problem (this very session) doesn't repeat.
