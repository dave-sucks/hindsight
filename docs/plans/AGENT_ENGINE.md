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
| **Saved record** | The request as sent, now with the manifest (`parts`) and the agent whose record built it (`agent`, saved right after `call`) | `run-requests.ts` |
| **Context panel** | One row per part, named and sized from the manifest, each in the Framework page's color for its kind (`swatchOf`). Records saved before the engine keep today's view | `RunContext.tsx` |
| **Agents page** | Every agent as its record shows it: instructions, which blocks are on and which are off, which tools are on and which are off. Read-only | `/how-it-works/agents` |
| **Framework page** | Every agent a tab: its parts in its record's order, each sized from the manifest of the latest request the account's runs saved for it (`RequestRecord.agent`), the Context panel's numbers; an agent with no such run yet is sized on its sample day (its engine test's case, `lib/docs/agent-samples.ts`), and the tab says which. Its tools. The workflow chips and each agent doc's "What it reads" list come from the same build | `/how-it-works/framework`, `lib/docs/framework.ts` |

A block's options are the record's choice of blocks. For example, the Portfolio Manager lists `watching` and leaves out `portfolio_digest`; it doesn't pass a flag to a loader.

## The rules for every move onto the engine

1. **Nothing an agent is sent changes.** A test built from the old builder's output (kept as a fixture) proves the engine sends the same instructions, first message and tools, character for character.
2. **The old builder is deleted in the same PR.** There is never a second way to build that agent.
3. **No text is added to any agent.** Moving is not editing. Changes to what an agent is sent come after, one edit to a record at a time, with the Context panel before and after and a score on real cases.

## The yardstick (step 1 of the audit's order; every change to an agent is scored on it)

A change to what an agent is sent lands only with its scores before and after. Ten real Writer decisions and ten real trigger-run decisions, each replayed twice against the real model (`scripts/hero-case.ts`), and graded by code (`lib/agent/yardstick/grade.ts`):

