# OpenAI Cost Reduction — living plan

**Status:** 🔴 Audit complete, no fixes shipped yet
**Owner:** Dave
**Last updated:** 2026-06-15
**Observed burn:** ~$15/day OpenAI refill (5 analysts). Modeled steady state ~$11–13/day; storm days (now fixed) hit $18–28.
**Planning assumption:** ALL analysts go LIVE eventually, and the roster grows. Optimize for that, not the current paper/live split. The paper→cheap-model move is a *temporary bridge*, not the strategy.

## How to use this doc
This is the single source of truth for "why is OpenAI expensive and what are we doing about it."
Each lever in the **Fix backlog** has a status marker — update it as work ships:
🔴 TODO · 🟡 IN PROGRESS · 🟢 DONE · ⚪ WON'T DO. Add a dated line to the **Changelog**
at the bottom whenever a lever moves. When a lever ships, keep the row (don't delete) and
record the measured before/after $ if you have it from the OpenAI dashboard.

---

## TL;DR — the one insight
**~85% of premium-model spend produces no action.** Morning runs take a trade **16% of the time** (8/50); tacticals **12%** (15/124). Today the rest is "reviewed, no change" — burned at GPT-5.5 / $30-per-M-output rates.

The scalable fix is **not** "cheap model for paper money" (that evaporates when everything goes live). It's two durable principles:
1. **Don't invoke the premium model when there's no decision to make.** Gate it behind a cheap triage. Applies to BOTH morning and tactical.
2. **Fix the triggers that over-fire.** EXIT converts 3%, REVIEW 4–8%, PRICE_BELOW→ENTER 0%. That's a *product* problem — reduce volume at the source, don't just make each no-op cheaper.

**Why it matters at scale:** the base load is linear in analyst count. 5 analysts ≈ $12–15/day. Unchanged, **10 live ≈ $24–28/day (~$750/mo), 20 live ≈ $45–55/day (~$1.5k/mo)** — a mostly-no-op premium workload multiplied by N. Triage + trigger-fix make it *sublinear*. That's the whole game.

The storms (35 tacticals on 06-04) were two now-patched bugs — **don't re-investigate them** (see "Already fixed").

---

## Scalable levers (assume ALL analysts go live + roster grows)
Ranked by impact-at-scale × durability. **M** = model/infra issue · **P** = product/architecture issue.

| Rank | Lever | Type | What it does | Contribution |
|---|---|---|---|---|
| **1** | **Triage gate before the premium model** | **P** (+cheap-model component) | A cheap pre-pass (GPT-4o-mini or deterministic checks) answers "is there a real decision here?" Only escalate to GPT-5.5 when yes. Applies to tacticals (the `trigger.action` already signals it) AND mornings (cheap book-review → deep-dive only the 1–2 names with new info, instead of 65 GPT-5.5 steps re-confirming unchanged theses). | **The curve-bender.** Cuts premium *invocations* 60–80%. The only lever that makes cost sublinear in analyst count. |
| **2** | **Fix over-firing triggers** | **P** | Reduce no-op volume at the source: EXIT (3% convert) → mechanical or wider levels; REVIEW (4–8%) → fold into the morning run, don't spawn a dedicated tactical; PRICE_BELOW→ENTER (0/8) → likely misconfigured, audit. | Removes ~60% of tactical *volume* (not just unit cost). Compounds with roster growth. |
| **3** | **Mechanical stops/targets off the LLM** | **P** | A hard stop or take-profit is a price comparison, not a research task. Execute deterministically in `trade-exit.ts`; reserve the agent for judgment (is the breakout real? has the thesis broken?). | Eliminates the EXIT bucket's premium runs entirely (30 runs → 0 LLM in the sample). |
| **4** | **Input efficiency / prompt caching** | **M** | ~30–40k input tokens/run (system prompt + 24-tool catalog + thesis library). Make the prefix cache-stable (same bytes across runs → billed at 10%) and trim the dynamic context serializer. Scales linearly with N×runs. | "Free" savings, no behavior change. Input is the smaller half today (output dominates on GPT-5.5) but grows linearly. ~10–20% of input cost. |
| **5** | **Decision-tier model routing** | **M** | The *durable* version of paper→cheap: route by decision type, not account type. Routine book-review/REVIEW → GPT-4o; novel high-stakes judgment + live entries → GPT-5.5. Survives all-prod. | Right-sizes the per-invocation cost that survives the triage gate. |
| **6** | **Briefing diet** | **P** | Briefing (GPT-4o) fires after *every* run incl. no-op tacticals. Move to 1×/day per analyst (or daily-run-only). | Small now, linear in run count → matters at scale. |
| **7** | **Cross-analyst dedup** (design-for, build later) | **P** | At N=5 there's zero ticker overlap, so no win today. At 20+ analysts in similar sectors, one market move fires N tacticals on the same name. A shared per-ticker evaluation that fans out cheaply prevents super-linear blowup. | $0 today; prevents the worst scaling failure mode. Design the trigger path so this is addable. |

**Immediate bridge (do now for relief, superseded by #1/#5):** the paper analysts (Momentum Breakout, Secular Compounder) → GPT-4o/4o-mini. ~$3–4/day today, but it's a stopgap — when they go live, lever #1 + #5 are what keep them affordable.

---

## Why 4 runs costs ~$7/day, and the cheaper-model question
"4 morning runs" is really **~56 model round-trips**: each run is an agentic loop of ~14 tool-call steps, and (a) GPT-5.5 bills its implicit reasoning as **output at $30/M**, (b) every step re-sends the growing transcript. So the cost is real, not a leak — but the model tier is a free 50% lever.

### Pricing (per 1M tokens, looked up 2026-06-15)
| Model | Provider | Input | Output | vs GPT-5.5 | Note |
|---|---|---|---|---|---|
| **GPT-5.5** (current) | OpenAI | $5 | $30 | — | what every run uses now |
| **GPT-5.4** | OpenAI | $2.50 | $15 | **~½ price** | prior frontier model; near-5.5 quality |
| GPT-5.4 Mini | OpenAI | $0.75 | $4.50 | ~85% less | for cheap lanes |
| Claude Opus 4.8 | Anthropic | $5 | $25 | output −17% | |
| **Claude Sonnet 4.6** | Anthropic | $3 | $15 | in −40% / out −50% | excellent, but see tier caveat |
| Claude Haiku 4.5 | Anthropic | $1 | $5 | ~83% less | cheap lane |
| GPT-4o | OpenAI | $2.50 | $10 | older gen | |

### Recommendation
- **Morning + discovery + ENTER-tacticals → GPT-5.4.** Drop-in (same provider, SDK, and context behavior), **~half the cost**, negligible quality loss for daily research. Morning ~$7 → ~$3.50/day. This is the highest-leverage, lowest-friction model change — and it survives all-prod (it's a quality model, not a paper-only downgrade).
- **Cheap lanes (REVIEW/EXIT quick-checks, briefing, trade-evaluator) → GPT-5.4 Mini or Haiku 4.5.**
- **Claude Sonnet 4.6** is cheaper-still on output and a strong model — `modes.ts` already supports `provider:"anthropic"` (principal-chat uses it), so swapping research-run is a ~1-line change. **Caveat:** the CLAUDE.md "30k context limit crashes the run" note is almost certainly an Anthropic **rate-limit tier** on the account (Claude models are 200K–1M context), not a model limit. Raisable via a tier bump, but it's friction + a migration. GPT-5.4 sidesteps it entirely.
- **Two "free" structural levers, specific to a small run count:**
  - **Prompt caching** — the ~20K-token stable prefix (system prompt + tool catalog) should bill at 10% on every step after the first. Verify it's actually caching (a `Date.now()`/timestamp interleaved into the system prompt silently breaks it). Big input-side win across ~14 steps × N runs.
  - **Batch API (50% off)** — async, up to 24h, so **NOT** for morning/tactical (they trade at the open). Fine for trade-evaluator / accuracy-scorer / any non-time-sensitive job.

---

## Triage design — your proposal, validated + refined
Your instinct ("REVIEW triggers flip a status, the morning run handles them, no spawned session") is **correct and is the quickest win** — REVIEW is ~40% of tactical volume at ~8% conversion, so redirecting it removes ~40% of tactical runs outright.

**Your explicit question — gate on action type or predicate type?** → **Action type.** The predicate (PRICE_ABOVE, TIME_ELAPSED, SIGNAL_TYPE) tells you *what happened*; the action (ENTER/EXIT/REVIEW) tells you *what you intend to do*, and intent is what decides whether a real-time expensive session is justified. Three lanes:

| Action | Lane | Model | Why |
|---|---|---|---|
| **ENTER** | Spawn tactical (real-time) | GPT-5.4/5.5 | Breakout window closes; 28% convert — time-sensitive, worth it |
| **REVIEW** | **Write `TRIGGER_FIRED` audit row at fire-time, no spawn** → daily run surfaces it via `needsAction=TRIGGER_FIRED` | (none — folded into the daily run) | Not time-sensitive by definition ("re-evaluate, don't auto-act"). **Your idea.** |
| **EXIT** | Mechanical close if hard stop; cheap quick-check if judgment exit | none / Mini | Risk management — must be fast |

**One correction to the proposal:** don't batch **EXIT** to the next morning. A blown stop on a live position can't wait overnight — that widens losses. REVIEW → tomorrow is fine; EXIT must act now (ideally mechanically, no LLM — a price ≤ stop comparison in `trade-exit.ts`).

**One nuance:** let **urgency escalate** a REVIEW. A SIGNAL_TYPE trigger carrying `urgency: BREAKING` (a real 8-K / earnings surprise on a held name) should still spawn real-time even though it's nominally a "review" — gate on `action` *and* `urgency`, so "news just broke" stays fast while "it's been 5 days, look again" batches.

**The mechanism (verified against the code).** The daily run is **`needsAction`-gated**: it walks only theses where `get_theses` annotates `needsAction != null` and *explicitly skips the rest* ("yesterday's thesis stands" — `system-prompt.ts`). One of those annotation kinds is **`TRIGGER_FIRED`** — "an unresolved `TRIGGER_FIRED` ThesisUpdate row with no resolving follow-up." Today that row is written by **`tactical-run.ts` on spawn**, *not* by the evaluator. So the load-bearing fix: when we suppress a REVIEW tactical, **the evaluator writes the `TRIGGER_FIRED` row itself** (via `writeThesisUpdate`). The daily run then sees `needsAction=TRIGGER_FIRED`, reviews it, and can buy/sell/stop-watch/mark-reviewed — exactly as before, minus the GPT-5 tactical. ⚠️ Without this write, a *transient* REVIEW (matched intraday, no longer matching by morning) would be `needsAction=null` and **silently skipped**. (An earlier draft proposed stamping `nextReviewAt` — rejected: it's a weaker signal that doesn't carry the trigger context and wouldn't reliably flag the thesis.)

---

## Ground truth — verify against the real bill
We could not pull exact $ — the project `OPENAI_API_KEY` lacks the `api.usage.read` scope (403 on `/v1/organization/costs`). All $ figures below are **modeled**, not billed. To get ground truth:
- **Dashboard:** platform.openai.com → Usage → range 2026-06-01→today → group by **model** + **day** → Export CSV.
- **API:** create an Admin key (Settings → Organization → Admin keys), then `GET /v1/organization/usage/completions?...&group_by[]=model` + `/v1/organization/costs`.
- **Three checks:** (a) GPT-5.5 *output* tokens should be 50–65% of its cost (reasoning bills as output); (b) 06-04 ≈ 2× a normal day (storm fingerprint); (c) GPT-4o ≈ briefing-count × ~$0.03.

**Pricing used (look up current):** GPT-5.5 $5/M in · $0.50/M cached · **$30/M out**. GPT-4o ~$2.50/$10. GPT-4o-mini ~$0.15/$0.60. GPT-5.5 output is the expensive part because implicit reasoning + tool-call JSON all bill as output.

---

## Ranked cost drivers (modeled)
| # | Driver | Model | Volume (14d) | Est. $/day | Files |
|---|--------|-------|-------------|-----------|-------|
| 1 | Morning runs (4 analysts, 8 AM cron) | GPT-5.5 | 42 runs | **$6–8** | `lib/inngest/functions/morning-research.ts`, `lib/agent/modes.ts` |
| 2 | Tactical runs (event-driven) | GPT-5.5 | ~8 distinct/day, 12% convert | **$4–5** | `lib/inngest/functions/tactical-run.ts`, `lib/inngest/functions/trigger-evaluator.ts` |
| 3 | Briefing agent — after EVERY run | GPT-4o | 1:1 with runs | $0.30–0.45 | `lib/agent/update-analyst-briefing.ts:481` |
| 4 | EV Catalyst zombie tacticals (disabled analyst still fires) | GPT-5.5 | 7 in 14d | $0.25–0.35 | `trigger-evaluator.ts:398`, `tactical-run.ts:122` |
| 5 | Sunday discovery cron | GPT-5.5 ×45 steps | ran 05-31; skipped 06-07 | ~$5–8 per Sunday it fires | `lib/inngest/functions/discovery-run.ts` |
| 6 | Email signal extractor | GPT-4o-mini | ~11 emails/day | <$0.03 | `lib/intelligence/email-signal-extractor.ts:78` |
| 7 | Trade evaluator / accuracy scorer | GPT-4o (capped) | a few/wk | <$0.02 | `trade-evaluator.ts:98`, `accuracy-scorer.ts:53` |

**Not on the OpenAI bill** (separate vendors): THESIS_WRITER + PRINCIPAL_CHAT = **Claude/Anthropic**; web_search/intelligence = **Perplexity Sonar** (silent since 05-31, pause holding).

---

## Fix backlog — concrete tasks (immediate $, current 5-analyst split)
This is the near-term task list — maps to the scalable levers above. Ranked by $/day × safety for *today's* roster. As analysts go live, weight shifts from the paper-bridge (row 1) toward the triage/trigger work (rows 2–3, 7).

| # | Lever | Scalable lever | Est. $/day | Risk | Status | Where |
|---|-------|----------------|-----------|------|--------|-------|
| 1 | **[BRIDGE] Paper analysts off GPT-5.5.** Momentum Breakout + Secular Compounder → GPT-4o morning, GPT-4o-mini tacticals. Per-analyst model override (model is per-*mode* today). *Temporary — superseded when they go live.* | #5 | **$3–4** | Low — paper money, reversible | 🔴 TODO | `modes.ts`, `morning-research.ts`, `tactical-run.ts` |
| 2 | **Tactical model routing by trigger action.** ENTER (breakout, 28% convert) → GPT-5.5; REVIEW/EXIT (3–8% convert) → GPT-4o-mini. | **$2** | Low | 🔴 TODO | `tactical-run.ts` (pick model from `trigger.action` before `generateText`) |
| 3 | **Defer REVIEW triggers into the morning run** instead of a dedicated tactical. Kills ~40% of tactical *volume*, not just unit cost. | $1.5–2 | Med — changes when reviews happen | 🔴 TODO | `trigger-evaluator.ts`, `tactical-run.ts` |
| 4 | **Briefing diet.** Skip briefings on no-action tacticals, or move tactical briefings to GPT-4o-mini. Keep morning briefings (next morning reads them). | $0.2–0.4 (more on busy days) | Low | 🔴 TODO | `update-analyst-briefing.ts` + call sites |
| 5 | **Kill the zombie.** Archive EV Catalyst's ACTIVE/WATCHING theses + add `enabled:true` filter to trigger-evaluator cron query + guard in tactical-run. | $0.3 + correctness | None | 🔴 TODO | `trigger-evaluator.ts:398`, `tactical-run.ts:122` |
| 6 | **Decide Sunday discovery** — keep (fix the silent 06-07 no-fire) or kill. Also stops Claude thesis-writer fan-out (Anthropic savings). | ~$5–8 per Sunday | Product call | 🔴 TODO | `discovery-run.ts`, `app/api/inngest/route.ts` |
| 7 | **Fix EXIT semantics.** 3% conversion = stops aren't real stops. Either make hard stops mechanical (no LLM, via `trade-exit.ts`) or widen review levels so they stop firing on noise. Read ~3 no-op EXIT transcripts first. | cost + correctness | Med | 🔴 TODO | `trade-exit.ts`, thesis trigger construction |
| 8 | **Triage gate (optional tier 2).** GPT-4o-mini "ESCALATE/SKIP" pre-check in front of GPT-5.5 tacticals. Exempt ENTER-breakouts (time-sensitive, already 28%). | depends | Low | 🔴 TODO | `tactical-run.ts` |
| 9 | **Cap the urgent-email path.** Require ≥2 BREAKING signals or a daily cap before a newsletter fires a full 65-step GPT-5.5 run. | $0 today (insurance) | None | 🔴 TODO | `lib/intelligence/urgent-trigger.ts` |
| 10 | **Hygiene.** Mark stuck PRINCIPAL_CHAT rows FAILED; trade-evaluator → GPT-4o-mini. | <$0.02 | None | 🔴 TODO | `trade-evaluator.ts:98` |

**Expected combined effect of #1–#5:** roughly halves the bill (~$12–15 → ~$6–7/day) with no impact on live-money trading quality, because the spend concentrates on the 2 live analysts and the 28%-converting breakout entries.

---

## Tactical deep-dive (driver #2) — the conversion data
124 completed tacticals over 14d; **only 15 (12%) touched a position.** Conversion is wildly uneven by trigger type — this is what justifies model-routing:

| Trigger (predicate → action) | Runs | Converted | Rate | Verdict |
|---|---|---|---|---|
| PRICE_ABOVE → **ENTER** (breakout) | 36 | 10 | **28%** | The value. Keep on GPT-5.5. |
| TIME_ELAPSED → REVIEW | 18 | 2 | 11% | Soft / schedulable → cheap model or defer |
| PRICE_ABOVE → REVIEW | 8 | 1 | 13% | Soft |
| PRICE_BELOW → REVIEW | 23 | 1 | 4% | Soft |
| PRICE_BELOW → **EXIT** (stop) | 30 | 1 | **3%** | Stops aren't real stops — see lever #7 |
| PRICE_BELOW → ENTER | 8 | 0 | **0%** | Likely misconfigured — eyeball these 8 |

Segments: **ENTER-breakout** (45 runs, ~28% — worth premium) · **REVIEW** (49 runs, 8% — soft) · **EXIT** (30 runs, 3% — broken).

---

## Already fixed — do NOT re-investigate
- **`cooldownDays:0` runaway** (NVDA). Agent stamped a zero cooldown → trigger fired every 5-min tick. Fixed `faa3c11` "three-layer defense" (2026-06-03).
- **Trade-as-proposal EXIT re-fire** (the 06-04 storm: NVDA 12× / IREN 8× / NVTS 5× / ~$25 in an hour). PR #364's human-approval gate left closes in `AWAITING_APPROVAL`, so the position stayed OPEN and the stop re-fired every tick. Fixed by the `close-already-queued` guard at `tactical-run.ts:238`.
- **Result:** refires dropped from 24/day (06-04) to ~1/day (06-05 onward). Storms are contained.

---

## Out of scope / separate billing
- **Perplexity Sonar** (web_search + intelligence crons): separate vendor. Silent since 05-31 — the PR #361 pause is holding (monitors disabled at the DB level, not in code; re-enabling them in the UI resurrects daily Sonar volume with no deploy).
- **Anthropic/Claude:** THESIS_WRITER + PRINCIPAL_CHAT. The overnight batches (06-05, 06-15) are **operator-driven** — Dave running discovery manually via Claude, trying to move it to Sundays. Not a leak. Separate (Anthropic) billing. Minor cleanup: the resulting PRINCIPAL_CHAT rows are left stuck `status=RUNNING` (15 today) — mark FAILED for dashboard hygiene.

---

## Decisions log / changelog
- **2026-06-15** — Audit complete (this doc created). No code changed. Confirmed storms already fixed. Pending: pull OpenAI dashboard CSV for ground-truth $ (project key lacks usage scope).
- **2026-06-15** — Reframed around all-prod assumption (Dave: every analyst goes live eventually; roster grows). Added "Scalable levers" section. Key finding: mornings are 84% no-op, tacticals 88% no-op → **triage gate (run premium only when there's a decision) is the curve-bender**, paper→cheap is just a bridge. Trigger over-firing flagged as a *product* issue, not a model one. Confirmed overnight Claude batch = operator-driven manual discovery (not a leak). Zero cross-analyst ticker overlap at N=5 (dedup is a future lever).
- **2026-06-15** — Added model pricing + the cheaper-model answer: **GPT-5.4 is ~½ the price of GPT-5.5** (drop-in, near-frontier) → lead recommendation for morning/discovery; Sonnet 4.6 cheaper-still but blocked by an Anthropic tier limit (the "30k" note). Validated Dave's triage design: gate on **action type** (ENTER spawns, REVIEW stamps `nextReviewAt` for the morning run, EXIT stays mechanical/fast — don't batch EXIT), with `urgency:BREAKING` escalating a REVIEW. Mechanism already exists (`Thesis.nextReviewAt` + index) — redirect the REVIEW trigger from emitting `thesis.trigger.fired` to stamping the field.
- **2026-06-15 — BUILT #1 + #3 (worktree).** `lib/agent/modes.ts`: research-run + discovery + tactical `gpt-5.5 → gpt-5.4` (verified the string is live on the account; `RESEARCH_MODEL_OPTIONS` keeps 5.5 selectable + adds 5.4). `update-analyst-briefing.ts` (both layers) + `trade-evaluator.ts`: `gpt-4o → gpt-4o-mini`. Est. ~$5–6/day off. **Validation owed:** trigger one manual morning run and eyeball quality before relying on the 8 AM cron (gpt-5.4 is near-frontier but unproven on this agent).
- **2026-06-16 — REBASED + BUILT #2.** Caught that the branch was 18 commits behind main (the P1-24 status-taxonomy migration #411–#434 landed 06-16: `ACTIVE`→`HOLDING`, enum shrunk). Rebased onto `origin/main` (#434) — model edits survived cleanly (main never touched those 3 files). **Corrected #2's mechanism** after reading the code: the daily run is `needsAction`-gated, so the evaluator must write a `TRIGGER_FIRED` row at fire-time (not stamp `nextReviewAt`). Built in `trigger-evaluator.ts`: both firing loops now defer REVIEW (non-BREAKING) triggers — write `TRIGGER_FIRED` via `writeThesisUpdate`, skip the tactical spawn; ENTER/EXIT/BREAKING still spawn. Added `agentConfig: { enabled: true }` to both thesis queries → zombie killed. **Verified:** `tsc --noEmit` 0 errors; 125 trigger + needs-action tests pass. Full package (4 files) ready for one PR. **Day+1/+2 validation** still to run post-deploy (fewer tacticals; batched REVIEWs get a `REVIEWED` row in the next daily run).
