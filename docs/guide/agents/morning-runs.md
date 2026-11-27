# Morning runs

**Your analysts, at 10 AM.** Every run day, each analyst reads its whole book and answers the stocks that need it.

It acts on what changed and leaves the quiet stocks alone. Every trade it wants goes through your approval gate.

```facts
Model: gpt-5.4
Starts: Run days · 10:00 AM ET
Steps: Up to 65
Tools: 19
Saves: a note on each stock, trigger edits, conviction, catalyst date, watch status, proposals, a run summary
```

```chat
caption: A morning run for the PEAD Specialist.
tools: Reading your book (+1 more)
- 11 stocks · 4 need an answer · 7 are quiet
- SPY above its 50-day · the market is risk-on
text: $SHOP (−3.4%) closed through its $96 floor on no company news. The drift has failed, so I'm proposing the sale.
tools: Closing $SHOP position (+2 more)
- SHOP [sell] {Proposal}: Sell 120 shares at about $95.12
- AVGO: Earnings review · held, floor raised to $1,610 to keep most of the gain
- ADBE: Review due · buy moved to $402, under the 20-day
tools: Recording the run summary
- 1 proposal waiting for you · 2 stocks' triggers changed · 7 stocks left alone
```

## What it does

The morning run keeps an analyst's book honest. Once a day it reads every stock the analyst holds or watches, takes one action on each stock that's in a [situation](../concepts/situations.md), and leaves the rest alone.

[Triggers](../concepts/triggers.md) watch prices all day, but a price can't tell you that a review came due, a gain has no floor under it, or you left a note nobody answered. The morning run catches all of that, once a day, across the whole book.

Its buys, sales, adds and trims are [proposals](../concepts/approvals.md). On the live account each one waits in your queue for a yes; on paper, approval is off by default and they go straight to the broker. Every change to a [thesis](../concepts/theses.md) lands in Activity the moment it's made.

## When it runs

At 10 AM Eastern on the analyst's run days, Monday to Friday by default: half an hour after the open, so a run reads live prices and the market's first reaction to the morning's news. Market holidays are skipped. The Run button on an analyst's page starts one on any day, and you can watch it stream in.

## What it reads

<!-- asset: context morning_run -->