| Grade | What counts |
|---|---|
| The right action | The case's `expect`: what a right answer calls, and what it must never call |
| The right playbook | The case names the playbooks a right answer may name (`grade.playbooks`, "none" for none), with why, from each playbook's preconditions |
| Prices from what it was shown | Every price it sets sits within 1% of a dollar figure in its inputs (the chart's levels, the gap-day lows) |
| Nothing invented | Every number it writes is in its inputs, within 1%, or a percent between two prices it was shown; a replay has no web search, so anything else came from nowhere |
| A belief someone can check | No price in the belief; two to four assumptions, each with a number and when it is checked; what would prove it wrong names the business, never a price, an average or a gap |
| The sale price kept | No edit lowers a "Sell if below" price, and none removes one |

The cases are cut from production runs (`scripts/hero-case-from-run.ts`) and kept on the owner's machine as `scripts/hero-cases/local-*.json`, which git ignores: the repo is public. `scripts/yardstick-report.ts` puts two versions side by side; the scores go on a private page.

A case holds the New York date its run started (`runDate`), the date the Writer is told. Until 11-18 the cutter took the UTC date, so seven of the eight Writer cases were told the next day; every score measured before then ran both versions on those same dates.

The set: Writer — four stocks we hold (V, NVDA, MU, CEG refreshes of the evening of 11-15), four new stocks (AAON, CORT, ACN, ZTS) and the two saved SNDK cases; trigger runs — a buy (WST), sales held through after a decline (CEG, GEV), a sale (NVDA), a declined sale (the saved NVDA case), reviews (LUXE's earnings miss, PRAX's 8-K) and three Auto write-ups (IOT, PLTR, MU).

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

Where a block goes follows what it is. A fact (the market and portfolio, the stock's row, what fired) goes in the first message. The analyst it works for opens the instructions, and an instruction that travels with the stock (its situations) ends them, after the fixed text. The morning run measured the analyst's place (#1021: in the first message three of six decisions changed, back at the top of the instructions all three came back); on the trigger run's yardstick cases the move scored the same (20 of 20 actions, no price off, nothing invented, nothing loosened), so it moved too, for one rule. Measured on the trigger run (`scripts/hero-case.ts`, 6 runs a case): with the situations among the facts in the first message, the NVDA declined-sale case went from 6 of 6 right to 3 of 6 and the CEG sale tried to lower its sale price in 2 of 9 runs; with the situations ending the instructions, 6 of 6 and 0 of 6, the same as before the split. Putting the agent's own text after the house rules instead made it worse (2 of 6, and 5 of 6 lowering).

1. The trigger run splits in two: the trigger run decides, and the post-trade write-up writes the note on a trade an Auto trigger made (its own instructions, no trade tools). The stock, the trigger, the price it fired at and the fire are blocks of the first message; the situations end the trigger run's instructions. Checked on seven real fires and two saved cases with `scripts/hero-case.ts`, before and after.
2. The Writer splits in two: the Writer (a new stock, a watch, a promoted stock) and the Holding refresh (a stock we own), each its own fixed text, with the rules both follow as five shared blocks and the stock's facts in the first message. On the yardstick against the old Writer (10 cases, 2 runs each): the right playbook 14 of 16 against 9 of 16, numbers from nowhere 8 against 13, belief problems 8 against 11, the action 19 of 20 against 18 of 20; both lowered NVDA's sale once (the save refuses it).
3. The chat.
4. The morning run, then the three whose words already don't change (the Portfolio Manager, the Market Reviewer, the portfolio digest) move their blocks to the same places.
   - The morning run's instructions open with the analyst it works for, then its own fixed text (the ═══ banners are headings now) with the house rules, then what travels with the run: the regime and cash (a block now) and the refused calls never redone. The Market and portfolio block and the book's earnings and filings this week are blocks of the first message, and the Run button sends that first message too.
   - Checked on the six saved morning cases with `scripts/hero-case.ts`. With the analyst in the first message instead, as the trigger run has it, MU's earnings review stopped lowering its conviction (3 of 3 runs to 0 of 3), so the analyst opens the instructions.
   - One case decides differently, graded with the yardstick: on WST (a watched stock at its buy, an empty book), the new order buys a stock in 6 of 9 runs against 2 of 9 before, WST itself in 2 (0 before). With the fixed text back at the end of the instructions it was 1 of 4: the instructions now end with the regime's cash duty ("act on it, or write one sentence in the run summary saying why not"). The other five decide as before.
   - The Market Reviewer and the portfolio digest already had every fact in their first message; each one's own parts are one fixed text now, the same characters.
   - The Portfolio Manager keeps its Market and portfolio block in its instructions. Its Nov 17 request, replayed with the block in the first message (3 runs each way), made the same call, no trade, but weighed different watches: ABBV, which every run as sent read and ranked second or third, was read in 1 of 3. Its job text also calls the snapshot "above".
   - Still own text that changes by run: the Portfolio Manager's and the Market Reviewer's day line ("Tue, Nov 17, the LIVE account.").
5. The engine drops what no record uses any more: own text that changes by run, and a part's own separator.

### Pass 2: one way to run an agent

Each agent still has its own loop: its own model call, tool assembly, retries, and saving of the thread, the token use and the run's status. That covers `run-thesis-writer.ts`, `morning-research.ts`, `tactical-run.ts`, `app/api/agent/[mode]/route.ts`, `portfolio-manager/run.ts`, `market-reviewer/run.ts` and `digest-writer.ts` (about 7,900 lines with the prompt files).

One runner (`runAgent`, `lib/agent/engine/run.ts`) takes a record and its input, builds the request, gives the model the record's tools and makes the call with the record's model, step limit and time limit. Every scheduled job and the chat route call it. Behaviour that is one agent's own becomes a small hook or that agent's tools, not its own loop:
- the Writer's data pull and its save checks;
- the trigger run's Auto-trade path;
- the morning run's coverage retry.

**The proof is the wire.** Before an agent moves, a test keeps the HTTP body its call sends from fixed inputs, and the record the run keeps of it, as a golden file written from the old loop. After the move the runner must send that body byte for byte (`lib/agent/portfolio-manager/run.wire.test.ts`). The test fails on a change of one field.

**What the seven loops do differently today** (mapped 2026-11-18):
- The 8 AM morning run stops at 30 steps (`morning-research.ts`). Its record, and so the Agents page, says 65, which is the Run button's limit; the Run button also sends temperature 0.2. One record is one setting: the move takes the 8 AM run's.
- Token use: the morning run writes it into the run's parameters and never counts its recovery call; the Market Reviewer and the digest record none.
- The run's status: the trigger run and the Portfolio Manager write it without checking the run is still running; the others check.
- Time limits: the chat and the digest have none.
- The Market Reviewer and the digest call OpenAI directly, not through the AI SDK, so their move has to show the same body sent through the SDK.
- The Writer's record names `submit_thesis`, which its loop never reads: it makes its tools itself.

The model call moves unchanged. The bookkeeping (the thread, the token use, the status) becomes one way once two or three agents run on the runner, where the differences above are settled one at a time.

The order, each its own PR:
1. The Portfolio Manager: one call, no retries.
2. The trigger run and the post-trade write-up, once the open trigger-run PRs merge.
3. The Writer, once the Writer split and the date fix merge.
4. The morning run, once its simple record merges.
5. The chat, once its simple record merges. It streams, so the runner gains a streaming call.
6. The Market Reviewer and the digest.

### After

Then come the agent changes on the audit page, each one an edit to a record:
- what each agent is given;
- tools per agent;
- the playbook writing its triggers;
- one way to make a view.
