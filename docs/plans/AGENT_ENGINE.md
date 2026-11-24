# The agent engine

**An agent is three things: its instructions, its context and its tools.** Nothing else. Every agent is one record that says those three, and one engine builds every model request from a record. What the owner sees on the Agents page, the Framework page and a run's Context panel is read from those records and from what the run saved.

The design (2026-11-18) is the top section of the audit page, https://claude.ai/artifact/LqoCe8qF1uo1Nb7A27hP2U. It follows the published guides: an agent is a model, its instructions and a few tools in a loop (OpenAI, *A practical guide to building agents*; Anthropic, *Building effective agents*); the instructions stay the same on every run, with a small always-useful fact like the date slotted in (OpenAI Agents SDK); what the run is about comes in the first message, written by whoever starts it (Claude Agent SDK); a few things are loaded up front and the rest fetched with a tool (Anthropic, *Effective context engineering*).

## The three parts

| Part | What it is | Where |
|---|---|---|
| **Instructions** | One document per agent (`lib/agent/engine/agents/<agent>.md`), the same on every run. A file imports another with a line of its own, `@rules.md`, as CLAUDE.md imports with `@path`; the engine inlines it where it stands (`instructions.ts`). Every agent that writes for you imports `rules.md`; the Writer and the Holding refresh also import `research-rules.md`. The Context panel shows it as one row, "Its instructions (<agent>.md)", each import marked where it starts; the Agents page shows it in one box, as it is sent. No instruction text is in TypeScript | the record (`instructions`), `lib/agent/engine/agents/*.md`, `instructions.ts` |
| **Context** | The facts about what the run is about. Every run has a subject (the account, an analyst, a thesis, or the chat) and the subject brings its bundle (`lib/agent/context/bundles.ts`); the record lists which of them it reads, and may read nothing outside it. One loader per fact, keyed to the subject (`lib/agent/context/`), and the engine calls them: no agent's run code builds context. Most go in the first message; a few the record sends with the instructions, where they were measured (the analyst first, the stock's situations last), and they are context all the same: the Context panel lists them under Context, "sent with the instructions". In a conversation (the chat) the first message's facts ride on each message you send | the record (`subject`, `instructions`, `context`), `lib/agent/context/`, `parts.ts` (`CONTEXT`) |
| **Tools** | The tools it may call | the record (`tools`) |

Two more things are in every request, and neither is a part an agent chooses:

- **The message**: the run's task, written by whoever starts the run (you in the chat, another agent's brief, the trigger check, the schedule's kickoff), `AgentInput.message`. The record's context list says where it goes ("message"): last for every agent but the Writer and the Holding refresh, which list it right after the date line. Measured on sndk-writer-watch, 10 runs each: with the brief last the Writer kept the view 3 times, with it before the stock's data 9, as before the three parts.
- **The date line**: the first line of every first message, "Wed, Nov 18, 2026, 10:00 AM ET, the PAPER account." (`dateLine`, `engine.ts`). Not configurable.

**The files agents import, in `lib/agent/engine/agents/`:**
- `rules.md`: the house rules (the principal's word outranks everything about a stock; a note is information, not an order; the Market and portfolio context is context, and a stock's row beats it), then how a note, a trade's reason, a trigger's note and the narration are written (`voice.ts` keeps only the measures the tests use). Imported by every agent that writes for you, where the rules printed before: after its own words, or for the Writer and the Holding refresh first. The Market Reviewer, the portfolio digest and Discovery import nothing.
- `research-rules.md`: dates, the research note, the Street and the claim, earnings triggers, what the owner reads first. Imported by `writer.md` and `holding-refresh.md`.

A number written into an instruction file (the Portfolio Manager's three proposals, Discovery's three sends, the Writer's four searches, the digest's length) is checked against the constant code enforces (`moves.engine.test.ts`).

