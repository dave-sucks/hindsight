# The agent engine

**The goal.** Every agent is one record (its instructions, its context blocks, its tools, when it runs) and one engine builds every model request from a record. What the owner sees on the Agents page and in a run's Context panel is read from those records and from what the run saved. No hand-built prompt is left.

## Today (2026-11-17, measured)

- Seven agents are each put together by their own code:
  - `system-prompt.ts` (morning run)
  - `intraday-tactical.ts` + `tactical-run.ts` (trigger run)
  - `run-thesis-writer.ts` (Writer)
  - `modes.ts` (chat)
  - `portfolio-manager/`
  - `market-reviewer/`
  - `digest-writer.ts` (portfolio digest)
- They share some parts, imported by each builder: `house-rules.ts`, `voice.ts`, `analyst-brief.ts`, `portfolio-block.ts`, `situations.ts`.
- Which agent gets which part is whatever its builder imports. The only per-agent switch is `loadPortfolioBlock({ watching, portfolioDigest })`.
- A run saves the request it sent (`run-requests.ts`), but not which part is which. The Context panel splits the text at headings.

The audit is at https://claude.ai/artifact/LqoCe8qF1uo1Nb7A27hP2U.

## The shape

| Thing | What it is | Where |
|---|---|---|
| **Block** | One named piece of context an agent can be given: a title, the file that builds it, one line on what it holds, and a loader | `lib/agent/engine/blocks.ts` |
| **Agent record** | The agent's own instructions (its job, in sections), the blocks it gets and where (instructions or first message), its tools, its model, its step limit, when it runs | `lib/agent/engine/agents/*.ts` |
| **Engine** | `buildAgentRequest(record, sources)`: loads each block, puts the record's parts in order, and returns the instructions, the first message, the tools and a manifest of every part (id, title, source, where, size) | `lib/agent/engine/engine.ts` |
| **Saved record** | The request as sent, now with the manifest (`parts`) | `run-requests.ts` |
| **Context panel** | One row per part, named and sized from the manifest. Records saved before the engine keep today's view | `RunContext.tsx` |
| **Agents page** | Every agent as its record shows it: instructions, which blocks are on and which are off, which tools are on and which are off. Read-only | `/how-it-works/agents` |
| **Framework page** | Every agent a tab: its parts in its record's order, each sized from the manifest of the request the engine built on its sample day (its engine test's case, `lib/docs/agent-samples.ts`), and its tools. The workflow chips and each agent doc's "What it reads" list come from the same build | `/how-it-works/framework`, `lib/docs/framework.ts` |

A block's options are the record's choice of blocks. For example, the Portfolio Manager lists `watching` and leaves out `portfolio_digest`; it doesn't pass a flag to a loader.

## The rules for every move onto the engine

1. **Nothing an agent is sent changes.** A test built from the old builder's output (kept as a fixture) proves the engine sends the same instructions, first message and tools, character for character.
2. **The old builder is deleted in the same PR.** There is never a second way to build that agent.
3. **No text is added to any agent.** Moving is not editing. Changes to what an agent is sent come after, one edit to a record at a time, with the Context panel before and after and a score on real cases.

## The order

### Pass 1: one way to build a request

1. The engine, the manifest, the Context panel by part, the Agents page, and the **Portfolio Manager** moved. It came first because its prompt is short and uses the shared blocks and the one switch (#1011).
2. The portfolio digest and the Market Reviewer (#1012).
3. The Writer. Its prompt has about 20 parts, many printed only in some runs, so a part names its own separator (#1013).
4. The trigger run. A separator can depend on the run, when it follows a part only some runs print (#1014).
5. The morning run. A request from the Run button names the parts of its instructions and shows the conversation as it is (#1015).
6. The chat. Its builder moved out of `modes.ts` to `system-prompts/chat.ts`, so the record can read its model and tools from `MODES` without the two files importing each other. With every agent moved, the Agents page has no "not on the engine yet" card.
7. The heading split is deleted from `run-requests.ts`: what rides on the chat's newest message (the time, the Market and portfolio block) is a third place in the record, `newest`, so every part the panel shows is named. A request saved before the engine shows each piece whole.

### Simple records (2026-11-18, before the Framework page and pass 2)

Every record takes the shape the owner described: its instructions are one fixed markdown text, the same on every run; everything that changes by run is a context block; a blank line between parts, no separator of its own. Where the old instructions branched on the run, the branch is either two agents or one text for both.

Where a block goes follows what it is. A fact (the analyst, the market and portfolio, the stock's row, what fired) goes in the first message. An instruction that travels with the stock (its situations) ends the instructions, after the fixed text. Measured on the trigger run (`scripts/hero-case.ts`, 6 runs a case): with the situations among the facts in the first message, the NVDA declined-sale case went from 6 of 6 right to 3 of 6 and the CEG sale tried to lower its sale price in 2 of 9 runs; with the situations ending the instructions, 6 of 6 and 0 of 6, the same as before the split. Putting the agent's own text after the house rules instead made it worse (2 of 6, and 5 of 6 lowering).

1. The trigger run splits in two: the trigger run decides, and the post-trade write-up writes the note on a trade an Auto trigger made (its own instructions, no trade tools). The stock, the trigger, the price it fired at and the fire are blocks of the first message; the situations end the trigger run's instructions. Checked on seven real fires and two saved cases with `scripts/hero-case.ts`, before and after.
2. The Writer.
3. The chat.
4. The morning run, then the three whose words already don't change (the Portfolio Manager, the Market Reviewer, the portfolio digest) move their blocks to the same places.
5. The engine drops what no record uses any more: own text that changes by run, and a part's own separator.

### Pass 2: one way to run an agent

Each agent still has its own loop: its own model call, tool assembly, retries, and saving of the thread, the token use and the run's status. That covers `run-thesis-writer.ts`, `morning-research.ts`, `tactical-run.ts`, `app/api/agent/[mode]/route.ts`, `portfolio-manager/run.ts`, `market-reviewer/run.ts` and `digest-writer.ts` (about 7,900 lines with the prompt files).

One runner takes a record and its input, builds the request, calls the model with the record's tools, and saves the request, the thread, the token use and the status. Every scheduled job and the chat route call it. Behaviour that is one agent's own becomes that agent's tools or a small hook, not its own loop:
- the Writer's data pull and its save checks;
- the trigger run's Auto-trade path;
- the morning run's coverage retry.

Each agent moves on its own. Replays of its recorded real runs prove it behaves the same.

### After

Then come the agent changes on the audit page, each one an edit to a record:
- what each agent is given;
- tools per agent;
- the playbook writing its triggers;
- one way to make a view.
