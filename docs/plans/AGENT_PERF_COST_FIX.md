# Agent performance, reliability & cost — work brief

> **Status:** open. Written 2026-08-12 as a self-contained handoff. Everything needed to start is
> in this file; you do not need the conversation that produced it.
>
> **Provenance + trust level:** a diagnosis agent produced these findings from the repo and the
> production DB. **One finding (§1, the PROMOTED catch-22) was independently re-verified by reading
> the source.** The rest are single-source. **Re-verify before you change anything** — every claim
> below carries the file:line or run id you need to check it. Where a number is modeled rather than
> measured, it says so.

---

## The complaint (verbatim intent from the platform owner)

> "Agents are going so slow and failing. They really shouldn't be that complex — it should be like
> 1 model on research mode, and that's it." Plus: the daily runs cost too much.

He is right about the symptom and partly right about the cause. The daily/tactical fleet is
actually fine (see §5). Almost all the pain is concentrated in **one mode: `THESIS_WRITER`**.

---

## Evidence base (production, 2026-08-12 UTC)

Analyst **Secular Compounder**, `AgentConfig.id = cmmqxola3000004lbj7c11bfn`. It was promoted
PAPER→LIVE on 2026-08-11, which dispatched thesis-writer refreshes for its two held names.

| Run id | Mode | Status | Seconds | What actually happened |
|---|---|---|---|---|
| `cmspjuuay000604jrqmo8kl70` | THESIS_WRITER (CRWD) | **FAILED** | 774 | Hit the 770s abort mid-retry-loop |
| `cmspjuuay000704jrqo0trioj` | THESIS_WRITER (CEG) | COMPLETE | 704 | **`thesisId: null` — zero DB writes** |
| `cmspl3y2l000b04jt54o778hm` | THESIS_WRITER (mint) | COMPLETE | 417 | |
| `cmspl439a000c04jt2pd0r17b` | THESIS_WRITER (mint) | COMPLETE | ~560+ | |
| `cmspl4985000d04jtv6rsrmur` | THESIS_WRITER (mint) | COMPLETE | ~560+ | |
| `cmspl4f04000e04jttpahe5p3` | THESIS_WRITER (mint) | COMPLETE | ~560+ | |
| `cmspl4kwm000f04jtseisffsh` | THESIS_WRITER (mint) | COMPLETE | 403 | |
| `cmspjxnff000004l45w6sy4r0` | PRINCIPAL_CHAT | COMPLETE | 2113 | The discovery session that dispatched the 5 mints |

30-day fleet averages: **THESIS_WRITER 523s** (n=21, max 704) · MORNING_PLAN 83s ·
INTRADAY_TACTICAL 30s.

**Read-only production DB access** via Supabase MCP:
```
ToolSearch query "select:mcp__a29028bb-00e4-49cb-8724-49d704fc93eb__execute_sql"
project_id: zomxxtqiszpkqrjrqqat
```
Useful tables: `ResearchRun` (mode/status/createdAt/completedAt/parameters), `RunEvent`,
`RunMessage` (`runId`, `content` = the full AI SDK thread as JSON — this is where you count real
tool calls), `Thesis`, `AgentConfig`. **SELECT only. Never write to this database.**

---

## §1 — The PROMOTED catch-22 (CONFIRMED, re-verified, fix first)

`lib/agent/tools/update-thesis.ts` makes it **structurally impossible** for a thesis-writer to
persist a research refresh on a `PROMOTED` thesis. Two guards, both on the PROMOTED branch:

- **:537** — `ctx.runMode === "THESIS_WRITER" && args.change_status !== undefined` → refused
  (`thesis_writer_cannot_change_promoted_status`)
- **:570** — `args.change_status !== "WATCHING"` → refused (`promoted_thesis_requires_resolution`).
  **`undefined !== "WATCHING"` is true**, so the no-status call is refused here.

Pass a status → :537 kills it. Pass no status → :570 kills it. There is no legal call.

