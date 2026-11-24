# After the buy

**Right after buying, a trader decides what would make them sell, take some off, add or look again.** After the buy does that on every buy and add, minutes after it fills.

It reads the stock's playbook's holding triggers and puts them on the stock, each fitted to the thesis with its reason. It writes the trade's note when nobody has. It can't trade.

```facts
Model: gpt-5.4
Starts: Minutes after a buy or an add fills
Steps: Up to 15
Tools: 8
Saves: the holding's triggers, and the trade's note when it has none
```

## What it does

At the fill, code takes the watch triggers off and puts the floor on: the "Sell if below" the buy came with ([From proposal to fill](../deep-dives/proposal-to-fill.md#what-it-does-to-the-thesis)). Nothing else is stamped. The rest of a holding's triggers, the ones its [playbook](../reference/setups.md) lists for a holding (a review clock, a business checkpoint, an add once it works, a Trim at the prior high), are this run's to put on.

Why a run and not a stamp? A playbook's line is a template. This stock has its own thesis, its own report date and its own chart, so the run reads them and fits each line to the stock, or leaves one off and says why.

## When it runs

Once for every buy or add that fills, whatever brought it:
- a proposal you approved;
- a buy with approval off;
- an Auto buy or an Auto add;
- a buy from the Trade ticket.

A fill reported twice (by the trade tool, and by the job that matches orders to the broker) runs it once. A run that fails is tried again five minutes later, up to three tries, then you get one email naming the stock. A run that put triggers on before it failed counts as done.

## What it reads

<!-- asset: context after_buy -->

Its message is the trade, from the fill:
- what filled, at what price, and the shares;
- the floor and its reason;
- the trigger that led to it;
- the trade's note, if anyone wrote one;
- after an add, the holding now.

Its context is the stock's row (the same one `get_theses` gives every agent, with the floor just written and each trigger's id), the stock's data and chart, the market numbers, and its playbook's holding triggers by reference: H1, H2…, the ones that come with the buy, then the ones written at the fill, each with its reason and where each chart key's number comes from.

## What it decides

- **Put on the holding's triggers:** one `edit_triggers`, each by its reference (`H2`). Code prices it from the chart and the buy, so no price is typed from memory. Where it fits one to the stock it gives its own reason.
- **Add its own where the thesis needs one:** an earnings review, a level to look again at. It prices from the chart, as the Writer does: a price is a chart key (`{swingLow}`, `{priorHigh}`) or a line (the 50-day average), never a typed number; its `edit_triggers` takes no other. A number that isn't a price (a %, days) stays a number.
- **Leave one off, with a reason:** its closing line names any holding trigger it didn't put on, and why.
- **On an add:** the stock already has its holding's triggers; it changes only what the add changes.
- **No trade now:** a buy or add it writes that is already true at today's price is refused, since it would fire at the next check. It writes the condition it means (an add on a break above uses "above").
- **The floor:** it leaves it as it is. Only you lower a floor.
- **The note:** a proposal you approved already carries the analyst's note, so it writes none. An Auto buy or add sent at once has none yet: it writes it, and that note is the trade's reason.

## What happens next

The holding is guarded by its triggers from here: the trigger check reads them every five minutes, and the [morning runs](morning-runs.md) keep them current. If the run fails, the floor still stands, the run is tried again, and the stock's row says plainly when a holding has no trigger besides its floor, so the next run sees it.

## Tools

`get_stock_data`, `get_earnings_data`, `get_sec_filings`, `get_catalyst_calendar`, `web_search`, `get_theses`, `edit_triggers`, and `write_note` only when the trade has no note. No trade tools.

<details>
<summary>Technical details</summary>

#### Wake
`lib/proposals/after-buy.ts` sends `app/buy.filled` once a buy or an add fills: `place_trade` and `add` on an immediate fill, `reconcile-orders.ts` on a later one. `lib/inngest/functions/after-buy-run.ts` runs the agent unless a run on the order finished or wrote on the stock (`runAfterBuy`, `afterBuyDoneBy`). A run that ends failed fails the function; its `onFailure` is `retryThenTell` (`lib/inngest/retry-then-tell.ts`) with `buyLeft` and `tellBuy`, which emails through `lib/emails/run-lost.ts`.

#### Run
Through the agent runner (`runAgentAsRun`, `lib/agent/engine/run.ts`), as a run of mode `AFTER_BUY`, on the trigger run's model and steps (`tactical` in `lib/agent/modes.ts`). Its page is read-only. The note it writes goes on the order (`putNotesOnRunProposals` with the order's id, `lib/proposals/auto-writeup.ts`).

#### Prompt
Its record, `AFTER_BUY` (`lib/agent/engine/agents/after-buy.ts`), whose run is about the thesis. Its instructions are one document, `after-buy.md`, which imports the rules (`@rules.md`); the analyst is sent before it. Its context: the stock's row, its data block (`pullThesisData`), its holding triggers (`holding_triggers`, `lib/agent/context/playbooks.ts`) and the market numbers. Its message is `afterBuyMessage` (`lib/proposals/after-buy.ts`) and the ask.

#### The note, once
An Auto buy or add sent at once is written up here, not by the post-trade write-up: `tactical-run.ts` marks that trigger run `writtenUpAfterFill`. An Auto proposal keeps its write-up, which writes the note you read before approving.

#### The row
A holding with no trigger of its own besides the floor says so on its row (`beyondTheFloor`, `get-theses.ts`; the line in `row-for-model.ts`).
</details>
