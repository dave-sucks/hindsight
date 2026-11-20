# Situations library

**Every situation, and exactly what the agent is sent.** The 11 codes in rank order, each with what it means and the text an agent reads.

This file is built from `SITUATIONS` in `lib/agent/situations.ts` and the skill files in `lib/agent/engine/skills/`; don't edit it by hand. What situations are and where they come from is [Situations](../concepts/situations.md).

## How a situation reaches an agent

- **On the row.** Every stock in a read lists its situations by code and name, the most urgent first. Every reader gets that: the chat, the Portfolio Manager, a read of one stock by ticker.
- **The text goes to the run that answers.** The morning run's own list carries one `guidance` entry per code on the day's list, however many stocks share it. A trigger run gets its stock's texts with the fire. No other read carries a text; the chat reads one from the knowledge library when it is asked to act.
- **A skill has a part for a stock we hold and a part for a stock we watch.** A run is sent the part that fits its stock, whole and as written; a list with both kinds gets both. No code writes or changes a word of a skill.
- **A just-sold stock** is never a trigger run's, so that skill goes only to the morning run.
- **The row's fields.** Every stock in a situation sends the row's standing fields (the stock, its situations, the price, the position, a proposal waiting, every trigger with its id, the belief, the newest Activity lines, when the research was written, the chart numbers). A situation adds the fields its decision reads, listed under each one below; the review reads the whole case; the history comes only when the stock is asked for by name (`ROW_FIELDS` in `lib/agent/row-for-model.ts`).

## Promoted to live

`PROMOTED_AWAITING` · rank 1 of 11 · its text is in the table · the row adds `paper_record` · sent to the run that answers

A stock just moved from paper to live money and needs a decision this run.

```text
When: this stock was promoted to live money and its paper position was closed at promotion. It needs a decision this run. The row's `paper_record` line carries the paper record: days held, realized P&L, reviews.

Answer, in order:
1. What has happened with the company and the stock since the paper buy: its news, its sector, the market (get_stock_data, web_search)?
2. Does the case still hold at today's price, against the thesis and its triggers?

What you can do (one of these):
- Re-enter live: place_trade.
- Defer: watch_again. The next run looks at it again.

Answered: place_trade, or that watch_again.

The note: what the company and the stock have done since the paper buy, and whether the case holds at today's price; then, in one sentence, bought with live money or why it waits.

Mistakes:
- A note in place of the decision: the stock stays promoted and is asked again on the next run.
```

## Sale signal

`PROTECTIVE_SALE` · rank 2 of 11 · `sale-fired.md` · the row adds `floor_risk`, `heldThroughFloor`, `would_prove_it_wrong` · sent to the run that answers

A sell or trim trigger fired on a holding, or a sale you declined or let expire is still past its line.

```text
A sale or trim trigger fired. A trigger written in advance to sell or trim this holding fired or is true now, or the owner declined that sale and the price is still past it.

1. Why is the stock down? Look at its own news, its sector and the market.
2. Does that touch why we own it? Go down what would prove it wrong. Name any line that has happened.
3. Is the price still past the trigger's price? A give-back is counted from the high since we bought, not from a high read off a chart.
4. Did the owner decline this sale, or let it lapse? Read their words.

A stock we hold. The trigger was written while calm, so the sale goes ahead unless something new about the business says to hold: propose the sale, or the trim. To hold, name what you found about the business; a different reading of the price is not a reason. After a decline, propose it again only with today's reasons, quote the owner's words, and offer the recent low as the new sale price. You can raise the sale price to tighten it. Two sales that fired together get one decision.

Done: one note that says why the stock fell and whether that changes why we own it, with the sale, the trim, or why you hold.
```

## Buy price reached

`BUY_ARRIVES` · rank 3 of 11 · `buy-fired.md` · the row adds `buyBlockedByFull`, `street`, `setup`, `playbook_checks`, `catalyst`, `variant_view` · sent to the run that answers

A buy trigger fired on a watched stock.