Compounding it: the writer's own prompt at `lib/agent/run-thesis-writer.ts:404-409` explicitly
orders it to call `update_thesis` with refreshed content and **no** `change_status` — precisely
what :570 rejects. And the error message at :570 suggests `place_trade` as the alternative, but
`place_trade` is **not in the thesis-writer allowlist** (`lib/agent/modes.ts:561-574`).

The comment at :534 explains the origin: guard :537 was added 2026-05-26 after three writer
refreshes (AVGO, MRVL, TSM) wrongly flipped PROMOTED→WATCHING and needed manual reverts. The fix
deadlocked against the pre-existing :570.

**Blast radius:** every analyst promotion silently produces no refreshed research. Tonight it
burned ~1,478s across two names and wrote nothing.

**Intended fix:** a research-only refresh (no `change_status`) from a THESIS_WRITER must be
*accepted* on a PROMOTED row. Keep :537 — writers genuinely must not flip status. Preserve the
role split documented in `docs/THESIS_ARCHITECTURE.md` §0: the writer refreshes research, the
**orchestrator** (next daily run) decides re-enter / defer / kill. Add a regression test covering
all three cases: writer + no status (accept), writer + status (reject), non-writer + no status on
PROMOTED (still reject — the daily run must resolve).

---

## §2 — The verbatim-retyping tax (CONFIRMED, the real perf fix)

`lib/agent/run-thesis-writer.ts:615-646` — the "FORWARD-VERBATIM RULE" — requires the outer agent
to copy the entire multi-section research output of the `write_thesis_research` meta-tool
*verbatim* into the `record_thesis` / `update_thesis` arguments. That is a ~24–28k-character
tool-call payload the model must generate token by token.

Measured: **~157–190s per persist call.** With the ~190s synthesis inside `write_thesis_research`,
one thesis has a **~400s floor** before anything goes wrong.

It also multiplies failures: **3 of tonight's 5 mint runs needed two `record_thesis` calls**
because the first payload failed Zod validation ("Type validation failed", visible in the SYK
thread) — a ~60% first-attempt schema-rejection rate, each costing another ~3 minutes of pure
regeneration.

**Intended fix:** stop round-tripping research through the model. Have `write_thesis_research`
persist its sections server-side keyed by `runId`, and let `record_thesis` / `update_thesis`
accept a **reference** instead of verbatim re-emission. Expected: −180s per persist, elimination
of the double-generation class, roughly **half** the writer's wall time and output-token cost.
This is the single change that gets the writer near its advertised runtime.

Watch out: the verbatim rule presumably exists so the persisted thesis matches what the model
reasoned over. Preserve that guarantee — a server-side handoff should make it *stronger*, not
weaker. Check git history for why the rule was written before removing it.

---

## §3 — Timeout math (CONFIRMED)

- `lib/agent/modes.ts` — `maxDuration` 800s; the AbortSignal derives **770s**
  (`run-thesis-writer.ts:962`). CRWD's `parameters.error` reads "Thesis-writer timed out after
  771s" — an exact match.
- `lib/agent/tools/write-thesis-research.ts:567` — the **inner synthesis abort is 180s**, and
  observed synthesis time is **187–192s every single run**. The safety net is now the routine
  operating point; CEG is what happens when it loses that race (synthesis returned empty
  sections, and the agent fell back to `get_stock_data` + 3 `web_search` calls, 2 of which
  returned nothing).
- `lib/agent/tools/wait-for-thesis-refresh.ts:61` — parent agents wait **150s default, 180s cap**
  against a worker averaging 523s. The cap is confirmed in code; whether parents are actually
  timing out in practice is **SUSPECTED** — go count it in `RunEvent`.

**Intended fix:** raise the inner abort (~240s) or cut the search `maxUses`; resize
`wait_for_thesis_refresh` to reality. Do §2 first — it may make both moot.

---

## §4 — Observability holes (CONFIRMED, cheap)

- **Timeout failures persist nothing.** The catch path at `run-thesis-writer.ts:1121` skips
  message persistence, so a failed run has **no `RunMessage` thread and no `RunEvent` rows**. The
  runs you most need to debug are the ones that leave no trace.
