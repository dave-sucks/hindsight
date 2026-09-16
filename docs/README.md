# docs — what's here

Pruned 2026-09-15: the superseded plans, one-off session handoffs and run
reviews older than August were deleted (they live in git history). **Linear,
team Davesucks, is the tracker** — issues, not markdown, hold open work.

## Start a session

| Session | File |
|---|---|
| The QB (reviews both build lanes, verifies production) | `prompts/QB_SESSION.md` |
| The Agents lane (setups, prompts, entries, sizing, selling) | `prompts/AGENTS_SESSION.md` |
| The Signals lane (earnings, filings, insider buying, movers) | `prompts/SIGNALS_SESSION.md` |
| Any other coding session | `prompts/SESSION_BOOTSTRAP.md` |
| **How the two lanes divide the work** | `plans/LANES.md` |

## Live reference — read before changing the system

- `THESIS_ARCHITECTURE.md` — the thesis lifecycle, states and gates.
- `TRIGGERS.md` — every trigger kind, what fires it, on which path.
- `plans/TRIGGER_MODEL.md` · `plans/TRIGGER_LIFECYCLE.md` · `plans/THESIS_GAME_PLAN.md` — the trigger system's shape, authority contract, and why it exists.
- `plans/STATUS_TAXONOMY.md` — the status vocabulary.
- `PRINCIPLES.md` — the three-layer rule for where a fix belongs.
- `VISION.md` — the product north star.
- `plans/PROD_DEPLOYMENT_PLAN.md` — deploys, migrations, the two-PR column drop.
- `TECH_DEBT.md` — known fragility outside current work.

## The current build

- `plans/AGENT_REBUILD.md` — the Agents lane's plan, stage by stage (§7 is the live progress report).
- `plans/TRADING_PLAYBOOK.md` — how disciplined traders work; the source for the setup catalog.
- `plans/MARKET_DATA.md` · `plans/EARNINGS_AND_MOVERS.md` · `plans/SEC_FILINGS.md` — the Signals lane's model and roadmap.
- `plans/SIGNALS_REDESIGN.md` — news, parked.
- `plans/ANALYST_LINEUP.md` — why the seats look like they do.
- `DISCOVERY_PLAYBOOK.md` — discovery query templates per analyst.

## Routines

- `prompts/RUN_REVIEW_INVARIANTS.md` — the twelve checks, run first every review.
- `prompts/REVIEW_DAILY_RUN.md` · `prompts/REVIEW_ANALYSTS.md` · `prompts/REVIEW_DISCOVERY_RUN.md` · `prompts/DISCOVERY_PREP.md` · `prompts/INGEST_THESIS.md`.
- Written output: `run-reviews/`, `analyst-quality/`, `discovery-reviews/`, `discovery-prep/`, `audits/`. Each has a `TEMPLATE.md` where one exists. Keep the recent ones; delete anything older than about a month unless it's marked a reference.

## Frozen

`plans/FIX_ROADMAP.md` is history from before Linear. Some of its links point
at plans that have since been deleted.