```text
A buy trigger fired. A trigger written in advance to buy this stock fired or is true now. The case was decided when the research was fresh. This look checks that nothing new stops it.

1. What is the story today? Look at the company's news, its sector and the market. A buy into bad news is not the buy the playbook meant.
2. Does the price still hold? If it touched the buy price and slipped back, say so.
3. Did the playbook's buy confirm? Go down the playbook's checks for this buy. Leave volume out before mid-session and outside market hours.
4. Did the owner decline this buy? If nothing they named has changed since, pass.
5. Does the case still hold? At low conviction, buy only when a second sign confirms it.

A stock we watch. Every check holds: propose the buy with its floor, the playbook's or one you name under structure on the chart with its reason. A check failed: move the buy price to where the chart now puts it, or take the buy off and keep a review that brings the stock back. A buy moved just above today's price to avoid the question comes straight back.

Done: one note that says what is going on with the company and why now is the time to buy or not, with the buy, the new buy price, or the buy taken off.
```

## Add

`ADD_OR_WINNER` · rank 4 of 11 · `add-fired.md` · the row adds `floor_risk`, `street`, `catalyst` · sent to the run that answers

An add trigger fired on a holding.

```text
An add trigger fired. A trigger written in advance to buy more of this holding fired or is true now. It is a decision, not a hold by default.

1. Why did the stock move? Look at its news, its sector and the market. A rise counts when it confirms the case: the event playing out, estimates rising, a healthy chart. A drop counts only when the whole market or sector fell and the case is intact.
2. Does today's price still confirm it, with no headline against it?
3. Is what is left still worth the risk? Wall Street's average target is one reading of what is left.
4. Did the owner decline this add? If nothing they named has changed since, pass.

A stock we hold. The move confirms the case: propose the add, then raise the floor under the bigger position. It doesn't: raise the floor to lock in a real share of the gain, under structure on the chart. A floor at the buy price only guards against a loss. The move looks spent: propose a trim. Adding into weakness that is the company's own is averaging into a loser.

Done: one note that says why the stock moved and whether that confirms why we own it, with the add, the floor raised and what it now locks in, or the trim.
```

## A report

`REPORT` · rank 5 of 11 · `report.md` · the row adds `assumptions`, `would_prove_it_wrong` · sent to the run that answers

A trigger on the company's earnings report fired: the report is coming, or it just landed.

```text
A report. A trigger on this company's earnings report fired: it is coming, or it just landed.

Before the report:
1. What is expected, and how has the stock moved into it?
2. Which number or assumption must the report clear? Your note sets that bar.

After the report:
1. What did they report against expectations? Judge a surprise on an estimate under $0.05 a share in dollars.
2. What did management say comes next? Read the call before trusting a number.
3. How did the stock take it?
4. Which assumption does it touch, and did it clear the bar?

A stock we hold. Before: size it for a 10% move either way from the last close. Trim, hold through, or raise the floor, and add nothing into the report. After: a broken assumption is a sale: propose it. A miss with the case intact stays, floored under structure: say what would change your mind. A beat on both lines, guidance raised: raise the floor, and add if the playbook allows it. A profit beat with revenue short came from costs: raise nothing on it. A beat the stock fell on: raise the floor.

A stock we watch. Before: the buy waits for the report. After: the case is stronger and the playbook's buy is true today: propose the buy. An assumption broke: stop watching, or send it to the Writer. Otherwise move the buy price to where the chart now puts it, or leave it.

A beat alone is no reason to buy, nor a miss alone to sell. Done: one note. Before, it names the bar. After: the report against the bar, how the stock took it, the verdict.
```

## A filing

`FILING` · rank 6 of 11 · `filing.md` · the row adds `assumptions`, `would_prove_it_wrong` · sent to the run that answers

A trigger on the company's SEC filings fired.

