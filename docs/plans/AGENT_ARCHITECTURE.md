# How the agents should be built

> **Status:** final proposal, 2026-10-02. Steps 1 and 2 are approved and in
> progress, one PR each. Step 3 onward waits for the test cases. Section 9
> records each decision.
>
> **This is the one page for this work.** It holds the research, the audit,
> the design, the build order, what the reviews raised, and the decisions.
> Section 8 says how it relates to the other plan pages.
>
> **Measured on** main at `1831f149` and on every run from 2026-09-02 to
> 2026-10-02. The deletions PR merged later the same day and changed about
> 1,100 characters of the five texts; nothing else here moved. A number is
> measured unless it says "estimate". Written for Dave first; the
> appendices are for whoever builds it.

---

## The short version

### What we found

| | Finding | The number |
|---|---|---|
| 1 | A third of the morning run's text can simply go | 31% is dead, repeated, enforced by code anyway, not its job, or for something that has never happened. 23% is needed on every run |
| 2 | The first read of a morning run is mostly not about the decision | 29% raw history, 18% a copy made for the screen, 29% research text. About 19% is what the decision needs |
| 3 | Part of that read is out of date and looks current | One stock's row said $348, "clean uptrend", score 8. The stock was $273. No morning run changed a score in 251 saves |
| 4 | A third of what morning runs review are stocks with no buy price | 83 of 236 stock reviews. Two flags return on every run on stocks that cannot clear them |
| 5 | The same rule is written in several places, with different answers | A pullback's confirmation has three answers. The thesis fields are defined in three tools |
| 6 | OpenAI's cache stopped early because of a random id in a tool definition | Proven: 71% cached as the app sends it, 97% with the id held still |
| 7 | This is not a money problem | All 42 morning runs in the month cost about $71 at list price |

### How it should be built

An agent carries very little all the time and is handed the rest when it
applies. The app already knows each stock's situation, so code attaches the
right text to the stock. Each rule is written in exactly one place.

| Piece | Who gets it, when |
|---|---|
| House rules: the few things particular to Hindsight | Every agent, always |
| The analyst: its strategy and numbers | Any agent acting for it |
| The job: what this agent is responsible for | That agent only |
| Playbooks: the house's method for one situation or one setup | Whichever agent is handed a stock in that situation, with the stock |
| The stock brief: what's been said, why it is on the list, the plan | With the stock. Research and history on request |
| Checks in code: anything that must never happen | Always enforced |

### The order

Content first, structure second. Moving text before cleaning it would only
move bad text.

1. Fix the cache and record token use for every agent.
2. Build the test cases: single real decisions, scored by code.
3. Delete what is dead, repeated or already enforced.
4. Fix the read.
5. Slim the tool definitions and define the thesis fields once.
6. Move each situation's text onto its flag, one at a time.
7. Write the house rules and cut each job to what is left.
8. Lessons get one home, and a test.

### Decisions, as of 2026-10-02

1. Steps 1 and 2: approved, one PR each. Step 3 onward waits for the cases.
2. The deletions PR: merged.
3. The score check: not approved. No change for now; revisit at step 6.
4. Two flags stop putting no-buy stocks on every morning list: approved,
   with a rule for the stock nothing can wake.
5. The pullback notice from the earlier plan still stands.

Details are in section 9.

---

## 1. How agent systems are meant to be built

Six research passes covered the published guidance from Anthropic (context
engineering, agent skills, writing tools for agents), OpenAI (prompting
guidance for its current models), Cursor (rules, loading context on demand),
Claude Code (memory, skills, sub-agents), Perplexity, Cognition and Manus.
They agree on seven things.

1. **A small text is always present. Everything else arrives when it
   applies.**
2. **An agent's own text says its job and nothing else.**
3. **Knowledge for a situation is written once and loaded when the situation
   is present.** Code loads it when the app can tell. The agent picks it when
   a person is steering.
4. **Tool replies are written for the model.** The facts of the decision come
   first and the detail is available on request.
5. **Tools are few and small, and a field says what it is.**
6. **A rule that must hold is a check in code.** The refusal says what to do.
7. **A change is tested on recorded cases before it goes live.**

How Hindsight scores against them:

