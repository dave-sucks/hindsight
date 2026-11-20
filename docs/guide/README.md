# How Hindsight works

**A research desk that never stops watching.** Analysts find the stocks, write the case and guard every position. On the live account, nothing trades without you.

This folder is the guide, and this page is where to start. The /docs pages in the app draw these same files, so what you read here is what the page says.

## How to use this guide

1. **Read this page** for the shape of the whole system.
2. **Open the concept or agent doc** your task touches. Each one says what it is, how it fits the cycle, and links the others it depends on.
3. **Go to a deep dive or the reference** when you need the whole mechanism (how a save lands, how a trade is sized) or an exact list (the text for each situation, every trigger measure, every playbook).
4. **Follow Technical details** at the end of each doc to the code. The code is the source of truth.

The folders match the sidebar:

- `agents/`: one doc per agent: Discovery, the Writer, the morning and trigger runs, After the buy, chat, the Market Reviewer, the Portfolio Digest, the Portfolio Manager and the analyst builder.
- `concepts/`: how an agent is built, theses, triggers, analysts, situations, approvals and price targets.
- `deep-dives/`: one mechanism or workflow end to end, like [saving a thesis](deep-dives/saving-a-thesis.md).
- `reference/`: exact lists built from the code, like the [Situations library](reference/situations-library.md).
- `architecture.md` and `glossary.md` sit here, next to this page.

## The loop, on one stock

1. **[Discovery](agents/discovery.md)** finds a stock that fits an [analyst](concepts/analysts.md): CRWD beat, raised its year and held the gap. Or you ask for research in [chat](agents/chat.md), or add the stock to the watchlist yourself.
2. **[The Writer](agents/writer.md)** researches it and writes its [thesis](concepts/theses.md): the belief, what would prove it wrong, and its [triggers](concepts/triggers.md): its playbook's watch triggers, a buy and the line that ends the watch. The stock goes on the watchlist as Watching.
3. **The trigger check** watches its triggers every five minutes. When the buy fires, a **[trigger run](agents/trigger-runs.md)** looks at that one stock and proposes the buy.
4. **You approve** the **[proposal](concepts/approvals.md)** (on paper, approval is off by default and the buy goes straight through). The buy goes to the broker, the thesis turns to Holding, its floor guards it, and one run puts on its holding triggers ([After the buy](agents/after-the-buy.md)).
5. **[Morning runs](agents/morning-runs.md)** read the analyst's whole book every run day and answer each stock in a **[situation](concepts/situations.md)**: a review that came due, a floor to raise, earnings, your notes.
6. **A sale fires**, or a run decides to sell: another proposal. Declined or left to expire, it asks the analyst again each day the price stays past the line: the analyst proposes the sale again or says why it holds. Only you can lower the floor.
7. **The sale goes through** and the thesis is retired as sold, or goes back to Watching after a profit-take. A retired stock gets one look back within two weeks: watch it again, or let it go.

[Chat](agents/chat.md) is where you ask about any of it, change a stock's triggers, or start research yourself, at any step.

## The whole system

- **[Architecture](architecture.md):** how the pieces fit: the data, the record, the clocks, the read, the agents, the save and the gate, and the one place each thing is defined.
- **[Glossary](glossary.md):** every term the app, the docs and the agents use, a sentence each.

## The agents

The agents that work on a stock have the same five sections, in the same order: **What it does** (the job, and why it works that way), **When it runs**, **What it reads**, **What it decides** and **What happens next** (where the stock goes from there). Read them in that order and you can follow a stock from one agent to the next. The Market Reviewer, the Portfolio Digest and the Portfolio Manager work on the account, and their docs are shaped to it. [How an agent is built](concepts/agents.md) says what every agent is made of.

