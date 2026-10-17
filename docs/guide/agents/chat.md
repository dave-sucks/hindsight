# Chat

**Ask anything. It sees the whole desk.** Chat is the one agent you talk to: about one analyst's book, or the whole account.

It reads the same theses and runs the same research as every other agent, and it can change a plan or propose a trade while you watch.

```facts
Model: claude-sonnet-4-6
Starts: When you type
Steps: Up to 45
Tools: 30
Saves: 21 fields: also belief, direction
```

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

Chat answers questions about any stock, run, trade or analyst. It researches, changes a plan, starts [Discovery](discovery.md) or [the Writer](writer.md), and proposes trades. It runs on Claude Sonnet with thinking on.

The other agents run on a clock and act on what's saved. Chat is how your judgment gets into that record: as [triggers](../concepts/triggers.md), plan edits and notes that every later run reads.

## When it runs

When you type. With an [analyst](../concepts/analysts.md) selected, chat works for that analyst: it reads the analyst's strategy and rules first, and every edit and trade lands on its book. With none selected, it looks across the whole account and asks which analyst you mean before it writes anything.

> What's waiting on me?
>
> Why did the 8 AM run sell SHOP?
>
> How have my drift trades done this quarter?
>
> /research CRWD
>
> What would make you sell LLY?

## What it reads

- **Your book:** `get_theses` and `get_portfolio_context`, the stocks, positions and cash.
- **Your queue:** `list_proposals`, what's waiting for you, each with its reason and time left.
- **The record:** `list_runs`, `read_run` and `read_trade_results`, what the analysts did and how their trades turned out.
- **Research:** the market data, filings, earnings, the web and X, the same tools as every other agent.

## What it decides

When your message is clear ("raise the floor to $1,650", "sell NVDA"), chat says what it's doing in one sentence and does it.

- **Edit a plan:** `update_thesis`, landing in Activity like any other edit. A price you name becomes a trigger on the [thesis](../concepts/theses.md). Like every agent, chat can raise a floor on a holding but not lower one; lowering a floor is yours, on the thesis.
- **Change the belief or direction:** only the Writer and chat can, and chat only when you ask.
- **Trade:** a [proposal](../concepts/approvals.md) like any analyst's. Chat can name a size, and it's used as given.
- **Research:** "research CRWD" or `/research` starts the Writer with `dispatch_thesis_research`; `wait_for_thesis_refresh` brings the thesis back into the conversation.

It never approves or declines a proposal. That's always your click.

## What happens next

The analysts never see this conversation. What reaches them is a note on the stock's thesis, in your words: why you like it or doubt it, what you're waiting for.

- **Chat asks first.** When research reaches a conclusion, it drafts the note on a question card and saves it only on your yes.
- **A note gets answered.** One no run has answered puts the stock in the "your word unanswered" [situation](../concepts/situations.md), so the next [morning run](morning-runs.md) answers it first, quoting you.
- **A note is information, not an order.** A run weighs it, and says so when it decides against it.
- **A price is never just words.** "Sell under $62" becomes a trigger, and the note says why.

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

#### Edits
`update_thesis` saves chat's trigger edits as an agent's (`actor: "AGENT"`), so the floor ratchet applies. Your own edits on the thesis sheet are the principal's and skip it.

#### Notes
`write_note`, only after a yes on `ask_question` or when you asked for one.

#### Route
`app/api/agent/[mode]/route.ts`
</details>
