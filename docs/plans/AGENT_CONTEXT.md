# What every agent is given about a stock, and how every agent knows how to trade

> **Status: design, not decided.** Written 2026-09-30 for the QB to review.
> Dave decides. This PR changes no code and no prompt: every prompt change
> below is a proposal, shown as the exact paragraph removed and the exact
> paragraph added (LANES law 7).
>
> It answers three open design tickets as one framework: notes on a thesis
> and what each agent reads before it decides (DAV-342), one shared trading
> knowledge for every agent and chat (DAV-346), and the reply a save gives an
> agent about what its change means (DAV-341, folded in). Related tickets
> it leans on but does not replace: DAV-343 (a pass on a wobble spends the
> buy), DAV-344 (a holding's floor in dollars), DAV-345 (a losing holding's
> review reaches Dave), DAV-334 (the Edit agent folds into /chat).
>
> Every fact about CEG, DOCU and EME below comes from production rows read
> on 2026-09-30: `ThesisUpdate`, `Order`, and the saved run threads in
> `RunMessage` (what each agent was actually handed). Times are Eastern.

---

## 0. The short version (for Dave)

**What goes wrong today, in three points.**

1. **What you decide doesn't reach the analyst once anything else happens.**
   Your written reason for declining CEG's sale on 09-14 ("Hard reject. If
   anything, today is a setup for the Secular Compounder to add, not exit")
   was the newest line on CEG for four hours. Then a trigger fired, and no
   morning run from 09-16 to 09-30 ever saw it. Your whole DOCU conversation
   on 09-30 (the $8K size, adding on a close above $74, why IAM matters) is
   nowhere on DOCU. That chat wasn't scoped to an analyst, so it couldn't
   have written to DOCU even if asked.
2. **A trigger that fires can be marked "answered" without any agent
   answering it.** CEG's "15% off the high" review, the one whose rule says
   *hold and raise the floor under real structure*, fired twice. Neither
   time did a run get it: on 09-16 a later "below the 200-day" alert took
   its place, and on 09-28 your cleanup of copied rules, 36 minutes after
   it fired, counted as the answer. On 09-30, the day CEG was down $1,061,
   the morning run filed CEG under "quiet" and never looked at it.
