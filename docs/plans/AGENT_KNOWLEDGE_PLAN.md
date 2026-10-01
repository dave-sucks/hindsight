# How the agents learn your system: the stock carries its rules

> **Status:** agreed between the design session and the review session
> ("State of the cycle review"), 2026-10-01. PR 1 is open. The pullback
> section was rewritten the same day after a test: "buy the touch" is
> withdrawn and nothing in the plan now needs a trading decision from Dave.
>
> **It replaces** the "one trading core" part of `AGENT_CONTEXT.md` (§3.4,
> §3.5, §3.7 and build steps 3 to 5). The parts of that doc already built
> stay as they are: what's been said on a stock, open triggers, notes, and
> the save warning on an edit.

---

## The pullback rule: no decision needed, and why that changed

All three analysts run the pullback setup (buy a strong stock when it dips to
its rising 20- or 50-day average). Three texts describe it differently:

- The setup and the writer put the buy **at the average, on the way down**.
- The trigger run is told to buy only after **a close above the prior day's
  high**, which has not happened at the moment a dip buy fires.

So when a pullback buy fires, the trigger run passes. DOCU's was passed on
09-28.

**What we first recommended, and withdrew.** We recommended "buy the touch":
buy the dip itself and let the floor limit a wrong one. Then we tested it.
With the agreed wording, the real model on DOCU's 09-28 case bought 1 time in
4, the same as before. The passes only changed their reason, from "no close
above the prior day's high" to "the price has undercut the average". That is
the playbook's own rule for this setup, and getting past it would have meant
stronger and stronger words to make the model buy a stock falling through
its level. The only limit on that would be the floor, and the floor is a sale
you have to approve.

