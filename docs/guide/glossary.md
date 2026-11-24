# Glossary

**The words, defined once.** Every term the app, the docs and the agents use, a sentence each.

When the code, a prompt or a doc uses one of these words, it means this.

## The desk

- **Analyst:** a trading style with its own universe, sizing and sell rules. Every thesis belongs to one. See [Analysts](concepts/analysts.md).
- **Book:** every stock an analyst holds or watches.
- **Strategy:** the analyst's edge in your words, read word for word by every agent.
- **Universe:** the sectors and market-cap band an analyst looks in. Its **exclusion list** always wins. The industries and themes it hunts are words in its strategy.
- **Run days:** the weekdays an analyst's morning run happens. Every weekday by default.
- **Live and paper:** the real-money account and the practice one. Approvals are on by default for live and off for paper, set separately for buys and sales.

## A thesis

- **Thesis:** one analyst's view of one stock, and its triggers. Every stock on the book has one. See [Theses](concepts/theses.md).
- **Belief:** one sentence we can be wrong about, with an outcome, a timeframe and the reason.
- **Wrong if:** what would prove the belief wrong, written before the buy.
- **Playbook:** the kind of trade, one of twelve (post-earnings drift, a pullback to a rising average, a run-up into a dated event…). Each has what must be true first and how a buy is confirmed, and its triggers: its watch triggers, written when the Writer names it, and its holding triggers, put on after the buy (Settings → Playbook). The code calls it a setup (`setupId`).
- **Conviction:** how strongly the analyst holds the belief. It scales the size of the buy.
- **Horizon:** how long the thesis means to hold: **catalyst** (until a dated event resolves), **trade** (days to weeks, tight stop), **target** (weeks to months, to a set price) or **compounder** (months to years). It sets how fast the research goes stale.
- **Verdict:** how a review leaves the thesis: stronger, unchanged, weaker or broken, with one line on what moved it.
- **Plan:** not a thing. A stock has its triggers and nothing else; "the buy" and "the floor" are names for kinds of trigger.
- **Seed:** a stock put on the watchlist with no view yet, by you or the analyst builder. It has no case to review, so when its review clock or one of its triggers comes due, code sends it to the Writer.
- **Wake:** a review trigger on a watch with no buy, like a price or a date, that brings the stock back for a fresh look.
- **Watching:** on the watchlist, waiting for its buy.
- **Agent Watch:** a watch with its own review clock, so its analyst looks at it on a schedule. A plain watch waits for its triggers.
- **Holding:** bought. A watch turns into a holding when the broker takes the buy.
- **After the buy:** the run on a stock right after a buy or an add fills. It puts on the playbook's holding triggers, each fitted to the thesis with its reason, and writes the trade's note when nobody has. It can't trade.
- **Passed:** researched and declined, kept so the stock isn't pitched again without a reason.
- **Retired:** sold, dropped, proven wrong, or replaced by a newer thesis. The history stays.
- **Promoted:** held in paper and just moved to live money; the next run re-enters or goes back to watching.
- **Note:** your words on a stock's thesis. Information, not an order; every run reads the newest ones first and answers them.
- **Activity:** the stock's log: one line for every change, fire, trade and note.
- **Thesis sheet:** a stock's detail panel, where you read its thesis and change its triggers yourself.

## Triggers

- **Trigger:** a condition and an action, written as one sentence: "Sell if below $384". See [Triggers](concepts/triggers.md).
- **Action:** what a trigger does when it comes true: **buy**, **add**, **trim**, **sell** or **review**. A review wakes the analyst with no order behind it.
- **Floor:** the sale trigger under the price. The stop. It comes with the buy.
- **Trail:** a sale measured as a give-back from the highest price since the buy, like "6% off the high".
- **Target:** only ever Wall Street's number, the analysts' 12-month price target. Hindsight sets none of its own; an upside rule is a take-profit trigger. See [Price targets](concepts/price-targets.md).
- **Buy level:** the price a watched stock's buy trigger waits for.
- **Fire:** a trigger coming true. It's written into Activity with the price that fired it.
- **Fires like an order:** every trigger fires when it becomes true, then again only after a market close finds it false. A trade it leads to uses it up: it comes off the stock when the order fills.
- **Review clock:** a review that repeats, like "Review every 30 days". When it comes round, the stock is due a fresh look.
- **On fire:** what a trigger does when it comes true: Auto (the trade, no agent: Auto-sell, Auto-trim, Auto-buy, Auto-add), Send to Agent (a trigger run), or Flag for Review (the next morning run; never a sale or a trim).
- **Fired:** a trigger that came true and hasn't been found false at a close since. Its card says so: "Fired Nov 18 · fires again after a close back above $150". There are no waits.
- **Inherited rule:** a trigger that comes from the analyst or the account, not the thesis. Never copied onto the thesis; the closest rule wins.
- **Close pass:** the 4:20 PM check for levels that read the day's closing price.
- **Chart numbers:** the averages, highs, volume, RSI, strength and gaps worked out at 6:30 every morning, which every check that day reads.