```text
A filing. The company filed with the SEC, and a trigger on its filings fired. The fire names the filing and its link.

1. What does the document say? Read it. Its item number names the kind of filing. Only the document says which way it cuts.
2. Which line of the case does it touch? Go down the assumptions and what would prove it wrong. Name the line, or say it touches none.
3. What follows?

A stock we hold. A restatement means the numbers may be false: propose the sale unless it is clearly small and beside the case, and say which. Bankruptcy or a delisting notice: propose the sale. A late report: find the stated reason, raise the floor, and add nothing until it is filed. A finance chief leaving suddenly: raise the floor. A planned succession changes nothing. An agreed takeover caps the stock at the deal price: weigh selling. New shares sold: add nothing, and check what the money is for.

A stock we watch. A restatement: take the buy off. Bankruptcy: stop watching. A late report or new shares sold: buy nothing into it.

It touches no line: do nothing, and say why in a sentence. Done: one note that says in plain words what the company filed, names the line it touches and gives the verdict, with whatever you did.
```

## News

`NEWS` · rank 7 of 11 · `news.md` · the row adds `assumptions`, `would_prove_it_wrong` · sent to the run that answers

Something happened to the company, or the stock had a day far outside its normal. Nothing puts a stock here yet.

```text
News on a stock. Something happened to this company, or the stock had a day far outside its normal. What woke you is in the stock's Activity.

1. What happened, and when? Read the source and check it against the stock's own price and volume since. If it repeats something already in Activity, or you can't confirm it, say so and stop. On an unusual day with no news named, find out why it moved; if you can't, say that.
2. Which line of the case does it touch? Go down the assumptions and what would prove it wrong. Name the one line, or say it touches none. A stock that only moved with its group touches none.
3. What follows?

A stock we hold. It proved the case wrong: propose the sale. It weakened it: raise the floor or trim, and say what would make it a sale. It strengthened it: add if the playbook allows one here, or do nothing. Never lower a floor.

A stock we watch. It ended what the playbook was waiting for: send it to the Writer, or stop watching. The case is stronger and the playbook's buy is true today: propose the buy. Otherwise move the buy price to where the chart now puts it, or leave it.

It touches no line: do nothing, and say why in a sentence. Done: one note that says what happened, names the line it touches and gives the verdict, with whatever you did.
```

## Floor to fix

`PROTECTION` · rank 8 of 11 · `floor-to-fix.md` · the row adds `floor_risk` · sent to the run that answers

A gain with too little floor under it, or a floor that would lose too much of the account.

```text
The floor needs fixing. This holding's floor locks in far less than its gain, or it would lose more than 1.5% of the account from the buy price. A normal buy risks 1% of the account.

1. What has carried the stock here, and is it still going? Look at its news, its results and its sector.
2. What does the floor lock in, and what would it lose? Read both numbers.
3. Where is real structure on the chart? The 20-day low, a swing low, the breakout price, an average.

A stock we hold. Raise the floor to just under that structure. A compounder gets more room than a short trade. Or propose a trim so the loss at the floor fits, or the sale when the structure is breaking or little is left to gain. Or leave the floor and say in one sentence why the risk is worth it, such as an event this week that a tight floor would shake out. A round number is not structure, and neither is the buy price by reflex. That the business is intact says whether to own the stock, not how much it can lose.

Done: one note that says how the stock got here and what is driving it now, with the new floor and what it locks in, the trim, or why the floor stays.
```

## Review due

`REVIEW_DUE` · rank 9 of 11 · `review.md` · the row adds `floor_risk`, `buyBlockedByFull`, `heldThroughFloor`, `supersededBy`, `street`, `setup`, `playbook_checks`, `assumptions`, `would_prove_it_wrong`, `catalyst`, `paper_record`, `company`, `bull_case`, `bear_case`, `conviction_rationale`, `variant_view`, `snapshot` · sent to the run that answers

The review clock came round, or the price reached a level the analyst asked to look at again.

