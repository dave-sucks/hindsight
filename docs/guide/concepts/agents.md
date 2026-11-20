# How an agent is built

**Five parts, and nothing hidden.** Every agent here, from the Writer to the Portfolio Manager, is its instructions, its context, its tools, its message and the moment it runs. Each part lives in one place, so you can open an agent and read all of it.

The Agents page in these docs shows each agent's parts. This page says what each one is, how to change it, and how a change is checked before it ships.

## The five parts

| Part | What it is | Where it lives |
|---|---|---|
| **Instructions** | One markdown file per agent, the same on every run. Shared text comes in by import, as it does in CLAUDE.md: `@rules.md` (the house rules and how a note is written) in most, and `@research-rules.md` too in the Writer and the Holding refresh. | `lib/agent/engine/agents/<agent>.md` |
| **Context** | Facts loaded before the model starts, chosen by what the run is about: a stock, an analyst, the account or the chat. One loader per fact. Anything bulky or only sometimes needed is a tool instead. | `lib/agent/context/` |
| **Tools** | One job each, with fields only for what the action needs. Code fills what it already knows: the stock on a one-stock run, the live price, the size of a buy, the floor's default. | `lib/agent/tools/` |
| **The message** | The task, written by whoever starts the run: you, another agent's brief, a trigger fire, a fill, the schedule. Every first message also opens with one line the engine writes, the date and the account. | the sender |
| **When it runs** | A line in the schedule, or an event: a trigger fires, a buy fills, a stock is sent to the Writer, you type. | `lib/agent/engine/schedule.ts` |

An agent's **record** (`lib/agent/engine/agents/<agent>.ts`) ties them together: its model and steps, what its run is about, the context it reads, the tools it may call. The run's subject decides which facts exist for it, and a record may read none outside them.

## How to change an agent

- **What it is told:** edit its `.md`. Shared text (`rules.md`) changes every agent that imports it. A rule that applies when a stock is in a [situation](situations.md) goes in that situation's skill file, never in an instruction file.
- **What it is given:** add or remove the fact in its record's context list. A new fact is a loader in `lib/agent/context/`, one per subject that has it, listed in the context index and in that subject's bundle, and named in `lib/agent/engine/parts.ts`, which is what the run's Context panel shows.
- **What it can do:** add or remove a tool in its record's tool list. The morning run, the trigger run and the chat take theirs from `lib/agent/modes.ts`. A new tool is a `defineTool` in `lib/agent/tools/`, registered in `lib/agent/tools/index.ts`. Give it one job, let code fill the fields it knows (`fromRun`), and hide a field a caller may not set (`schemaFor`). A guard lives in the tool, and its refusal says what to do instead.
- **When it runs:** a line in `SCHEDULE`, or the event that starts it.

## How a change is checked

A change to an agent is scored before it merges. The yardstick replays real decisions: each case is a recorded run up to one decision (`scripts/hero-cases/`, cut from real runs). Today's code builds the request, the real model answers, and the tools are described but never run. A run passes when its calls and words match what the right answer does (`scripts/hero-case.ts`). The pass rate before and after goes in the PR.

Scoring costs money, so: build every case's request free with `--inputs-only`, on both sides of the change; score only the cases whose request changed; reuse the baseline's saved results; run each case 4 times, 8 only for one on a knife edge. A case has to be faithful to its moment: nothing dated after the run goes into it.

## How triggers get set across a stock's life

| When | Who | What gets set |
|---|---|---|
| New stock | [The Writer](../agents/writer.md) | Names the playbook. Code writes all of that playbook's watch triggers, each priced from the chart. The Writer then tailors them with `edit_triggers`, a reason each; a price is a chart key or a line, never a typed number. |
| Watching | The morning run, trigger runs, the Portfolio Manager, chat | Edit them as the chart and the news change, with `edit_triggers`: a playbook's trigger by reference, or their own with a reason. The Portfolio Manager can't set Auto. |
| The buy | A run that proposes it, or an Auto trigger | One number comes with the buy: the floor. It is the playbook's floor, priced by code, or the run's own with a reason, checked against the playbook's sale rules. The buy is sized by the distance to it. |
| Just bought | The fill, then [After the buy](../agents/after-the-buy.md) | At the fill, code takes the watch triggers off and puts only the floor on. After the buy then puts on the playbook's holding triggers, each fitted to the thesis with its reason. It can't touch the floor. |
| Holding | Every run that looks at it | Raise the floor, trim, add, review. Only you lower a floor. |

The [triggers](triggers.md) page says what a trigger is; [Saving a thesis](../deep-dives/saving-a-thesis.md) says how an edit lands or is refused.

## Sources

The design follows two Anthropic articles: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (what goes in context, and what stays a tool) and [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (one job a tool, and results and refusals the model can act on).

<details>
<summary>Technical details</summary>

#### The record
`AgentRecord` (`lib/agent/engine/types.ts`); every agent's is in `AGENTS` (`lib/agent/engine/agents/index.ts`). A scheduled agent's "when it runs" is read from its line in `SCHEDULE` (`whenItRuns`), never kept a second time on its record.

#### The request
`buildAgentRequest` and `buildConversation` (`lib/agent/engine/build.ts`) put an agent's request together: its instruction file with its imports (`lib/agent/engine/instructions.ts`), the facts, the date line, then the message. The agent runner (`runAgentAsRun`, `lib/agent/engine/run.ts`) runs a record that names its time limit and keeps the run's books.

#### Context
`BUNDLES` (`lib/agent/context/bundles.ts`) lists the facts each subject has (a thesis, an analyst, the account, the chat); `FACTS` (`lib/agent/context/index.ts`) has one loader per fact for each subject; `ContextId` (`lib/agent/engine/types.ts`) names them. A record that reads a fact outside its subject's bundle fails its test.

#### Tools
`defineTool` (`lib/agent/define-tool.ts`) wraps every tool with timing, logging and one result shape. Which fields each caller is shown is pinned by `lib/agent/tools/field-contract.test.ts` and `thesis-doors.test.ts`.

#### The yardstick
`scripts/hero-case.ts` replays a case; `scripts/hero-case-from-run.ts` cuts one from a run; `scripts/yardstick-regrade.ts` regrades saved results; the graders are in `lib/agent/yardstick/`. The design is `docs/plans/AGENT_ENGINE.md`.
</details>
