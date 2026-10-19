# Glossary

**The words, defined once.** Every term the app, the docs and the agents use, a sentence each.

When the code, a prompt or a doc uses one of these words, it means this.

## The desk

- **Analyst:** a trading style with its own universe, sizing and sell rules. Every thesis belongs to one. See [Analysts](concepts/analysts.md).
- **Book:** every stock an analyst holds or watches.
- **Strategy:** the analyst's edge in your words, read word for word by every agent.
- **Universe:** the markets, sectors, industries, themes and market-cap band an analyst looks in. Its **exclusion list** always wins.
- **Run days:** the weekdays an analyst's morning run happens. Every weekday by default.
- **Live and paper:** the real-money account and the practice one. Approvals are on by default for live and off for paper, set separately for buys and sales.

## A thesis

- **Thesis:** one analyst's view of one stock, and its plan. Every stock on the book has one. See [Theses](concepts/theses.md).
- **Belief:** one sentence we can be wrong about, with an outcome, a timeframe and the reason.
- **Wrong if:** what would prove the belief wrong, written before the buy.
- **Setup:** the kind of trade, from the shared **playbook** (post-earnings drift, a pullback to a rising average, a run-up into a dated event…). Each has its checklist for the buy, the floor, the target and the time limit.
- **Score:** a score out of 10 for the stock against the setup.
- **Conviction:** how strongly the analyst holds the belief. It scales the size of the buy.
- **Horizon:** how long the thesis means to hold: **catalyst** (until a dated event resolves), **trade** (days to weeks, tight stop), **target** (weeks to months, to a set price) or **compounder** (months to years). It sets how fast the research goes stale.
- **Verdict:** where a stock stands after a run looks: its direction, conviction and status.
- **Plan:** a thesis's triggers. The buy, the floor and the target are triggers too.
- **Seed:** a stock put on the watchlist with no view yet, by you or the analyst builder. It's due its first research on its review clock.
- **Wake:** a review trigger on a watch with no plan, like a price or a date, that brings the stock back for a fresh look.
- **Watching:** on the watchlist, waiting for its buy.
- **Agent Watch:** a watch with its own review clock, so its analyst looks at it on a schedule. A plain watch waits for its triggers.
- **Holding:** bought. A watch turns into a holding when the broker takes the buy.
- **Passed:** researched and declined, kept so the stock isn't pitched again without a reason.
- **Retired:** sold, dropped, proven wrong, or replaced by a newer thesis. The history stays.
- **Promoted:** held in paper and just moved to live money; the next run re-enters or goes back to watching.
- **Note:** your words on a stock's thesis. Information, not an order; every run reads the newest ones first and answers them.
- **Activity:** the stock's log: one line for every change, fire, trade and note.
- **Thesis sheet:** a stock's detail panel, where you read its thesis and change its plan yourself.

## Triggers

- **Trigger:** a condition and an action, written as one sentence: "Sell if below $384". See [Triggers](concepts/triggers.md).
- **Action:** what a trigger does when it comes true: **buy**, **add**, **trim**, **sell** or **review**. A review wakes the analyst with no order behind it.
- **Floor:** the sale trigger under the price. The stop.
- **Trail:** a sale measured as a give-back from the highest price since the buy, like "12% off the high".
- **Target:** the price the plan aims for. Reaching it is a review: take it, or trail higher.
- **Buy level:** the price a watched stock's buy trigger waits for.
- **Fire:** a trigger coming true. It's written into Activity with the price that fired it.
- **On the cross:** how a buy fires: once, on the day the price reaches its level, never every day it stays there.
- **Standing order:** how a sale or a review fires: every day its condition holds, until it's answered.
- **Review clock:** a review that repeats, like "Review every 30 days". When it comes round, the stock is due a fresh look.
- **Direct sale:** a floor set to propose its sale the moment it fires, with no agent run in between.
- **Rest period:** how long a trigger stays quiet after it fires, so one condition doesn't ask fifty times a day.
- **Inherited rule:** a trigger that comes from the analyst or the account, not the thesis. Never copied onto the thesis; the closest rule wins.
- **Close pass:** the 4:20 PM check for levels that read the day's closing price.
- **Chart numbers:** the averages, highs, volume, RSI, strength and gaps worked out at 6:30 every morning, which every check that day reads.

## The agents

- **Morning run:** each analyst's review of its whole book, every run day at 8 AM. See [Morning runs](agents/morning-runs.md).
- **Trigger run:** an analyst's short look at one stock, started by a trigger that fired. See [Trigger runs](agents/trigger-runs.md).
- **Chat:** the agent you talk to, on one analyst or the whole account. See [Chat](agents/chat.md).
- **Discovery:** finding new stocks for an analyst. In practice it's done in chat, which carries Discovery's tools and rules. See [Discovery](agents/discovery.md).
- **The Writer:** the only agent that writes a whole thesis, from in-depth research. See [the Writer](agents/writer.md).
- **Door:** one way an agent is started: the morning run, the trigger run, chat, Discovery or the Writer. The Framework tab compares them.

## What an agent reads

- **The read:** an agent's view of its book from `get_theses`. Each stock is a row at the size today needs: a **line** for a quiet stock, a **short row** for a stock in a situation, the **full row** for one that needs re-planning.
- **Situation:** a reason a stock needs an answer today, worked out fresh on every read and never stored. There are sixteen. See [Situations](concepts/situations.md).
- **Guidance:** a situation's instructions, sent once per read for each situation on the day's list.
- **Analyst brief:** the analyst's name, strategy, rule numbers, free slots and setups, written once and given to every agent.
- **House rules:** the sentences every agent gets, whatever its job: your word comes first, a note is information, and how to write.

## Trades

- **Proposal:** a buy, sale, add or trim waiting for your approval, with its reason (on paper, only when approval is turned on). It expires after 24 hours. See [Approvals](concepts/approvals.md).
- **Decline:** your no on a proposal. Recorded and read by every run after it.
- **Lapse:** a proposal left to expire. It means "not now, ask me again", never a decline.
- **Fill:** the broker carrying out an order. Its price becomes the position's cost and the thesis's entry.
- **Sized by risk:** how every buy is sized: the dollars at risk divided by the distance to the floor, scaled by conviction, kept inside the analyst's band. No agent picks a size.
- **Band:** an analyst's smallest trade, largest trade, and most in one stock.
- **Slots:** how many stocks an analyst may hold at once, 5 by default. A buy for a full analyst is refused.
- **Run summary:** the list a run ends with: every stock it touched, with a one-word action.
- **Close-out:** the check at the end of a run that every exit, trim or add its summary names on a holding was actually made or proposed.
