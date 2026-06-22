Read `docs/prompts/REVIEW_ANALYSTS.md` and follow the instructions there.

Short version of what you're doing (the Strategist lane — weekly, outcome-level; NOT the daily run review):
1. Read `docs/analyst-quality/TEMPLATE.md` for the report shape
2. Read the most recent `docs/analyst-quality/YYYY-MM-DD.md` as the prior baseline
3. Read `docs/plans/ANALYST_LINEUP.md` for the roster + each seat's success metric (confirm against the live `AgentConfig` table — table wins)
4. STAY IN YOUR LANE: outcomes/strategy only. Infra/data bugs → one line in "Flagged to eng" and STOP. Source of truth = the `Order` table, never `ThesisUpdate PROPOSAL_*`. Split pre/post 2026-05-27 + paper/live.
5. Hold each seat to its metric (Momentum = payoff/expectancy, NOT win rate; the other three = win rate)
6. Recommend 1–3 tweaks (lever + layer + evidence + effect), one lever per analyst — recommend only, no DB writes
7. Write `docs/analyst-quality/<today>.md` with a "Feed to Discovery" section for the `/discovery` handoff
8. Open one PR titled `docs(analyst-quality): YYYY-MM-DD` — no code changes
