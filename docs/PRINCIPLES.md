# Hindsight — Agent Design Principles

> **Evergreen doctrine.** This doc describes how to build and debug agent behavior in Hindsight.
> It is not scoped to any single PR or feature — it's the architectural backbone that every
> implementation decision should be checked against.

---

## How to use this when fixing a bug

Before adding prompt text to fix an agent failure, ask which layer the fix belongs in:

- **"The agent did the wrong thing even though the prompt said not to"**
  → Layer 1 (tool gate). Refuse the bad call.
- **"The agent didn't know what to do"**
  → Layer 2 (result shape). Pre-digest the state.
- **"The agent needed judgment we couldn't pre-compute"**
  → Layer 3 (prompt). Identity + goals only, never procedures.

> Most past failures were fixed by adding Layer 3 prompt text when the right answer was
> Layer 1 or Layer 2. The maze prompt was the cost.

---

## The three-layer principle

Every well-built agent system (Cursor, Claude Code, Perplexity, Devin) splits logic across
three layers and is religious about putting each rule in the RIGHT layer. Hindsight targets
the same split.

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1 — Tool gates (server-side validation)               │
│ "What must NEVER happen, regardless of what the agent       │
│ thinks." Refuses bad calls. Returns the rejection reason    │
│ as a tool result. The agent reads the rejection and         │
│ corrects its call. NOT enforced by prose in the prompt.     │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────────┐
│ Layer 2 — Tool result shape (computed context)              │
│ "What the agent shouldn't have to compute itself."          │
│ Pre-digested state in tool responses. The agent CONSUMES    │
│ this info; the math/cross-referencing happens server-side.  │
│ Examples: needsAction per thesis, daysToEarnings, signals   │
│ already filtered to today's portfolio + watchlist.          │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────────┐
│ Layer 3 — Prompt (judgment + identity + intent)             │
│ "What requires interpretation." The mandate, the goals, the │
│ analyst's role and edge. SHORT. Describes WHAT and WHY,     │
│ not HOW. The mechanical HOW lives in tools.                 │
└─────────────────────────────────────────────────────────────┘
```

**Mapping every rule to its correct layer:**

| Rule | Layer | Destination |
|---|---|---|
| 6 procedural stages (Step 1 / Step 2 / …) | — | **Deleted.** Procedures don't belong anywhere. The agent needs goals ("act on needsAction items"), not pseudocode. |
| 4 horizons with full default-cadence explanations | 2 + 3 | Cadence math → tool-internal (Layer 2: `get_theses` uses horizon to compute `REVIEW_DUE`). 5-line glossary → prompt (Layer 3: explains what each horizon MEANS for exit policy). The agent SEES horizons, doesn't COMPUTE cadence. |
| 5 priority blocks (Priority Reviews, Fired Triggers, Matching Now, Live Theses, Watchlist) | 2 | **`get_theses.needsAction`** — one annotation per thesis row. The 5-way cross-reference happens server-side. |
| Tool-call discipline + forbidden-phrase list | 3 | One sentence in the user prompt: "You are running unattended. No human will respond. Every turn must call a tool. End with complete_run." |
| Closeout contract ("every Live Theses row produces one tool call") | — | **Deleted.** It existed because the agent didn't know which rows mattered. With `needsAction`, it does — null rows don't need touching. |
| Promotion check (prompt narration) | 1 | **Deleted from prompt.** Already a tool gate in `record_run_summary` (PR #235). Don't duplicate. |
| Goalpost-moving prohibition (prompt narration) | 1 | **Deleted from prompt.** Already a tool gate in `update_thesis` (PR #232 + #220). Don't duplicate. |
| 9 hard-reject gates listed as prose rules | 1 | **Already in tools, kept there. Prose duplicates deleted.** The agent learns from rejection messages, not from prompt warnings. |
| `record_thesis` 30-line tool description | — | Tool description, not prompt. Stays — it's the right place for the schema-level guidance. |
| Tool catalog re-listed in prompt | — | Already injected by AI SDK as schemas; the prompt doesn't repeat it. |
| Identity + mandate (analystPrompt) | 3 | **Kept.** This IS the judgment that makes Tech Momentum different from Catalyst Event Raider. |
| Universe & rules (sectors, watchlist, sizing) | 3 | Kept. |
| Yesterday's briefing standup | 3 | Kept (continuity between runs). |
| Workflow goals (5 bullets, not 6 stages) | 3 | Kept. ~5 lines. |
| Per-`needsAction`-kind action map (TRIGGER_FIRED → execute action; TRIGGER_MATCHING_NOW → same; REVIEW_DUE → update_thesis) | 3 | Kept. ~5 bullets. |
| Horizon glossary (CATALYST/TRADE/TARGET/COMPOUNDER meaning) | 3 | Kept. ~5 lines. |

**Why this works:** the agent's attention budget goes to JUDGMENT (analyst-specific edge, what
makes a good trade), not to tracking 9 rules across 5 priority blocks across 6 procedural stages.
The model gets the context it needs through tool results (Layer 2) and gets stopped from doing
the wrong thing by tool gates (Layer 1). The prompt is short because it doesn't have to teach
mechanics.

---

## A refusal is never the end (2026-09-25)

Layer 1 says no. What happens next is the part every agent product gets right and Hindsight
did not: PLTR's buy was refused on 2026-09-25, the tactical run closed out, ended COMPLETE, and
nothing anywhere said the buy never happened. DYN, IBRX and BBIO's theses died the same way in
the writer. A refusal that nobody acts on is work that vanished.

The rule, in four parts, all mechanical:

1. **The model cannot produce the wrong shape.** Strict tool schemas (OpenAI `strictJsonSchema`,
   Anthropic `strict`), enums over free text, and no field the model can guess wrong — the buy
   tool inside a run has no size field at all. A refusal over shape is a bug in the schema.
2. **A refusal is an input.** The reason goes back to the model with the two legal answers:
   correct the call, or make the call that records why it stands. Every run (daily, tactical,
   discovery) checks its refusal ledger before it may end, and gives the model one more turn
   for anything still open (`refusalNudge`).
3. **Nothing is dropped.** Every refusal is a row in `GateRejection`, open until the same tool
   lands on the same stock or thesis for that analyst — `resolveGateRejections`, from the
   `defineTool` wrapper. No phrase, no flag closes it. An open row is written on the run
   (`action_blocked`), told to the next daily run ("Blocked last time — resolve today"), and
   shown on the Activity feed as "Buy blocked" / "Sale blocked" / "Thesis edit blocked".
4. **The refusal message says what to do instead.** A gate that returns "no" without the next
   legal move is half a gate.

What this is not: a new gate. It adds no refusal. It makes every existing refusal cost the run
one more turn instead of costing the principal the trade.

**How Cursor handles "you must read a file before editing it":**

- Layer 1 (tool gate): `edit_file` refuses if the file hasn't been read this session. Returns "Read the file first."
- Layer 2 (tool result): `read_file` returns the file with line numbers. Agent sees structure, doesn't compute it.
- Layer 3 (prompt): "Be careful with destructive operations." One sentence. Judgment, not procedure.

**Mapped to Hindsight:**

- Layer 1 (tool gate): `place_trade` refuses if confidence < threshold or target ≤ entry. Returns the specific reason.
- Layer 2 (tool result): `get_theses` returns each thesis with `needsAction`. Agent sees what needs work.
- Layer 3 (prompt): "Manage your book. Act where needsAction says to act. End with complete_run." Goals, not procedures.

---

## Every field the model can pass has a contract (2026-09-25)

The question behind PLTR's lost buy and the writer's four lost theses was the same: for
this field, who decides — the code or the model — and if the model, from what list, under
which rule, stated where? `lib/agent/tools/field-contract.ts` answers it for every field
on every write tool, one row each, and `field-contract.test.ts` holds the code to it:

| Kind | Who decides | What the test checks |
|---|---|---|
| **COMPUTED** | The app. | The field is absent from the schema a run sees. The principal's chat may keep it. |
| **CHOSEN** | The model, from a closed list. | The wire schema is an enum, const or boolean — never a free string. |
| **JUDGED** | The model, under a rule the tools enforce. | The rule is named, and every prompt of a mode that offers the tool states it (a marker string). |
| **IDENTITY** | A reference to something that exists. | Documented: a wrong one is refused by name. |
| **TEXT** | The model's prose. | No length cap. |
| **CARRIED** | The writer's research, copied through. | Documented. |

A new field fails the suite until it has a row. That is the whole framework: nothing the
model can type is unclassified, nothing the app should compute is typed by the model,
nothing chosen is free text, and no rule is enforced that the prompt did not state. What
happens after a refusal is the section above.

---

## See also

- [`THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — how the thesis lifecycle implements Layer 1 gates
- [`plans/MORNING_RUN_V2_DESIGN.md`](git history) — the V2 prompt rewrite that applied this principle to the daily run
- Linear (team Davesucks) — open items, many of which are Layer violations still to fix