3. **Each agent is taught a different part of the job.** On 09-30 /chat
   called DOCU's buy "too heavy" by counting dollars in ($11,045), while
   the app sized it by dollars at risk ($842, 0.75% of the account, less
   than CEG's open risk). It also read DOCU's light volume as weakness,
   when light volume on a pullback is what the setup DOCU was bought on
   asks for. On 09-29 the EME chat read the earlier instruction ("re-score
   to 7 first"), quoted it, and armed the buy at a score of 6 anyway. It
   believed the score would rise by itself once the price got there. It
   doesn't: the score is a number written on the thesis, and the buy is
   checked against it on the day it fires.

**The proposal, in five parts.**

1. **Notes.** A new Activity line, *Note*, written by your chat (in your
   words, after you say yes) or by any agent. A note stands until a newer
   note replaces it or someone marks it resolved.
2. **One "what's been said" block, the same for every agent.** Every agent
   deciding on a stock reads, in this order: your standing notes and your
   decisions of the last 30 days, word for word and dated; then the
   analyst's latest note, its last two answers, everything that has fired
   since its last answer, and the other recent lines. After that come the
   thesis, the plan and the numbers, as today. One function builds it, so
   the morning run, the trigger run, the writer, discovery and /chat all
   see the same thing.
3. **A fired trigger stays open until an agent answers it.** Your edits,
   approvals and the app's own bookkeeping lines no longer count as the
   answer. If three things fired since the last review, the run sees all
   three, not only the newest.
4. **One trading core, written once, in every prompt.** Nine short rules in
   plain words: what the score is for, how a buy fires, how a sale fires,
   size by risk, the floor in dollars, each setup's confirmation, selling,
   the market, and "what's been said comes first". Each agent adds only its
   own job, and each analyst's own setups and sell rules come with it.
5. **A save says what the change means.** When a save leaves a buy that its
   own score can't pass, the reply says so in words, while the agent can
   still fix it. It's a reply, not a refusal.

**What it costs.** About 600 tokens per stock an agent decides on (hard cap
1,000), and about 1,800 for the core plus the analyst's own rules in each
prompt. The morning run comes out cheaper than today on the days it asks
for history, because the block replaces the raw history, which is 10,000
to 18,000 tokens per read (§3.8).

**What you decide** is in §4: six questions, each with a recommendation.

---

## 1. The audit: what each agent is given today

Read-only. The prompt sizes are measured: each builder was rendered with a
5,200-character analyst strategy and a 1,500-character digest (the
Compounder's real strategy is 5,195 characters). Tool payload sizes are
measured from saved production run threads. A token is taken as about four
characters.

### 1.1 Summary

| Agent | Model | Built by | Prompt size | What it gets about a stock | Your decisions | Its own earlier reasoning |
|---|---|---|---|---|---|---|
| **Morning run** | gpt-5.4 | `buildDailyRunSystemPromptV2`, `lib/agent/system-prompt.ts:69`; the stock itself comes through `get_theses`, `lib/agent/tools/get-theses.ts:213` | ~11,800 tokens | A full row (4,000–5,500 tokens) for stocks with work to do, a one-line index row for quiet ones | `principalDirective`: only your **newest** decision, and only while it is still the newest line on the stock (`classifyPrincipalDirective`, `get-theses.ts:166`) | Only when the model asks for `include_history` (5 raw lines by default). 3 of the 6 runs that reviewed CEG didn't ask |
| **Trigger run** | gpt-5.4 | `buildTacticalSystemPrompt`, `lib/agent/system-prompts/intraday-tactical.ts:96`; data loaded in `lib/inngest/functions/tactical-run.ts:139` | ~7,100 tokens | Thesis fields, the setup's confirmation, a bull and bear excerpt, the full trigger list with ids, position and tracked peak | Only if it is one of the last 5 Activity lines, and cut at 120 characters (`intraday-tactical.ts:141–149`) | The same 5 lines, same cut |
| **Writer** (mint and refresh) | claude-sonnet-4-6 | `buildWriterResearchPrompt`, `lib/agent/run-thesis-writer.ts:328`; data block `formatDataBlock`, `lib/agent/thesis-research/format-data-block.ts:693` | ~4,900 tokens, plus a ~1,400-token data block | On refresh: status, direction, horizon, core belief, target, stop, score, 300 characters of snapshot, the stock's **own** triggers (`loadExistingThesis`, `run-thesis-writer.ts:202`) | **None** | **None.** The dispatcher's one-line `reason` is the only channel |
| **Discovery** | gpt-5.4 | `buildDiscoverySystemPrompt`, `lib/agent/system-prompts/discovery.ts:84` | ~6,300 tokens | A new name: its screen row and `get_stock_data`, whose prior-coverage paragraph gives the last thesis, the core belief and our trades on it (`formatTickerHistory`, `lib/agent/context-bundle.ts:665`) | None | The last thesis's core belief only |
| **/chat** | claude-sonnet-4-6 | `buildPrincipalSystemPrompt`, `lib/agent/modes.ts:572`; route `app/api/agent/[mode]/route.ts:538` | ~10,700 tokens scoped, ~8,700 unscoped | Whatever it calls: `get_theses` (full row), `get_stock_data`, `list_proposals` | Only through `get_theses`, with the same newest-line-only rule | Only if it asks for `include_history` |

The **Edit agent** (GPT-4o, the `editor` mode in `modes.ts`) edits analyst
settings, not stocks. It is left out here because DAV-334 folds it into
/chat.

### 1.2 Morning run

- **Prompt:** identity, the analyst's strategy, universe and settings
  (`system-prompt.ts:121–136`), yesterday's account digest, earnings and
  filings on the book this week, cash and room, refused calls not yet
  redone (`blockedLastTimeSection`), the horizon glossary, and the working
  rules (`system-prompt.ts:234–361`).
- **About a stock:** `get_theses` returns **full rows** for stocks with
  `needsAction`, a plan-sanity flag, a setup to name, a buy blocked by a
  full analyst, a buy level reached, or an unanswered decline that has a
  message (`isFullDetail`, `get-theses.ts:1189`). Everything else is a one-line
  index row (`get-theses.ts:1210`). A full row carries the thesis, the
  trigger list with the analyst's and account's rules resolved in, the
  `resolved` envelope (live price, ladder health, plan sanity), the setup
  checklist, research age, `heldThroughFloor`, and `principalDirective`.
- **What's been said:** `principalDirective` looks only at the newest
  Activity line (`get-theses.ts:799–817, 885–888`). If that line is a
  decline, an approval that changed the order, or a direct edit, it is
  shown. Otherwise nothing is. `history` is present only when the model
  passes `include_history: true`; the prompt never tells it to.
- **Cost:** the Compounder's opening `get_theses` read was 188,000 to
  225,000 characters (47,000–56,000 tokens) on 09-25, 09-28 and 09-30, and
  it stays in context for the rest of the run. Of that, 37,000–49,000
  characters are `cards`, a second copy of the rows for the chat's card
  renderer. The model receives it anyway, because `defineTool` has no
  separate model output. When history was asked for, it was 41,000
  characters for 5 lines per stock (09-28) and 72,000 for 8 (09-30),
  because each raw line carries its full rationale, its `fieldChanges`
  JSON and every id.

### 1.3 Trigger run

- **Prompt** (`intraday-tactical.ts:172–522`): the analyst's name and
  strategy, the thesis fields, the room line, **the setup's own
  confirmation, chase limit, failure signs, manage rule and time limit**
  (`:214–225`), a research excerpt, the position with the tracked peak,
  the full trigger list with ids, the fired trigger and its rationale, and
  the decision framework.
- **What's been said:** "RECENT THESIS ACTIVITY (last 5 updates)"
  (`:266–267`), built from `thesis.updates` with `take: 5`
  (`tactical-run.ts:144–153`), rationale cut at 120 characters
  (`intraday-tactical.ts:146`). The five are loaded before the run writes
  its own fire line (`tactical-run.ts:139` runs before `:469`).
  Trigger fires are Activity lines too, so a trigger firing three times in
  an afternoon pushes everything else out of the window.

### 1.4 Writer

- **Prompt** (`run-thesis-writer.ts:471–626`): the analyst's strategy,
  **its setups with entry, stop, target and time** (`:451–469`), why it was
  dispatched, the existing thesis on a refresh, date awareness, the
  nine-section note, and the plan rules: 2:1, setup first, no level worth
  waiting for yet, conviction, "you do not size the trade", and the
  minimum confidence.
- **About a stock:** the ground-truth data block, about 5,600 characters
  on 09-25 (EME) and 09-30 (BWXT): quote, chart structure, financials,
  earnings, analyst ratings, insiders, peers, filings, news.
- **What's been said:** nothing. No Activity lines, no decisions, and on a
  held refresh not even the analyst's own sell rules, because
  `loadExistingThesis` reads the stock's stored triggers
  (`run-thesis-writer.ts:217, 231`), not the resolved list the other agents
  see.

### 1.5 Discovery

Manual by design (LANES law 10); chat is the door. When it runs, it sees
names nobody covers. The only history it gets on a name is
`get_stock_data`'s prior-coverage paragraph: the last thesis's status,
conviction and core belief, our closed trades, and other analysts' trades
(`context-bundle.ts:665–765`). A decline you wrote on an earlier thesis for
that stock ("never this name") doesn't travel.

### 1.6 /chat

- **Prompt:** the system map, the data model, the approval gate, the
  universe, the tool list, thesis dispatch, batched discovery with its own
  4-dimension scoring routine, and response style
  (`modes.ts:649–887`). When scoped, it also gets the analyst's settings
  and strategy (`:612–640`), plus its money and book blocks.
- **What it does not get:** the analyst's setups and their confirmations,
  the analyst's sell rules, how size is set by risk, how a buy fires versus
  how a sale fires, what the score is for, or the ratchet. Its scoped
  "Sizing" line is `minConfidence 70 · largest trade $10000 ·
  maxOpenPositions 8` (`modes.ts:632`).
- **What's been said:** only what `get_theses` returns on a drill-down,
  with the newest-line-only rule. An **unscoped** chat can't write to any
  stock: `place_trade`, `close_position`, `manage_position`,
  `record_thesis` and `update_thesis` are removed from it
  (`route.ts:800–812`).

### 1.7 Eight mechanics that lose what was said

These cut across the agents. Each one is shown happening in §2.

| # | Mechanic | Where | Seen in |
|---|---|---|---|
| A | Your decision reaches an agent only while it is the **newest line** on the stock. | `classifyPrincipalDirective`, `get-theses.ts:166–211` | CEG 09-14 decline: newest line for 4 hours, never seen by a morning run |
| B | A fired trigger counts as **answered by any newer line**, including your edits, approvals and the app's bookkeeping. | `computeNeedsAction`: `latestUpdate?.type === "TRIGGER_FIRED"`, `lib/agent/needs-action.ts:463` | CEG 09-28: the 15%-off-high review, answered by your copied-rule cleanup 36 minutes later |
| C | Only the **newest** fire is shown. Earlier fires since the last answer disappear. | same | CEG 09-18: three fires since 09-16, the run was shown one |
| D | The morning run's history is **the model's choice**. | `get_theses` `include_history`, `get-theses.ts:114, 400` | 3 of 6 CEG reviews read no history |
| E | The trigger run sees **5 lines, 120 characters each**. | `intraday-tactical.ts:141–149` | CEG 09-14 15:30: your decline cut off at "…isn't "AI slowdo" |
| F | The writer sees **no Activity at all**. | `loadExistingThesis`, `run-thesis-writer.ts:202` | EME 09-25: score cut 8 → 3 with the prior plan unseen |
| G | An **unscoped chat can't write** to any stock. | `UNSCOPED_BLOCKED_WRITES`, `route.ts:800` | DOCU 09-30 |
| H | A **smaller** approved size is read out as **"principal raised the size"**, and the prompt tells the run that an edit means "they upsized you". | `get-theses.ts:193`; `system-prompt.ts:253` | DOCU 09-30: 162 → 120 shares |

### 1.8 Trading knowledge, prompt by prompt

The trading-core rules in §3.4, and what each prompt has today. "—" means
absent.

| Rule | Morning run | Trigger run | Writer | Discovery | /chat |
|---|---|---|---|---|---|
| **The score answers "would I buy?"; below the minimum a stock gets wake-ups, not a buy** | Partly: "Min confidence: 70%" (`system-prompt.ts:130`), a 0–100 number beside a 0–10 score; the plan-sanity flag says it on a row | Partly: "a buy needs this analyst's minimum confidence" (`intraday-tactical.ts:466–467`) | **Contradicts:** "minimum confidence … is 70/100 — calibrate composite … against that bar" (`run-thesis-writer.ts:610–612`), with no rule that a buy under it is refused. BWXT 09-30 was written at 2 with a buy | "Min confidence: 70%" (`discovery.ts:159`); dispatches at composite ≥ 4 (`:226`) | **Contradicts:** its own triage dispatches at composite ≥ 4 (`modes.ts:827`) for an analyst that buys at 7, and it never says what a score is for |
| **A buy fires once, on the crossing; buying now is a level at the price; full plan at 2:1** | Yes (`:257, 298–302`) | 2:1 only, in the ladder duty (`:462–465`) | 2:1 and buying now, yes; "once" is not said (`:551–565`) | 2:1 only (`:160`) | 2:1 only, inside the `record_thesis` bullet (`:748`) |
| **A sale or review fires every day its condition holds** | Yes (`:257`) | — | — | — | — |
| **Size by risk; judge a position by dollars at risk, not dollars in** | Yes (`:282`) | "place_trade sizes the buy itself" only (`:468`) | "A tight, honest stop is what earns size" (`:606–609`) | "sizes every buy inside this band by risk" (`:161`) | **—.** "largest trade $10000" and "Omit notional" (`:632`). DOCU 09-30: "the stop distance is tight enough that the math inflates share count" |
| **The floor in dollars** | — ("price being down is not on the list", `:304`) | — | — | — | — |
| **Each setup's own confirmation** | Points at "the row's `setup` block says what to confirm" (`:299`), **but the block has no confirmation field** (`SetupChecklist`, `lib/agent/knowledge/setup-checklist.ts:10–21`) | Yes, for the one setup (`:218–220, 352–363`); gate (a) "ALWAYS applies" misfires on a compounder (DAV-343) | Entry, stop, target and time per setup; no confirmation (`:457–467`) | — (screens by setup, no confirmation) | **—.** Judged DOCU's pullback by breakout rules ("$74.07 on volume", "0.13× … no conviction") |
| **Selling: thesis level beats the analyst rule, which beats the account rule; floors only rise; did the story break or the price?** | Ratchet and belief question, yes (`:256–258, 303`); glossary says a COMPOUNDER "exits only on invalidation" (`:229`), which the 25% sale contradicts | Belief question and ladder duty, yes; the analyst's rules appear as triggers, unlabelled | Ratchet on a held refresh (`:379–384`); the analyst's sell rules are **not shown** | — | **—** |
| **The market regime** | Yes (`:202`) | — | — | — | — |
| **What's been said comes first** | `principalDirective` only (`:247–254`) | — | — | — | — |

**Stale lines found on the way** (each gets fixed inside the build step
that touches its file, not as its own PR):

- `system-prompt.ts:280, 284, 287`: "fresh routed signal", "routed news",
  "a routed signal confirmed". The router was deleted 2026-09-15.
- `system-prompt.ts:304`: "Cite signal_ids that informed the update."
  Same.
- `system-prompt.ts:374` and `modes.ts:661`: discovery "(Sundays)".
  Discovery is manual.
- `modes.ts:662`: "**Briefing agent** … writes the per-analyst standup
  that gets injected into the next run's prompt — that's how the analyst
  remembers." False. There is no per-analyst standup; the account digest is
  one paragraph. It is the reason /chat assumes the analyst will remember
  what was said.
- `intraday-tactical.ts:332–334`: "When the thesis status is WATCHING and
  the action is ADD, call place_trade for the entry." A buy is `ENTER`.
- `place-trade.ts:300`: the refusal reads "thesis composite 6/10 is below
  this analyst's minimum (70%)". That's two rulers in one sentence.

---

## 2. Replays on paper

Each replay lists what the agent was actually handed (from its saved
thread or the rows it loaded) and what it would be handed under the
proposal. **A replay can't prove a different decision would follow.**
Where more context alone wouldn't have changed the outcome, the replay
says so, and names the part of the proposal (or the other ticket) that
would.

### 2.1 CEG, 09-14 to 09-30 (Secular Compounder, held)

**The position.** Bought 08-13 at $280.33 (30 shares), with June's $220
floor. On 09-14 it went to 39 shares, average $276.90. 09-30 close:
$249.69, down $1,061. The tightest floor through 09-29 was the analyst's
25%-off-the-high line at $227.55: a hit would have lost **$1,925 (1.7% of
the $112,281 account)**. The thesis's own $220 floor would have lost
$2,219 (2.0%). You raised the floor to $248 at 12:07 on 09-30.

**What happened, and what each agent was handed.**

| When | Event | What the agent had about what was said |
|---|---|---|
| 09-14 09:35 | Trailing-8% sale fires at $273.98. The trigger run proposes the sale. | — |
| 09-14 11:43 | **You decline, with 709 characters of reasons**, ending "The stock is down on guilt-by-association with the AI complex, not because its thesis deteriorated. Hard reject. If anything, today is a setup for the Secular Compounder to add, not exit." | This is now the newest line, so any morning run would show it as `principalDirective`. None runs until 09-16. |
| 09-14 15:30 | The analyst's "down 7% in a day → add" fires. The trigger run proposes an add on a stale $284.75 quote (fixed since, #733). | Last 5 lines (loaded before the run writes its own fire line), with your decline first, cut at 120 characters: *"now the strongest hold of the five This is the biggest delta from the sentiment. The X narrative on CEG isn't "AI slowdo"*. The "add, not exit" sentence was cut. |
| 09-14 15:45, 15:50, 15:55 | The trailing 8% fires three more times. Each run calls it a false fire on the stale quote. | Your decline, cut the same way, is line 3 at 15:45 and line 5 at 15:50. At 15:55 it's **gone**: the window is all fires and the runs' own replies. |
| 09-14 15:52 | You approve the add: 9 shares at $265.46. | — |
| 09-14 22:29 | You remove the trailing-8% sale: "Don't re-create it unless the thesis materially changes." | — |
| 09-16 08:07 | Morning run: "none of my named invalidations has tripped … holding through the drawdown." | Shown the "below the 200-day" fire of 09-15. `principalDirective` **null**. History **not requested**. |
| 09-16 10:15 | **"Gave back 15% from the high"** review fires ($257.59). Its rule: *"is the reason we bought still true? If yes, hold and raise the floor under real structure (the 20-day low, the breakout level). If partly, trim."* | — |
| 09-16 10:30 | "8% below entry ($256.42)" review fires. | — |
| 09-17 09:35 | "Below the 200-day" fires again. It is now the newest line. | — |
| 09-18 08:06 | Morning run: names the setup, "a business-led hold." | Shown **only** the 09-17 "below the 200-day". The 15% review and the $256.42 review are gone (mechanic C). Directive null, no history. |
| 09-21, 09-23, 09-25 | Morning runs: "hold", "hold", "hold." | 09-21 and 09-23 asked for history: 5 lines each, all fires plus their own replies. 09-25 didn't ask. Directive null each time. |
| 09-28 08:04 | Morning run: "a different fact pattern … stabilized near $261 … hold." | Shown "below the 200-day" with "This has fired 6 times and the plan has not changed since 2026-09-18." History: 5 lines, fires and replies. |
| 09-28 11:20 | **The 15%-off-high review fires again** ($257.63). | — |
| 09-28 11:56 | You remove two copied earnings rules from CEG. | **This counts as the answer to the 11:20 fire** (mechanic B). |
| 09-30 08:04 | Morning run. | **CEG is on the quiet list.** Not opened. |
| 09-30 09:35 | "$256.42" review fires. | — |
| 09-30 12:07 | You raise the floor $220 → $248. | Counts as the answer to the 09:35 fire (mechanic B). CEG can still come back while the price sits under $256.42, through "matching now". |

**Under the proposal: what the 09-18 morning run would have been handed**
on CEG, ahead of the thesis and numbers:

```
WHAT'S BEEN SAID ON $CEG — read this before the numbers
The principal — decisions in the last 30 days, word for word:
  09-14 11:43  Declined the sale (trailing 8% off the high, $273.98): "…The stock is
               down on guilt-by-association with the AI complex, not because its thesis
               deteriorated. Hard reject. If anything, today is a setup for the Secular
               Compounder to add, not exit."   [full 709 characters in the real block]
  09-14 15:52  Approved the add: 9 shares at $265.46 (now 39 at $276.90).
  09-14 22:29  Removed the trailing-8% sale: "Don't re-create it unless the thesis
               materially changes."
Latest analyst note: none.
Last two answers:
  09-16 08:07  morning run — "none of my named invalidations has tripped … holding
               through the drawdown … valuation compression, not business damage."
  09-14 15:55  trigger run — "did not sell … false fire … the $220 hard floor still
               sits well below the current structure."
Fired since the last answer (09-16 08:07), not yet answered:
  Gave back 15% from the high — 09-16 10:15 at $257.59. The rule: "is the reason we
    bought still true? If yes, hold and raise the floor under real structure (the
    20-day low, the breakout level). If partly, trim."
  8% below what we paid ($256.42) — 09-16 10:30 at $256.37.
  Below the 200-day — 09-16 09:35 and 09-17 09:35.
Other lines: 09-14 15:55 buy price set to what was paid, $276.90.
Full history: get_theses(tickers: ["CEG"], include_history: true)
```

That's about 2,400 characters, 600 tokens. On 09-30 CEG would have been a
**full row**, not quiet: the 09-28 15% review would still be open, because
your cleanup is not an agent's answer.

**What would change.**

- Every run from 09-16 to 10-14 sees your reason for holding. It argues
  for holding, so the runs holding is not the failure. The failure is that
  the runs never weighed it: whether "guilt-by-association with the AI
  complex" still explained CEG two weeks and fifteen alerts later.
- The 15% review and its sentence ("raise the floor under real
  structure") reach a run twice (09-18 and 09-30), instead of never.
- The 09-16 run could leave a note: "Holding through the 200-day because
  the business list is clean. Floor under structure at $X; if CEG closes
  under it, the thesis is wrong." The next five runs would build on that
  note instead of each writing "hold, no invalidation" from scratch.
- **Context alone wouldn't have raised the floor.** The morning prompt
  tells a run that "price being down is not on the list unless you wrote
  it there" (`system-prompt.ts:304`). Nothing puts the floor's cost in
  dollars in front of it. That is the core's rule 5 and DAV-344's flag:
  39 shares × ($276.90 − $227.55) = $1,925, 1.7% of the account, over the
  1.5% line from the first 09-16 review on. The message to you when a
  holding under cost gets a review is DAV-345.

### 2.2 DOCU, 09-30 (PEAD Specialist, bought that day)

| When | Event | What the agent had about what was said |
|---|---|---|
| 09-27 21:05 | A chat scoped to PEAD Specialist rewrote the plan as a pullback to the rising 20-day (`MA_PULLBACK`): buy $67, floor $63, target $83, score 8. | — |
| 09-28 09:30 | The $67 buy fires. The trigger run passes: the pullback's reversal close hasn't happened. | Last 5 lines include the 09-27 plan. |
| 09-30 08:01 | Morning run moves the spent buy to a reclaim at $67.80. | Full row. No decisions to show. |
| 09-30 09:40 | The $67.80 buy fires. The trigger run confirms the reclaim and proposes **162 shares at $68.18**: "1% of $112,281 × 0.75 (MEDIUM) = **$842 at risk** over a $5.18 stop distance → 162 shares ($11,045). Open risk after this buy: 5.7% of equity (cap 6%); largest: ASML $1,226, CEG $1,131, NVDA $1,014." | Last 5 lines, including the 09-27 plan. |
| between 09:40 and 12:25 | **/chat, unscoped** (run `cmun33sb7000004legfhcofst`). It calls `list_proposals` and `get_stock_data`, not `get_theses`, so it never sees the thesis's setup block. It says: the size is "the biggest position of the three proposals today by far"; "the stop distance is tight enough that the math inflates share count"; the stock is "8.7% *below*" the $74.07 base pivot, "a **mid-base entry**"; "**Volume today is also dead** — 0.13× average"; "I'd **approve it but feel better at half size**." You: "I was thinking i might reduce the size to about 8K." The chat: a strong buy would be "price breaking *above* $74.07 … on volume above average … If $DOCU clears $74 on real volume in the coming days, *that's* when you'd want to be adding." After your X-sentiment paste: IAM 12.6% → 15.1% of ARR, guided 18–19%; the MCP integrations; the 34% buy ratings as "institutional scar tissue"; the December print as a second catalyst. "At $8K, yes." | The chat has no analyst scope, so it can't write to DOCU. |
| 09-30 12:25 | You approve, **cut from 162 to 120 shares** (about $8,182). | — |

**What DOCU's analyst gets today:** one line, `PROPOSAL_APPROVED …
(edited 162→120 sh)`. `get_theses` renders it as "Approved, resized
162→120 shares **(principal raised the size)**" (mechanic H), and the
morning prompt tells the run an edit means "they upsized you". It is shown
only while it is the newest line, and only if DOCU is a full row. On a
normal day a newly bought stock with nothing fired is quiet, so the next
morning run (Fri 10-02) most likely sees none of it. Nothing about $74,
IAM, or "a starter position" exists anywhere on DOCU, and there is no add
at $74.07 on its trigger list.

**What the chat got wrong, and why:**

- **The size.** It judged by dollars in ($11,045). The app sized by
  dollars at risk: $842, 0.75% of the account, less than CEG's $1,131 of
  open risk that same morning. At 120 shares the risk is $622, 0.55%.
  Cutting the size is your call. The chat's reason for it ("the math
  inflates share count") is the opposite of the writer's rule ("a tight,
  honest stop is what earns size").
- **The setup.** DOCU was bought on the pullback setup. That setup's
  confirmation is the touch holding (a close above the prior day's high)
  and a pullback that comes on **below-average volume**
  (`setups.ts:593–596`). The chat judged it by the breakout setup's rules
  (a close above the pivot on 1.5× volume). It also read a volume figure
  taken around 10 AM, when a day's volume is only partly in. The trigger
  run's prompt says volume is "informational before ~14:00 ET"; the chat's
  prompt says nothing.

**Under the proposal:**

1. **The chat has the core** (rules 4 and 6). It would say: "The app sized
   this at $842 at risk, 0.75% of the account, over a tight $5.18 floor.
   It's a pullback entry, and light volume on a pullback is what that
   setup wants." You might still want $8K. You'd be choosing it on the
   same ruler the app uses.
2. **The conclusion becomes a note.** Before the chat ends, it drafts one
   in your words and writes it on your yes, through `write_note`, which
   works unscoped (§3.1). One thing the rows show: your own words were
   "about 8K". "Add on a close above $74" was the chat's suggestion, and
   the ticket recorded it as yours. A note ranks first for every agent, so
   the draft has to separate what you decided from what the chat
   suggested, and you confirm it (decision 1). The draft:

   ```
   Note — the principal, 09-30 (via chat): Bought a starter, 120 shares (~$8K),
   smaller than the 162 proposed because the base hasn't resolved. Agreed with the
   chat: add on a close above $74.07 (the base pivot) on real volume. What would
   change my mind: IAM stalls under 17% of ARR at the December print. Why I like
   it: IAM went from 12.6% to 15.1% of ARR in one quarter, guided to 18–19%; the MCP
   integrations; the 34% buy ratings are post-pandemic scar tissue, not a broken
   business.
   ```

3. **The analyst gets it first.** No run has answered the note yet, so DOCU
   is a full row on 10-02, and its block opens with your note and "09-30
   12:25 Approved the buy, cut from 162 to 120 shares." The run answers
   the note the way it answers anything: it adds an ADD trigger (a close
   above $74.07 with volume at least 1.5× average) through
   `update_thesis`, and resolves the note in the same call. Or it says why
   not. Code never turns a note into a trigger; the analyst does, and that
   is one Activity line you can see.

### 2.3 EME, 09-29 (Secular Compounder, watched; this analyst buys at 7)

| When | Event | What the agent had about what was said |
|---|---|---|
| 09-25 08:05 | The writer, dispatched by the morning run ("stale research … I need a fresh view"), cuts the score **8 → 3** and moves the buy $790 → $786. The save bug fixed by #732 then removed the buy. | Writer: the existing thesis block only. No Activity, no decisions (mechanic F). |
| 09-27 22:31 | **A chat scoped to the Compounder gets it right:** "At composite 3/10, a mechanical buy trigger would be refused on execution … wait for a confirmed reclaim of the 50/200-day cluster (~$770+), then re-score. If it re-scores to 7+, price a clean entry at the base pivot $807.42 with stop at the Sep 17 swing low $723.87." It adds a review on a close above the 50-day. | — |
| 09-28 10:00 | The 50-day review fires. Its rationale repeats the instruction ("If composite reaches 7+, arm a buy trigger … Do not buy automatically"). | — |
| 09-29 21:32 | **A second chat** (run `cmunfk76c000104jquugen25z`). Your message: "Refresh EME … then write the full plan (buy, floor, target at 2:1), or tell me why it shouldn't have one." It calls `get_theses(tickers: ["EME"], include_history: true)`. The 5 lines include the 09-27 instruction and the 09-28 fire, and **the chat quotes them**: "The prior plan correctly said 'don't arm a buy at 3/10; wait for the 50-day reclaim first.'" It re-scores 3 → 6, then **arms the buy at $807.42 anyway**: "still one point below the 7-point execution floor, but by the time price closes above $807 the trend will have repaired enough to clear it." | Everything that mattered was in front of it. |
| 09-29 21:33 | **The save's reply:** "Updated EME: Added: buy above $807.42, Added: Reports within 5 days → review, Stop set: $724, Target set: $980, composite 3 → 6." Nothing about the buy being refused. | The flag ("The buy will be refused the day the level fires", `plan-sanity.ts:411–415`) was on the thesis sheet, not in the reply. |
| 09-29 21:39 | You paste the sheet's flag into the chat. **Six minutes later** it replaces the buy with a review on a close above $807.42 and says why. | — |

**What this replay shows.** EME is the case where **context was not the
problem**. The instruction reached the chat and the chat repeated it back.
Two things failed:

1. **Its picture of the app was wrong.** It assumed the score would rise
   to 7 by itself when the price crossed $807. The score is a number on
   the thesis. `place_trade` compares it to the analyst's minimum on the
   day the buy fires (`place-trade.ts:284–300`), nothing re-scores it in
   between, and a buy fires once. That's core rule 1, which no prompt says
   plainly today (§1.8, first row).
2. **The save didn't say what the change meant.** When you told it, it
   fixed the plan in one turn. That's the evidence for §3.6: when the line
   reaches the agent, the agent acts on it.

**Under the proposal:**

- The 09-27 chat's instruction would be the **latest analyst note**
  ("EME scores 3; this analyst buys at 7. Wake on the 50-day reclaim;
  re-score; price $807.42 / $723.87 only if it clears 7"), not a line that
  a busy week can push out of the last five.
- The core, in the chat's prompt, says in rule 1 that nothing re-scores a
  stock when the price moves.
- The 21:33 save replies: *"EME scores 6/10 and this analyst buys at 7/10.
  This buy will be refused when $807.42 closes, and a buy fires only once.
  Did you mean a review at $807.42 (a wake-up), or has the setup improved
  enough to re-score?"* The chat fixes it in the same turn, before you see
  it.
- The 09-25 writer would get the block and the same kind of reply on a
  score cut: *"EME now scores 3/10; this analyst buys at 7/10. The buy at
  $786 will be refused when it fires. Set it down to a wake-up, or keep it
  and say why."*

### 2.4 What the three replays say, together

| | CEG | DOCU | EME |
|---|---|---|---|
| Your words never reached the agent | ✔ (A, D, E) | ✔ (G, H) | — |
| A fire was lost before any agent answered it | ✔ (B, C) | — | — |
| The agent had the words but the wrong trading picture | partly: no floor-in-dollars rule | ✔: sizing ruler, setup confirmation | ✔: what the score is for |
| The save didn't say what the change meant | — | — | ✔ |
| **Parts of the proposal that fix it** | §3.2 block, §3.3 fires stay open, core rule 5 (+ DAV-344, DAV-345) | §3.1 notes, §3.2 block, core rules 4 and 6 | core rule 1, §3.6 save reply, notes |

No single part fixes all three. Notes without the core would have left
EME exactly where it was, and the core without the block would have left
CEG where it was. That's why this is one design.

---

## 3. The proposal

### 3.1 Notes: the write path

**What a note is.** A point-in-time conclusion about one stock that the
next reader must carry forward: what was decided, what would change the
mind, and any size or level decision. It is not a rationale. A rationale
says why *this save* happened; a note says what *every later reader* must
know.

**Where it is stored.** A `ThesisUpdate` row with `type: "NOTE"`. `type` is
a string column (`prisma/schema.prisma:465–468`: "Kept as String (not
enum) so types extend without migrations"), so **no migration**. The row
already is the Activity feed (`components/agent/sheets/thesis-timeline-utils.ts`,
`app/api/theses/[id]/updates/route.ts`), and the morning run, the trigger
run and /chat already read that table (the writer will, through §3.2).

```
ThesisUpdate {
  type: "NOTE",
  summary:   first line, ≤ 140 characters   → the Activity line
  rationale: the note, ≤ 1,200 characters
  fieldChanges: { note: {
    author: "PRINCIPAL" | "ANALYST",
    via: "chat" | "sheet" | "morning run" | "trigger run" | "writer",
    replaces?: <note id>,          // this note takes that one's place
    resolves?: <note id>,          // a resolution line, with its reason as the text
  } },
  runId, priceAtTime
}
```

**What "standing" means.** A note stands until a newer note names it in
`replaces`, or a resolution row names it in `resolves`. One pure function,
`standingNotes(rows)`, decides it. The feed never deletes anything, and
each write is one Activity line.

**Who writes, and how.**

| Writer | How | Rules |
|---|---|---|
| **Your chat** (/chat, scoped or unscoped) | New tool `write_note(thesis_id, text, replaces_note_id?)`. A thesis names its own analyst, so it works **unscoped**, after checking the thesis is on your account. It trades nothing, so it isn't on the unscoped block list. | At the end of research on a stock (a conclusion, a size, a level, what would change the mind), the chat drafts **one** note in your words and writes it **after you say yes** (decision 1, §4). Author `PRINCIPAL`. |
| **The thesis sheet** (optional) | A "Write a note" field on the Activity tab, through the same core. | Author `PRINCIPAL`, via `sheet`. ShadCN `Textarea` and `Button` as-is. |
| **Morning run, trigger run, a scoped chat acting for the analyst** | Two optional fields on `update_thesis`: `note` (text) and `resolve_note_id`. No new tool. | Author `ANALYST`. **One standing analyst note per stock**: a new one replaces the previous one automatically, so the next reader carries one analyst voice, not a pile. |
| **Writer** | A refresh already saves through `update_thesis` (`buildWriterSaveCall`, `run-thesis-writer.ts:1244`), so the field comes free. | Not prompted to write one in the first version. |

**Resolving your notes.** Recommended: you can resolve any note, and an
agent can resolve one of yours **only in the same call that carries it
out** (for DOCU: the call that adds the $74.07 add trigger), citing what
it did. That resolution is an Activity line you see, and writing the note
again reopens it (decision 2).

**One core, three doors.** `lib/agent/notes.ts` (`writeNote`,
`resolveNote`, `standingNotes`). The chat tool, the `update_thesis` fields
and the sheet all go through it, the way `lib/agent/triggers/ops.ts` is the
one write path for triggers.

### 3.2 One "what's been said" block: the read contract per agent

**One builder.** `buildStockContext(rows, { reader, now })` in
`lib/agent/stock-context.ts`. It is pure: it takes the stock's recent
`ThesisUpdate` rows (the 20-row scan `get_theses` already runs for the
repeat-fire count, `get-theses.ts:826–845`, extended to 30 days for
decisions) and returns dated plain-text lines. It returns text, not raw
rows: a raw history line costs about 1,100 characters, because it carries
the full rationale, the `fieldChanges` JSON and every id.

**The order, fixed for every agent** (the QB's starting proposal, plus
the "fired since" part that the CEG replay shows is needed):

1. **The principal: standing notes**, any age, word for word. A note older
   than 60 days shows its age ("written 74 days ago"). Nothing expires on
   its own.
2. **The principal: decisions in the last 30 days**, word for word and
   dated: declines (with the message), approvals (with any resize, and
   which way: "cut from 162 to 120 shares"), direct level edits, trigger
   removals. At most 6, newest first; older ones are counted ("and 3
   earlier").
3. **The latest analyst note.**
4. **The last two answers**: the rationale of the last two agent reviews or
   updates, 300 characters each.
5. **Fired since the last answer, not yet answered**: every distinct
   trigger, its count, first and last time, and its rule sentence. (§3.3
   decides what counts as an answer.)
6. **Other recent lines**: up to 5, one-line summaries only.
7. **Where the rest is**: `get_theses(tickers: ["X"], include_history: true)`.

Over the cap, the builder drops in this order: other lines, then the
oldest decisions (counted, not shown), then the second answer. **Your
standing notes are never cut.** A single note is capped at 1,200
characters when it is written.

**Per agent:**

| Agent | When it gets the block | Parts | Budget per stock |
|---|---|---|---|
| **Morning run** | On every **full row**, as `context`, before the thesis fields. A **quiet row** gets one line when a standing note of yours exists ("Principal's note 09-30: Bought a starter…", 120 characters). **A note or decision of yours that no run has answered yet makes the row full**, once. That widens today's rule (only a decline with a message does, `get-theses.ts:1200`). | 1–7 | typical 400–700 tokens, cap 1,000; quiet line ~30 |
| **Trigger run** | In the prompt, **replacing** "RECENT THESIS ACTIVITY (last 5 updates)". | 1–7 | typical 500, cap 1,000 (today ~250) |
| **Writer: refresh** | In the prompt, after EXISTING THESIS. On a held refresh it also gets the **resolved** trigger list, marked by level ("the analyst's rule", "the account's rule"), so it knows what sits under the stock's own levels. | 1–4 | typical 500, cap 800 |
| **Writer: mint** | Standing notes of yours from an **earlier** thesis on the same stock for this analyst (a stock sold and minted again), plus the dispatcher's reason. | 1 | typical 0–150 |
| **Discovery** | `get_stock_data`'s prior-coverage paragraph gains the newest standing note of yours from any earlier thesis on that stock, account-wide and labelled by analyst. | 1 (one note) | 0–150 per researched name |
| **/chat** | A `get_theses` drill-down returns the full block. `get_stock_data` on a covered stock adds two lines (your newest note, the analyst's latest note). `list_proposals` rows carry the thesis's standing notes of yours, so "Should I approve this?" starts from them. | 1–7 on a drill-down | 500 per drilled stock |

**What goes away in the same PR** (never ship a dying idea across two
PRs): `principalDirective`, `classifyPrincipalDirective`, and the morning
prompt's "Read the principal's directives" paragraph, which is replaced in
§3.7. The hard-coded "(principal raised the size)" (mechanic H) goes with
them.

### 3.3 A fired trigger stays open until an agent answers it

**Today** a fire is open while its line is the newest on the stock
(`needs-action.ts:463`), so anything written after it closes it.

**Proposed.** A fire is answered by the first **agent** line after it: a
review or update written by a run (`REVIEWED`, `UPDATED`, `ACTED`,
`CLOSED`, `INVALIDATED` with a `runId`). These do **not** answer it:

- your edits (`[USER]` lines);
- approvals, declines and expiries (`PROPOSAL_*`);
- the app's bookkeeping (a buy price set to what was paid, a status
  change written by a fill);
- another fire.

`needsAction` lists every trigger fired since the last agent answer, and
the `context` block shows them (part 5).

**Effect on CEG:** full row on 09-18 with three fires and on 09-30 with
the 15% review, instead of one fire and then quiet. **Cost:** more held
stocks arrive as full rows on the mornings after something fired while you
edited them. Run over the live book before merging (the "run the flag
over the real book" rule).

### 3.4 One trading core, written once

`lib/agent/knowledge/trading-core.ts` exports `tradingCore(analyst)`. The
numbers are **read from the constants the tools use**
(`MIN_REWARD_RISK`, `PORTFOLIO_HEAT_PCT`, `CHASE_LIMIT_PCT`,
`BREAKOUT_VOLUME_RATIO`, `EP_GAP_MIN_VOLUME_RATIO`, `PEAD_ENTRY_WINDOW`,
`CATALYST_WINDOW_DAYS`, `COMPOUNDER_CATASTROPHE_PCT`, in
`lib/agent/knowledge/setups.ts`; `DEFAULT_RISK_PCT`,
`CONVICTION_RISK_MULTIPLIER`, `CAUTION_SIZE_MULTIPLIER`, in
`lib/agent/position-sizing.ts`). Each setup's confirmation line is read
from `setup.entry.confirmation`, so the words can't drift from the check.
The prompts say "the principal" (the app will have other users); this doc
says Dave.

The full text, rendered for the Secular Compounder, **added to every
prompt** (morning run, trigger run, writer, discovery, /chat), about 1,100
tokens (4,400 characters):

```
HOW WE TRADE — the same rules for every analyst and every chat

1. The score and the triggers. A thesis's score (0–10) answers "would I buy this?"
   Its triggers answer "when?". This analyst buys only at a score of 7/10 or better.
   The score is a number written on the thesis: nothing re-scores it when the price
   moves, and a buy is checked against that number on the day it fires. Below 7 a
   stock gets wake-ups — reviews at prices — not a buy. When a wake-up fires,
   re-score it; write the buy only if the new score clears. Never raise a score to
   fit a plan.

2. How a buy fires. Once, when the price crosses its level (true now, not true at
   the prior close). A buy that is passed on or refused is used up until the price
   crosses back and again. Buying now is a buy level at or a few cents past the
   current price; there is no other way to buy. Every buy needs the full plan — buy,
   floor and target — paying at least 2:1: (target − buy) ÷ (buy − floor).

3. How a sale or a review fires. Every day its condition is true. A declined sale
   means "not today", not "stop asking".

4. Size is set by risk, and the app sets it. Dollars at risk = the account × 1% ×
   conviction (low ½, medium ¾, high 1, strong 1¼), halved for a binary event and in
   a CAUTION market, and kept between this analyst's smallest trade ($4,000) and
   largest trade ($10,000); the most in one stock is $20,000. Shares = dollars at
   risk ÷ (buy − floor), so a tight, honest floor buys more shares for the same risk
   and a wide one buys fewer. All open risk together stays under 6% of the account.
   Judge a position by what it loses at its floor, never by the dollars in.

5. The floor in dollars. What a holding loses if its floor is hit = shares × (what
   we paid − floor). A new buy is sized so that is about 1% of the account. After an
   add, and whenever the price falls, check it again: a floor that would lose more
   than 1.5% of the account needs an answer — raise it under real structure, trim,
   or say why it stands.

6. What confirms each setup. Judge a plan by its own setup, never another's.
   • Base breakout: a close above the pivot, not an intraday poke; volume at least
     1.5× average on the breakout day; no more than 5% past the pivot.
   • Momentum flag: range expands upward out of the flag; price above the 10- and
     20-day.
   • Pullback to a rising average: a close above the prior day's high after touching
     the average; the pullback came on below-average volume. Light volume on a
     pullback is healthy, not weak.
   • Earnings gap: the gap holds (day 2 closes above the gap-day midpoint); volume
     stays heavy.
   • Post-earnings drift: days 1–3 after the print; the gap held; the surprise and
     guidance confirmed from the release or transcript.
   • Pre-catalyst: never the day before the event, never inside the last 21 days; a
     falling chart is never bought at the market.
   • Compounder: whichever comes first of a breakout, a reclaim of the 50-day, or a
     pullback that holds it; the thesis intact; volume matters less than for a trade.
   Today's volume is only partly in until late in the session: before about 2 PM ET
   it is context, not a verdict.

7. Selling. Three layers: the stock's own levels, this analyst's rules (its Triggers
   tab, listed below), and the account's rules. A level on the stock beats the
   analyst's rule for that stock; nothing copies an analyst's rule onto a stock. A
   protective floor on a stock we own only goes up; lowering it is the principal's
   act. Every sale answers one question: did the story break, or did the price? On a
   long hold, price alarms are reviews, not sales — except the analyst's catastrophe
   line (25% off the high).

8. The market. RISK_ON: full size. CAUTION (SPY more than 1% under its 50-day):
   half size, no breakouts. RISK_OFF (more than 1% under its 200-day): only
   event-driven and mean-reversion entries.

9. What's been said comes first. Every stock arrives with the principal's notes and
   decisions, this analyst's latest note, its last answers, and what has fired since.
   Read them before the numbers. Answer a note of the principal's — carry it out, or
   say why not — and leave a note of your own when the next reader must carry your
   reasoning forward.
```

Rule 2's second sentence changes in the same PR as DAV-343, if Dave takes
that fix: a pass because the price was back under the level wouldn't spend
the buy.

### 3.5 Each analyst is a distinct trader

`analystTradingBlock(config, overrides)` in the same file, placed right
after the core in every prompt acting for an analyst. It renders the
analyst's minimum score, sizing band and risk per trade (these also fill
the core's numbers), **its setups** from `AgentConfig.setupIds` (name,
entry, confirmation, floor, target, time), and **its sell rules**, the
rationale sentence of each `AgentConfig.triggers` entry. For the Secular
Compounder the sell rules read:

```
THIS ANALYST'S SELL RULES — they apply to every stock it holds unless the stock sets its own level
  • Review at 15% off the high: is the reason we bought still true? If yes, hold and raise the
    floor under real structure (the 20-day low, the breakout level). If partly, trim. Sell only
    if you can name what broke in the business.
  • Sell at 25% off the high — the catastrophe line for a multi-year hold.
  • Review below the 200-day — review the business, not the chart.
  • Review at 15% up and at 15% down from what we paid.
  • Add review on a 7% down day, only if the drop is market- or sector-wide with the thesis intact.
```

About 650 tokens with three setups. It goes to the trigger run (which
today sees only the one setup), the writer (which today has the setups
but not the sell rules), discovery, and a scoped /chat (which today has
neither). The morning run gets it once in its prompt instead of piecing it
together from row blocks.

Separately (code, not prompt): the row's `setup` block gains the setup's
confirmation (`SetupChecklist`, `setup-checklist.ts:10`), so the morning
prompt's "the row's `setup` block says what to confirm"
(`system-prompt.ts:299`) finally points at something.

### 3.6 The reply a save gives (where DAV-341 fits)

**Recommendation: option B, the reply.** The save lands, and its reply
says what the change means in words the agent reasons with. The check
when the buy fires stays exactly as it is today. No check is added and
none is removed (LANES law 3).

**Where.** `update_thesis`, `record_thesis`, and the writer's
`submit_thesis` check step (`checkDecisionAgainstSave`,
`run-thesis-writer.ts:1442`, which runs before anything is saved) each
return a new `what_this_means: string[]`. The first line is also appended
to `summary`, the first thing the model reads. The lines come from the
**same function the sheet uses** (`lib/agent/plan-sanity.ts`), run on the
saved row, so the sheet and the reply can't say different things.

**What it says.**

- **A buy under the score** (`COMPOSITE_BELOW_MINIMUM`, `plan-sanity.ts:411`,
  reworded for a reply): *"EME scores 6/10 and this analyst buys at 7/10.
  This buy will be refused when $807.42 closes, and a buy fires only once.
  Did you mean a review at $807.42 (a wake-up), or has the setup improved
  enough to re-score?"*
- **A score change with a buy on the stock:** *"CYTK now scores 3/10; this
  analyst buys at 5/10. The buy at $70.25 will be refused when it fires.
  Set it down to a wake-up, or keep it and say why."* (CYTK 09-21, EME
  09-25.)
- Every other plan-sanity flag the save leaves standing, one line each
  (2:1, floor inside the daily range, buy far from the price).

**Why B and not A.** When the EME line reached the chat (you pasted it),
it fixed the plan in one turn. The 09-27 chat, which understood the rule,
did the right thing unprompted. The honest risk with B is an agent that
reads the line and saves anyway. The fire-time check still refuses that
buy, and the refusal still reaches the run through the carry-over of
refused calls. Option A moves the check to the save and deletes it at the
fire. It's cleaner, but it refuses a save, and every refusal so far has
taught agents to reword instead of rethink (the run-summary word-list
lesson in CLAUDE.md).

### 3.7 Proposed prompt changes: each paragraph removed and added

Quoted as the model sees them: rendered, not source-escaped, with the
source's hard line breaks joined, and numbers shown for the Secular
Compounder where the source interpolates them. Source line numbers are
given for each.

**Every prompt: added.** `${tradingCore(analyst)}` (§3.4), followed by
`${analystTradingBlock(analyst)}` (§3.5) wherever the prompt acts for one
analyst. Placement: the morning run after "Universe & rules"
(`system-prompt.ts:136`); the trigger run after the first line
(`intraday-tactical.ts:172`); the writer after "Your strategy"
(`run-thesis-writer.ts:473`); discovery after the operating manual
(`discovery.ts:137`); /chat after "THE SYSTEM YOU OPERATE"
(`modes.ts:666`), with the analyst block inside the scope block when
scoped.

#### Morning run: `lib/agent/system-prompt.ts`, `buildDailyRunSystemPromptV2`

**M1, line 130.** Removed:
> - Min confidence: 70%

Added:
> - Buys at a score of 7/10 or better (the score on the thesis, checked the day a buy fires)

**M2, lines 247–254.** Removed:
> **Read the principal's directives — they're the most important context you have.** Every thesis row carries a `principalDirective` field: the principal's most recent review decision on a proposal you raised — a **reject** (with their verbatim `message`), an **approve-with-edit** (e.g. they upsized your 6 shares to 12), or a **direct edit** of a level. Whenever `principalDirective` is set, read it and respond with judgment — it is NOT just a "soft no":
>   - **A reject comment flags the thesis for review** (it arrives as `needsAction = REVIEW_DUE`). Read the comment and act on what it actually says:
>       - An **instruction** ("raise my stop to near the current price", "hold past target, don't sell yet", "trail it") → carry it out: move the stop/target via `update_thesis` (or edit the relevant trigger), or `manage_position` on a held name. (This is the CRDO miss we're fixing — the principal asked to raise the stop repeatedly and it never moved.)
>       - A **question or open consideration** ("are we sure the peak has passed, or is more news coming?", "I'm thinking about waiting a week") → don't force a trade. Do the work the question asks for — pull `get_stock_data` / `get_earnings_data`, weigh it, and reply in your `update_thesis` rationale (adjust the next review date if they're deferring). Answering the question IS the action.
>       - A **bare no** (no written reason) → soft-no: do NOT re-propose the same setup unless the stated reason has materially changed. "Not this week" doesn't survive past the week; "never this name" survives indefinitely; "wait for the pullback" is satisfied only by the pullback.
>     Either way, quote the comment in your `update_thesis` rationale so the trail shows you read it.
>   - **Approve-with-edit / direct edit** → informational, no action required: the principal expressed conviction (they upsized you) or set a level themselves. Honor their numbers — do NOT revert them — and let it inform your conviction read.
>   `PROPOSAL_EXPIRED` rows are softer still — the user didn't decide either way — so re-proposal is allowed if the setup still holds.

Added:
> **Read what's been said before anything else.** Every full row starts with `context`: the principal's standing notes and decisions of the last 30 days (word for word, dated), your latest note on the stock, your last two answers, everything that has fired since your last answer, and the other recent lines. The principal's words outrank everything else on the row. A note or decision of theirs that no run has answered yet is why the row is in your list today:
>   - An **instruction** ("add on a close above $74", "raise the floor", "hold past the target") → carry it out with the tools, usually as a trigger via `update_thesis`, and resolve the note in the same call (`resolve_note_id`). (The CRDO miss: the principal asked to raise the stop repeatedly and it never moved.)
>   - A **question or open consideration** → do the work it asks for, weigh it, and answer in your rationale. Answering the question is the action.
>   - A **decline with no reason** → do not propose the same thing again unless its circumstances have changed. "Not this week" lapses after the week; "never this name" does not; "wait for the pullback" is met only by the pullback.
>   - An **approval with a different size, or a level they set** → honor their numbers, never revert them, and read the direction: a cut size is caution, a raised one is conviction.
>   Quote them in your rationale. When your own reasoning is something the next run must build on — what you are holding through, and what would make you sell — write it as `note`; it replaces your previous note on this stock. An expired proposal is not a decision: proposing it again is allowed if the setup still holds.

**M3, lines 256–258.** Removed:
> **The ratchet rule — protective levels move ONE way (principal ruling, 2026-08-16).** A trigger is the principal's standing order. Two consequences you must respect:
>   - **It fires every day its condition is true, and that is correct.** A stop at $400 alerts every single day the price is under $400. A decline or an expiry means "I chose to do nothing today" — it does NOT mean stop asking. Re-proposing the same exit tomorrow is the system working as designed. **Never go quiet on a live condition**, and never treat a repeat alert as a bug to engineer around. (Buy levels are the one exception: an ENTER fires when the price *crosses* its level, not every day it sits past it — a plan the price has left behind shows up here as a `planSanity` flag for you to re-anchor, not as a daily buy proposal.)
>   - **You may RAISE a protective floor; you may NEVER LOWER or loosen one.** Tightening protection on a winner is your job (see UNPROTECTED_GAIN). Moving a floor DOWN, widening a stop, or deleting a protective rung is the **principal's manual act** — they do it in the reject dialog, which lets them adjust levels while declining. If you believe a floor is too tight, say so in your proposal rationale and suggest the level; do not edit it. The same applies to the `stopLoss` column: never lower it to satisfy a shape gate (that's how MU's protection got silently cut 940→840).

Added (the firing rules now live in the core, rules 2, 3 and 7):
> **Protective levels (How we trade, 3 and 7).** A sale or review alerts every day its condition is true; a repeat alert is the system working, never a bug to engineer around — never go quiet on a live condition. You may raise a floor on a stock we own, and on a winner that is your job (see UNPROTECTED_GAIN). You may never lower or loosen one, or delete a protective trigger: that is the principal's act, done in the decline dialog. If you think a floor is too tight, say so in the proposal with the level you'd suggest. Never lower the `stopLoss` column to satisfy a shape check (MU 940 → 840).

**M3b, line 303**, which points at the paragraph M3 removes. Removed:
> You may NOT move the floor yourself — see the ratchet rule.

Added:
> You may NOT move the floor yourself — see Protective levels, above.

**M4, line 280.** Removed:
> cite an additional confirming signal (fresh routed signal, volume confirm, peer leadership shift)

Added:
> cite an additional confirming fact (a filing, the earnings figures, volume that fits the setup, peer leadership)

**M5, line 282.** Removed:
> **Sizing is by risk, and it is not yours to do.** place_trade sizes every buy so the account loses about the analyst's risk per trade (a % of equity) if the stop hits — a tight stop buys more shares, a wide stop fewer — scaled by the conviction multiple above, halved for a binary catalyst and in a CAUTION market, and kept between the analyst's smallest and largest trade. The proposal shows the arithmetic, the account's open risk against the 6% cap, and the regime.

Added: nothing. It is core rule 4.

**M6, line 284.** Removed:
> If today's signals (routed news, analyst PT moves, catalyst print direction) say the variantView no longer holds

Added:
> If today's facts (a filing, the earnings figures, the catalyst's result) say the variantView no longer holds

**M7, line 287.** Removed:
> a routed signal confirmed the variantView

Added:
> a filing or the print confirmed the variantView

**M8, line 304.** Removed:
> Cite signal_ids that informed the update.

Added:
> Then look at what the floor costs in dollars (How we trade, 5); a floor that would lose more than 1.5% of the account is part of this review's answer.

**M9, line 229.** Removed:
> - **COMPOUNDER** — long-term hold. Months to years. Exit only on invalidation triggers.

Added:
> - **COMPOUNDER** — long-term hold. Months to years. Sells on a named invalidation or the analyst's catastrophe line; price alarms are reviews.

**M10, line 374.** Removed:
> that's the Discovery Run's job (Sundays)

Added:
> that's discovery's job, which the principal starts from chat

#### Trigger run: `lib/agent/system-prompts/intraday-tactical.ts`, `buildTacticalSystemPrompt`

**T1, lines 266–267.** Removed:
> RECENT THESIS ACTIVITY (last 5 updates):
> ${recentLines}

Added:
> WHAT'S BEEN SAID ON $CEG — read before you decide
> ${context}
> The principal's notes and decisions outrank the trigger's own rationale. If they declined this same action and nothing they named has changed, say so and pass.

**T2, lines 332–334.** Removed:
> When the thesis status is WATCHING and the action is ADD, call place_trade for the entry.

Added:
> When the thesis status is WATCHING and the action is ENTER, call place_trade for the entry.

**T3, lines 462–468.** Removed:
> Two more rules the tools hold every level to, stated here so you never learn them from a refusal: a plan pays at least 2:1 ((target − entry) ÷ (entry − stop)) — a level that breaks it is refused with the arithmetic and the three legal answers (a real level, PASS, or set the plan down); and a buy needs this analyst's minimum confidence (the thesis row's composite against the seat's setting) — place_trade sizes the buy itself, you name no amount.

Added:
> The plan rules (2:1, the score, size) are How we trade, 1, 2 and 4, above.

#### Writer: `lib/agent/run-thesis-writer.ts`, `buildWriterResearchPrompt`

**W1, after the EXISTING THESIS block (line 355), refresh only.** Removed: nothing.

Added:
> WHAT'S BEEN SAID ON $T
> ${context}
> The principal's notes and decisions are part of the ground truth for your judgment. Where your refresh disagrees with one, say so in the note and in submit_thesis's rationale; never undo one silently.

**W2, lines 606–612.** Removed:
>    • You do not size the trade. place_trade sizes it by risk from your stop: the account loses about the analyst's risk per trade if the stop hits, scaled by conviction (LOW ×0.5 … STRONG ×1.25). A tight, honest stop is what earns size.
>    • confidence context: this analyst's minimum confidence for trade-eligible coverage is 70/100 — calibrate composite + conviction honestly against that bar.

Added:
>    • The score decides whether this is a buy at all. This analyst buys at 7/10. If your honest composite is below it, write the view with wake-ups — a REVIEW at the price you would look again — and no buy: a buy under the minimum is refused the day it fires, and a buy fires only once. Never raise the score to fit a plan. You do not size the trade (How we trade, 4).

The "your record by setup" lines that follow in the source stay as they
are.

#### Discovery: `lib/agent/system-prompts/discovery.ts`, `buildDiscoverySystemPrompt`

**D1, line 159.** Removed:
>   Min confidence:    70%

Added:
>   Buys at:           a score of 7/10 or better

**D2, after line 160.** Removed: nothing.

Added:
>   A writer you dispatch on a name scoring under 7 comes back as a watch with wake-ups, not a buy. That is the right outcome, not a failure.

**D3, line 139.** Removed:
> Today is your **weekly discovery run**.

Added:
> This is a **discovery run**, started by the principal.

#### /chat: `lib/agent/modes.ts`, `buildPrincipalSystemPrompt`

**C1, line 632.** Removed:
>   • Sizing: minConfidence 70 · largest trade $10000 · maxOpenPositions 8. Omit notional and place_trade sizes the buy by the analyst's rules; a notional the principal names is honored as given, with a line on the proposal when it sits outside the analyst's band.

Added:
>   • Buys at a score of 7/10 · smallest trade $4,000 · largest $10,000 · most in one stock $20,000 · at most 8 stocks. place_trade sizes every buy by risk (How we trade, 4); omit notional unless the principal names one, which is honored as given, with a line when it sits outside the band. Judge a proposal's size by the dollars at risk on its sizing line, never by the dollars in.

**C2, lines 661–662.** Removed:
>   • **Discovery Run** (Sundays 9 AM ET per analyst): mints up to 5 new WATCHING theses. Mode = DISCOVERY.
>   • **Briefing agent** (inline after every run): writes the per-analyst standup that gets injected into the next run's prompt — that's how the analyst remembers.

Added:
>   • **Discovery** runs when the principal starts it from chat; the weekly job is off by design. Mode = DISCOVERY.
>   • **How an analyst remembers:** only through the stock's Activity — the principal's notes and decisions, its own notes, its last answers — which every agent reads first. Nothing else carries a conversation forward. If this chat reaches a conclusion the analyst needs, it must become a note.

**C3, line 706, the "Should I approve this?" bullet.** Removed: nothing.

Added, at its end:
> Judge it by the analyst's own setup (its confirmation, not another setup's) and by the dollars at risk on the proposal's sizing line. Read the thesis's standing notes first.

**C4, new section after TRADE-AS-PROPOSAL (line 710).** Removed: nothing.

Added:
> ══════════════════════════════════════════════════════════════════════
> ## NOTES — how this conversation reaches the analyst
> ══════════════════════════════════════════════════════════════════════
>
> The analyst never sees this chat. When the principal reaches a conclusion on a stock — a size, a level, what they're waiting for, what would change their mind — draft ONE short note in their words: what was decided, what would change the mind, any size or level. Show it, and write it with `write_note(thesis_id, text)` when they say yes. It works unscoped: the thesis names its analyst (find the id with `list_theses_all`). A note replaces nothing unless you pass `replaces_note_id`. Never write a note the principal didn't agree to, and never a second note for the same conclusion.

**C5, line 827.** Removed: nothing.

Added, at the end of the "Composite ≥ 4" bullet:
> A writer dispatched on a name under the analyst's buying score comes back as a watch with wake-ups, not a buy.

### 3.8 The token budget

| Agent | Today | Added | Taken away | Net |
|---|---|---|---|---|
| **Morning run**, Compounder, 09-30 read (8 full rows, 14 quiet, history 8 lines) | prompt 11,800 + read ~56,000 | core + analyst block ~1,800; `context` 8 × ~600 = 4,800; quiet lines ~100 | raw history 72,000 characters ≈ 18,000 (on request instead of in every row); M3 and M5 ≈ 500 | **≈ −11,800** |
| **Morning run**, a read without history (09-25: 10 full, 5 quiet) | prompt 11,800 + read ~47,000 | ~1,800 + 10 × 600 = 7,800 | ~500 | **≈ +7,300** |
| — optional offset | | | send the model the rows without `cards` (the chat's card renderer keeps its copy): 37,000–49,000 characters ≈ 9,000–12,000 | **≈ −9,000 to −12,000** |
| **Trigger run** | ~7,100 + last 5 lines ~250 | core + analyst block ~1,800; block ~500 | old block ~250; T3 ~120 | **≈ +1,900** |
| **Writer** (refresh) | ~4,900 + data ~1,400 | core ~1,100 (its setups are already there); sell rules ~200; block ~500 | W2 ~150 | **≈ +1,650** |
| **Discovery** | ~6,300 | core + analyst block ~1,800; ~100 per researched name | — | **≈ +1,800 + 100/name** |
| **/chat**, scoped | ~10,700 | core + analyst block ~1,800; notes section ~200; ~500 per drilled stock | C2 ~80 | **≈ +1,900 + 500/stock** |

The morning run carries its `get_theses` read for the rest of the run, so
every token in the read is paid on every later step. Dropping `cards` from
the model's copy pays for the whole proposal on the morning run by itself.
It's listed separately because it touches the renderer path, and it's
worth doing either way.

---

## 4. What Dave decides

1. **Your chat's notes: written after your yes, or automatically?**
   *Recommended: after your yes.* A note of yours is the first thing every
   agent reads on that stock, for as long as it stands, so it should be
   words you agreed to. One word ("yes") is the whole cost.
2. **Who can resolve your notes?** *Recommended: you, and an agent only in
   the call that carries the note out* (for DOCU, the call that adds the
   $74.07 add trigger), shown as an Activity line. Writing the note again
   reopens it.
3. **The reading order** (§3.2): the QB's order plus "fired since the last
   answer". *Recommended as written.* The alternative ("the last 5 lines")
   is today's trigger run, and it's what lost CEG.
4. **A fired trigger stays open until an agent answers it** (§3.3).
   *Recommended.* More held stocks will show up in the morning list on
   days you've edited them; that's the point.
5. **The save's reply: B (say what it means) or A (refuse at the save)?**
   *Recommended: B* (§3.6).
6. **One trading core in every prompt, with the morning run's duplicate
   paragraphs taken out** (M3, M5). *Recommended.* The risk: the morning
   prompt is the most tuned text in the app, and moving a rule can change
   behavior. The replay tests below pin each rule's words before and
   after.

---

## 5. If agreed: the build order

One PR each, no stacking, each with a test replayed from the production
rows above and shown failing on main (LANES laws 6–8). The QB checks the
set merges in order on a scratch branch. Steps 2 and 4 touch
`lib/agent/modes.ts`, a file both lanes touch (LANES §4), so each of those
PRs says whether the Signals lane has an open PR on it. All of this is the
Agents lane's.

1. **What's been said + fires stay open.** `stock-context.ts`; `context`
   on `get_theses` rows (full and quiet); `needsAction` lists every open
   fire and counts only agent answers; the trigger run's block (T1);
   delete `principalDirective` and replace M2 **in the same PR**; the
   resize wording (mechanic H). *Replays:* CEG through `get_theses` on
   09-18 (three open fires, your 09-14 decline shown) and on 09-30 (a full
   row, not quiet); the 09-14 15:55 trigger run's prompt carries the whole
   decline (today it isn't among the five lines at all).
2. **Notes.** `notes.ts`; `update_thesis` `note` and `resolve_note_id`;
   /chat `write_note` (allowed unscoped); the Activity line. *Replay:*
   DOCU. A note written from the unscoped 09-30 chat is on DOCU, and a
   10-02 `get_theses` read returns DOCU as a full row with the note first.
3. **The save's reply.** `what_this_means` on `update_thesis`,
   `record_thesis` and the writer's check step, from `plan-sanity.ts`.
   *Replays:* the EME 09-29 21:33 save replies with the refusal line;
   BWXT 09-30's writer check says the same before saving.
4. **The trading core, the analyst block, and the prompt changes** M1,
   M3–M10, T2, T3, W2, D1–D3, C1–C5, plus the setup block's confirmation
   field. *Tests:* each prompt contains the core, rendered from the
   constants; each removed paragraph is gone; the Compounder's sell rules
   reach the trigger run, the writer and a scoped chat.
5. **Writer, discovery and /chat read the block** (W1, the
   `get_stock_data` and `list_proposals` lines). *Replay:* the EME 09-25
   writer refresh gets the block and the score-cut reply.

Optional, anytime: the model's copy of `get_theses` without `cards`.

## 6. What this does not do

- **Nothing trades on its own.** A note never becomes a trigger by code.
  An agent reads it and writes the trigger, as one Activity line. Every
  buy and sale is still a proposal you approve.
- **No analyst rule is copied onto a stock.** The block shows the
  analyst's rules as the analyst's; the stock's own levels still win.
- **No new refusal.** The save's reply is words. The fire-time check is
  unchanged.
- **No news pipeline and no inbox.** Notes are what you and the analysts
  write about a stock. The deleted signal machinery stays deleted.
- **Nothing is hidden.** The full history is always one call away, and
  the block says where.
- **It doesn't replace DAV-343, DAV-344 or DAV-345.** Those fix a spent
  buy, the floor's cost, and the message to you. This design makes sure
  each agent is handed what those fixes produce, and what you said.
