# How Hindsight works

**A research desk that never stops watching.** Analysts find the stocks, write the case and guard every position. Nothing trades without you.

This folder is the guide: one doc per agent and per concept. The /docs page in the app draws these same files, so what you read here is what the page says. Start here, then open only the docs your task needs.

## The loop, on one stock

1. **[Discovery](discovery.md)** finds a stock that fits an analyst: CRWD beat, raised its year and held the gap.
2. **[The Writer](writer.md)** researches it and writes its [thesis](theses.md): the belief, what would prove it wrong, and a plan made of [triggers](triggers.md). The stock goes on the watchlist.
3. **[Morning runs](morning-runs.md)** read the analyst's whole book every weekday at 8 AM and answer each stock in a [situation](situations.md).
4. **[Trigger runs](trigger-runs.md)** start within minutes when a trigger comes true during the day, and decide on that one stock.
5. Every buy, sale, add and trim becomes a **[proposal](approvals.md)** that waits for your approval.
6. **[Chat](chat.md)** is where you ask about any of it, change a plan, or start research yourself.

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
- **[Under the hood](under-the-hood.md):** data sources, schedules, models, and what each agent is told.

## Reading these docs

- Every doc ends with **Technical details**: the files, functions and tables behind it. The code is the source of truth; when a doc and the code disagree, the code wins and the doc is the bug.
- Some lists aren't copied here because they're read from the code: each agent's tools (`lib/agent/modes.ts`), the playbook's setups (`lib/agent/knowledge/setups.ts`), the situation texts (`SITUATIONS` in `lib/agent/situations.ts`) and the trigger examples (`lib/docs/trigger-examples.ts`). The docs say where.
- A line like `<!-- asset: trigger-log -->` is where the page draws a picture. A ` ```chat ` block is an example conversation: `user:` is you, `tools:` is a tool call with its rows, `text:` is the agent's answer.
- For working on the code, `CLAUDE.md` at the repo root has the rules and the known traps. The deeper references are `docs/THESIS_ARCHITECTURE.md`, `docs/TRIGGERS.md` and `docs/plans/`.
