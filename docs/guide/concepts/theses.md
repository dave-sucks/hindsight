# Theses

**Every position starts with a thesis.** One analyst's view of one stock: what it believes, and the triggers that act on it.

A thesis is the record every agent reads and edits. Its life is a loop: researched, watched, bought, guarded, sold, and looked back on once.

<!-- asset: card theses -->

## A claim and its triggers

A thesis has two halves, written and kept by different hands.

- **The claim** is the research, written by [the Writer](../agents/writer.md): the belief (why we own the company and what has to stay true, in plain words), the two or three assumptions it rests on, what would prove it wrong, the case for and against, and a score. Every agent reads it as the claim of record. Only a new write-up changes the belief, its assumptions and what would prove it wrong; [chat](../agents/chat.md) sends the stock to the Writer when you ask for one. A morning run or chat can change its conviction.
- **The [triggers](triggers.md):** one sentence each saying when to buy, add, trim, sell or look again. A stock has its triggers and nothing else: "the buy" and "the floor" are names for kinds of trigger, and there is no plan or price target of our own beside them ([Price targets](price-targets.md)). This is the half the agents keep up to date, one trigger at a time.

Alongside both sits what's been said: the stock's Activity, one list. A trigger firing, an analyst's note, a proposal and what you did with it, your own notes and edits are each one line in it. A declined or expired proposal shows the stock's price at that moment, as an approved one shows the fill; an order that never went through approval (approvals off, or your own click) is one line, its fill. The Activity tab shows the whole list (`lib/thesis/activity-feed.ts`). The next look at the stock reads it as one list, newest first, one sentence per line, the same for every agent (`activityRead`, `lib/agent/stock-context.ts`). The rule is a filter: the last 3 reviews (a run's line with a note; a run that saved its note twice is one review), the newest 3 of the Market Reviewer's news notes of medium or high impact, your newest 3 notes, and your last decline that carries words. Every kind has a number (`READ`), and nothing older than 45 days is read (`READ_DAYS`). Trigger edits, trigger fires, proposal steps with no words and low-impact news are left out; they stay on the Activity tab. Each sentence has the same parts: what it is, who wrote it, when, the price then, the verdict's word when it has one, and the note ("Review by its analyst, Nov 18, 8:01 AM at $39.27: weaker. …"). The [Portfolio Manager](../agents/portfolio-manager.md)'s rows carry the same list. The Overview's "Agent insights" is the newest 5 lines that carry a written paragraph (a trigger fire's figures don't count), with the first period in its heading; hovering the heading says what the agents read instead. A proposal waiting for you is pinned to the top of the Overview as the card. The home page's Activity is the same lists across the book, cut to the trades (each proposal's steps and every fill, a sale with its gain on what the shares cost) and the changes of watch status (started watching, stopped watching with the reason written on the line, a position opened or closed, a pass), each named by what is stored on the line, never by its words (`lib/thesis/account-activity.ts`). Beside them are the trades that never became a proposal: a trigger that fired and the analyst held ("Held, not sold", "Buy passed"), a trade a rule blocked, a run that broke, and any other refusal still open ("Thesis research blocked"). A refusal and a broken run are not Activity lines, so these are read from the runs, orders and refusals (`lib/portfolio/attempt-outcomes.ts`). A review's title says what kind of review it was, from the trigger that woke it: after a sale line fired, a "Sale review" with that line's condition ("Sale review below $42.70"); on a review trigger, "Pre-earnings review", "Post-earnings review", "Scheduled review" (the review clock), "Checkpoint review" (so many days after the buy), "Filing review", or "Review" with the price or chart condition it answered ("Review below the 200-day average"); a review no trigger woke is "Review". A line keeps the rule it answered as it stood, so the title holds after the rule is edited or removed; a morning note that names no trigger is linked by the app to the one fire open on the stock, or to the review clock when the review was due, so a clock review reads "Scheduled review". A review can end with a verdict (stronger, unchanged, weaker or broken) and name the earlier note it answers: its title carries the word ("Pre-earnings review · weaker"), and the agent's copy of the line carries the word and the line's id. The app gives each line it makes a title and never a paragraph: every paragraph you read is an analyst's words or yours.

A note can also be written once to several stocks: a list of them, one analyst or the whole account (`SharedNote`, `lib/agent/shared-notes.ts`). You write one from chat with `write_note`. The [Market Reviewer](../agents/market-reviewer.md) writes them every morning to the stocks its research touched, one stock or several, each with its impact and effect in its title; none of its notes is pinned, and a high one can start a look through a [trigger](triggers.md) that watches its notes. Every note is one line in the Activity of each stock it reaches: a note to stocks on the stocks it names, a note to the account on every stock on the book when it was written, a note to an analyst on that analyst's stocks. Pinned until a date (two weeks at most), your note to stocks reads above the stock's Activity for every look. A note puts no stock on a run's list. A note to the account or an analyst is read once at the top of each run until it ends, a week unless it names an end, and is not repeated on each stock.

## What you read

Every agent writes for you in plain English, in one of two styles (`lib/agent/engine/agents/rules.md`):

- **A note** (a review, a trigger run's decision, a trade's reason, a run-summary line) is one short paragraph, two to four sentences and about 60 to 90 words, said the way a markets podcaster would say it: short sentences, everyday words, none of the desk's ("catalyst", "thesis intact", "re-rate", "exposure"). It answers "what's going on with this stock, and what should I do?" in three parts: the first sentence says what happened and what the analyst is doing about it ("Microsoft jumped after earnings, and I'm proposing we add 4 shares"); then why and what the analyst makes of it (the company, or just its group?), with what you own and are up or down; then what would change the call. It keeps the two or three numbers that matter and drops the rest. What to find out comes from the stock's [situation](situations.md); the note is what was found. It never opens with a level or a trigger; a stop or a level appears at most once, in that last sentence. It picks up from the last note rather than repeating it.
- **The stock's standing description** (the company line, the belief, the bull and bear cases, the variant view) reads like a company page: what the company does and how it makes money, why we own it, the case for and against, and what has to stay true. The numbers, the earnings history and what Wall Street thinks are live data beside it, never prose.

Before writing a decision note, an agent searches the web once for the stock's latest news, so the note can say why it moved. If it still doesn't know, it says so. None of the app's shorthand reaches you: no setup names, no "drift", no "rung".

## How a review ends

A thesis has two pieces of state, and every look by its analyst ends with one event.

**Outlook** is what we expect of the stock from here: bullish, neutral or bearish, with a sentence of why. The Writer must set it, with its reason, on every thesis it writes. Nothing fills it in from the direction: a thesis written before outlooks existed has none, reads "Not rated", and gets one at its analyst's first look. The analyst may change it at any look, on any verdict: a rally that uses up the upside turns bullish into neutral while nothing about the company changed. No code acts on it. It shows as a pill beside Holding or Watching, and an agent reads the word on the stock's line and the reason wherever it reads the conviction's.

**Conviction** is how confident we are in the belief as written, whichever way it points:

- **High:** the evidence clearly supports it, and nothing against it is unanswered.
- **Medium:** reasoned and plausible; untested, or the evidence is mixed.
- **Low:** thin or contested; an assumption has missed or is in doubt.

It is not how bullish we are and not whether to buy today, so high conviction in a neutral or a bearish outlook is a real view. It sizes a buy. A move in the price is not a reason for it, though what the price already reflects can be part of the belief.

**The verdict** is what the evidence since the last look did to the belief as written, not to the stock: evidence that backs a bearish belief is stronger. Every note from a morning run or a trigger run carries one:

- **Stronger:** the evidence supports the thesis more than before.
- **Unchanged:** nothing bore on it. A move in the price alone is unchanged.
- **Weaker:** the evidence goes against it, not fatally.
- **Broken:** something written under what would prove it wrong has happened, or the belief no longer holds.

Any verdict but unchanged says what happened and which assumption it touched.

The rules between them are few (`lib/agent/thesis-review.ts`), and a note that breaks one comes back whole with what to send:

- Conviction changes only in a look's note, in the same save as its verdict. It rises only on stronger and falls only on weaker or broken. A verdict doesn't have to move it.
- A new conviction or outlook comes with its reason, or the whole note comes back: one look leaves one Activity line.
- Broken can't leave the outlook bullish, and on a stock we hold it comes with its sale: the whole holding's sale waiting for you now, or one you declined after the thesis was first called broken. A trim, a sale that lapsed, or a sale from before it broke is not that sale.
- The post-trade write-up after an Auto trade is not a look: its note is that trade's reason and carries no verdict.
- Nothing adds verdicts up. Outlook and conviction are whatever the latest look left them at.

You change either one yourself from the chat (`set_conviction`), with no verdict.

A thesis shows in three tabs, the same on its sheet, on the trade page and on the stock's page (the stock's page adds its Financials and News tabs and Hindsight's history of the stock under Activity). With no live thesis, the stock's page shows the newest one as history, its pill saying how it ended (Passed, Dropped, Sold) and its notes under Agent insights; only a stock never researched reads "No research yet" (`thesisToShow`, `lib/thesis-status.ts`). **Overview** is the timeline: the price, the chart, the flag for today's work, the Agent insights (the newest 5 written-up Activity lines) and the triggers, with the levels, the two analyst cards (the rating split, and the Street's targets on a line with the price and our entry) and the earnings record under them. **Research** is the analyst's view, in this order: the company in two sentences under "About <the company>", the belief under "Core thesis" with the date the Writer wrote it and the stock's price that day ("Written Sep 13 at $38.38"), the bull case, the bear case and what would prove us wrong as bullets, the recent SEC filings, then, folded, the assumptions (each ending with when and where it is checked) where we differ from the street, and the conviction's reason under its tier. The top row of the sheet and the trade page is the nav: the status pill and the conviction chip ("High conviction", with a flame on High and Strong), then at the right edge the pin, a ··· menu (Send to agent, Trade, Close trade with its warning) and, on the sheet, an expand button to the full page on the left and the X on the right. Under it, one line: the stock's logo, ticker and name. **Activity** is the whole list. A row written before the company line shows nothing where it would be, never a placeholder.

## Where it comes from

Every thesis is researched by the Writer. A stock reaches it when [Discovery](../agents/discovery.md) finds one that fits the [analyst](analysts.md), when you ask in chat or press Send to agent on a stock's page, or when a stock you put on the watchlist comes due its first research.

The Writer reads the numbers, the filings and the web, and comes back with one of three answers:

- **Watch it, with a buy.** Its playbook's watch triggers: a buy, a "Stop watching if below", usually a review clock, each price from the chart. A watch has no floor: its "Stop watching if below $X · only on the close" trigger retires the watch on a close below, and it never sells. The thesis is **Watching**, and with a review clock the sheet calls it an **Agent Watch**: the analyst looks at it again on that schedule.
- **Watch it, with no buy yet.** Strong but not ready to price. It waits on a wake, like a price or a date, that brings it back for a fresh look.
- **Pass.** Saved as **Passed**, with what would change the verdict, so the stock isn't pitched again without a reason.

## How it gets bought

While a stock is watched, its buy trigger is checked every five minutes. When the price crosses the level, a [trigger run](../agents/trigger-runs.md) looks at that one stock within minutes, checks the playbook's confirmation and the news, and [proposes](approvals.md) the buy. On the live account, nothing fills until you approve it.

When the broker takes the buy, the thesis becomes **Holding**. At the fill, the watch triggers come off and the floor goes on: the buy, the "Stop watching if below" and the playbook's other watch triggers come off (a trigger written by hand stays), and "Sell if below" goes on at the price you approved on the proposal (the analyst's, or yours from Edit & Approve or the Trade ticket). Then one run on the stock, [After the buy](../agents/after-the-buy.md), puts on the playbook's holding triggers, each fitted to the thesis with its reason. Nothing is stamped from the fill price or the horizon. From then on the sell side guards it: the floor and the trail, usually inherited from the analyst's sell rules.