| Principle | Hindsight today |
|---|---|
| Code does what is deterministic; the model judges | Good. Code picks what needs work, sizes trades and enforces checks |
| State lives outside the model | Good. Theses, the activity log and notes |
| Tool replies are written for the model | Bad. See 2.3 |
| Few, small tools | Bad. One tool has 41 fields |
| Each rule has one home | Bad. See 2.5 |
| Changes are tested on recorded cases | Missing. This is the largest gap |

---

## 2. What we measured

### 2.1 What a month of runs did

**Morning runs: 42 runs, 536 requests.** They read 33.6 million tokens and
wrote 160,000. They were handed 236 stocks to review.

| What the run did with the stock | Stocks |
|---|---|
| Changed something on the plan | 102 |
| Said the plan stands | 77 |
| Sent it to the writer for fresh research | 23 |
| Saved nothing | 21 |
| Proposed a sale | 7 |
| Moved a target or stop | 4 |
| Proposed a buy | 2 |

| Why the stock was on the list | Stocks |
|---|---|
| A review trigger had fired | 100 |
| A flag on the plan, nothing else | 49 |
| Research had gone stale | 43 |
| A scheduled review was due | 15 |
| A sale trigger was live | 11 |
| A buy level was live | 6 |
| Other | 12 |

83 of the 236 were watched stocks with no buy price.

**Trading happens in the trigger runs.** 32 buy fires, 43 sale fires and 12
add fires came through them. The 32 buy fires led to 12 buy proposals,
morning runs added 2, and 10 of the 14 were bought. 46 sale proposals were
raised and 6 were executed.

**The book on 10-02:** 11 held, 32 watched, 20 of them with no buy price. It
carries 190 triggers: 150 are reviews and 12 are buys. About 170 of the
month's 271 fires were reviews. 90 were one kind, "price below its average".

### 2.2 The morning run's text

The Compounder's real text on 10-02 was 49,295 characters. Each paragraph was
read against the code and the month of runs. These shares are a judgment per
paragraph, so treat them as within 5 points.

| What the paragraph is | Share | Verdict |
|---|---|---|
| Needed on every run | 12% | Keep |
| The analyst's own strategy | 11% | Keep |
| For a situation that comes up most runs | 14% | Load when it applies |
| For a rare situation | 23% | Load when it applies |
| Explains the fields of the read | 8% | Belongs with the read |
| Said a second time in the same request | 11% | Delete |
| Code already does or enforces it | 6% | Delete, or cut to a line |
| Not this agent's job | 6% | Delete |
| Dead, or left without its heading | 4% | Delete |
| For promoted stocks, which has never happened | 4% | Delete |

Examples of the last five rows:

- It tells the run to resend the whole trigger list. That input was removed
  on 2026-09-09.
- It says to cite signal ids. There are no signals. The run sent an empty
  list 9 times.
- A press, hold or take block lost its heading on 2026-08-25 and now sits
  under the wrong bullet.
- The rule that a floor only moves up appears five times in one request.
- It says a plan set down costs nothing. A flag on the stock then says to
  price it or let it go, and brings it back on every run.
- Yesterday's digest covers the whole account, including other analysts'
  trades.

The deletions PR, merged 2026-10-02, removed about 1,100 characters across
all five texts.
About 15,000 are removable from the morning text alone. Appendix B lists
them.

### 2.3 The read

A morning run opens by reading its stocks. For the Compounder on 10-02 the
data in that reply was 266,767 characters, about 70,000 tokens, and it is
sent again on every later step.

| Part of the read | Share |
|---|---|
| Raw history. The "what's been said" block already sums it up | 29% |
| A second copy of each stock, built for the screen | 18% |
| The writer's research text: bull and bear cases, snapshot, score notes | 29% |
| What the decision needs: plan, triggers, flags, belief, what's been said | 19% |
| The one-line list of quiet stocks, and empty fields | 5% |

Two things make it worse than long.

- **The research text and the score are as old as the writer's last visit.**
  One row carried a write-up from 51 days earlier: $348, a clean uptrend, a
  score of 8. The stock was $273. Morning runs changed a score 0 times in
  251 saves. The buy check and the score flag both read that score.
- **The tool's own definition tells the run to ask for raw history** on a
  review. The "what's been said" block was built to replace it. The run now
  gets both in most runs.

### 2.4 Tool definitions

The morning run's tools are 60,848 characters as sent, more than its text.

