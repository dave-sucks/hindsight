Read `docs/prompts/DISCOVERY_PREP.md` and follow the instructions there.

Short version of what you're doing (the PRE-run half of discovery — generate the prompts the operator fires by hand; the POST-run grading is `/review-discovery`):
1. Read `docs/DISCOVERY_PLAYBOOK.md` — the Grok Scout Loop (4 plays, convergence scoring, gap→play map, per-archetype filters). Assemble prompts FROM it.
2. Read `docs/discovery/scout-roster.md` — seed Chat 2 with known-good handles; prefer Play D (reuse scouts) over cold-start.
3. Read the latest `docs/analyst-quality/YYYY-MM-DD.md` "Feed to Discovery" section — that's the gap you're sourcing for. (Ask which analyst if not given.)
4. Pull the skip-list: `Thesis` WATCHING/HOLDING/PROMOTED for that analyst (don't re-source held names).
5. Produce: going-in context → the play → Grok prompts (2–4) → Perplexity prompts (2–3, date-stamped) → the Hindsight Discovery paste (triage filters + DISPATCH_CAP=5 + skip-list + LONG only).
6. You write prompts only — no DB writes, no dispatching. Print the block for the operator to copy (file to `docs/discovery-prep/` only if asked).
