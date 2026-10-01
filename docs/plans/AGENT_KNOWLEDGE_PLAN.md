# How the agents learn your system: the stock carries its rules

> **Status:** agreed between the design session and the review session
> ("State of the cycle review"), 2026-10-01, after four rounds. Waiting on
> Dave. Nothing here is built.
>
> **It replaces** the "one trading core" part of `AGENT_CONTEXT.md` (§3.4,
> §3.5, §3.7 and build steps 3 to 5). The parts of that doc already built
> stay as they are: what's been said on a stock, open triggers, notes, and
> the save warning on an edit.

---

## The one decision for you: the pullback rule

All three analysts run the pullback setup (buy a strong stock when it dips to
its rising 20- or 50-day average). Today three texts disagree about it:

- The setup and the writer put the buy **at the average, on the way down**.
- The trigger run is told to buy only after **a close above the prior day's
  high**. At the moment a dip buy fires, that close has not happened and
  cannot have.

DOCU's pullback buy was passed on 09-28 for exactly this. It was bought on
09-30 only after the morning run rewrote the buy as "back above $67.80". The
QB's count on 09-28 was that no pullback buy had gone through in 30 days, 0 of
5; we have re-read only the DOCU one.

**We recommend: buy the touch.** The buy stays at the average, as the writer
writes it today. When it fires, the trigger run checks what it can see at that
moment:

1. The trend is intact: the average being bought is still rising, and the
   stock has not closed below its 50-day.
2. The pullback came on light volume. Before about 2 PM this is context, not
   a reason to pass.
3. No bad company news in the last hour. This check already applies to every
   buy.

It stops waiting for the close above the prior day's high.

**What this costs.** It buys the dip, not the bounce, which departs from the
playbook's wording for this setup. A stock that keeps falling through its
average gets bought.

What limits that loss is the floor, set one average day's move (1 ATR) under
the average. Two things about it:

- **The floor proposes the sale; it does not sell.** The day the price is
  under it, you get a sale proposal, and the loss is limited when that sale is
  approved. In the 30 days to 09-28, 50 sales were proposed: 7 filled, 20
  were declined and 23 expired unanswered (the 09-28 state-of-the-cycle
  review). Buying the touch leans on those approvals more than waiting for the
  bounce would.
- **The size of that loss** is 1% of the account times conviction (from half
  to one and a quarter), and halved in a cautious market or into a dated
  event. So between about 0.25% and 1.25% of the account. DOCU's was 0.75%.

On 09-28 this would have bought DOCU near $67.

**Why not wait for the bounce.** The app can't today. A buy written as "back
above the level" can't be stored while the stock is still above its average,
which is when a pullback plan is normally written. The alternative is a
wake-up at the average that gets answered the same day and writes the buy
then. That is a feature, not a wording fix, and it is not in this plan. It can
follow if buying the touch proves too loose.

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

The shared file starts with one sentence: judge a position or a proposal by
what it loses at its floor, not by the dollars in. A sentence gets into it
only if a real case goes wrong without it, shown by running that case against
the model.

---

## The plan: four PRs, in this order

### 1. Deletions

No new instructions. It removes or corrects what is wrong today:

- Instructions that point at things that no longer exist: an input that was
  removed, options that were deleted, a trigger kind that was deleted, a
  setups list that isn't there, routed news signals, a feed subscription, a
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

The decision above, in the setup list and the trigger run. It deletes the
trigger run's second, hand-written list of what confirms each setup, so one
list remains. It also corrects the trigger run's first check, which is written
only for a buy that fires on the way up: for a dip buy, the price bouncing
back above the level is the touch holding, not a failed move.

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
setups, which its prompt already refers to and doesn't have.

It also creates the shared file, with its one sentence, and loads it into the
trigger run, the writer, discovery and chat.

It deletes the numbers from chat's "Sizing" line, which shows only the largest
trade. The sentence that the app sizes the buy, and that a size you name in
chat is honored as given, stays.

### 4. The morning run's prompt

The morning prompt is the longest and carries at least eight passages each
written after one incident. This PR goes through it paragraph by paragraph:
whatever PR 3 now puts on the stock comes out of the prompt, and each incident
passage is deleted only where a check in the app now covers it, named one by
one. It loads the shared file here too, in the same change that removes the
morning prompt's own copy of that sentence. The stage headers and the tool-call rules are not touched; changing those
broke every run once.

PR 1 and PR 4 each merge alone, on a day before a morning run you can watch.

---

## How we check it

- **Prompts can only shrink.** A test measures all five prompts and fails if
  any grows past its recorded size. Each PR that deletes lowers the number.
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
- **A same-day wake-up that writes the pullback buy on the bounce.** See the
  decision above.

## What this plan does not claim

Since 09-25, six buy prices were hit in trigger runs (the review session's
count). Three became proposals: CORT and DOCU were bought, ISRG expired
unclicked. Three were missed: PLTR on size (fixed that day), AAPL on a price
wobble (fixed since), and DOCU on the pullback wording. Of this plan, only
PR 2 bears on buys being made. The rest makes chat's advice and the analysts'
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
  and Sunday run), `:299` (the deleted feed subscription), `:306` ("YOUR
  SETUPS above"; the list itself arrives in PR 3).
- `lib/agent/modes.ts`: `:666` (the briefing line), `:711` (repeatedly
  declined), `:665`, `:805`, `:873` (Sunday discovery), `:832` (`ACTIVE`),
  `:888` (`docs/GAPS.md`), `:766` (time-elapsed trigger). `:662` says the
  Daily Run is 8 AM per analyst; add Mon/Wed/Fri.
- The prompt-size test: each of the five prompts rendered from a fixed
  fixture, one recorded number each.
- The hero-case script: under `scripts/`, about 120 lines at most, not in CI,
  no assertions. One model turn after the recorded context, no tool loop. At
  most 18 model calls per PR; the count goes in the PR body. If it won't fit,
  the runs are done by hand and the PR says so.
- The PR body shows the morning prompt's removed and added text exactly.

**PR 2**
- `lib/agent/knowledge/setups.ts`, `MA_PULLBACK`: `entry.confirmation` and
  `entry.text`. The 3-month strength line stays a precondition.
- `lib/agent/system-prompts/intraday-tactical.ts`: `:342-350` deleted (the
  rendered list at `:208` remains); gate (a) at `:335-340` says which way the
  buy fires. For a buy that fires on the way down, pass only if the price is
  past the setup's chase limit above the level or already under the floor.
  `:370-374` (volume timing) stays. Gate (c) already covers company news.
- The writer, the crossing rule (`triggers/evaluate.ts:443-453`) and the
  plan-sanity flags are untouched. `rearm.ts` already covers `PRICE_BELOW`.

**PR 3**
- One builder, in the manner of `stock-context.ts`, called by `get_theses`
  rows, the trigger run's block and `list_proposals` (whose thesis block,
  `list-proposals.ts:229-240`, has no setup today).
- `SetupChecklist` (`setup-checklist.ts:10`) gains the confirmation. The
  setup's text appears once per reply, keyed by setup id, not on every row.
- The shared file: one file, loaded in PR 3 by the trigger run, writer,
  discovery and chat (scoped and unscoped). Day-one content is the one size
  sentence, worded to read correctly for all four; chat's approve bullet
  needs no sentence of its own. Its header carries the admission rule (a real
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