- **[Discovery](agents/discovery.md):** screens earnings, movers and the web for stocks that fit an analyst, and sends the best to the Writer.
- **[The Writer](agents/writer.md):** researches one stock in depth and writes its thesis and its first triggers.
- **[Morning runs](agents/morning-runs.md):** every weekday morning, each analyst reviews its whole book.
- **[Trigger runs](agents/trigger-runs.md):** a trigger fires and the analyst looks at that one stock within minutes.
- **[After the buy](agents/after-the-buy.md):** minutes after a buy or an add fills, puts the playbook's holding triggers on the stock, fitted to the thesis.
- **[Chat](agents/chat.md):** talk to one analyst, or to the whole account.
- **[Market Reviewer](agents/market-reviewer.md):** every weekday at 7:30, researches the market itself and writes the market digest and notes on the stocks it touches.
- **[The Portfolio Digest](agents/portfolio-digest.md):** at 8 PM, your account's day, written from one snapshot of your portfolio.
- **[Portfolio Manager](agents/portfolio-manager.md):** twice a week, reads the whole account and decides where the money belongs.
- **[The analyst builder](agents/analyst-builder.md):** interviews you and proposes a whole analyst, checked against today's market. It sets up the analysts the other agents work for.

## The concepts

- **[How an agent is built](concepts/agents.md):** the five parts of every agent (instructions, context, tools, message, when it runs), how to change one, and how a change is checked.
- **[Theses](concepts/theses.md):** a belief we can be wrong about, and the triggers that act on it. Every stock on the book has one.
- **[Triggers](concepts/triggers.md):** one sentence each, like "Sell if below $384". A stock has its triggers and nothing else: no plan, no price target of our own.
- **[Analysts](concepts/analysts.md):** a trading style with its own universe, sizing and sell rules. Every thesis belongs to one.
- **[Situations](concepts/situations.md):** why a stock is in front of its analyst today, each with one short skill that says what to find out.
- **[Approvals](concepts/approvals.md):** analysts propose, you approve, and a proposal expires after a day, except one a trigger made, which waits while its trigger holds.
- **[Price targets](concepts/price-targets.md):** the house sets none, and there is no plan. A stock has its triggers (its playbook's triggers and any written by hand); Wall Street's targets are a card, and a price a trigger can watch.

## Deep dives

One mechanism or one workflow, end to end, for when the concept doc isn't enough.

- **[Saving a thesis](deep-dives/saving-a-thesis.md):** how every agent edit lands or is refused: a save is a patch, each agent's fields, one trigger at a time, floors only go up.
- **[Sizing and limits](deep-dives/sizing-and-limits.md):** how big a trade is: risk to the floor, conviction, the market, the analyst's band and slots, the account-wide lines.
- **[From proposal to fill](deep-dives/proposal-to-fill.md):** a trade from the agent's call through the approval gate, the broker and the fill, and what each step does to the thesis.
- **[From fire to run](deep-dives/trigger-fire-to-run.md):** the five-minute check, what fires, what holds a fire back, and where each one goes.

## Reference

Exact lists built from the code, with a test that fails when they drift. Regenerate with `UPDATE_GUIDE=1 npx jest lib/docs/guide`.

- **[Situations library](reference/situations-library.md):** every situation, each with its code, what it means and the exact text an agent is sent.
- **[Trigger measures](reference/trigger-measures.md):** every condition a trigger can watch, its numbers, variables and settings, and the shape it's saved in.
- **[Playbooks](reference/setups.md):** every playbook: what must be true first, the triggers each writes, and when it has failed.

## Reading these docs

- Every agent and concept doc ends with **Technical details**: the files, functions and tables behind it. The code is the source of truth; when a doc and the code disagree, the code wins and the doc is the bug.
- Some lists are read from the code rather than written here: each agent's tools (`lib/agent/modes.ts`), the playbooks (`lib/agent/knowledge/setups.ts`) and the trigger examples (`lib/docs/trigger-examples.ts`). The docs say where. The situation texts are copied into the [Situations library](reference/situations-library.md) by a test that fails when they drift.
- A line like `<!-- asset: trigger-log -->` is where the page draws a picture. A ` ```chat ` block is an example conversation: `user:` is you, `tools:` is a tool call with its rows, `text:` is the agent's answer.
- For working on the code, `CLAUDE.md` at the repo root has the rules and the known traps. Open work is in Linear; code smells outside the current work go in `docs/TECH_DEBT.md`. The deeper references are `docs/THESIS_ARCHITECTURE.md`, `docs/TRIGGERS.md` and `docs/plans/`.