- **`complete_run` masks contract failures.** `run-thesis-writer.ts:1052-1057` only flips rows
  still RUNNING, so `complete_run` wins the status race. CEG is recorded COMPLETE with
  `thesisId: null` and zero writes. **A run that produced no thesis must not report COMPLETE.**
- **The "~60–120s" estimate is fiction** and appears in three places: `lib/run-summary.ts:462`,
  `components/analysts/PromoteAnalystDialog.tsx:174`,
  `lib/agent/tools/dispatch-thesis-research.ts:406`. It was copied from the synthesis sub-call's
  budget (`run-thesis-writer.ts:203`). A comment at `run-thesis-writer.ts:673` has documented the
  true range (333–760s, avg 425s) since 2026-06-03. Until §2 lands, say ~8–10 min.

---

## §5 — Is it over-complex? (honest answer: partly)

Ten agent modes in `modes.ts` (research-run, builder, editor, tactical, discovery, principal,
thesis-writer, + 3 podcast) plus trade-evaluator, digests, and the synthesis call inside
`write_thesis_research`.

**Defensible:** the daily / tactical / discovery / builder split. Different step budgets,
tool allowlists and write permissions *are* the platform's safety model, and that fleet is fast
(83s / 30s averages) and no longer the cost problem.

**The genuine fat is one thing:** the thesis-writer is a **two-model relay whose second model's
main job is retyping the first model's output**, wrapped in Layer-1 gates strict enough that ~60%
of first persist attempts bounce on schema and 100% bounce on PROMOTED. Fix §1 and §2 and the
owner's "it should just be one model doing research" complaint is largely answered without
dismantling the safety model.

The podcast modes are accreted scope but idle — leave them alone.

---

## §6 — Cost

The repo's own prior audit, `docs/plans/legacy/OPENAI_COST_REDUCTION.md`, found **~85% of
premium-model spend produces no action** (morning runs trade 16% of the time, tacticals 12%) at
~$15/day. The model downgrade and REVIEW-batching shipped. **Lever #1 — a cheap triage pass before
invoking the premium model — never shipped, and it is the only lever that makes cost sublinear in
analyst count.**

On top of that baseline, the incident classes above are pure waste: tonight's 5-name dispatch cost
roughly **$3–5** (modeled from the repo's pricing table, **not** billing data — verify against
actual billing before quoting it), much of it regenerating payloads that were then rejected.

---

## Prioritized work

| # | Change | Size | Impact |
|---|---|---|---|
| 1 | **PROMOTED catch-22** (§1) | one-line + tests | Promotion works at all; kills the failure class |
| 2 | **Server-side research handoff** (§2) | medium | ~50% writer time + output cost; kills schema-bounce |
| 3 | **Timeout math** (§3) | small | Stops synthesis losing its race |
| 4 | **Observability** (§4) | small | Failures debuggable; COMPLETE means complete |
| 5 | **Honest estimates** (§4) | trivial | Stop lying in the UI |
| 6 | **Triage gate** (§6) | large | The only sublinear cost lever |

**1, 3, 4, 5 are independent** and can go in parallel. **2 is the big one** and should be its own
PR with care. **6 is a separate project** — scope it, don't bolt it on.

---

## Constraints

- **Do not weaken the Layer-1 safety model.** The gates exist because agents mis-sized and
  mis-flipped things in production. Read `docs/PRINCIPLES.md` (three-layer principle) before
  moving a rule between layers.
- **Read `CLAUDE.md` first** — especially "RECURRING BUGS", which documents fixes that were tried
  and broke production.
- **Never write to the production database.** Diagnosis is read-only; fixes ship as migrations.
- **This platform trades real money.** The Compounder went live 2026-08-11. Changes to
  `place_trade`, position sizing, or status transitions need proportionate care.
- Branch + PR per item; `gh auth switch --user dave-sucks` before pushing.
- **Re-verify before acting.** Only §1 was independently double-checked.
