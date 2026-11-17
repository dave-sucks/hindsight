# Theses

**Every position starts with a thesis.** One analyst's view of one stock: what it believes, and the triggers that act on it.

A thesis is the record every agent reads and edits. Its life is a loop: researched, watched, bought, guarded, sold, and looked back on once.

<!-- asset: card theses -->

## A claim and its triggers

A thesis has two halves, written and kept by different hands.

- **The claim** is the research, written by [the Writer](../agents/writer.md): the belief (why we own the company and what has to stay true, in plain words), the two or three assumptions it rests on, what would prove it wrong, the case for and against, and a score. Every agent reads it as the claim of record. Only a new write-up, or you through [chat](../agents/chat.md), changes the belief, its assumptions and what would prove it wrong; a morning run can change the setup it trades as and its conviction.
- **The [triggers](triggers.md):** one sentence each saying when to buy, add, trim, sell or look again. A stock has its triggers and nothing else: "the buy" and "the floor" are names for kinds of trigger, and there is no plan or price target of our own beside them ([Price targets](price-targets.md)). This is the half the agents keep up to date, one trigger at a time.

Alongside both sits what's been said: the stock's Activity, one list. A trigger firing, an analyst's note, a proposal and what you did with it, your own notes and edits are each one line in it. A declined or expired proposal shows the stock's price at that moment, as an approved one shows the fill; an order that never went through approval (approvals off, or your own click) is one line, its fill. The rule is two sentences: the Activity tab shows the whole list, and the next run on the stock reads the newest 8 exactly as they read in the feed (`lib/thesis/activity-feed.ts`), where the Activity tab marks their end. The Overview's "Agent insights" is the newest 5 lines that carry a written paragraph (a trigger fire's figures don't count), with the first period in its heading; hovering the heading says what the agents read instead. A proposal waiting for you is pinned to the top of the Overview as the card. The home page's Activity is the same lists across the book, cut to the trades (each proposal's steps and every fill, a sale with its gain on what the shares cost) and the changes of watch status (started watching, stopped watching with the reason written on the line, a position opened or closed, a pass), each named by what is stored on the line, never by its words (`lib/thesis/account-activity.ts`). Beside them are the trades that never became a proposal: a trigger that fired and the analyst held ("Held, not sold", "Buy passed"), a trade a rule blocked, a run that broke, and any other refusal still open ("Thesis research blocked"). A refusal and a broken run are not Activity lines, so these are read from the runs, orders and refusals (`lib/portfolio/attempt-outcomes.ts`). A review's title says what kind of review it was, from the trigger that woke it: after a sale line fired, a "Sale review" with that line's condition ("Sale review below $42.70"); on a review trigger, "Pre-earnings review", "Post-earnings review", "Scheduled review" (the review clock), "Checkpoint review" (so many days after the buy), "Filing review", or "Review" with the price or chart condition it answered ("Review below the 200-day average"); a review no trigger woke is "Review". A line keeps the rule it answered as it stood, so the title holds after the rule is edited or removed; a morning note that names no trigger is linked by the app to the one fire open on the stock, or to the review clock when the review was due, so a clock review reads "Scheduled review". A review can end with a verdict (stronger, unchanged, weaker or broken) and name the earlier note it answers: its title carries the word ("Pre-earnings review · weaker"), and the agent's copy of the line also carries the verdict's one line, the date of the line it answers and each line's id. The app gives each line it makes a title and never a paragraph: every paragraph you read is an analyst's words or yours.

A note can also be written once to several stocks: a list of them, one analyst or the whole account (`SharedNote`, `lib/agent/shared-notes.ts`). You write one from chat with `write_note`. The [Market Reviewer](../agents/market-reviewer.md) writes them every morning to the stocks its research touched, one stock or several, each with its impact and effect in its title; a high-impact one is pinned for three days. Every note is one line in the Activity of each stock it reaches: a note to stocks on the stocks it names, a note to the account on every stock on the book when it was written, a note to an analyst on that analyst's stocks. Pinned until a date (two weeks at most), a note to stocks reads above the stock's newest 8 for every run, and the stock is in the "a note to answer" situation until a run writes on it. A note to the account or an analyst is read once at the top of each run until it ends, a week unless it names an end, so it never counts toward a stock's newest 8; the Activity tab's mark skips it.

## What you read

Every agent writes for you in plain English, in one of two styles (`lib/agent/voice.ts`):

- **A note** (a review, a trigger run's decision, a trade's reason, a run-summary line) is one short paragraph, two to four sentences and about 60 to 90 words, said the way a markets podcaster would say it: short sentences, everyday words, none of the desk's ("catalyst", "thesis intact", "re-rate", "exposure"). It answers "what's going on with this stock, and what should I do?" in three parts: the first sentence says what happened and what the analyst is doing about it ("Microsoft jumped after earnings, and I'm proposing we add 4 shares"); then why and what the analyst makes of it (the company, or just its group?), with what you own and are up or down; then what would change the call. It keeps the two or three numbers that matter and drops the rest. What to find out comes from the stock's [situation](situations.md); the note is what was found. It never opens with a level or a trigger; a stop or a level appears at most once, in that last sentence. It picks up from the last note rather than repeating it.
- **The stock's standing description** (the company line, the belief, the bull and bear cases, the variant view) reads like a company page: what the company does and how it makes money, why we own it, the case for and against, and what has to stay true. The numbers, the earnings history and what Wall Street thinks are live data beside it, never prose.

Before writing a decision note, an agent searches the web once for the stock's latest news, so the note can say why it moved. If it still doesn't know, it says so. None of the app's shorthand reaches you: no setup names, no "drift", no "rung".

A thesis shows in three tabs, the same on its sheet, on the trade page and on the stock's page while the thesis is live (the stock's page adds its Financials and News tabs and Hindsight's history of the stock under Activity). **Overview** is the timeline: the price, the chart, the flag for today's work, the Agent insights (the newest 5 written-up Activity lines) and the triggers, with the levels, the two analyst cards (the rating split, and the Street's targets on a line with the price and our entry) and the earnings record under them. **Research** is the analyst's view, in this order: the company in two sentences under "About <the company>", the belief under "Core thesis" with the date the Writer wrote it and the stock's price that day ("Written Sep 13 at $38.38"), the bull case, the bear case and what would prove us wrong as bullets, the recent SEC filings, then, folded, the assumptions (each ending with when and where it is checked) where we differ from the street, and the conviction's reason under its tier. The top row of the sheet and the trade page is the nav: the status pill and the conviction chip ("High conviction", with a flame on High and Strong), then at the right edge the pin, a ··· menu (Send to agent, Trade, Close trade with its warning) and, on the sheet, an expand button to the full page on the left and the X on the right. Under it, one line: the stock's logo, ticker and name. **Activity** is the whole list. A row written before the company line shows nothing where it would be, never a placeholder.

## Where it comes from

Every thesis is researched by the Writer. A stock reaches it when [Discovery](../agents/discovery.md) finds one that fits the [analyst](analysts.md), when you ask in chat or press Send to agent on a stock's page, or when a stock you put on the watchlist comes due its first research.

The Writer reads the numbers, the filings and the web, and comes back with one of three answers:

- **Watch it, with a buy.** A buy trigger and the place it would stop watching (and a take-profit where the setup has one), priced from the setup's rules and the chart. A watch has no floor: its "Stop watching if below $X · only on the close" line retires the watch on a close below, and it never sells. The thesis is **Watching**, and with a review clock the sheet calls it an **Agent Watch**: the analyst looks at it again on that schedule.
- **Watch it, with no buy yet.** Strong but not ready to price. It waits on a wake, like a price or a date, that brings it back for a fresh look.
- **Pass.** Saved as **Passed**, with what would change the verdict, so the stock isn't pitched again without a reason.

## How it gets bought

While a stock is watched, its buy trigger is checked every five minutes. When the price crosses the level, a [trigger run](../agents/trigger-runs.md) looks at that one stock within minutes, checks the setup's confirmation and the news, and [proposes](approvals.md) the buy. On the live account, nothing fills until you approve it.

When the broker takes the buy, the thesis becomes **Holding**. It keeps its other triggers: the buy and the Stop watching line come off, "Sell if below" goes on at the price you approved on the proposal (the analyst's, or yours from Edit & Approve or the Trade ticket), and its playbook's fill triggers are added as Settings → Playbook lists them (a review clock among them; one the stock already has of the same kind stays, and the Activity line says which template wasn't written). Nothing is stamped from the fill price or the horizon. From then on the sell side guards it: the floor and the trail, usually inherited from the analyst's sell rules.

## When an agent looks at it

No agent reviews every thesis every day. A thesis gets attention for one of two reasons:

- **One of its triggers fires.** A buy, add, trim or sale wakes a trigger run within minutes. A review waits for the morning.
- **It's in a [situation](situations.md).** Every [morning run](../agents/morning-runs.md) reads the analyst's whole book but works only on stocks that need an answer today: a review that came due, a buy the price has moved past, a gain with no floor under it, a report coming, research past its date, a note from you. A quiet thesis is one line in the read and is left alone.

And you can ask about any thesis in chat, any time.

## How it changes

As the price and the story move, agents keep the triggers current one at a time, by id: re-price a buy the price left behind, raise a floor under a gain, reset the levels after a fire. Each change is one line in the stock's Activity, with who made it and why. When the research gets old, the stock goes back to the Writer for a refresh.

Who may change what:

- **The Writer:** the whole thesis, claim included.
- **Chat:** the triggers, and the belief and direction when you ask.
- **A morning run:** the triggers, its verdict and a note.
- **A trigger run:** the triggers, its verdict and a note.
- **You:** any trigger on the thesis sheet, a yes or no on every proposal, and notes through chat, which the next run answers first.

One rule holds over all of them: no agent can lower a floor on a stock we hold. Only you move it down.

How a save lands or is refused, field by field: [Saving a thesis](../deep-dives/saving-a-thesis.md).

## How it ends

<!-- asset: thesis-lifecycle -->

- **Sold.** A profit-take, or a sale where the analyst says the belief still holds, sends the thesis back to Watching with a one-day review to set a re-entry level. Any other sale retires it as sold, and within two weeks it gets one look back: watch it again, or let it go.
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

A review's verdict is on its Activity line: `ThesisUpdate.verdict` (STRONGER · UNCHANGED · WEAKER · BROKEN), `verdictLine` and `answersUpdateId`, written by `update_thesis` and read into the agent's copy by `saidLine` in `lib/agent/stock-context.ts`.

#### The parts
`coreBelief`, `keyAssumptions`, `invalidationConds`, `bullCase`, `bearCase`, `snapshot`, `scoring`, `conviction`, `setupId`, `triggers`

#### Written by
The Writer (`submit_thesis`, saved through `record_thesis` / `update_thesis`). A seed is minted by the app or the analyst builder, never by an agent. Send to agent on a stock's page is `sendToThesisWriter` in `lib/actions/watchlist.actions.ts`.

#### Agent Watch
`isAgentWatched` in `lib/agent/triggers/agent-watch.ts`: a watch with a review schedule of its own.

#### Edited by
`update_thesis`: `add_triggers`, `edit_triggers` by id, `remove_trigger_ids`. The fields each agent may send are pinned by `update-thesis-doors.test.ts`: the Writer 29, chat 18, a morning run 15, a trigger run 9.

#### Status changes
The buy turns WATCHING into HOLDING as soon as the broker accepts it (on approval, or inline when approval is off): `armHeldLadderOnFill` in `lib/proposals/thesis-flips.ts` removes the buy and the Stop watching lines, writes the order's own sale ("Sell if below" at its `stopLoss`, with the analyst's `stopReason` as its note, or yours from the ticket) and upside level onto their triggers, applies stop when buying (`lib/trading/auto-stop.ts`) when it is on, stamps the entry with the fill price, adds the playbook's fill templates (`loadPlaybook` and `fillTemplateOps` in `lib/agent/knowledge/`; the seed is `playbook-templates.ts`, an account's own list is `Account.playbooks` once seeded; a playbook that can't be read writes none, and the Activity line says so), and leaves the sell rules inherited. Nothing comes from the horizon. A watch's Stop watching line firing retires it as DROPPED (`stopWatching`, `lib/agent/triggers/stop-watching.ts`). A sale retires it as SOLD, unless it was a profit-take or the closing agent said the belief survived (`shouldRecycleToWatching`): then it goes back to WATCHING with a one-day review.

#### Floors
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts` refuses any agent edit that lowers or loosens a protective level on a stock we hold.

#### Levels
The buy, floor and upside levels are triggers, edited by id; there are no level fields on any save. The `entryPrice`, `targetPrice` and `stopLoss` columns are a cache of the triggers (`canonicalLevels`).

#### Reference
`docs/THESIS_ARCHITECTURE.md` · `lib/agent/triggers/ops.ts`
</details>
