# Hindsight — Docs

## Evergreen (design doctrine — read first)

- [VISION.md](./VISION.md) — product north star
- [PRINCIPLES.md](./PRINCIPLES.md) — agent design rules (three-layer principle: tool gates / tool result shape / prompt)

## Live state (current system reference)

- [THESIS_ARCHITECTURE.md](./THESIS_ARCHITECTURE.md) — how the thesis system works today (state machine, producers, gates, lifecycle)
- [/agent-workflow](../app/(root)/agent-workflow/page.tsx) in the app — runtime registry (driven by `lib/agent/workflow-registry.ts`)

## Trackers (the deltas)

- [GAPS.md](./GAPS.md) — open P0/P1/P2 in the thesis architecture rework
- [TECH_DEBT.md](./TECH_DEBT.md) — fragility outside the rework
- [GAPS_HISTORY.md](./GAPS_HISTORY.md) — archive of closed items

## Plans (project-scoped, finite lifespan)

- [plans/MORNING_RUN_V2_DESIGN.md](./plans/MORNING_RUN_V2_DESIGN.md) — daily-run prompt rewrite + needsAction field (all 7 fixes shipped 2026-05-13)
- [plans/DISCOVERY_V2.md](./plans/DISCOVERY_V2.md) — discovery operating model + signal-source catalog
- [plans/DISCOVERY_OVERHAUL.md](./plans/DISCOVERY_OVERHAUL.md) — discovery overhaul to-do list (NOW / SOON / MEDIUM / LATER)
- [plans/PROD_DEPLOYMENT_PLAN.md](./plans/PROD_DEPLOYMENT_PLAN.md) — per-analyst paper→live promotion
- [plans/TEAM_ACCESS_PLAN.md](./plans/TEAM_ACCESS_PLAN.md) — team access rollout
- [plans/TRADE_ALERTS_PLAN.md](./plans/TRADE_ALERTS_PLAN.md) — trade alert notifications
- (Done plans go to [legacy/](./legacy))

## Recurring work templates

- [run-reviews/TEMPLATE.md](./run-reviews/TEMPLATE.md) + `YYYY-MM-DD.md` files — daily morning run post-mortems
- [discovery-reviews/TEMPLATE.md](./discovery-reviews/TEMPLATE.md) + `YYYY-MM-DD-TICKER.md` files — pre-run expectations + post-run comparison

## Session kickoff prompts

- [prompts/SESSION_BOOTSTRAP.md](./prompts/SESSION_BOOTSTRAP.md) — what to read before touching code
- [prompts/REVIEW_DAILY_RUN.md](./prompts/REVIEW_DAILY_RUN.md) — bootstrap prompt for a daily run review session
- [prompts/REVIEW_DISCOVERY_RUN.md](./prompts/REVIEW_DISCOVERY_RUN.md) — bootstrap prompt for a discovery run review session

## Reference

- [INTELLIGENCE.md](./INTELLIGENCE.md) — V3 intelligence pipeline architecture (Sonar, Firecrawl, signal router, monitors)

## Archive

- [legacy/](./legacy) — historical plans, session handoffs, closed workstream docs
