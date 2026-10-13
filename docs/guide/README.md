# How Hindsight works

**A research desk that never stops watching.** Analysts find the stocks, write the case and guard every position. Nothing trades without you.

This folder is the guide: one doc per agent and per concept. The /docs page in the app draws these same files, so what you read here is what the page says. Start here, then open only the docs your task needs.

## The loop, on one stock

1. **[Discovery](discovery.md)** finds a stock that fits an [analyst](analysts.md): CRWD beat, raised its year and held the gap. Or you ask for research in [chat](chat.md), or add the stock to the watchlist yourself.
2. **[The Writer](writer.md)** researches it and writes its [thesis](theses.md): the belief, what would prove it wrong, and a plan made of [triggers](triggers.md). The stock goes on the watchlist as Watching.
3. **The trigger check** watches the plan every five minutes. When the buy fires, a **[trigger run](trigger-runs.md)** looks at that one stock and proposes the buy.
4. **You approve** the **[proposal](approvals.md)**. The buy fills, the thesis turns to Holding, and its floor, trail and target guard it.
5. **[Morning runs](morning-runs.md)** read the analyst's whole book every run day and answer each stock in a **[situation](situations.md)**: a review that came due, a floor to raise, earnings, stale research, your notes.
6. **A sale fires**, or a run decides to sell: another proposal. Declined or left to expire, it's proposed again each day the price stays past the line, and only you can lower the floor.
7. **The sale fills** and the thesis is retired as sold. Within two weeks it gets one look back: watch it again, or let it go.

[Chat](chat.md) is where you ask about any of it, change a plan, or start research yourself, at any step.

## The whole system

- **[Architecture](architecture.md):** how the pieces fit: the data, the record, the clocks, the read, the agents, the save and the gate, and the one place each thing is defined.
- **[Glossary](glossary.md):** every term the app, the docs and the agents use, a sentence each.

## The agents

- **[Discovery](discovery.md):** screens earnings, movers and the web for stocks that fit an analyst, and sends the best to the Writer.
- **[The Writer](writer.md):** researches one stock in depth and writes its thesis, plan and all.
- **[Morning runs](morning-runs.md):** every weekday morning, each analyst reviews its whole book.
- **[Trigger runs](trigger-runs.md):** a trigger fires and the analyst looks at that one stock within minutes.
- **[Chat](chat.md):** talk to one analyst, or to the whole account.

## The concepts

- **[Theses](theses.md):** a belief we can be wrong about, and the plan that acts on it. Every stock on the book has one.
- **[Triggers](triggers.md):** one sentence each, like "Sell if below $384". A thesis's whole plan is its triggers.
- **[Analysts](analysts.md):** a trading style with its own universe, sizing and sell rules. Every thesis belongs to one.
- **[Situations](situations.md):** the sixteen reasons a stock needs an answer today, each with its own instructions.
- **[Approvals](approvals.md):** analysts propose, you approve, and a proposal expires after a day.

## Reading these docs

- Every agent and concept doc ends with **Technical details**: the files, functions and tables behind it. The code is the source of truth; when a doc and the code disagree, the code wins and the doc is the bug.
- Some lists aren't copied here because they're read from the code: each agent's tools (`lib/agent/modes.ts`), the playbook's setups (`lib/agent/knowledge/setups.ts`), the situation texts (`SITUATIONS` in `lib/agent/situations.ts`) and the trigger examples (`lib/docs/trigger-examples.ts`). The docs say where.
- A line like `<!-- asset: trigger-log -->` is where the page draws a picture. A ` ```chat ` block is an example conversation: `user:` is you, `tools:` is a tool call with its rows, `text:` is the agent's answer.
- For working on the code, `CLAUDE.md` at the repo root has the rules and the known traps. The deeper references are `docs/THESIS_ARCHITECTURE.md`, `docs/TRIGGERS.md` and `docs/plans/`.
