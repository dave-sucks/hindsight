# Trigger runs

**When a stock moves, an analyst looks.** A trigger comes true, and within minutes its analyst reads that one stock and decides.

It checks the fire against what's true now, then proposes the trade, redraws the line, or holds and says why. When the trigger was set to Auto, the trade is already made, and a different agent, the post-trade write-up, writes the note on it.

```facts
Model: gpt-5.4
Starts: Minutes after a fire
Steps: Up to 15
Tools: 14
Saves: 7 fields: triggers, verdict, note
```

```chat
caption: A sale trigger fires on SHOP during the day.
tools: Trigger fired on $SHOP
- SHOP: Sell if below $96 · $95.12 at 10:40 AM
tools: Pulling $SHOP's snapshot (+1 more)
- SHOP: $95.12 · 0.9% under the floor · volume 1.6× normal
- No company news since the report; software is down 2.4% on the day
text: Selling $SHOP (−3.4%) at $95.12. The floor sat under the gap-day low and broke on heavy volume with nothing new on the business. The drift has failed.
tools: Closing $SHOP position
- SHOP [sell] {Proposal}: Sell 120 shares at about $95.12 · waiting for your approval
```

## What it does

A trigger run is an analyst's short look at one stock, started when one of its [thesis](../concepts/theses.md)'s [triggers](../concepts/triggers.md) comes true. Its triggers said "buy here" and "sell there"; this is where they meet the live price. One stock, one decision, fifteen steps at most. Deep research goes to [the Writer](writer.md) instead.

Why a run and not an automatic order? A level is a call made days ago. The run checks it against today (the news, the volume, the market) before anything reaches you, and says what it saw either way.

## When it runs

Every five minutes while the market is open, plus a pass at 4:20 PM for levels read on the close, every trigger on every stock is checked. When a trigger set to **Send to Agent** comes true (every trigger but a review, unless you chose otherwise), the fire is written into Activity and a trigger run starts on that stock.

- **A trigger fires when it becomes true, like an order.** A buy, a review, a sale, an add or a trim fires on the first check its condition holds, and again only after a 4:20 PM close finds it false. A trade it leads to uses it up: when the order fills, it comes off the stock. Two buys on one stock true on the same check start one run.
- **Reviews are flagged for the morning, unless sent to the agent.** A review is a question, not an order, so by default (**Flag for Review**) it goes on the stock's list for the next [morning run](morning-runs.md). Set to **Send to Agent**, it starts a trigger run the same day, which answers it with the review's guidance (each one is a run, about 6–18 cents). A worrying new filing on a stock we hold always gets a look the same day.
- **A trim names its size.** The run is told "Trim 30% if above $150", and a partial sale it makes without naming a size sells that 30%.
- **An Auto trade is made first, then written up.** An Auto-sell, Auto-trim, Auto-buy or Auto-add happens with no agent deciding: the trigger run makes the trade the agent would have made, with the same tool, sizing and checks, and it goes through the same [approval](../concepts/approvals.md) as any trade. Then the same run reads the stock and writes the note, with no trade tools: what's going on with the company and why, what it means for why we own it, the trade, and whether the analyst agrees. That note is the trade's reason on the card and in the email. A refused trade is written up the same way. Like any trigger, it comes off the stock when its order fills.

## What it reads

<!-- asset: context trigger_run -->

