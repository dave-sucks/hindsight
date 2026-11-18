# The agent engine

**An agent is three things: its instructions, its context and its tools.** Nothing else. Every agent is one record that says those three, and one engine builds every model request from a record. What the owner sees on the Agents page, the Framework page and a run's Context panel is read from those records and from what the run saved.

The design (2026-11-18) is the top section of the audit page, https://claude.ai/artifact/LqoCe8qF1uo1Nb7A27hP2U. It follows the published guides: an agent is a model, its instructions and a few tools in a loop (OpenAI, *A practical guide to building agents*; Anthropic, *Building effective agents*); the instructions stay the same on every run, with a small always-useful fact like the date slotted in (OpenAI Agents SDK); what the run is about comes in the first message, written by whoever starts it (Claude Agent SDK); a few things are loaded up front and the rest fetched with a tool (Anthropic, *Effective context engineering*).

## The three parts

| Part | What it is | Where |
|---|---|---|
| **Instructions** | The agent's own text (one string, the same on every run) and the shared texts it uses, in the order the record lists them. When its context has the stock, the stock's situations end them | the record (`instructions`), `lib/agent/engine/parts.ts` (`SHARED`) |
| **Context** | The reads put in its first message, each one named text from one function. In a conversation (the chat) they ride on each message you send | the record (`context`), `parts.ts` (`CONTEXT`) |
| **Tools** | The tools it may call | the record (`tools`) |

Two more things are in every request, and neither is a part an agent chooses:

- **The message**: the run's task, written by whoever starts the run (you in the chat, another agent's brief, the trigger check, the schedule's kickoff). The engine prints it last in the first message (`AgentInput.message`).
- **The date line**: the first line of every first message, "Wed, Nov 18, 2026, 10:00 AM ET, the PAPER account." (`dateLine`, `engine.ts`). Not configurable.

**The shared texts (5):**
- `house_rules`: the principal's word outranks everything about a stock; a note is information, not an order; the Market and portfolio context is context, and a stock's row beats it (`house-rules.ts`).
- `how_you_write` (`voice.ts`).
- `the_analyst`: its strategy, its rules (direction, hold style, size, slots, and its fence where it narrows: some sectors, a market-cap band, exclusions), its playbooks a line each (`analyst-brief.ts`).
- `playbooks`: the analyst's playbooks in full, for the Writer and, on a review of a stock we watch, the trigger run (`knowledge/playbooks.ts`).
- `research_rules`: the Writer's five rule texts as one, for the Writer and the Holding refresh (`thesis-research/writer-rules.ts`).

**The reads (13):** `market_numbers`, `market_digest`, `portfolio` (today's snapshot), `portfolio_digest` (the four print under one heading, "Market and portfolio", from one loader, `portfolio-block.ts`); `the_book` (every stock held and watched, a line each with its belief, `book.ts`); `the_analysts` (each analyst's room); `the_stock` (the `get_theses` row); `stock_data` (the Writer's data pull, with our history with the stock); `playbook_record`; `earnings_this_week`; `filings_this_week`; `refused_calls`; `last_output` (the agent's own last write-up, or its digest and notes).

**The engine** (`engine.ts`): `buildAgentRequest(record, input, sources)` reads each text the record names, `composeAgentRequest(record, input, loaded)` puts them together, and the request names every part (its id, title, kind, where it went, its source, its size). The run saves that manifest with what it sent (`run-requests.ts`), and the Context panel shows a request as the agent is made: Instructions (its own text and each shared text, named), Context (the date line and each read, named), Message, Tools.

## The agents