## When an agent looks at it

No agent reviews every thesis every day. A thesis gets attention for one of two reasons:

- **One of its triggers fires.** A buy, add, trim or sale wakes a trigger run within minutes. A review waits for the morning.
- **It's in a [situation](situations.md).** Every [morning run](../agents/morning-runs.md) reads the analyst's whole book but works only on stocks that need an answer today: a review that came due, a buy the price has moved past, a gain with no floor under it, a report coming, research past its date, a note from you. A quiet thesis is one line in the read and is left alone.

And you can ask about any thesis in chat, any time.

## How it changes

As the price and the story move, agents keep the triggers current one at a time, by id: re-price a buy the price left behind, raise a floor under a gain, reset the levels after a fire. Each change is one line in the stock's Activity, with who made it and why. When the research gets old, the stock goes back to the Writer for a refresh.

Who may change what:

- **The Writer:** the whole thesis, claim included, and the playbook's watch triggers.
- **Chat:** the triggers, the conviction and the catalyst date, whether we watch the stock, and notes. The belief and direction go through the Writer.
- **A morning run:** the same, and its verdict on a review.
- **A trigger run:** the triggers, its verdict and a note.
- **The Portfolio Manager:** notes and triggers.
- **You:** any trigger on the thesis sheet, a yes or no on every proposal, and notes through chat, which the next run answers first.