**The subjects and their bundles** (`lib/agent/context/bundles.ts`):
- **A thesis** (trigger run, post-trade write-up, Writer, Holding refresh): the stock's row (`the_stock`, its `get_theses` read through the run's own tool), its numbers and chart (`stock_data`, the Writer's pull, which its save checks against), the analyst (with its room where a buy is a choice) and its record by playbook, the stock's own playbook (`the_playbook`; each of the analyst's when it has none yet), the analyst's playbooks (`playbooks`, which the Writer picks the stock's from), the stock's situations, and the market numbers. A run about a stock gets no portfolio snapshot and no digest, the write-up included.
- **An analyst** (morning run, Discovery): the analyst, its playbooks, its book (its `get_theses` read: a quiet stock one line, a stock in a situation its full row, and what each situation asks, once), the Market and portfolio reads, this week's earnings and filings on its book, and the earnings calendar outside its book.
- **The account** (Portfolio Manager, Market Reviewer, portfolio digest): the Market and portfolio reads, the book (a line a stock), and what the agent wrote on its last run.
- **The chat**: the Market and portfolio reads on each message; pinned, the analyst (its name and id first) and its book; at the portfolio level, each analyst's room.

**The facts (17):** `the_analyst` (`analyst-brief.ts`); `the_playbook` and `playbooks` (`knowledge/playbooks.ts`); `situations` (`situations.ts`); `market_numbers`, `market_digest`, `portfolio` (today's snapshot), `portfolio_digest` (the four print under one heading, "Market and portfolio", from one read, `portfolio-block.ts`); `the_book`; `the_analysts` (each analyst's room); `the_stock`; `stock_data`; `playbook_record`; `earnings_this_week`; `filings_this_week`; `earnings_calendar`; `last_output` (the agent's own last write-up, or its digest and notes); `manager_writeup` (the Portfolio Manager's write-up from that day, for the evening summary).

**The engine**: `buildAgentRequest(record, input, run)` (`build.ts`) reads each fact the record lists through its loader for the run's subject (`loadContext`, `lib/agent/context/index.ts`), and `composeAgentRequest(record, input, loaded)` (`engine.ts`) puts them together with the instruction files; the request names every part (its id, title, kind, where it went, its source, its size). The run saves that manifest with what it sent (`run-requests.ts`), and the Context panel shows a request as the agent is made: Instructions (its one document, each import marked where it starts), Context (the date line and every fact, each with where it was sent: with the instructions, in the first message, or on your newest message), Message, Tools.

## The agents

| Agent | Subject | Instructions | Context | Its message comes from |
|---|---|---|---|---|
| Morning run | an analyst | `morning-run.md` (the regime's rules in it), importing the rules | sent with the instructions: the analyst; first message: the four Market and portfolio reads, its book, earnings this week, filings this week | the schedule's kickoff (or the Run button), with the watched stocks at their buy price |
| Trigger run | a thesis | `trigger-run.md`, importing the rules | sent with the instructions: the analyst, the stock's playbook, the stock's situations; first message: market numbers, the stock | the trigger check: the trigger that fired, its price and the fire's facts, said once, then the ask |
| Post-trade write-up | a thesis | `post-trade-writeup.md`, importing the rules | sent with the instructions: the analyst; first message: market numbers, the stock | the trigger check: the trade the Auto trigger made, then the ask |
| Writer | a thesis | `writer.md`, importing the rules and the research rules | sent with the instructions: the analyst before, the analyst's playbooks after (moved there when the rules became its import; scored); first message: market numbers, the stock (on a refresh), record by playbook, the stock's data | the sender's brief: why it was sent, what the sender found, whose idea it was, what the chat found; right after the date line, before its context |
| Holding refresh | a thesis | `holding-refresh.md`, importing the rules and the research rules | sent with the instructions: the analyst; first message: the Writer's | the sender's brief |
| Portfolio Manager | the account | `portfolio-manager.md`, importing the rules | market numbers, market digest, the portfolio, the book, its last write-up | none: the date line is its start |
| Market Reviewer | the account | `market-reviewer.md` | market numbers, the portfolio, the book, its last digest and notes | none |
| Portfolio digest | the account | `portfolio-digest.md` | the portfolio (the snapshot its job saves) | none |
| Chat | the chat | `chat.md`, importing the rules | sent with the instructions, pinned: the analyst; on each message you send: the four Market and portfolio reads, pinned the analyst's book, at the portfolio level each analyst's room | you |
| Discovery | an analyst | `discovery.md` | sent with the instructions: the analyst; first message: its book, the earnings calendar | the schedule's kickoff |

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
- The Market Reviewer and the digest call OpenAI directly, not through the AI SDK, so their move has to show the same body sent through the SDK. Moved (step 6 below): the digest's body through the SDK differs only in the role of its instructions ("developer") and `prompt_cache_key`; the Reviewer's also in three of the SDK's own (`include` of the search's sources, `tool_choice: "auto"`, the first message as a text part). The text the model reads is the same. The wire tests list them. How each is called sits on its record, beside its model and limits: `api` (Chat Completions or Responses), `maxOutputTokens`, `providerTools` (ids; the page names them), `searchesPerCall`, and `reply` (a data reply's name and its JSON schema, made from the run's input, the Reviewer's from the stocks in its book).
- The Writer's record names `submit_thesis`, which its loop never reads: it makes its tools itself.

**One scheduler.** The schedule is one list (`SCHEDULE`, `lib/agent/engine/schedule.ts`): each scheduled agent, its time in New York as a cron, one run per traded book or per enabled analyst, whether a closed market skips it, on or off. One Inngest function (`agent-scheduler`) is triggered at each time an agent that is on runs, and runs every agent due then through `runAgentAsRun`. A new scheduled agent is a line there, and how it runs one entry in the scheduler's `SCHEDULED_RUNS`; a change to its times needs an Inngest sync after the deploy. A scheduled agent's "when it runs" is read from its line (`whenItRuns`): its record keeps no second copy, and `runsWhen` stays only on the agents an event starts. The first new agent written this way is Discovery: its record (`lib/agent/engine/agents/discovery.ts`, instructions, context and tools), its run's reads and tools (`lib/agent/discovery/run.ts`) and a schedule line, off; the schedule writes its kickoff. The Portfolio Manager moved first; its own cron job is deleted.

The model call moves unchanged. The bookkeeping (the thread, the token use, the status) becomes one way once two or three agents run on the runner, where the differences above are settled one at a time.

The order, each its own PR:
1. The Portfolio Manager: one call, no retries. Then the runner keeps the books: `runAgentAsRun` opens the run, runs the agent and saves its thread (its opening by `openingOf`, as the morning and trigger runs save theirs), its token use, its notes on its proposals, the agent's own save (the PM's write-up) and its status, FAILED when the call failed or ended without its last reply, set only while the run is RUNNING.
2. The trigger run and the post-trade write-up, once the open trigger-run PRs merge.
3. The Writer, once the Writer split and the date fix merge. Done on top of the Reviewer and the digest: the research call goes through `runAgent` (the body byte for byte the loop's; the kept record names the call "Main"), and the runner learned what it needed: Anthropic's cache marks, its web search with a cap, a save that ends the run (`endsWith`), every step's text, and what a call cut short had done. Its data pull, its repair turns and its save stay its own. Its toolset is every research tool and its save; its record names the ones it gets.
4. The morning run, once its simple record merges.
5. The chat, once its simple record merges. It streams, so the runner gains a streaming call.
6. The Market Reviewer and the digest.

### After

Then come the agent changes on the audit page, each one an edit to a record:
- what each agent is given;
- tools per agent;
- the playbook writing its triggers;
- one way to make a view.