| Agent | Instructions | Context | Its message comes from |
|---|---|---|---|
| Morning run | the analyst, its own text (with the regime's rules), house rules, how you write | the four Market and portfolio reads, earnings this week, filings this week, refused calls | the schedule's kickoff (or the Run button), with the watched stocks at their buy price |
| Trigger run | the analyst, its own text, house rules, how you write, the playbooks (a review of a watch only); the stock's situations | market numbers, the stock | the trigger check: the trigger that fired, its price and the fire's facts, said once, then the ask |
| Post-trade write-up | the analyst, its own text, house rules, how you write | the four Market and portfolio reads, the stock | the trigger check: the trade the Auto trigger made, then the ask |
| Writer | the analyst, house rules, how you write, the playbooks, the research rules, its own text | market numbers, the stock (on a refresh), record by playbook, the stock's data | the sender's brief: why it was sent, what the sender found, whose idea it was, what the chat found |
| Holding refresh | the analyst, house rules, how you write, the research rules, its own text | the Writer's | the sender's brief |
| Portfolio Manager | its own text, house rules, how you write | market numbers, market digest, the portfolio, the book, its last write-up | none: the date line is its start |
| Market Reviewer | its own text | market numbers, the portfolio, the book, its last digest and notes | none |
| Portfolio digest | its own text | the portfolio | none |
| Chat | its own text, house rules, how you write, pinned the analyst | on each message you send: the four Market and portfolio reads, pinned the analyst's book, at the portfolio level each analyst's room | you |

## The rules for a change to an agent

1. **One edit to a record at a time**, with the Context panel before and after.
2. **Same words wherever the change doesn't move them.** A test built from the old builder's output proves it part by part (`engine.test.ts`, `three-parts.engine.test.ts`, the Portfolio Manager's wire golden).
3. **Where the words change, the yardstick scores it** (below), and the change stays only if the scores hold.

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

A replayed case's date line is the date its run started (the run's start time, or the case's `runDate`). Until 11-18 the cutter took the UTC date, so seven of the eight Writer cases were told the next day; every score measured before then ran both versions on those same dates.

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

### Simple records, then the three parts (2026-11-18)

The simple-records step made each agent's own text one fixed string and put every fact in the first message (#1017–#1027; their measurements are in git history). It still cut each old prompt into 45 named "blocks" (`today`, `why_sent`, `sender_notes`, `idea_source`, `fired_trigger`…), and the owner rejected that. The three parts replace it:

- `today` and the chat's time line → the date line.
- The Writer's `why_sent`, `sender_notes`, `idea_source` and `chat_found` → its message, the sender's brief; `existing_thesis` and `promotion` → the stock (its row has `paper_record`); `prior_exit` → the stock's data (its history); `setup_record` → record by playbook; the five rule texts → `research_rules`.
- The trigger run's `fired_trigger`, `fire_facts` and the ask → the message from the trigger check, said once (the trigger's sentence and its note had printed three times and twice); `stock_row` → the stock; its playbooks → the shared text.
- The morning run's regime rules → its own text; the watched stocks at their buy price → its kickoff; `blocked_last_time` → refused calls.
- The chat's scope, money and book → the analyst (whose rules now carry the fence) and the book, on each message; each analyst's room → the analysts, on each message.
- The Portfolio Manager's `watching` → the book; `last_writeup` → its last output. Its Market and portfolio reads move from its instructions to its first message, as every agent's do.
- The Market Reviewer's beliefs → the book; its notes and last digest → its last output.
- `market_block_rule` → back into the house rules.

Measured on the way (`scripts/hero-case.ts`, the morning set, 4 runs a case): printing an unfenced analyst's three fence lines ("every sector", "no bound", "(none)") to every agent took the morning set from 5 of 12 to 2 of 12; printing the fence only where it narrows brought it back to 5 of 12. The fire message keeps the trigger's declared action, which the trigger run's instructions act on, and the morning kickoff keeps the cash when the snapshot can't be read, which the regime line used to say.

Two measured placements stay: the analyst opens the instructions of the agents that work for one (the morning run's MU case), and the stock's situations end the instructions (the trigger run's NVDA case: 6 of 6 there, 3 of 6 in the message).

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