- "Update a thesis" is 47% of that. In 251 morning saves, 16 of its 41
  fields were never used. The trigger run used 16 of the 41.
- Seven of its trigger sub-fields are written only by the server, and the
  model is shown them anyway. One of them carries the random id in 2.6.
- 3 of the morning run's 18 tools and 6 of the trigger run's 14 were never
  called in the month.
- "Record a thesis" opens with instructions for a staged run that was
  deleted in May. One of its required fields is for signal ids.
- The thesis fields are defined in three tools. Two of them share 30 fields,
  and 1 is worded the same in both.

### 2.5 The other agents

The same breakdown for the other agents, from their real texts. These were
classified by section, not line by line against the code.

| Text | Applies to the case in hand | For another case | Repeated, dead or not its job |
|---|---|---|---|
| Trigger run, when a buy fires (28,304 characters) | 69% | 16% | 15% |
| Trigger run, when a sale fires (30,219) | 62% | 24% | 14% |
| Chat, on every message (44,318) | 24% | 60% | 16% |
| Writer, for a new thesis (15,410) | 89% | 7% | 3%, enforced by code |

- **Trigger run.** Code knows which action fired before it writes the text,
  and writes the answer to every action anyway. The text calls a buy an
  "add" throughout. 6 of its 14 tools were never called; they are 26% of its
  tool text. Its 85 saves used 16 of the 41 thesis fields, 7 of them often.
- **What 87 fires produced.** 51 trade proposals, 18 of them sales that went
  straight to a proposal with no model. 6 stop or level moves. 13 passes. 4
  plans taken down or theses retired. 13 buys refused by the buy tool: the
  analyst was full (5), the score was under its minimum (5), or the size was
  outside its band (4, counting a second attempt in one run).
- **Chat.** The discovery procedure is 32% of its text, on every message.
  Procedures for other requests are 28%: proposals, research requests,
  example questions, and a reference for a database tool not used in the
  month. 11% describes tools that already describe themselves and 5% is
  dead. It is told to finish with two tools it does not have, and that a
  briefing job keeps each analyst's memory; that job does not exist.
  "Record a thesis" is 31% of its tool text and was called once.
- **Writer.** The cleanest. Its text is already built per case. Its weight
  is elsewhere: half of a run's input is web search results, and its single
  tool's definition is 45,000 characters, three times its text, because the
  trigger shapes repeat six times. Of 70 runs, 56 completed and 13 failed.
- **Discovery agent.** It has not run since 2026-05-31. Three other texts
  still say it runs on Sundays.

Rules that are written in more than one place, with different answers:

| Rule | Where it is written | What it cost |
|---|---|---|
| What confirms a pullback buy | The setup list, the writer, the trigger run: three answers | DOCU passed on 09-28 and bought two days later, 2.8% higher |
| When a buy is allowed by score | The score's definition asks whether the entry has formed; the buy check reads a score taken before the entry existed | Seven buys refused on score since 08-25 |
| What a declined sale means | Chat is told to stop proposing; the ruling is "not today" | Wrong advice in chat |
| Whether a plan set down costs nothing | The morning text says yes; the flag on the stock says price it or let it go | The stock returns on every run |

### 2.6 The cache

A morning run sends the same growing conversation on every step, so most of
each request should be read from OpenAI's cache at a tenth of the price. In
August a comment in the code recorded that the cache stopped early and that
the limit was on OpenAI's side. That is wrong.

- A tool definition carries a random id as a default value. The definition
  is rebuilt on every request, so the id changes every time, and the cache
  stops at that point.
- Since 08-19 almost every morning request cached the same fixed number of
  tokens, however long the conversation was. That number rose in steps over
  the weeks, which fits text being added ahead of the id.
- Tested on 2026-10-02 with four calls: the request as the app sends it
  cached 71%. The same request with the id held still cached 97%.

### 2.7 Cost

| | Tokens | Cost at list price |
|---|---|---|
| Input, not cached | 26.8 million | $66.89 |
| Input, cached | 6.9 million | $1.71 |
| Output | 0.16 million | $2.41 |
| **42 morning runs** | | **about $71** |

With the cache working, the same month would cost about $18 (estimate). The
other agents' token use is not recorded, so it is not priced here.

The tokens are a quality problem. Four fifths of what a run reads is not
about the decision in front of it, and some of it is wrong.

---

## 3. What is wrong, in order of how much it matters