Its first message opens with the date line. Of the Market and portfolio reads it gets the [market numbers](market-reviewer.md#the-market-numbers) alone, written by code when the request is built (the S&P 500 and Nasdaq 100, the regime, the 11 sectors, VIXY, our stocks reporting in the next 14 days), printed before the stock's row. It gets no portfolio snapshot and no digest: its decision is on one stock, whose position is on its row, the analyst's open slots are in the analyst's text, and code sizes a buy. The rest of the account is the [Portfolio Manager](portfolio-manager.md)'s. The write-up of an Auto trade gets the same, as every run about a stock does.

The stock's row, the same one `get_theses` gives every agent: the position, every trigger with its id, the belief and what would prove it wrong, the bull and bear cases, why the conviction and where we differ from the Street, and the stock's newest 8 Activity lines exactly as the Activity tab reads them (it marks where the 8 end; the Overview's Agent insights is a different cut, the newest 5 with a note). A trigger's note is on it only when you or an analyst wrote one; a note the app wrote (a template's, or a default that only restates the trigger) isn't shown. Its message is the fire, from the trigger check, said once: the trigger's sentence, the price it fired at and its id, what else the check knows (a report's numbers, what fired with it, a refused call), then the ask. The trigger's note is on the row beside its id. The instructions for each [situation](../concepts/situations.md) the stock is in end its instructions. Then `get_stock_data` gives the live price and the news, and one web search gives the stock's latest news, so the note can say why it moved.

Right after a trigger set to Auto makes or tries a trade, the run that writes it up is its own agent, with no trade tools. It is sent this:

<!-- asset: context post_trade_writeup -->

A give-back is measured from the highest price since the buy, over the whole holding. The run can't call a fire false by reading a lower high off a short chart; declining a sale takes new evidence about the business.

## What it decides

- **Act:** propose the sale or the trim with `sell`, the add with `add`, or the buy with `place_trade`, which names the sale: the playbook's "Sell if below" as `sell_if_below` with `sell_reason`, the price from the chart. The proposal shows it, and you can change it in Edit & Approve. The playbook's other triggers that come with the buy (its Trim, a review) are written by code when the buy fills, each number from the chart then and the buy. On the live account, the [proposal](../concepts/approvals.md) reaches your queue, your email and your phone at once.
- **Tighten the sale:** move the trigger to a price the chart supports (`edit_triggers`). It can raise a floor; it can never lower one, widen a trail or delete a protective trigger on a stock we hold. If it thinks the price is wrong, it says so and names the price, and lowering it is yours to do on the thesis.
- **Write a playbook's watch triggers:** a review on a stock we only watch can be a playbook's way in (an episodic pivot's gap, a screen). Every trigger run is shown the stock's own playbook in full, with its watch triggers (a stock with no playbook yet, each of its analyst's), and adds the one that fits with `edit_triggers`, each trigger by its reference (W1, W2…): code prices each from the chart that day and marks it the playbook's.
- **Write up an Auto trade:** with no trade tools, what is going on with the company and why, what it means for why we own it, the trade, and whether it agrees. If it would have done otherwise, it says so; you decide on the card. Its note is the trade's reason.
- **Hold, with a reason:** what is going on with the stock and why it isn't acting. A sale it doesn't make stays on the morning run's list every day until a close goes back past the line, and so does one you declined or let lapse; the trigger fires again, with a new run, only after a close back on the other side. While a sale is waiting for your approval, that sale is yours to answer: no run proposes it again or argues it, and a run woken by something else on the stock answers that with a note or an edit.

Whatever it decides, it brings the stock's other triggers up to date: after an add the floor goes up, and a trigger whose price the stock blew through is reset off the new chart, not a round number.

## What happens next

The run ends with at most one trade, exactly one `write_note` that says what it did and why, linked to the trigger that fired, and `complete_run`. It has no status tool: dropping a watch is the morning run's call. A sale or a trim is proposed first and the note written after it. That note is the proposal's reason: the card, the email and Activity show it as the one paragraph on the trade. If you declined this same trade before, the note answers you.

- **A buy goes through:** the stock becomes a holding. Its buy and its Stop watching line come off, "Sell if below" goes on at the price approved on the proposal, and its sell side takes over.
- **A sale goes through:** the thesis is retired as sold (or goes back to Watching after a profit-take), and a later [morning run](morning-runs.md) gives it one look back.

## Tools

Everything a trigger run can call, read from `lib/agent/modes.ts`.

<!-- asset: tools trigger -->

<details>
<summary>Technical details</summary>

#### Wake
`lib/inngest/functions/trigger-evaluator.ts` sends `app/thesis.trigger.fired`; `tactical-run.ts` starts the run. A fire set to the next morning run (a review, unless set otherwise) writes its fire and waits, unless a same-day filing calls for a look (`filingNeedsSameDayLook`).

#### Mode
`tactical` in `lib/agent/modes.ts`: `gpt-5.4`, up to 15 steps.

#### Prompt
Its record, `TRIGGER_RUN` (`lib/agent/engine/agents/trigger-run.ts`), whose run is about the thesis. Its instructions are one document, `trigger-run.md`, the same on every run, which imports the rules (`@rules.md`: the house rules and how it writes). Its context is read for the thesis by one loader per fact (`lib/agent/context/`): the analyst it works for, the stock's playbook and the stock's situations are sent with the instructions, where they were measured (the analyst first, the situations last); the market numbers and the stock's row from `row-for-model.ts` are in its first message after the date line. Its message is the fire from the trigger check (`fireMessage`, `lib/agent/system-prompts/intraday-tactical.ts`): the trigger's sentence, the price it fired at and its id, the fire's facts, then the ask. `tactical-run.ts` hands the engine the thesis and the run's tools; the agent engine (`buildAgentRequest`, `lib/agent/engine/build.ts`) reads the facts and builds the request, naming each part for the run's Context panel.

#### Fire rules
`shouldFire` in `lib/agent/triggers/evaluate.ts`: a trigger fires when its condition holds and it has not fired since a close last found it false (`firedSinceFalseClose`). Two buys, or a sale and a trim, on one stock in one pass fold into one run (`lib/agent/triggers/co-fire.ts`).

#### Floors
`lib/agent/triggers/ratchet.ts` refuses any agent edit that lowers, widens, deletes or slows a protective sale. Your edits on the thesis sheet don't go through it.

#### Auto
`fireMode: DO_IT` skips the agent's decision: a sale goes to `closeOpenPosition`; a trim, a buy or an add calls `sell`, `add` or `place_trade` with the trigger's own arguments (`doItCall`), a buy or an add paid from cash (`ToolContext.payFromCash`). The order carries `autoTradeLine` until the write-up's note replaces it (`putNoteOnOrder`, `lib/proposals/auto-writeup.ts`). The write-up is its own agent, `POST_TRADE_WRITEUP` (`lib/agent/engine/agents/post-trade-writeup.ts`): its own fixed instructions, no trade tools, the same stock and trigger blocks, and no situations (`recordFor` picks it).

#### What was sent
The run page's Context shows the request the run's newest model call started with (its own, or a retry or follow-up after it), exactly as it was sent, kept by `modelFor` (`lib/agent/model.ts`). The conversation on the page opens with its message, the fire and the ask (`openingOf`, `lib/agent/engine/engine.ts`); the instructions and the reads are in Context.
</details>
