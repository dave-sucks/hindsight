# Thesis-Writer V2 — one research agent, zero relay

> **Status:** approved 2026-08-13, in progress. Companion diagnosis:
> `docs/plans/AGENT_PERF_COST_FIX.md` (the evidence base — run ids, timings,
> file:line for every claim). This doc is the design + shipping plan.

## The problem (one paragraph)

The thesis-writer is a two-model relay: an inner synthesis model (inside the
`write_thesis_research` meta-tool) writes a ~25k-char multi-section research
note; an outer agent then re-types that entire note *verbatim* into
`record_thesis` / `update_thesis` tool arguments (the FORWARD-VERBATIM RULE,
`run-thesis-writer.ts:615`). The re-typing costs ~157–190s of pure token
regeneration per persist, fails Zod on ~60% of first attempts (another ~3 min
each), and the whole run averages **523s** vs. 83s for a full daily run.
The verbatim rule itself is a prompt patch (#316, 2026-05-23) over the
structural flaw — the outer model was reshaping a payload it should never
have been forwarding at all. On top: the inner synthesis abort (180s) is
*below* the observed synthesis time (187–192s every run), timed-out runs
persist no thread and no events, `complete_run` can stamp COMPLETE on a run
that wrote nothing (CEG 2026-08-11), and the single long Inngest step makes
Inngest abandon + re-invoke, silently re-running the whole agent.

## The design

**One model call does research and decisions. Code does everything else.**

```
dispatch (unchanged contract)
  └─ Inngest thesis-writer fn, split into real steps:
       step 1  pull-data      — the existing 7 parallel structured pulls (~10s)
       step 2  research       — ONE generateText call:
                                  model: sonnet, web_search maxUses 3-4,
                                  abort ~300s
                                  input: pulled data + discovery opinion +
                                         section template + decision rubric
                                  output: full research note as TEXT +
                                          terminal `submit_thesis` tool call
                                          (compact decision object only)
       step 3  gate + persist — server-side:
                                  parseIntoSections(note text)   [exists]
                                  validate decisions (R/R ≥ 2:1, trigger
                                    template conformance, price sanity)
                                  on validation failure → ONE repair turn
                                    (feed errors back, model re-emits the
                                    ~1-2k-char decision object only)
                                  persist via the same gate code
                                    record/update_thesis use today
       step 4  finalize       — status := COMPLETE iff thesisId written,
                                else FAILED; RunEvents + RunMessage thread
                                persisted in ALL outcomes (finally-block)
```

### submit_thesis (the compact decision schema)

Direction, confidence_score, horizon, entry_price, target_price, stop_loss,
trigger ladder, one-line summary, belief statement. **No section args** — the
sections come from parsing the model's own text output. ~1–2k chars total.
Zod-validated; validation failure costs one cheap repair turn, not a 3-minute
full-payload regeneration.

### What each current failure class maps to

| Today | V2 |
|---|---|
| ~180s verbatim re-emission per persist | gone — note generated once, parsed server-side |
| ~60% first-attempt Zod bounce on 25k payload | compact object + targeted repair turn |
| synthesis 180s abort < 187–192s observed runtime | research step budgeted ~300s |
| timeout ⇒ no RunMessage / no RunEvents | finally-block persistence, all outcomes |
| `complete_run` stamps COMPLETE with 0 writes | no `complete_run` in this mode; status derived from thesisId |
| Inngest abandons 333–760s single step, re-runs agent | real step boundaries; retries memoize |
| PROMOTED refresh catch-22 (`update-thesis.ts:537` vs `:570`) | :570 only fires when change_status is *defined* |
| "~60–120s" ETA fiction in 4 places | swept to measured p50 after V2 lands |

### What is deliberately preserved

- **Layer-1 safety.** The writer still cannot change status and cannot trade.
  Persistence goes THROUGH the existing record/update_thesis gate code
  (extracted as a shared internal `persistThesis()` — same validations, same
  audit rows), not around it. See `docs/PRINCIPLES.md` before moving any rule.
- **The role split** (`docs/THESIS_ARCHITECTURE.md` §0): writer refreshes
  research; the orchestrator (next daily run) decides re-enter / defer / kill.
- **The dispatch contract.** `dispatch_thesis_research` /
  `wait_for_thesis_refresh` keep their external shape; discovery sessions and
  the promotion flow don't change. `wait_for_thesis_refresh` gets resized to
  the measured V2 runtime in PR C.
- **The fidelity guarantee** the verbatim rule was protecting ("what's stored
  is what the model reasoned over") — now structural: the stored note IS the
  model's single generation.

### Expected outcomes

Typical run ~200–220s (from 523s avg), worst case ~320s — inside every outer
limit with headroom. Roughly half the output-token cost per thesis; the
double-generation and double-execution classes go to zero.

## Shipping plan

| PR | Scope | Status |
|---|---|---|
| **A** | PROMOTED catch-22: `update-thesis.ts:570` fires only when `change_status` is defined; regression tests (writer+none accept, writer+status reject, non-writer+none reject) | in progress |
| **B** | The V2 writer: single-agent call, server-side parse/gate/persist, Inngest step split, finally-block observability, status-from-thesisId, timeout resize | in progress |
| **C** | Honest ETAs (`run-summary.ts:462`, `PromoteAnalystDialog.tsx:174`, `dispatch-thesis-research.ts:406,28`) + `wait_for_thesis_refresh` resize — after measuring V2 p50 | queued |

Out of scope here: the triage-gate cost lever (AGENT_PERF_COST_FIX §6) — a
separate project; scope it independently.

## Verification bar (before B merges)

- Unit: parseIntoSections round-trip on a real synthesis transcript; decision
  validation (R/R gate, trigger templates) accept/repair/reject paths;
  persistThesis parity with record/update_thesis behavior (audit rows, status
  rules, PROMOTED handling).
- Integration: one real mint + one real refresh on a scratch analyst in paper;
  confirm RunEvents phases, thread replay on /runs/[id], and a forced-timeout
  run that still persists its thread.
- Adversarial pass per the house rule: hostile-input review of the repair
  loop (model returns garbage twice), partial data-pull failure, and the
  Inngest retry path (steps must memoize, not re-run).