1. **Agents are handed content that is wrong or out of date as if it were
   current.** Old research and an old score beside a live price.
   Instructions for things that no longer exist. Two instructions in one
   request that disagree.
2. **The morning list is filled with stocks that cannot become a trade.** A
   third have no buy price. Flags return them on every run.
3. **One rule lives in many places.** A fix lands in one of them. This is why
   one fix keeps producing the next bug.
4. **Everything is loaded all the time.** Thirteen situations, 41 fields and
   tools that are never called.
5. **The cache bug.** Cheap to fix, and most of the bill.
6. **Only the morning run is measured, and no recorded case tests a change.**

---

## 4. How it should be built

An agent's input is assembled from six pieces. Each piece is written in one
place.

| Piece | What it holds | Who gets it | When |
|---|---|---|---|
| **House rules** | The few things particular to Hindsight that a model gets wrong unless told | Every agent, including chat with no analyst selected | Always |
| **The analyst** | Its strategy and its numbers, as today | Any agent acting for that analyst | Always |
| **The job** | What this agent is responsible for, what is out of scope, how it finishes | That agent only | Always |
| **Playbooks** | The house's method for one situation or one setup, with its known mistakes | Whichever agent is handed a stock in that situation or on that setup | With the stock |
| **The stock brief** | What's been said, why it is on the list, the plan, the triggers, the score with its date | Whichever agent is handed the stock | With the stock. Research and history on request |
| **Checks in code** | Anything that must never happen | Nobody has to remember them | Always enforced |

The rules that hold it together:

1. **Code decides what to attach.** The app already knows a stock's flags,
   its setup and which trigger fired. Each flag carries its own instruction
   to the agent. This is half built: the flags on a plan already arrive with
   their own text, and a save already replies with what the change means.
2. **When several apply, each rides on the stock in the order the code
   already ranks them.** One save answers all of them. Protecting a holding
   outranks pricing a buy.
3. **When none applies,** a short default says how to review a stock with
   nothing flagged.
4. **When something new turns up mid-run,** the instruction rides on the tool
   reply that reveals it. As a fallback there is one lookup tool. It exists
   today and chat has it. The runs get it only if a test case shows they
   needed it.
5. **Chat works the same with no analyst selected.** House rules are always
   present, and playbooks ride on the stock, not on the chat's scope.
   Procedures a person asks for, such as discovery or reviewing proposals,
   are lookups chat loads when asked.
6. **A tool says what a field is.** The thesis fields are defined once and
   used by all three thesis tools. Each agent is given only the fields its
   job uses. Fields only the server writes are never shown to the model.
7. **The house's method is written down. General finance is not.** The model
   knows what a moving average is. It does not know how this desk reads an
   earnings report, what confirms each setup, or when a floor moves. That is
   written once, in the playbook for that situation or setup.
8. **A lesson has one home.** One setup: that setup's playbook. One
   situation: that situation's playbook. Every stock and every agent: the
   house rules. Must never happen: a check in code. A lesson is added only
   with a test case that fails without it, and each playbook has a size cap,
   so adding one means removing one.
9. **Reference material, if it comes later,** goes behind the same lookup
   tool. There is none to search today. The playbook is twelve setups.

What each agent looks like afterwards:

| Agent | Today | Afterwards |
|---|---|---|
| Morning run | One text with 13 situations, and a read of everything | A short job. Each stock arrives as a brief with the instruction for its own flags |
| Trigger run | One text with the answer to every kind of fire | Code writes only the answer for what fired |
| Writer | Already built per case | The same, with the dead lines out |
| Chat | Everything, plus the discovery procedure, on every message | A short job, the house rules, and procedures it looks up when asked |
| Discovery agent | Has not run since 05-31 | Its text is deleted when discovery becomes one playbook |

---

## 5. The order to build it

Every step is one or two small PRs. Appendix D has the rules each PR follows.

1. **Fix the cache and measure every agent.** Stop the random id reaching the
   tool definition and mint it in code after the call. Add a test that an
   agent's tool definitions are identical from one request to the next. Give
   the trigger run the cache key the morning run has. Record token use for
   every agent. Checked by the cached share on the next morning's runs.