## The agents

- **Morning run:** each analyst's review of its whole book, every run day at 10 AM. See [Morning runs](agents/morning-runs.md).
- **Trigger run:** an analyst's short look at one stock, started by a trigger that fired. See [Trigger runs](agents/trigger-runs.md).
- **Chat:** the agent you talk to, on one analyst or the whole account. See [Chat](agents/chat.md).
- **Discovery:** finding new stocks for an analyst. It's done in chat, which carries the tools and rules for it; a scheduled Discovery agent per analyst exists and is off. See [Discovery](agents/discovery.md).
- **The Writer:** the only agent that writes a whole thesis, from in-depth research. See [the Writer](agents/writer.md).
- **After the buy:** the run on a stock right after a buy or an add fills. See [After the buy](agents/after-the-buy.md).
- **Post-trade write-up:** the agent that writes the note on a trade an Auto trigger made, with no trade tools. See [Trigger runs](agents/trigger-runs.md).
- **Portfolio Manager:** the agent that looks at the whole account twice a week and may propose up to three trades. See [Portfolio Manager](agents/portfolio-manager.md).
- **Market Reviewer:** the 9:00 AM agent that researches the market and writes the market digest and notes on stocks. See [Market Reviewer](agents/market-reviewer.md).
- **Agent:** its instructions, its context, its tools, its message and the moment it runs. See [How an agent is built](concepts/agents.md).
- **Record:** one agent's definition in code: its model, steps, the facts it reads and the tools it may call (`lib/agent/engine/agents/`).
- **Door:** the tools and fields one agent is offered on a thesis. No agent is offered a field its job doesn't need.
- **Yardstick:** real decisions replayed against the real model and scored by code, before a change to an agent merges. See [How an agent is built](concepts/agents.md#how-a-change-is-checked).

## What an agent reads

- **The read:** an agent's view of its book from `get_theses`. Every stock is a **line** of the stock table, the same columns for each (its situation, price, the day's move and volume, the 5-day and 1-month moves and so on), and the Portfolio Manager gets the same table for the whole account. A stock in a situation, and any stock an agent opens by its ticker, is also a **row**: the same fields whatever the situation and whoever reads (the [Situations library](reference/situations-library.md) lists them). The bull and bear cases, the research summary and the raw history come only when the read asks for them.
- **Situation:** why a stock is in front of its analyst today, worked out fresh on every read and never stored. One of your triggers raises it (a possible sell, buy or add, a review, an earnings report, a filing, news), or one of three checks in the code does (a floor to fix, a stock just sold, promoted to live). Each has one short skill. See [Situations](concepts/situations.md).
- **Guidance:** a situation's instructions, sent once per read for each situation on the day's list.
- **Analyst brief:** the analyst's name, strategy, rule numbers, free slots and playbooks, written once and given to every agent.
- **House rules:** the sentences every agent gets, whatever its job: your word comes first, a note is information, and how to write.

## Trades

- **Proposal:** a buy, sale, add or trim waiting for your approval, with its reason (on paper, only when approval is turned on). It expires after 24 hours, except one a trigger made, which waits while its trigger holds. See [Approvals](concepts/approvals.md).
- **Decline:** your no on a proposal. Recorded and read by every run after it.
- **Lapse:** a proposal left to expire. It means "not now, ask me again", never a decline.
- **Withdrawn:** a proposal a trigger made that came down on its own, because the stock closed back past the trigger's line or the trigger came off the stock.
- **Fill:** the broker carrying out an order. Its price becomes the position's cost and the thesis's entry.
- **Sized by risk:** how every buy is sized: the dollars at risk divided by the distance to the floor, scaled by conviction, kept inside the analyst's band. No agent picks a size.
- **Band:** an analyst's smallest trade, largest trade, and most in one stock.
- **Slots:** how many stocks an analyst may hold at once, 5 by default. A buy for a full analyst is refused.
- **Run summary:** the list a run ends with: every stock it touched, with a one-word action.
- **Close-out:** the check at the end of a run that every exit, trim or add its summary names on a holding was actually made or proposed.
