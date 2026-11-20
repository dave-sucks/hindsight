# How we build agents

> The standard for every agent in Hindsight, from the architecture down to the words in a sentence. Read it before you change an agent, a playbook, a rule, a context item, a skill or a tool.
>
> It is a living document. When we learn something that should hold for every future change, it goes here, in the same PR. It holds rules, not history: the history is in git and the PRs.

---

## 1. Two perspectives, always both

Every change is judged twice.

**The expert trader** has run money for twenty years in the style the change touches: breakouts, pullbacks, earnings drift, compounders, biotech events. They ask three things:
- What exactly would I look at here?
- What number would make me act?
- What would I do?

Every field, rule and sentence has to survive those questions in the details: the exact column, the exact percentage, the exact verb. "Review if below the 200-day average" and "Stop watching if below the 200-day average on the close" are different decisions. The trader knows which one their style means, and why.

**The agent architect** builds agents for a living and keeps up with how the best ones are built. They ask three things too:
- Is this in its one right home?
- Will a model read it the way we mean it?
- Can we show the change made the agent better?

When the two disagree, the trader decides what the firm does. The architect decides where it lives and how it is written.

---

## 2. How a trading firm works, and where each part lives here

A disciplined trader approaches every stock through the same few layers, and each layer has one home here.

| What the trader has | What it means on a real desk | Home in Hindsight | Today |
|---|---|---|---|
| A strategy for each kind of stock | Stocks like this are always approached the same way: buy the breakout from a base on volume; buy the pullback to a rising average; buy after an earnings gap that holds; run up into an event and get out before it. Each strategy comes with its own sell rules. | Playbooks (`lib/agent/knowledge/playbook-templates.ts`, Settings → Playbook). The Writer names a stock's playbook, and code writes its triggers from the chart. | Built. The rules themselves are not yet reviewed (§8). |
| A plan for one stock | After studying one company: these are my levels, this is what would make me buy, add, trim or leave, and this is when I look again. | The stock's own triggers (`edit_triggers`), each with its reason. | Built |
| Rules for everything, by the numbers | Any stock that moves 7% in a day on heavy volume gets a look. Every stock gets a look the day after it reports. These apply whatever the playbook. | Account rules (Settings → Triggers) and analyst rules (the analyst's Triggers tab), inherited by every stock. | Partly. The earnings rule is set; a big-day rule is not. |
| News that matters whatever the price does | A CEO resigns, a drug is rejected, a deal is announced. The chart can be flat while the decision changes. | The Market Reviewer's notes, each marked by impact. | Partly. "High" is over-used, and it wakes only the next morning run. |
| The book and the market | Before any buy: how many positions, how much in one sector, how much cash, and what the market is doing. This can overrule a buy on one stock. | Position sizing (`lib/agent/position-sizing.ts`) and the Portfolio Manager. | Partly. Concentration and market conditions have no written rules. |
| A scan for new names | Every night the whole market is screened for stocks that fit a strategy. A rule that finds new stocks is a scan, not a trigger: triggers only watch stocks we already follow. | Discovery and its screens (`run_screen`). | Built, and switched off |
| Looking back | Every closed trade is graded: did the plan work, and did we follow it? | The trade evaluator, the weekly accuracy report, Performance. | Partly |

Two rules hold across the layers.
- **Which rule wins.** A stock's own trigger beats every rule it inherits from its analyst or the account. When two triggers on one stock disagree, for example a playbook's "Stop watching below the 200-day" and an account rule that buys below it, that is a bug in the rules. Fix it in the rules; don't leave an agent to settle it run by run.
- **What may trade by itself.** An account or analyst rule can wake an agent, or sell by itself (Auto-sell). Only the owner can make a buy, add or trim Auto, and only on one stock (`lib/agent/triggers/fire-mode.ts`). Every other fire wakes an agent, and the agent decides.

---

## 3. An agent is five things

Every agent is built from five parts, each with exactly one home in the code. This is the shape Anthropic publishes for agents ([context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [writing tools](https://www.anthropic.com/engineering/writing-tools-for-agents)). If what you are building doesn't fit one of the five, the design is wrong.

| Part | Home | What it is |
|---|---|---|
| Instructions | `lib/agent/engine/agents/<agent>.md` | The agent's job, the same on every run. Shared text comes in only by import: `@rules.md` (house rules, how you write) and `@research-rules.md` (the Writer, the Holding refresh). No code writes instruction text. |
| Context | `lib/agent/context/`, ticked on `lib/agent/engine/agents/<agent>.ts` | Facts loaded up front, one loader per fact, chosen by what the run is about (a stock, an analyst, the account, the chat). Any agent can reuse any fact. Data, never rules. |
| Tools | `lib/agent/tools/`, listed on the record | One job each, with only the fields the action needs. Code fills what it knows (`fromRun`, `schemaFor`). A rule is a refusal in the tool's code that says what to do instead. |
| Message | Whoever starts the run | You, another agent's brief, a trigger fire, a fill, or the schedule. |
| When it runs | `SCHEDULE` in `lib/agent/engine/schedule.ts`, or an event | Plus one automatic date line on every run. |

The run page's Context panel and the Agents page (`/how-it-works/agents`) show all five for every agent, read from the same records.

### How to add things

| You want | Do this | Not this |
|---|---|---|
| An agent to know more | Write a loader for the fact (or reuse one) and tick it on the agent's record | Paste the fact into its `.md`, or build it in a run-only code path |
| An agent to do something new | A tool with one job and few fields; code fills the rest | A new mode or field on an existing tool |
| An agent to stop doing something | A refusal in the tool that says what to do instead | A "never do X" sentence |
| Different handling in one situation | For now the `SITUATIONS` table (`lib/agent/situations.ts`); later a short skill file attached from a fact | An if-else that changes the prompt |
| A new agent | A record, an `.md`, its context ticks and tools, and a `SCHEDULE` line or an event | Its own cron, route or prompt builder |
| A trigger on a stock | `edit_triggers`: a playbook trigger by reference, or the agent's own with a reason and a chart key for any price | Code that stamps triggers, or trigger fields on other tools |

### Never
- Choose instruction text in code by a stock's state, the day or a setting. Situations are the one existing case, and they are becoming short skills; add nothing to them without the owner.
- Patch a failure with a prompt sentence. Find the layer first (§6), then measure.
- Put fields, variables or calculations in an agent's text. A number an agent needs is a fact, or a key code fills.
- Build agent-specific plumbing: a special loader path, a prompt builder, a flag only one run reads. Everything goes through the one engine (`buildAgentRequest`, `runAgent`).
- Copy a shared rule into one agent. Change the shared file, or that agent's own `.md`.
- Merge a change to what an agent is sent before the yardstick scores it (§7).

---

## 4. Which home a sentence belongs in, and whose voice it is

Each kind of text is written by a different person on the desk. Write it in that voice, and only that.

| Text | Who is speaking | What it holds | What it never holds | Size |
|---|---|---|---|---|
| Instructions (`<agent>.md`) | The head of the desk giving a new hire their job | Who they are, what they're for, what a good result looks like, how to weigh what needs judgment, and why | Steps, numbers, field names, situations, tool mechanics, anything code checks | As short as the job allows |
| A context item (a fact) | The trading screen | Data: the columns a trader would pin, named and formatted for scanning. One stock per line, the same units everywhere, sorted the way a trader sorts. | Advice, rules, "you should" | Only the fields a decision uses. Bulky or optional data is a tool. |
| A skill (today, a situation) | The desk's card for one moment | When this happens: what an expert checks, the choices, and what each choice needs | General rules (those are instructions) and data (that is context) | A few short paragraphs, attached only when the moment applies |
| A tool's description and fields | The label on an order ticket | When to use it, what each field means in the app's words, what it refuses and what to do instead | Strategy, persuasion, cases | One or two sentences per field |
| A refusal message | The risk manager | The rule in one sentence, and the next legal move | Blame, or a bare "no" | One or two sentences |
| A trigger's reason | The trader writing on their own plan | What this level protects or waits for, in plain words | The level restated, or the rule's name | One sentence |
| A note, a trade's reason, a summary line | The analyst talking to the owner | Everything in `rules.md`, "How you write" | Shorthand, bookkeeping | One paragraph |

---

## 5. How to write a sentence for an agent

1. **Use the app's words, and the same word for the same thing everywhere:** playbook (not setup), trigger, buy price, floor, the owner. "Target" means Wall Street's number only.
2. **Name things exactly as the agent sees them.** If the row says "Next report", the instruction says "next report", not "earnings date".
3. **Give every number its unit and what it is measured from:** "7% from yesterday's close", "2× the 50-day average volume", "21 days before the event date". Never a bare number.
4. **One idea per sentence.** A sentence that joins two rules with "and" is two sentences.
5. **Say what to do, not what to avoid.** "Write the condition you mean" teaches; "don't write backwards triggers" doesn't.
6. **Give the reason for anything that needs judgment.** A reason lets the model handle the case the sentence didn't name. A bare rule gets applied too widely or too narrowly.
7. **No shouting:** no capitals, "IMPORTANT", "NEVER", "ALWAYS" or "you MUST". Current models follow plain text, and they over-apply emphasis.
8. **Examples become templates.** Use one only when you want its shape copied, and use an invented company so its numbers can't leak into real work.
9. **No conditions the model has to check against data.** "If the stock is held, …" belongs to code: a skill attached, a field shown, a tool refusal.
10. **Delete before adding.** A new sentence must name the failure it fixes and the run that showed it. If a refusal or a field could fix it, use that instead.
11. **Read the whole request the agent gets, not the diff.** A sentence that reads well alone can contradict one 3,000 characters earlier.

---

## 6. Where a rule goes when something breaks

Find the layer before writing anything.

| What happened | Where the fix goes |
|---|---|
| The agent did something it must never do | A refusal in the tool, with the next legal move |
| The agent didn't know something | A fact, or a better field in one |
| The agent needed judgment | The instructions or a skill, as a reason rather than a procedure |

Most past failures were fixed with instruction text when the right fix was a refusal or a fact. The long prompts were the cost.

**A refusal is an input, never an ending.** The refused call goes back with what to do instead. It stays open until the same tool lands on the same stock (`lib/agent/gate-rejections.ts`), and the next run for that analyst is told (`refused_calls`).

**Every field a model can pass has a contract** (`lib/agent/tools/field-contract.ts`). Each field is one of these:
- computed by the app, so it's absent from the schema a run sees;
- chosen from a closed list (an enum);
- judged under a rule a tool enforces;
- an identity that must exist;
- free text.

A new field fails the test suite until it has a row.

---

## 7. How a change is checked

- **The cases.** Real runs replayed from their recordings (`scripts/hero-case.ts`), each cut faithful to its moment, with nothing dated after the run.
- **When to score.** Once per set of agent work (the changes that will merge together), never per PR or per fix. First build every case's request with `--inputs-only`, which is free.
- **What to score.** Only the cases whose request changed, 2 runs each, reusing the baseline's saved results. A case that drops gets 4 runs, and only if the runner can show the outcome. Today a chat case is scored on its first step only.
- **The cost.** Say the run count and a rough cost before scoring. More than about 40 GPT runs needs the owner's OK.
- **The machine.** One heavy job at a time on the build machine.
- **Merging.** Nothing merges without the owner's click.

---

## 8. Reviewing a part, in the details

The rules, screens, skills, tools and instructions are reviewed one part at a time, by a session that takes both perspectives (§1). Progress lives in `docs/plans/EXPERT_REVIEW_LEDGER.md`. Start a unit with `/expert-review`.

**The order** follows how a trader thinks, so every edit flows one way:
1. **The rulebook, or what we trade on:** the rules for everything, each playbook, and the book and market rules.
2. **The screen, or what we look at:** the watchlist row, the holding row, the market block, one stock in full, and the rest of the context catalog.
3. **Reactions:** each skill (today's situations).
4. **Actions:** each tool's fields, descriptions and refusals.
5. **Jobs:** the shared files (`rules.md`, `research-rules.md`), then each agent's instructions, the chat first.

A later layer quotes an earlier one; it never re-edits it. A unit that finds an earlier layer wrong writes that in the ledger for the lead.

**Usage decides depth.** Before the first unit, count what production actually used over the last 30 days:
- calls per tool;
- how often each context item is sent, and how big it is;
- how often each situation and each playbook occurs;
- how often each rule fires.

Anything unused is a candidate to delete. Anything rare is reviewed in bulk, in one unit. Anything used daily, or anything that reaches a trade, gets its own unit.

**For every item in a unit** (a field, a rule, a sentence), answer three questions:
1. What exactly would an expert in this style look at or do here? Name who works this way.
2. Do our words, fields and numbers say exactly that?
3. Is it in its one right home (§3, §4), written the way §5 says?

**What a unit produces.** A before → after for every item it changes, field by field and sentence by sentence. Each change carries:
- the trader's reason;
- how often it would have fired or mattered on the real book over the last 12 weeks, counted from market data and the database, with no model calls;
- the framework check.

That is one PR per unit, scored with its layer (§7).

**What a unit never does:** add a concept, a layer, an agent or a mode; restructure; or drift into a plan. If the structure looks wrong, the unit says so in one line in the ledger and finishes its own work.

**Reading.**
- **Trading:**
  - William O'Neil, *How to Make Money in Stocks* (bases, buy points, cutting a loss at 7–8%).
  - Mark Minervini, *Trade Like a Stock Market Wizard* (the trend template, the volatility contraction).
  - Stan Weinstein, *Secrets for Profiting in Bull and Bear Markets* (stages, the 30-week average).
  - Bernard and Thomas (1989) on the drift after earnings.
  - Kristjan Kullamägi on episodic pivots and breakouts.
  - How event-driven biotech traders handle a decision date.
- **The screen:** the columns traders pin on professional platforms (Robinhood Legend, thinkorswim, TradingView watchlists).
- **Agents:**
  - Anthropic's [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).
  - [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
  - [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents).
  - [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).

---

## See also
- `CLAUDE.md`, "Agents: how they're built": the short form of §3.
- `docs/guide/concepts/agents.md`: how an agent is built, for readers of `/docs`.
- `docs/TRIGGERS.md` and `docs/THESIS_ARCHITECTURE.md`: triggers and the thesis lifecycle.