One rule holds over all of them: no agent can lower a floor on a stock we hold. Only you move it down.

How a save lands or is refused, field by field: [Saving a thesis](../deep-dives/saving-a-thesis.md).

## How it ends

<!-- asset: thesis-lifecycle -->

- **Sold.** A profit-take, or a sale where the analyst says the belief still holds, sends the thesis back to Watching. The triggers that need a position come off; the rest stay as written, and nothing is added. Any other sale retires it as sold, and within two weeks it gets one look back: watch it again, or let it go.
- **Proven wrong.** Something on its "wrong if" list happened. A holding is sold; a watch is retired.
- **Dropped or replaced.** Taken off the watchlist (by an agent, by you, or by a watch's "Stop watching if" line closing below), or replaced by a newer thesis. The history stays.

## Statuses

- **Watching:** on the watchlist. An **Agent Watch** has its own review clock; a plain watch waits for its triggers.
- **Holding:** bought, guarded by its sell side.
- **Passed:** researched and declined.
- **Retired:** sold, dropped, proven wrong or replaced.
- **Promoted:** held on paper and just moved to live money; the next run re-enters or goes back to watching.

<details>
<summary>Technical details</summary>

#### Stored as
`Thesis`: `status` WATCHING · HOLDING · PASSED · RETIRED (with `retiredReason` DROPPED · SOLD · INVALIDATED · REPLACED) · PROMOTED; `direction` LONG · SHORT, or none on a seed. Sold is RETIRED with SOLD.

A review's verdict is on its Activity line: `ThesisUpdate.verdict` (STRONGER · UNCHANGED · WEAKER · BROKEN), `verdictLine` and `answersUpdateId`, written by `write_note`. `activityRead` in `lib/agent/stock-context.ts` builds the one list every agent reads (`READ`), and `ownerSets` there reads off the same lines when you last changed a trigger and what it was.

#### The parts
`coreBelief`, `keyAssumptions`, `invalidationConds`, `bullCase`, `bearCase`, `snapshot`, `conviction`, `setupId`, `triggers`

#### Written by
The Writer: `submit_thesis`, then code runs the save (`record_thesis` for a new thesis, `update_thesis` for a rewrite; neither is on any agent's list), which writes its playbook's watch triggers; then the Writer tailors them with `edit_triggers`. A seed is minted by the app or the analyst builder, never by an agent. Send to agent on a stock's page is `sendToThesisWriter` in `lib/actions/watchlist.actions.ts`.

#### Agent Watch
`isAgentWatched` in `lib/agent/triggers/agent-watch.ts`: a watch with a review schedule of its own.

#### Edited by
`edit_triggers`: `add`, `edit` by id, `remove` by id. Each agent's thesis tools and their fields are pinned by `thesis-doors.test.ts`: a run's note, its trigger edits, its catalyst date and the two watch tools; a trigger run gets the note and the trigger edits only, and the Writer its own save, `update_thesis`.

#### Status changes
The buy turns WATCHING into HOLDING as soon as the broker accepts it (on approval, or inline when approval is off): `armHeldLadderOnFill` in `lib/proposals/thesis-flips.ts` removes the buy and the Stop watching triggers and every trigger marked `playbook: "WATCH"`, writes the order's own sell price ("Sell if below" at its `stopLoss`, with the analyst's `stopReason` as its note, or yours from the ticket), applies stop when buying (`lib/trading/auto-stop.ts`) when it is on, and leaves the sell rules inherited. The playbook's other holding triggers are put on by the run after the fill (`lib/proposals/after-buy.ts`), through `edit_triggers`, so the save's rules hold for them: yours win, and only you lower a floor. Nothing comes from the horizon. A watch's Stop watching trigger firing retires it as DROPPED (`stopWatching`, `lib/agent/triggers/stop-watching.ts`). A sale retires it as SOLD, unless it was a profit-take or the closing agent said the belief survived (`shouldRecycleToWatching`): then it goes back to WATCHING with the triggers that need a position removed (`closeThesisForPosition`) and nothing written.

#### Floors
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts` refuses any agent edit that lowers or loosens a protective level on a stock we hold.

#### Levels
The buy, floor and upside levels are triggers, edited by id; there are no level fields on any save and no level columns on the stock. Every surface shows the triggers themselves, as their sentences; rows and cards show none. What we paid is the position's `avgCost`.

#### Reference
`docs/THESIS_ARCHITECTURE.md` · `lib/agent/triggers/ops.ts`
</details>