```text
A review. Nothing may have happened. The review clock came due, or the price reached a level you asked to look at again.

1. What has happened to the company and the stock since your last note? If nothing, say so.
2. Is the case still true? Go down what would prove it wrong, then the assumptions. Name any line that has happened or failed.
3. Is the playbook still working? Check its failure signs and its time limit.
4. Do the triggers still fit the price? Look for a buy price the stock has left behind, a floor far under the gain, a trigger that fired and was never replaced.

A stock we hold. A line proved the case wrong: propose the sale. Otherwise fix the triggers that no longer fit, or leave them.

A stock we watch. The case is stronger and the playbook's buy is true today: propose the buy. The case no longer holds: stop watching. The research is too old to judge: send it to the Writer. Otherwise fix its triggers or leave them.

Change how often you look only with a reason: slower for a quiet stock, sooner before an event. Done: one note with what changed since the last one and the verdict. If you gave the same answer last time, change a trigger or say what is different now.
```

## A note to answer

`NOTE_TO_ANSWER` · rank 10 of 11 · its text is in the table · the standing fields only · sent to the run that answers

You left a note or made a decision since the analyst's last answer, or a note is pinned on the stock (the Market Reviewer's or yours).

```text
When: the principal made a decision on this stock that no run has answered, or left a note since your last answer; or a note is pinned on this stock and no run has written on it since, which has its paragraph at the end. Their words are in `said`, with the price then and now.

Answer, in order:
1. Which is it: an instruction, a question, a decline, a resized approval, a note?
2. What has happened with the company and the stock since they said it (get_stock_data, web_search)?

What you can do:
- An instruction ("add on a close above $74"): carry it out with the tools, usually as a trigger via edit_triggers.
- A question: do the work it asks for and answer in your note. Answering the question is the action.
- A decline with no reason: do not propose the same buy or add again unless its circumstances have changed. "Not this week" lapses after the week; "never this name" does not.
- An approval with a different size, or a price they set: honor their numbers, never revert them. A cut size is caution, a raised one is conviction.

Answered: your one write_note on the stock, quoting them and saying what you decided on each.

The note: their words, quoted, then your answer: what you found about the company and the stock, and what you did about each thing they asked.

Mistakes:
- Taking an expired proposal for a decision: it may be proposed again if the playbook holds.

If a note is pinned: an Agent note (the 7:30 Market Reviewer's) or the principal's, on this stock alone or with others. It is in `said` under PINNED, above the Activity lines, with the stocks it covers and their share of the account, and it names news that could change a decision here: a market date, a story moving a group, the company's own news, how much of the account rides on it. What does it say is coming, and when? Does it reach why we own or watch this stock? Check its claim and the stock's own news against the data (the Market numbers too). Do its triggers still fit what is coming: the floor and the size on a holding, the buy and the research on a watch? Then one of these. Act on it: on a holding, an add on good news (add sizes it), a trim or a sale proposal, or a floor moved up with edit_triggers; on a watch, a buy at today's price on good news (the buy trigger moved to at or near the current price, edit_triggers by its id), a buy price moved, the research refreshed through the writer (dispatch_thesis_research), or let it go. Or keep its triggers, saying in one sentence why the note doesn't change them for this stock. It is a read on the market, not an order: the stock's own case still decides, and a floor is never moved down or loosened because of it (only the principal lowers a floor). Your write_note names the pinned note and says what it means here; the stock leaves this situation once you have written, and the note stays pinned for the others it covers. The note: what the pinned note says is coming, what it means for this stock and why, then what you did, in one sentence.
```

## Just sold

`SOLD_ONE_REVIEW` · rank 11 of 11 · `just-sold.md` · the standing fields only · not sent to a trigger run

A stock sold in the last two weeks is owed one look back.

```text
Just sold. This analyst sold the stock in the last two weeks and no run has looked back yet. This is the one look a sold stock gets. The sale's price, date and reason come with the stock.

1. What have the company and the stock done since we sold?
2. Did the reason we owned it survive the sale? Is an event still ahead?
3. Is it worth watching again?

What can follow: watch it again with a buy priced off today's chart; watch it again on a review clock; watch it again with nothing set, which costs nothing; or let it go. A sold stock nobody looks at again is research already paid for and thrown away.

Done: one note that says what the stock has done since the sale and whether the reason we owned it survived, with whether you watch it again and for what, or let it go.
```
