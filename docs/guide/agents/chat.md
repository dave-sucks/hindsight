# Chat

**Ask anything. It sees the whole desk.** Talk to one analyst about its book, or to the whole account.

Chat reads the same theses, runs the same research, and can change a plan or propose a trade while you watch.

```chat
caption: Chat with the Secular Compounder selected.
user: Why are we still holding AVGO after the report?
tools: Reading $AVGO's thesis (+1 more)
- AVGO: Holding since June · up 18.4% · floor $1,610 · target $2,050
- Beat by 6%, raised AI revenue guidance; the stock fell 3% on the day
text: The belief is intact. $AVGO (−3.1%) beat and raised; the drop was the sector selling, not the company. None of the things that would prove it wrong has happened.
user: Good. Raise the floor to $1,650.
tools: Updating $AVGO's thesis
- AVGO: Floor raised from $1,610 to $1,650
```

## What it does

Chat is the one agent you talk to directly. It can answer a question about any stock, run, trade or analyst, do research, change a plan, start [Discovery](discovery.md) or [the Writer](writer.md), and propose a trade. It runs on Claude Sonnet with thinking on.

## One analyst, or all of them

With an analyst selected, chat works for that analyst: every edit and trade is made on its book, and it reads the analyst's strategy and rules first. With none selected, it looks across the whole account, and asks which analyst you mean before it writes anything.

## Try asking

> What's waiting on me?
>
> Why did the 8 AM run sell SHOP?
>
> How have my drift trades done this quarter?
>
> /research CRWD
>
> Raise CRWD's floor to $398.
>
> What would make you sell LLY?

## What it can reach

- **Your book:** `get_theses` and `get_portfolio_context` for the stocks, positions and cash.
- **The queue:** `list_proposals` reads what's waiting for you, with each reason and its time left. Chat can't approve or decline one; that's always your click.
- **The record:** `list_runs`, `read_run` and `read_trade_results` for what the analysts did and how their trades turned out.
- **Research:** the market data, filings, earnings, the web and X, the same as every other agent.
- **New research:** "research CRWD", or `/research`, starts the Writer with `dispatch_thesis_research`, and `wait_for_thesis_refresh` brings its thesis back into the conversation.

## Changes and trades

When your message is clear ("raise the floor to $1,650", "sell NVDA"), chat says what it's doing in one sentence and does it. An edit goes through `update_thesis` and lands in Activity like any other, and a price you name becomes a [trigger](../concepts/triggers.md) on the [thesis](../concepts/theses.md). A trade becomes a [proposal](../concepts/approvals.md) like any analyst's; chat can name a size, which is used as given. Besides the Writer, chat is the only agent that may change a thesis's belief and direction, and only when you ask.

## Your notes

The analysts never see this chat. What reaches them is a note on the stock's thesis, in your words: why you like or doubt it, what you're waiting for. A note no run has answered puts the stock in the "your word unanswered" [situation](../concepts/situations.md), so the next [morning run](morning-runs.md) answers it first, quoting you.

- When research reaches a conclusion, chat asks before saving a note, with the draft on a question card.
- A note is information, not an order. A run weighs it and says so when it decides against it.
- A price or a condition is never just words in a note. "Sell under $62" becomes a trigger, and the note says why.

## Tools

Everything chat can call, read from `lib/agent/modes.ts`.

<!-- asset: tools chat -->

<details>
<summary>Technical details</summary>

#### Mode
`principal` in `lib/agent/modes.ts`: `claude-sonnet-4-6` with a 4,000-token thinking budget, up to 45 steps. The model can be switched in the chat.

#### Scope
With an analyst selected, the chat is a `PRINCIPAL_CHAT` run on that analyst, so its edits and trades are recorded like a morning run's.

#### Prompt
`buildPrincipalSystemPrompt` in `lib/agent/modes.ts`, with the analyst brief and the house rules.

#### Notes
`write_note`, only after a yes on `ask_question` or when you asked for one.

#### Route
`app/api/agent/[mode]/route.ts`
</details>
