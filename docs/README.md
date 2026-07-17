# Hindsight — Docs

## Evergreen (design doctrine — read first)

- [VISION.md](./VISION.md) — product north star
- [PRINCIPLES.md](./PRINCIPLES.md) — agent design rules (three-layer principle: tool gates / tool result shape / prompt)

## Live state (current system reference)

- [THESIS_ARCHITECTURE.md](./THESIS_ARCHITECTURE.md) — how the thesis system works today (state machine, producers, gates, lifecycle). **Current with the trigger ladder** (§1a living-ladder reality, verified 2026-07-17).
- [TRIGGERS.md](./TRIGGERS.md) — **canonical for trigger mechanics**: predicate catalog (incl. the `GAIN_FROM_ENTRY` / `TRAILING_FROM_HIGH` gain-protection predicates), the standing protection minimums, the cron-vs-signal firing matrix, fire modes (TACTICAL/DIRECT), cooldown, editing surfaces. Current with the ladder (#477/#490).
- [/agent-workflow](../app/(root)/agent-workflow/page.tsx) in the app — runtime registry (driven by `lib/agent/workflow-registry.ts`)

## Trackers (the deltas)

- [GAPS.md](./GAPS.md) — open P0/P1/P2 in the thesis architecture rework
- [TECH_DEBT.md](./TECH_DEBT.md) — fragility outside the rework
- [GAPS_HISTORY.md](./GAPS_HISTORY.md) — archive of closed items

## Plans (project-scoped, finite lifespan)

### The Trigger Game Plan (shipped 2026-07-12 — the conceptual spine for the ladder)

- [plans/TRIGGER_MODEL.md](./plans/TRIGGER_MODEL.md) — the trigger conceptual model (`condition·action·mode·timing`; what is/isn't a trigger) + the two verified reference grids. **Current.**
- [plans/TRIGGER_LIFECYCLE.md](./plans/TRIGGER_LIFECYCLE.md) — authority + visibility contract (who sets which level, when; what wakes an agent). **Current.**
- [plans/THESIS_GAME_PLAN.md](./plans/THESIS_GAME_PLAN.md) — why the ladder exists (conviction management: press winners / protect gains; the IONS motivating failure). **Current.**
- [plans/SIGNALS_REDESIGN.md](./plans/SIGNALS_REDESIGN.md) — the paused-signals rethink (GAPS P1-34; design-ready, not built). **Current.**

### Reference-grade (complete, kept as living reference)

- [plans/STATUS_TAXONOMY.md](./plans/STATUS_TAXONOMY.md) — the P1-24 status/direction contract (complete; THESIS_ARCHITECTURE §P1-24 summarizes it)
- [plans/ANALYST_LINEUP.md](./plans/ANALYST_LINEUP.md) — why the analyst roster looks like it does

### Open

- [plans/DISCOVERY_V2.md](./plans/DISCOVERY_V2.md) — discovery operating model + signal-source catalog
- [plans/DISCOVERY_OVERHAUL.md](./plans/DISCOVERY_OVERHAUL.md) — discovery overhaul to-do list (NOW / SOON / MEDIUM / LATER)
- [plans/PROD_DEPLOYMENT_PLAN.md](./plans/PROD_DEPLOYMENT_PLAN.md) — per-analyst paper→live promotion
- [plans/TEAM_ACCESS_PLAN.md](./plans/TEAM_ACCESS_PLAN.md) — team access rollout
- [plans/TRADE_ALERTS_PLAN.md](./plans/TRADE_ALERTS_PLAN.md) — trade alert notifications
- (Shipped/superseded plans go to [plans/legacy/](./plans/legacy) — e.g. the daily-run V2 rewrite, the scale-into-winners pair, conviction-expression, trade-as-proposal.)

## Recurring work templates

- [run-reviews/TEMPLATE.md](./run-reviews/TEMPLATE.md) + `YYYY-MM-DD.md` files — daily morning run post-mortems
- [discovery-reviews/TEMPLATE.md](./discovery-reviews/TEMPLATE.md) + `YYYY-MM-DD-TICKER.md` files — pre-run expectations + post-run comparison

## Session kickoff prompts

- [prompts/SESSION_BOOTSTRAP.md](./prompts/SESSION_BOOTSTRAP.md) — what to read before touching code
- [prompts/REVIEW_DAILY_RUN.md](./prompts/REVIEW_DAILY_RUN.md) — bootstrap prompt for a daily run review session
- [prompts/REVIEW_DISCOVERY_RUN.md](./prompts/REVIEW_DISCOVERY_RUN.md) — bootstrap prompt for a discovery run review session

## Reference

- [INTELLIGENCE.md](./INTELLIGENCE.md) — V3 intelligence pipeline architecture (Sonar, Firecrawl, signal router, monitors). **Historical** — the V3 signal-routing pipeline is parked; current thinking is [plans/SIGNALS_REDESIGN.md](./plans/SIGNALS_REDESIGN.md) + GAPS P1-34.

## Archive

- [legacy/](./legacy) — historical plans, session handoffs, closed workstream docs