Its first message opens with the date line, then its context. The Market and portfolio reads come first: the [market numbers](market-reviewer.md#the-market-numbers), written by code when the request is built (the S&P 500 and Nasdaq 100, the regime, the 11 sectors, VIXY, our stocks reporting in the next 14 days), the latest 7:30 [market digest](market-reviewer.md), your portfolio snapshot, written by code when the request is built (the value and cash, every holding and how it moved, the day's buys and sells, the proposals waiting for you), and the latest 8 PM [digest](portfolio-digest.md). Where it and a stock's own row differ, the row is right. Then its book, the analyst's `get_theses` read, already in the first message so the run sees across its stocks from the start; the run page shows that same read at the top of the run as the `get_theses` card, "Reading N theses", which the model never reads. Then the week's earnings and filings.

The run's first read is `get_portfolio_context`: positions, cash, the account's open risk and the market's mood. The book gives each stock at the size today needs:

- **Every stock** is one line of the stock table: its situation, the price, the day's move and volume and the rest of the columns.
- **A stock in a situation** is also a row, the same row whatever the situation (its situations by name, its Activity, the position and any proposal waiting, the price, every trigger with its id, the belief, the assumptions, what would prove it wrong, the reasons for its conviction and outlook, where we differ from the Street, the playbook's checks, the chart numbers and Wall Street's view), with that situation's instructions, once. The fields are listed in the [Situations library](../reference/situations-library.md).
- **The bull and bear cases and the research summary** come only when a run asks for them (`include_research`).

<!-- asset: read-demo -->

The sizes are the point. The whole book at full size is tens of thousands of tokens, re-sent on every step. Sized this way, the run's attention goes to the stocks that need it.

It also reads the analyst's brief: your strategy, word for word, its rules on direction and size, and how many slots are free.

## What it decides

It works the list one stock at a time and takes exactly one action on each. One `write_note` answers all of a stock's situations at once. Before any trade it calls `get_stock_data` for the news and a fresh quote, and before any note on a stock it searches the web once for that stock's latest news. The note leads with what happened to the stock and why, then what it means for your position ([what you read](../concepts/theses.md#what-you-read)).

- **Sell or trim:** `sell`, all or part of the holding, as a proposal; the run's note on the stock is its reason. A sale you declined or let lapse, with the price still past the line, is proposed again with today's reasons, or the note says why the analyst holds.
- **Buy or add:** `place_trade` or `add`. The size is worked out by risk, inside the analyst's band; the run never picks it.
- **Redraw the triggers:** `edit_triggers`, one trigger at a time, by id, and the playbook they come from. It can raise a floor; it can never lower one on a stock we hold.
- **End its look with a verdict:** every `write_note` carries one (stronger, unchanged, weaker or broken), and a change to conviction or outlook rides in that same note; see [how a review ends](../concepts/theses.md#how-a-review-ends).
- **Change the catalyst date:** `set_catalyst_date`.
- **Stop watching, or watch again:** `stop_watching` drops a watched stock; `watch_again` puts a sold one back on watch.
- **Get fresh research:** `dispatch_thesis_research` sends the stock to [the Writer](writer.md).
- **Answer you:** your notes come first, quoted, with what it decided on each.
- **Leave your queue alone:** a sale waiting for your approval is yours to answer, so the run doesn't propose it again or argue it; its row says the proposal is waiting, and `sell` refuses a second sale. Everything else on that stock still counts (a note, a review that's due, a report, a floor to fix, an add), and the run answers it with a note or an edit, never a second sale. A waiting buy isn't proposed twice.
- **Look back once:** a stock sold in the last two weeks is either watched again with a re-entry level or let go.
- **Change nothing:** one sentence on what it checked and what would change its mind.

The market's mood sets how hard it leans in. Risk-on is full size. Cautious (the S&P more than 1% under its 50-day) halves buys and holds off on breakouts. Risk-off (more than 1% under its 200-day) tells it to take only event-driven and mean-reversion buys. And idle cash is a decision: over a quarter of the account in cash, a watched stock at its buy and a risk-on market means the run acts or says why not.

## What happens next

`record_run_summary` lists every stock the run touched, each with a one-word action. `complete_run` then checks that summary against the orders: on a stock we hold, a pick marked exit, reduce or add needs a matching sale, trim or add from this run, or the run can't finish. A summary that says "sold" when nothing was sold is the one mistake the run isn't allowed to end on.

It also checks the list: every stock the read listed as work needs an answer from this run, any save on it, a note-only review included. The list is the read's own, worked out the same way from the same facts, so every stock on it is owed and nothing else is. A book longer than the read's limit never cuts the list: the limit trims only the quiet stocks, one line each. If one has no answer, `complete_run` names it with its situations and the run goes back to it.

A run that stops after `complete_run` refused it never finished: it is saved as failed, with the refusal as the reason.

On the live account, its proposals wait in your queue. Its new levels are triggers, and from here [trigger runs](trigger-runs.md) act on them through the day.

## Tools

Everything the morning run can call, read from `lib/agent/modes.ts`.

<!-- asset: tools morning -->

<details>
<summary>Technical details</summary>

#### Schedule
`lib/inngest/functions/morning-research.ts`, cron `0 8 * * 1-5` Eastern, then each analyst's `runDaysOfWeek` (default Monday to Friday); skipped when `isTradingDay()` is false. A manual run skips both.

#### Mode
`research-run` in `lib/agent/modes.ts`: `gpt-5.4`, up to 65 steps, an 800-second limit.

#### Prompt
Its record, `MORNING_RUN` (`lib/agent/engine/agents/morning-run.ts`), whose run is about an analyst. Its instructions: one document, `morning-run.md` (the regime's rules in it), the same on every run, which imports the rules (`@rules.md`: the house rules and how it writes); the analyst it works for (its brief with its room) is context sent with them. Its context, read for the analyst by one loader per fact (`lib/agent/context/`), in its first message after the date line: the Market and portfolio reads, its book (the `get_theses` read through the run's own tool, `context/the-book.ts`), and the book's earnings and filings this week. Its message is the schedule's kickoff, the start of the day, with the watched stocks at their buy price this morning (`morningKickoff`). The cron and the Run button send the same first message (`morningRunRequest`, `lib/agent/system-prompt.ts`); the agent engine (`buildAgentRequest`, `lib/agent/engine/build.ts`) reads the facts and builds the request, naming each part for the run's Context panel. Situation texts come from `SITUATIONS` in `lib/agent/situations.ts`, never the prompt.

#### The read
`get_theses` builds each row with `lib/agent/row-for-model.ts` at one of three sizes. A trigger's note is on the row only when someone wrote it (`writtenNote`, `lib/agent/triggers/note.ts`).

#### Close-out
`complete_run` credits a sale from the `Order` table, not the run's words (`lib/agent/summary-action-check.ts`). The stocks it owes are `listsTheStock` (`lib/agent/situations.ts`) over `loadStockFacts` (`lib/agent/stock-facts.ts`), what `get_theses` lists (on the default read its `limit` applies to the quiet stocks only, so a stock in work is never cut); any `ThesisUpdate` this run but a trigger fire answers one. A trigger run or a Writer run owes only its own stock.
A run still open when the model stops is closed by the job (`morning-research.ts`): failed if `complete_run`'s last reply was a refusal (`refusedCloseOut`) or the same call was refused three times, otherwise complete if it saved any work.

#### What was sent
The run page's Context shows the request the run's newest model call started with (its own, or a follow-up after it), exactly as it was sent, kept by `modelFor` (`lib/agent/model.ts`). The conversation on the page opens with its message (`openingOf`, `lib/agent/engine/engine.ts`), then the book's `get_theses` card: the one read, as the screen gets it, saved with the thread by the cron and the Run button and streamed first on a live run (`lib/agent/book-card.ts`, `bookOnScreen` in `context/the-book.ts`). A follow-up leaves the card out of what the model is sent (`historyForModel`, `lib/agent/prompt-cache.ts`), so the book reaches it once, in its first message. The instructions and the reads are in Context.
</details>