**What the app does today.** The trigger run passes the dip, and the next
morning run finishes it, one of two ways. From the review session's read of
every trigger run on a pullback buy since 08-28 (the setup shown is the one
stored on each stock today; the design session verified DOCU's rows only):

- **DOCU:** passed 09-28 at $65.88. The 09-30 morning run moved the buy to
  "back above $67.80", naming the 20-day average. It fired 40 minutes after
  the open and was bought at $67.73. That is the bounce, two days late.
- **ABT:** passed 09-08 and 09-10. On 09-11 the morning run bought the dip
  itself, with the price still under its buy level, filled at $103.66.
- **HPE:** passed 09-14 (the stock was down 9.8% that day, not a pullback),
  re-priced 09-15, never bought.

So the two agents were following different rules. The trigger run waits for
the bounce. The morning run sometimes re-prices for the bounce and sometimes
buys the dip, because its prompt points at a confirmation the stock's row
doesn't carry.

**What the plan does now.** It keeps the playbook's rule and makes the three
texts say the same thing: the dip to the average arms the buy, and the buy is
taken on the bounce. When the dip fires, the trigger run moves the buy to the
bounce level itself, naming the average or the prior day's high it sits on,
the way the 09-30 morning run did. The buy can then fire the next session,
not two days later.

Tested on the real model, six runs each on DOCU's 09-28 case: before, 1
bought the dip and 5 passed with no change; after, all 6 moved the buy to
$67.43, the 20-day. On DOCU's second fire (09-30, the buy above $67.80), 2 of
3 bought both before and after, and none moved the buy a second time.

This is not a new trading rule, so there is nothing for you to decide. If the
test shows the trigger run still just passes, this PR shrinks to deleting the
duplicate text and the pullback stays as it works today.

---

## Why the earlier plan is withdrawn

The earlier plan added one "How we trade" page to all five prompts. The
review session checked it against the code and it does not hold:

- It added about ten words for every one it removed. Every prompt got longer.
- Only three of its nine rules had a real mistake behind them.
- It listed seven setups by hand. The code has twelve, and your analysts use
  six.
- It copied the pullback contradiction above into every prompt.
- Both DOCU mistakes happened in a chat with no analyst selected. The shared
  page would have reached that chat; the per-analyst part, which held the
  setups and sell rules, would not.

**The principle that replaces it:** what an agent needs to know about a stock
arrives with the stock, as labelled facts, every time. The standing prompts
get shorter, not longer.

Two findings from the review session's research into how other teams build
agents are the reason for the first and last PRs (its reading of the sources,
not checked by the design session):

- OpenAI reports that leaner prompts scored better on its own tests with far
  fewer words, and lists what to cut: repeated rules, examples that don't
  change behaviour, steps the model already does.
- OpenAI's guide for its newer models says contradictory instructions cost
  more on them, because the model spends effort reconciling them. The morning
  run and the trigger run are OpenAI models.

---

## Where a new lesson goes

This is the part that answers the original complaint: each fix landed in one
agent's prompt, and the other agents never saw it. From now on a lesson has
four possible homes:

| The lesson is true for | It goes in | Who gets it |
|---|---|---|
| One setup | The setup list | Every agent, with the stock |
| One stock or one action | The reply the tool hands back | Whichever agent is acting |
| Every agent and every stock | One shared file | All five agents, every run |
| Something that must never happen | A check in the code | Nobody has to remember it |

An agent's own prompt gets only what is about that agent's job. A fix that
doesn't fit one of the four isn't ready to be written.

The shared file starts with one sentence: the app sizes every buy from the
distance to its floor, so judge a position or a proposal by what it loses at
that floor, not by the dollars in. A sentence gets into it
only if a real case goes wrong without it, shown by running that case against
the model.

---

## The plan: four PRs, in this order

### 1. Deletions

No new instructions. It removes or corrects what is wrong today:

- Instructions that point at things that no longer exist: an input that was
  removed, options that were deleted, a trigger kind that was deleted,
  routed news signals, a feed subscription, a
  thesis status that was renamed, a deleted doc, Sunday and weekly discovery.
- A first buy on a watched stock called an "add" in the trigger run. It is a
  buy.
- The writer's "3-day earnings heads-up". Your account is set to 5. The number
  comes out of the prompt altogether; the account's setting is the source.
- Chat's false line that a briefing is "how the analyst remembers".
- Chat's line that a repeatedly declined sale means "stop proposing it". Your
  ruling is that a decline means "not today".
- The writer's line to calibrate scores against "70/100". It becomes: a buy
  under the analyst's buying score is refused.

It also adds two checks used by every later PR (see "How we check it").

### 2. The pullback rule

The section above, in the setup list and the trigger run. It deletes the
trigger run's second, hand-written list of what confirms each setup, so one
list remains. It also says the trigger run's first check ("the move hasn't
failed back below the level") is for a buy that fires on the way up; for a
dip buy, the setup's own confirmation is the check.

### 3. The stock carries its rules

Every time an agent is handed a stock, it also gets:

- **What confirms its setup**, from the setup list, stated once.
- **The analyst's buying score beside the stock's score** ("scores 6, this
  analyst buys at 7").
- **Dollars at risk at the floor, and the share of the account**, beside the
  dollars in ("$11,045 in, $842 at risk, 0.75% of the account").
- **Which sell rules are the analyst's**, labelled in the trigger list it
  already gets.

One piece of code builds this, and the morning run, the trigger run and chat's
proposals list all read from it. Discovery gets the list of its analyst's
setups: its prompt points at "your setups above" and there is no such list
until this PR adds it.

**One thing this changes about money, said here so it is read before it
happens.** Today the morning run never sees what confirms a setup, which is
how it bought ABT's dip on 09-11. Once the confirmation arrives with the
stock, the morning run reads the pullback rule for the first time. From then
on a dip like ABT's becomes a buy moved to the bounce, not a buy of the dip.
That is consistent with the rule the plan keeps, and it removes one place
where two agents disagree, but it is a change in what the morning run does.

It also creates the shared file, with its one sentence, and loads it into the
trigger run, the writer, discovery and chat. Each of those four drops its own
sentence about sizing in the same PR, so none of them says it twice.

It deletes the numbers from chat's "Sizing" line, which shows only the largest
trade. The sentence that the app sizes the buy, and that a size you name in
chat is honored as given, stays.

### 4. The morning run's prompt

The morning prompt is the longest and carries at least eight passages each
written after one incident. This PR goes through it paragraph by paragraph:
whatever PR 3 now puts on the stock comes out of the prompt, and each incident
passage is deleted only where a check in the app now covers it, named one by
one. A passage that is really about one setup moves to that setup's list of
known mistakes, where every agent gets it with the stock. It loads the shared
file here too, in the same change that removes the morning prompt's own copy
of that sentence. The stage headers and the tool-call rules are not touched; changing those
broke every run once.

PR 1 and PR 4 each merge alone, on a day before a morning run you can watch.

---

## How we check it

- **A prompt can't grow by accident.** A test records the size of each of the
  five prompts and fails if one gets longer. A PR that deletes lowers the
  number. A PR that makes a prompt longer has to raise the number by hand and
  give the reason. The plan expects that once: discovery gains the list of its
  analyst's setups in PR 3, which it needs and doesn't have.
- **Three real cases, run against the real models before and after.** Tests
  prove what an agent is handed, not what it decides. So for each change we
  replay three real moments and paste what the model said, pass or fail:
  - DOCU 09-30: "should I approve this?" in a chat with no analyst selected.
  - EME 09-29: chat setting a buy at a score of 6 for an analyst that buys at 7.
  - DOCU 09-28: the trigger run on the pullback buy.

  Each runs three times per side, on recorded data, one model answer each.
  Nothing is executed and nothing touches your account.
- **The usual replay tests** from real production rows, shown failing before
  the change.

---

## What is deliberately left out

- **The nine-rule "How we trade" page.** Withdrawn. The shared file that
  replaces it holds one sentence.
- **A block of the analyst's rules in the trigger run and chat prompts.** The
  stock carries what they need.
- **The save warning on a new thesis and in the writer.** The one case behind
  it is BWXT on 09-30, written at a score of 2 with a buy. PR 1 corrects the
  writer's instruction. It gets built only if that case still goes wrong
  afterwards.
- **Buying the touch on a pullback.** Tested and withdrawn; see the first
  section.
- **A re-priced pullback buy firing the same day.** A buy that has fired
  waits a day before it can fire again, and changing that is code on the
  money path. The re-priced buy fires the next session at the earliest.

## What this plan does not claim

Since 09-25, six buy prices were hit in trigger runs (the review session's
count). Three became proposals: CORT and DOCU were bought, ISRG expired
unclicked. Three were missed: PLTR on size (fixed that day), AAPL on a price
wobble (fixed since), and DOCU on the pullback, which was bought two days
later. Of this plan, only PR 2 bears on buys being made, and what it changes
is how soon. The rest makes chat's advice and the analysts'
reviews more accurate.

---

## Appendix for the builder

Files and lines, as of main at `e4f1e1d8`.

**PR 1**
- `lib/agent/system-prompt.ts`: `:272` "resend `triggers`" becomes
  `remove_trigger_ids` naming the buy, target and floor triggers, matching
  `:298` and `setDownInstruction` in `update-thesis.ts` (a word swap, not a
  deletion). `:354` (options b/c) goes whole; `:299` already covers when to
  invalidate. `:278`, `:282`, `:285` (routed signals), `:302` (cite
  signal_ids), `:373` (Sundays), `:334` (time-elapsed trigger). `:328` and
  `:332` wait for PR 4.
- `lib/agent/system-prompts/intraday-tactical.ts:323`, `:483`: a first buy on
  a watched stock is `ENTER`, not `ADD`.
- `lib/agent/run-thesis-writer.ts:422` (the heads-up number is deleted, not
  replaced), `:610-612` (70/100).
- `lib/agent/system-prompts/discovery.ts:139`, `:196`, `:239`, `:424` (weekly
  and Sunday run), `:299` (the deleted feed subscription). `:306` ("YOUR
  SETUPS above") is left for PR 3, which adds the list.
- `lib/agent/modes.ts`: `:666` (the briefing line), `:711` (repeatedly
  declined), `:665`, `:805`, `:873` (Sunday discovery), `:832` (`ACTIVE`),
  `:888` (`docs/GAPS.md`), `:766` (time-elapsed trigger). `:662` says the
  Daily Run is 8 AM per analyst; it becomes "on each analyst's run days"
  (the days are a per-analyst setting, so no weekday is written into a
  prompt).
- The prompt-size test: each of the five prompts rendered from a fixed
  fixture, one recorded number each.
- The hero-case script: under `scripts/`, about 120 lines at most, not in CI,
  no assertions. One model turn after the recorded context, no tool loop. At
  most 18 model calls per PR; the count goes in the PR body. If it won't fit,
  the runs are done by hand and the PR says so.
- The PR body shows the morning prompt's removed and added text exactly.

**PR 2**
- `lib/agent/knowledge/setups.ts`, `MA_PULLBACK`: `entry.text` says the dip
  arms the buy and the buy is taken on the reversal. `entry.confirmation`
  keeps the reversal and says what to do when a dip buy fires before it:
  re-price this buy to the reversal level, naming the structure.
- `lib/agent/system-prompts/intraday-tactical.ts`: `:342-350` deleted (the
  rendered list at `:208` remains); gate (a) at `:335-340` says it is for a
  buy that fires on the way up. `:370-374` (volume timing) stays.
- The writer, the crossing rule (`triggers/evaluate.ts:443-453`), `rearm.ts`
  and the plan-sanity flags are untouched. A re-levelled buy takes its side
  from the live price (`ops.ts:361-372`), keeps its id and its one-day
  cooldown (`defaults.ts:645-653`), and is not flagged by `ENTRY_RAISED_AWAY`
  when its rationale names the structure. The model is DOCU's 09-30 edit.
- Hero case: DOCU 09-28, six runs a side, three outcomes counted: bought,
  re-priced to the reclaim, bare pass.

**PR 3**
- One builder, in the manner of `stock-context.ts`, called by `get_theses`
  rows, the trigger run's block and `list_proposals` (whose thesis block,
  `list-proposals.ts:229-240`, has no setup today).
- `SetupChecklist` (`setup-checklist.ts:10`) gains the confirmation. The
  setup's text appears once per reply, keyed by setup id, not on every row.
- The shared file: one file, loaded in PR 3 by the trigger run, writer,
  discovery and chat (scoped and unscoped). Day-one content is the one size
  sentence, worded to read correctly for all four; chat's approve bullet
  needs no sentence of its own. Each prompt that loads it drops its own
  sizing sentence in the same PR: the tail of `intraday-tactical.ts:452-458`
  ("a buy needs this analyst's minimum confidence ... you name no amount";
  the row now carries the buying score), `run-thesis-writer.ts:606-609`, the
  bracket at `discovery.ts:161`, and chat's Sizing numbers (below). Its header carries the admission rule (a real
  case goes wrong without it, shown by a hero-case run; the prompt-size test
  counts it) and what may never go in it: anything about one setup (the setup
  list), anything about one stock or one action (the tool's reply), anything a
  tool already enforces and explains in its reply.
- Chat's scoped "Sizing" line (`modes.ts:636`): the numbers go; "place_trade
  sizes the buy" and "a notional the principal names is honored as given"
  stay. Chat is the one place a size may be named.
- Dollars at risk: on holdings and proposals only, not on watched stocks. For
  a holding, reuse `resolved.floorRisk` (`resolved-thesis.ts`, from #743);
  don't compute it a second way.
- Discovery reuses the writer's setup renderer.
- Standing cap: about 200 lines of app code. If over, discovery's list splits
  off.
- Before building: run EME 09-29 on main. The save warning from #749 may
  already fix it; if so it is not this PR's case.

**PR 4**
- `lib/agent/system-prompt.ts` only. No `### Stage N` header and no
  tool-call discipline text changes.
- Loads the shared file and removes `:280` (size is by risk) in the same
  change, so the morning prompt never states it twice.
