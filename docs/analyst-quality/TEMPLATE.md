# Analyst Quality Review — YYYY-MM-DD

**Session:** Analyst Quality & Tuning (outcome-level, cross-run, weekly).
**Prior baseline:** [YYYY-MM-DD](./YYYY-MM-DD.md) — diff against it. (First review = establish baseline, no delta.)
**Read as input:** latest `docs/run-reviews/`, latest `docs/discovery-reviews/`, `docs/plans/ANALYST_LINEUP.md`, `docs/PRINCIPLES.md` (layer assignment).

> If a same-day correction is needed after publish (a number was wrong, a label misread), add a
> blockquoted **⚠️ CORRECTION** at the top rather than silently editing — keep the audit trail.

---

## TL;DR

2–3 paragraphs. Lead with: is it early enough that outcomes are still legacy-distorted (tune on
*behavior + thesis quality*) or is the post-2026-05-27 sample big enough to tune on *outcomes*?
Then the single highest-leverage finding. Name the one analyst that needs action now and the ones
to leave alone.

---

## Scorecard

Clean = excludes `RECONCILE_DUPLICATE` / `PROMOTED` artifacts; **includes** `RECONCILED_FILL`
(real exits). Split by the **2026-05-27 overhaul** (pre/post = different strategies) and by
**paper/live**. **Hold each seat to its correct metric** (stated per row — Momentum = payoff/
expectancy, the other three = win rate).

| Analyst | Env | Metric held to | PRE-overhaul closed | POST-overhaul closed | Open now | Verdict |
|---|---|---|---|---|---|---|
| **PEAD Specialist** | LIVE | Win rate (70–80%) | | | | |
| **Catalyst Event PM** | LIVE | Win rate (70–80%) | | | | |
| **Secular Compounder** | PAPER | WR + drawdown + tenure | | | | |
| **Momentum Breakout** | PAPER | Payoff ≥2:1 / expectancy | | | | |

**Momentum payoff/expectancy:** avgWin / avgLoss → payoff ratio, expectancy/trade. Caveat the
sample size + any legacy-oversizing distortion. **Do not judge Momentum on win rate.**

**Cross-cutting data notes:** conviction-tier distribution (any STRONG theses, or does the writer
cap at HIGH?), any sourcing/sizing pattern visible across seats.

---

## Per-analyst findings + recommended tweaks

For each seat: **the finding(s)**, then **recommended lever** (lever + **layer** per PRINCIPLES.md
+ evidence + expected effect). Read the actual thesis bull/bear cases for quality — not just P&L.
State explicitly when the recommendation is **NONE / hold** (and why). One lever per analyst.

### <Analyst> — Lever: <lever or NONE>. Metric: <metric>.
**Finding:** …
- **Recommended lever — <Strategy | Prompt (L3) | Config (L2) | Discovery>:** … **Evidence:** …
  **Expected effect:** … **Pull when:** …

_(repeat per analyst)_

---

## Feed to Discovery session

Numbered, specific, per-analyst. Each item = gap → which **Play** (Scout Loop in
`DISCOVERY_PLAYBOOK.md`) → theme → filter bias. This is the input `/discovery prep` consumes.

1. **<Analyst> — <what KIND of names to source / stop sourcing>.** (e.g. "source early breakouts
   <5% from pivot, outside semis → Play C, narrative = 'this week's breakouts outside
   semiconductors'.")

---

## Flagged to eng / daily-review (NOT my lane to fix)

One line each. Infra / data-integrity / approval-mechanics / writer-prompt issues. The operator
files these to `docs/GAPS.md` or a fix session — this session does not investigate them.

- …

---

## Running trend (fill forward each review)

| Date | Momentum fills/runs (post-overhaul) | Momentum payoff | Compounder avg-win / avg-hold | Catalyst WR (post) | PEAD WR (live) | Notes |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | | | | | | |

---

## Recommended tweaks summary (operator decides; nothing applied)

| # | Analyst | Lever | Layer | Action | Pull when |
|---|---|---|---|---|---|
| | | | | | |

**No DB writes were made.** All `AgentConfig` changes are recommendations. On go-ahead, draft the
exact `UPDATE` and show it before running.

---

## Appendix — queries used (reproducible; substitute overhaul date 2026-05-27)

- Clean scorecard split by era: `Position` JOIN `AgentConfig`, `status='CLOSED'`,
  `closeReason NOT LIKE 'RECONCILE_DUPLICATE%' AND closeReason <> 'PROMOTED'`, grouped by
  `openedAt >= '2026-05-27'` and env.
- Close-reason × outcome mix (note `closeReason` stores `RECONCILED_FILL ($x.xx)` — match with
  `LIKE`, and cross-check the backing `Order` row for the true exit reason).
- Per-trade detail (entry/exit/% move/size/hold) → spot legacy oversizing.
- Approvals/execution from the **`Order`** table only (never `ThesisUpdate PROPOSAL_*`).
- Thesis conviction/composite/rationale via `Thesis` JOIN `ResearchRun` ON `researchRunId`
  JOIN `AgentConfig` ON `agentConfigId` → conversion-failure + sourcing + bull/bear-quality.
