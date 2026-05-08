# Hindsight — Docs

This directory holds the live documentation. Anything historical lives in [`legacy/`](./legacy).

## The three living artifacts

| Doc | Purpose | Updated when |
|---|---|---|
| **[`/agent-workflow`](../app/(root)/agent-workflow/page.tsx)** (interactive page, driven by [`lib/agent/workflow-registry.ts`](../lib/agent/workflow-registry.ts)) | Source of truth for **what the system IS today** — every team, cron, tool, prompt, run lifecycle | Whenever any agent / cron / tool / mode changes. Bump `LAST_VERIFIED_AT` in the registry. |
| **[VISION.md](./VISION.md)** | Source of truth for **what the system SHOULD be** — the product vision, the hold-style spectrum, the five pillars, success criteria | When the product vision shifts |
| **[GAPS.md](./GAPS.md)** | The delta — known bugs, gaps, ordered remediation, with production-data baselines | Whenever a fix lands or a new gap is found |

## Where to look for what

- **"How does the system work today?"** → open [`/agent-workflow`](../app/(root)/agent-workflow/page.tsx) in the app, browse the phase cards, click into any team to see its workflow + tools + prompt source.
- **"What are we building toward?"** → [VISION.md](./VISION.md) — start with Part 2 (the hold-style spectrum) and Part 7 (success criteria).
- **"What's broken?"** → [GAPS.md](./GAPS.md) — start with the production-data snapshot, then read the P0 list.
- **"How does the V3 intelligence pipeline work in detail?"** → [INTELLIGENCE.md](./INTELLIGENCE.md) — historical design + still-current pipeline architecture. Deeper than the workflow page; complementary, not replacement.

## Conventions

- New work that produces a doc-shaped artifact: edit one of the three above, don't add a new top-level file. If it's truly novel, add a per-concept reference doc here AND link it from the relevant team in `workflow-registry.ts`.
- Session handoffs, completed plans, post-mortems → write a one-line note in [GAPS.md](./GAPS.md) "Done since" section, optionally drop the long form in `legacy/`.
- Don't write a 1000-word handoff document at the end of a session. Update the three living artifacts and leave a clean diff.

## Why the cleanup

3 weeks of refactoring left ~30 markdown files in this directory — mostly stale plans and session-handoff docs from prior workstreams. As of 2026-05-07, those have been moved to [`legacy/`](./legacy) and replaced with the three artifacts above. See `legacy/` for historical context if you need it; do not reference those docs as current-state.
