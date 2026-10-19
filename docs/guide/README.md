# How Hindsight works

**A research desk that never stops watching.** Analysts find the stocks, write the case and guard every position. On the live account, nothing trades without you.

This folder is the guide, and this page is where to start. The /docs pages in the app draw these same files, so what you read here is what the page says.

## How to use this guide

1. **Read this page** for the shape of the whole system.
2. **Open the concept or agent doc** your task touches. Each one says what it is, how it fits the cycle, and links the others it depends on.
3. **Go to a deep dive or the reference** when you need the whole mechanism (how a save lands, how a trade is sized) or an exact list (the text for each situation, every trigger measure, every setup).
4. **Follow Technical details** at the end of each doc to the code. The code is the source of truth.

The folders match the sidebar:

- `agents/`: the five agents, one doc each.
- `concepts/`: theses, triggers, analysts, situations and approvals.
- `deep-dives/`: one mechanism or workflow end to end, like [saving a thesis](deep-dives/saving-a-thesis.md).
- `reference/`: exact lists built from the code, like the [Situations library](reference/situations-library.md).
- `architecture.md` and `glossary.md` sit here, next to this page.

## The loop, on one stock

1. **[Discovery](agents/discovery.md)** finds a stock that fits an [analyst](concepts/analysts.md): CRWD beat, raised its year and held the gap. Or you ask for research in [chat](agents/chat.md), or add the stock to the watchlist yourself.
2. **[The Writer](agents/writer.md)** researches it and writes its [thesis](concepts/theses.md): the belief, what would prove it wrong, and a plan made of [triggers](concepts/triggers.md). The stock goes on the watchlist as Watching.
3. **The trigger check** watches the plan every five minutes. When the buy fires, a **[trigger run](agents/trigger-runs.md)** looks at that one stock and proposes the buy.
4. **You approve** the **[proposal](concepts/approvals.md)** (on paper, approval is off by default and the buy goes straight through). The buy goes to the broker, the thesis turns to Holding, and its floor, trail and target guard it.
5. **[Morning runs](agents/morning-runs.md)** read the analyst's whole book every run day and answer each stock in a **[situation](concepts/situations.md)**: a review that came due, a floor to raise, earnings, stale research, your notes.
6. **A sale fires**, or a run decides to sell: another proposal. Declined or left to expire, it's proposed again each day the price stays past the line, and only you can lower the floor.
7. **The sale goes through** and the thesis is retired as sold, or goes back to Watching after a sale at the target. A retired stock gets one look back within two weeks: watch it again, or let it go.

[Chat](agents/chat.md) is where you ask about any of it, change a plan, or start research yourself, at any step.

## The whole system

- **[Architecture](architecture.md):** how the pieces fit: the data, the record, the clocks, the read, the agents, the save and the gate, and the one place each thing is defined.
- **[Glossary](glossary.md):** every term the app, the docs and the agents use, a sentence each.

## The agents

Every agent doc has the same five sections, in the same order: **What it does** (the job, and why it works that way), **When it runs**, **What it reads**, **What it decides** and **What happens next** (where the stock goes from there). Read them in that order and you can follow a stock from one agent to the next.

- **[Discovery](agents/discovery.md):** screens earnings, movers and the web for stocks that fit an analyst, and sends the best to the Writer.
- **[The Writer](agents/writer.md):** researches one stock in depth and writes its thesis, plan and all.
- **[Morning runs](agents/morning-runs.md):** every weekday morning, each analyst reviews its whole book.
- **[Trigger runs](agents/trigger-runs.md):** a trigger fires and the analyst looks at that one stock within minutes.
- **[Chat](agents/chat.md):** talk to one analyst, or to the whole account.

## The concepts

- **[Theses](concepts/theses.md):** a belief we can be wrong about, and the plan that acts on it. Every stock on the book has one.
- **[Triggers](concepts/triggers.md):** one sentence each, like "Sell if below $384". A thesis's whole plan is its triggers.
- **[Analysts](concepts/analysts.md):** a trading style with its own universe, sizing and sell rules. Every thesis belongs to one.
- **[Situations](concepts/situations.md):** the sixteen reasons a stock needs an answer today, each with its own instructions.
- **[Approvals](concepts/approvals.md):** analysts propose, you approve, and a proposal expires after a day.

## Deep dives

One mechanism or one workflow, end to end, for when the concept doc isn't enough.

- **[Saving a thesis](deep-dives/saving-a-thesis.md):** how every agent edit lands or is refused: a save is a patch, each agent's fields, one trigger at a time, floors only go up.
- **[Sizing and limits](deep-dives/sizing-and-limits.md):** how big a trade is: risk to the floor, conviction, the market, the analyst's band and slots, the account-wide lines.
- **[From proposal to fill](deep-dives/proposal-to-fill.md):** a trade from the agent's call through the approval gate, the broker and the fill, and what each step does to the thesis.
- **[From fire to run](deep-dives/trigger-fire-to-run.md):** the five-minute check, what fires, what holds a fire back, and where each one goes.

## Reference

Exact lists built from the code, with a test that fails when they drift. Regenerate with `UPDATE_GUIDE=1 npx jest lib/docs/guide`.

- **[Situations library](reference/situations-library.md):** all sixteen situations, each with its code, what it means and the exact text an agent is sent.
- **[Trigger measures](reference/trigger-measures.md):** every condition a trigger can watch, its numbers, variables and settings, and the shape it's saved in.
- **[Setups](reference/setups.md):** every setup in the playbook: what must be true first, where the buy, floor and target go, and when it has failed.

## Reading these docs

- Every agent and concept doc ends with **Technical details**: the files, functions and tables behind it. The code is the source of truth; when a doc and the code disagree, the code wins and the doc is the bug.
- Some lists are read from the code rather than written here: each agent's tools (`lib/agent/modes.ts`), the playbook's setups (`lib/agent/knowledge/setups.ts`) and the trigger examples (`lib/docs/trigger-examples.ts`). The docs say where. The situation texts are copied into the [Situations library](reference/situations-library.md) by a test that fails when they drift.
- A line like `<!-- asset: trigger-log -->` is where the page draws a picture. A ` ```chat ` block is an example conversation: `user:` is you, `tools:` is a tool call with its rows, `text:` is the agent's answer.
- For working on the code, `CLAUDE.md` at the repo root has the rules and the known traps. Open work is in Linear; code smells outside the current work go in `docs/TECH_DEBT.md`. The deeper references are `docs/THESIS_ARCHITECTURE.md`, `docs/TRIGGERS.md` and `docs/plans/`.