2. **Build the test cases.** A case is one decision cut from a real run. It
   names the tool call the right answer makes, runs six or more times, and is
   scored by code. A whole run cannot be replayed past its first different
   call. Start with about ten: the pullback buy that was passed, a buy
   refused on score, a declined sale that fires again, a review where nothing
   changed, a review that needs the research text, a stock with two flags, an
   earnings review. A size test, a single-decision script and the first
   recorded cases already exist on a local branch
   (`claude/prompt-deletions-full`). This step brings them in and extends
   the size test to cover tool definitions and the read.
3. **Delete.** The dead, repeated, already-enforced and not-its-job text in
   the five texts and the tool definitions, and the tools an agent never
   calls. No structure changes. Add a test that every tool a text names is on
   that agent's list. The deletions PR, merged 2026-10-02, was the first
   slice; the rest of Appendix B was built 2026-10-03 (the step-3 PR).
   One exception to "never called": the filing-reader PR (#753)
   gives the trigger run a reason to call `get_sec_filings`, so that tool
   stays on its list until a re-measure after #753 has run for a while.
   One rule that had to go with it: the field contract test no longer
   requires a prompt to restate a rule the tool refuses.
4. **Fix the read.**
   - a. Keep the screen's copy out of what the model reads. Safe.
   - b. Stop inviting raw history. Checked against the cases.
   - c. Hand over research on request, and show its date and the price when
     it was written. Checked against the cases that need the research: the
     run must ask for it.
   - d. Stop the two flags in decision 4 from listing a stock by themselves.
5. **Slim the tool definitions.** One definition of the thesis fields. Each
   agent gets its own fields. Coaching moves to the playbook, or to the
   tool's reply when the agent gets a field wrong.
6. **Move each situation onto its flag.** One at a time, deleting every other
   copy in the same change. Start with the trigger run, where code already
   knows what fired. Chat's discovery procedure becomes the one discovery
   playbook, and the unused discovery agent text is deleted.
7. **Write the house rules and cut each job.** By now what is left in each
   text is either common, which becomes a house rule, or the job.
8. **Lessons.** Rule 8 in section 4, with no new machinery. A post-mortem
   that proposes lines for approval can come later if it is wanted.

Steps 1 and 2 change no behaviour. Step 4a is safe. Everything else changes
what an agent reads, so it waits for the cases.

The pullback PR and the score decision change which buys go through. They
run alongside this, not behind it.

---

## 6. The next lever, not in the first build

**Review one stock per call in the morning run.** Today one conversation
holds every stock, and each step sends all of them again. Code could loop
over the listed stocks and give each its own short review, then one closing
step for the summary and the decisions that compare stocks. The trigger run
already works this way.

It fits the design, because the brief and the playbooks are per stock. It
also changes how a morning run is stored and shown, so it is not in the
first build. Pull this lever if, after steps 1 to 6, the cases still fail on
large books, or a morning run nears its time limit.

---

## 7. How we will know it worked

It is judged on behaviour first. The sizes are reported, not targeted.

1. Every case passes at least as often as it did before the change.
2. The known duplicates in 2.5 go to zero, and stay there.
3. No text names a tool or a field that does not exist for that agent.
4. The cached share of a morning run is above 80%.
5. The share of morning reviews that end with nothing changed goes down.

It does not promise that any analyst trades better. It should make the
agents agree with each other and read what is true.

**What six runs can and cannot say (learned at step 3, 2026-10-03/04).** A
case's score moves with the day as much as with the text. The NVDA case on
the same code (the cache fix, with only tests added after it) scored 0/12
on Saturday and 5/12 on Sunday; the baseline commit scored 4/6 Thursday,
2/6 Saturday and 1/12 Sunday. So a change of a few runs between batches
means nothing, and a before/after is never read across days. A case is
read three ways: a 6/6 or 0/6 that holds across days is a fact; two texts
are compared in the same hour, twelve runs each; and a difference is
claimed only when the answers differ in kind (a sale proposed vs a review
saved) or by more than the day-to-day swing.

---

## 8. What happens to the work already done

- **The deletions PR, merged 2026-10-02.** It was the first slice of step
  3: the stale and wrong lines only, about 1,100 characters. The size test,
  the single-decision script and the recorded cases were taken out of it and
  kept on a local branch; step 2 brings them in.
- **The pullback PR, not yet opened.** It is the first playbook written the
  right way. After it, no analyst buys a pullback at the dip.
- **The "stock carries its rules" PR, not yet opened.** It is the first piece
  of the brief, and it creates the house-rules file.
- **`AGENT_KNOWLEDGE_PLAN.md`.** It stays as the record of those PRs, the
  pullback test and why the shared trading text was withdrawn. This page is
  the plan above it.
- **`AGENT_CONTEXT.md`.** The parts already built stand: what's been said on
  a stock, notes, and the reply on a save.

What the reviews raised, and where each point is handled:

| Raised by | The point | Where |
|---|---|---|
| Design session | Only removing the screen's copy is safe | Step 4 splits it |
| Design session | Whole runs cannot be replayed; test single decisions | Step 2 |
| Design session | The size targets were guesses | Dropped. Section 7 |
| Design session | A playbook works only if the competing text is deleted in the same change | Step 6 and Appendix D |
| Design session | A lessons step rebuilds the pile of incidents | Rule 8: a failing case and a cap |
| Design session and review 2 | The cache limit looked wrong; the saving was never priced | 2.6 and 2.7 |
| Review 1 | How instructions combine, what happens with no flag, what happens mid-run, chat with no analyst | Rules 2 to 5 |
| Review 1 | The house's method must be written even if general finance is not | Rule 7 |
| Review 1 | Caching must be checked per provider | OpenAI checked live. Anthropic is not checked and is dropped as a step: the writer takes under two steps a run and chat took 70 steps in the month |
| Review 1 | Leave room for searchable reference material | Rule 9 |
| Reviews 1 and 2 | Research on request works only if the agent asks for it | Steps 2 and 4c |
| Review 2 | Check decisions, not only tokens | Each case names the right decision |
| Review 2 | Review one stock per call | Section 6 |
| Review 2 | Rule on the score before situations move | Decision 3 |
| Reviews 1 and 2 | Judge by behaviour, not prompt size | Section 7 |

### What not to do

- **A separate skills system where agents choose what to load.** Fine for
  chat. For a run nobody is watching, code attaching the right text is
  simpler, and the flags already exist.
- **More agents, or an orchestration framework.**
- **A long shared "how to trade" page.** That plan was withdrawn.
- **Move text into playbooks before it is cleaned.**
- **Design to a prompt size.**
- **A knowledge base or fine-tuning.**

---

## 9. Decisions

1. **Steps 1 and 2.** Approved 2026-10-02, one PR per step, built by the
   review session. Step 3 onward waits for the cases.
2. **The deletions PR.** Merged 2026-10-02.
3. **The score check.** The proposal was: when a buy fires from its own
   trigger, check the score with the entry counted as formed, with one sum
   used by the buy check, the flag and the warning on a save. Today the
   score is taken when the thesis is written, before the entry exists, so a
   pullback plan scores low and is refused on the day its level arrives.
   **Not approved.** The QB ruled no change for now; revisit at step 6, when
   the buy situation moves onto its flag.
4. **Two flags stop listing a stock by themselves.** "No buy level" and
   "score under the analyst's minimum" still show on the stock whenever it
   is opened. A stock with no buy price comes onto the morning list on its
   review clock or when a trigger fires, not because of these two. The score
   flag applies only where a buy level exists. This follows the 2026-09-08
   ruling that the review clock is the only attention switch. It would have
   removed 20 of the month's 236 reviews; 17 of those were a stock with no
   buy price flagged "the buy will be refused". **Approved 2026-10-02**, on
   one condition, met here: a watched stock with no buy price, no review
   clock and no trigger is the one case where a flag keeps listing it.
   Nothing else can ever bring it back, so the "nothing can wake it" flag
   puts it on the morning list every run until the run gives it a wake or a
   clock, or lets it go. Last month that was 8 rows in 6 runs. It changes
   what the morning run looks at, not what it may trade. Built in step 4d.
5. **The pullback notice.** Unchanged from the earlier plan.

---

## Appendix A. Where each piece lives

| Piece | File | State |
|---|---|---|
| House rules | `lib/agent/knowledge/house-rules.ts` | In the unopened stock-rules PR, one sentence |
| Jobs | `lib/agent/system-prompt.ts`, `system-prompts/intraday-tactical.ts`, `run-thesis-writer.ts`, `modes.ts` | Each also holds rules and situations today |
| Situation playbooks | On the flags: `needs-action.ts` (8 kinds) and `plan-sanity.ts` (13 kinds) | The plan flags already carry text. The rest moves from the morning and trigger-run texts |
| Setup playbooks | `lib/agent/knowledge/setups.ts` | Exists. Add known mistakes |
| Stock brief | `stock-context.ts` and `stock-rules.ts` (unopened), read by `get-theses.ts`, `list-proposals.ts` and the trigger run | Becomes one builder |
| Order of flags on a stock | `needs-action.ts`, "Precedence when multiple match" | Exists |
| A smaller reply for the model than the screen | `toModelOutput` on a tool, in the installed SDK | Unused today |
| Thesis fields, defined once | New, used by `update-thesis.ts`, `record-thesis.ts` and the writer's `submit_thesis` | 30 shared fields, 1 worded the same |
| Model-facing trigger shape | `lib/agent/triggers/model-schema.ts` | Exists. The writer uses it. The two thesis tools do not |
| Per-agent tool fields | `schemaFor` on `defineTool` | Exists. Used only for sizing fields |
| Lookup tool | `read-knowledge-library.ts` | Exists. Topics: archetype, setup, source, signal |
| Random id | `lib/agent/triggers/schema.ts:215` | The cache bug |

## Appendix B. The delete list

Line numbers are on main at `1831f149`. Built 2026-10-03 in the step-3
PR, except the rows marked as situations (earnings and filings, confirming
a buy, adding to a holding, the buy-fire wording) and the `get_theses`
description, which is step 4. A situation's text is not deleted outright:
it moves onto its flag in step 6.

**Morning run, `lib/agent/system-prompt.ts`**

| Lines | What | Why it goes |
|---|---|---|
| 123–134 | Sectors, industries, themes, market cap, watchlist seeds, exclusions | The run cannot add stocks |
| 139–142 | Yesterday's digest | Whole-account narrative, other analysts' trades |
| 223–231 | Horizon glossary | Names a hold-days field that does not exist; the setup on the stock carries the rule |
| 245 | Per-stock closeout | The end-of-run check enforces it |
| 254–256 | A floor only moves up | In the tool's description and three of its fields |
| 266 | History of the signal inbox | No longer exists |
| 268 | Values for dead and replaced theses | Those rows never arrive |
| 272 | "Resend triggers" | Input removed 2026-09-09. The flag carries its own instruction |
| 274–280 | Sizing multiples and how sizing works | Code sizes every trade |
| 278, 282, 285 | "Routed signal" | No signals |
| 284–287 | When to change conviction | The field says the same. Used 10 times in 251 saves |
| 290–294 | Promoted stocks | No stock has been promoted |
| 301 | The sale-label paragraph | Repeated in the sale tool, with the same story |
| 302 | "Cite signal ids" | No signals |
| 313–316 | Press, hold, take | Its heading was deleted 2026-08-25 |
| 342–350 | Research age | Repeats 322–326. Its thresholds are wrong for watched stocks, which cap at 35 days |
| 352 | "No staleness gate on the buy tool" | Describes a check that is not there |
| 354 | "Pick the right shape (b), (c)" | Those options no longer exist |
| 356 | Retiring a held thesis needs a sale | The tool refuses it |
| 358 | Quiet stocks need no work | Said at 266 |
| 371, 373 | "No need to think about signal ids"; "Discovery (Sundays)" | Contradicts 302; discovery last ran 05-31 |

**Trigger run, `lib/agent/system-prompts/intraday-tactical.ts`**

| Lines | What | Why |
|---|---|---|
| 172–174 | The May failure story | A story |
| 240 | "No staleness gate" | Describes a check that is not there |
| 290–294, 322–330, 483 | A buy is called "add"; no line says what a buy fire does | Wrong name for the main case |
| 295–303 | The sale-label paragraph | Repeated in the sale tool. Only for a sale |
| 304–321 | Earnings and filings | Only when that kind fired |
| 331–374 | Confirming a buy | Only on a buy |
| 379–419 | Adding to a holding | Only on an add. 12 of 87 fires |
| 452–458 | Two rules the tools enforce | The refusal says them |
| 470–492 | The tools list | The tools describe themselves. It names one the run is told not to use |
| 508–514 | Formatting rules | The run wrote 604 characters of prose in 69 runs |

**Chat, `lib/agent/modes.ts`**

| Lines | What | Why |
|---|---|---|
| 659, 667, 692–696 | Monitors, intelligence policy, signal tables | Nothing writes to them |
| 665, 805, 873 | Discovery runs on Sundays | Last ran 05-31 |
| 666 | The briefing agent | No such job |
| 711 | A repeated decline means stop proposing | The ruling is "not today" |
| 745–773 | The toolkit | A second description of every tool. Names an action that does not exist |
| 823 | Trade results, inside the discovery pool list | In the wrong place |
| 832 | "ACTIVE" status | Removed |
| 849, 873 | Finish with the run summary and complete tools | Chat does not have them |
| 888 | The gaps doc | Deleted 2026-09-15 |
| 904 | The closing line | Written as a different product |

**Tool definitions**

| Tool | What | Why |
|---|---|---|
| `update_thesis` | `signal_ids`, `trade_id`, three fields that call themselves legacy | Dead or duplicate |
| `update_thesis` | `direction` and `horizon` descriptions | Name a status and an input that were removed |
| `update_thesis`, `record_thesis` | Trigger items use the server's shape | Random id, seven server-only fields, a story in the cooldown field |
| `record_thesis` | "Stage 3 only" description; `status` "ACTIVE"; `source_kind`, `source_signal_ids`; the day-trading overlap field | A flow, a status, a pipeline and an analyst type that are gone |
| `close_position` | The story in the sale-label field | Repeated in two texts |
| `get_theses` | The description invites raw history; the screen copy is in the model's reply | 2.3 |
| Morning list | `get_earnings_calendar`, `get_market_movers`, `get_catalyst_calendar` | Never called in the month |
| Trigger-run list | `get_catalyst_calendar`, `web_search`, `get_theses`, the two writer tools | Never called in the month |
| Trigger-run list | `get_sec_filings` | Never called in the month, but the filing-reader PR (#753) gives it a reason to be. Re-measure after #753 before removing it |

## Appendix C. Measurements

- **Period:** 2026-09-02 to 2026-10-02. Morning runs 42, trigger runs 87,
  writer runs 68, chat sessions 23, discovery runs 0.
- **Morning tokens:** input 33,610,877, cached 6,855,552 (20.4%), output
  160,558, requests 536. List price per million: $2.50 input, $0.25 cached
  input, $15 output.
- **Cached tokens per request,** the same on every step of every run: 3,584
  until 08-18; 10,880 from 08-19; 12,928 from 08-31; 14,976 from 09-18;
  17,024 for the Compounder from 09-30.
- **Cache test, 2026-10-02:** first request 23,937 tokens, 0 cached. Second
  step with identical tool definitions: 23,168 of 23,972 cached. Second step
  as the app sends it: 17,024 of 23,973. About 10 cents.
- **Morning text as sent on 10-02:** PEAD 46,234 characters, Catalyst 46,721,
  Compounder 49,295. Tool definitions as sent: 60,848, of which
  `update_thesis` 28,731.
- **The 10-02 Compounder read:** 266,767 characters. Ten full stocks 210,242
  (history 77,804; bull and bear cases 44,681; triggers 16,921; snapshot
  10,671; score notes 8,976). Screen copy 48,271. Quiet list 7,950.
- **Morning saves, 251:** fields never used: `thesis_bullets`, `risk_flags`,
  `core_belief`, `key_assumptions`, `scoring`, `horizon`, `catalyst_date`,
  `research_data` and the eight research-note sections.
- **Buy-price changes in the month:** morning runs gave 10 and took away 13;
  the writer gave 3 and took away 6; chat gave 12 and took away 6.
- **Orders:** buys 14 proposed, 10 filled. Sales 46 proposed, 6 filled, 19
  declined, 21 expired.
- **How:** read-only scripts over the saved run conversations and the
  activity log, removed after use; the request bodies were captured without
  calling OpenAI; four test calls for the cache.

## Appendix D. Rules for every PR in this plan

1. Cases from real runs, shown before and after, six or more runs each, on
   the model that agent uses.
2. The measured total for the agent it touches is reported. If it goes up,
   the PR says why.
3. A text that moves is deleted from where it was in the same PR.
4. A PR adds no new instruction text. It deletes or moves text, unless a
   case shows a rule is missing.
5. A PR that changes what the morning run reads merges alone, before a run
   day that can be watched.
6. No merge without Dave's click.
