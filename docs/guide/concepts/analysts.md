# Analysts

**Hire an analyst for every style.** An analyst is a trading style with its own universe, sizing and sell rules.

You build one by describing it, and it works its book every weekday morning.

<!-- asset: card analysts -->

## What an analyst is

Each analyst is one way of trading, run by the agents. It has its own book of [theses](theses.md), its own watchlist and its own money rules, and every agent that works on one of its stocks reads it first. You can run several side by side: one buying post-earnings drift, one owning long-term compounders, one trading dated events.

<!-- asset: analyst-styles -->

## What makes one

- **Strategy:** its edge in your words: what it buys, what it filters out, what it never does. Every agent reads it word for word.
- **Universe:** the markets, sectors, industries, themes and market-cap band it looks in. Its exclusion list always wins.
- **Setups:** the kinds of trade it takes, chosen from the playbook below.
- **Sizing:** the smallest trade, the largest, and the most it will hold in one stock.
- **Sell rules:** its own [triggers](triggers.md), inherited by every stock it holds, like a trail 12% off the high.
- **Run days:** which mornings it reviews its book. Every weekday by default.

## How it shapes every step

An analyst isn't one agent; it's the style every agent works in when it touches one of its stocks.

- **Finding stocks:** [Discovery](../agents/discovery.md) searches only inside its universe, scores each stock against its setups, and skips anything it already covers.
- **Writing the thesis:** [the Writer](../agents/writer.md) researches in its strategy and prices the plan from its setups' rules.
- **Guarding holdings:** its sell rules watch every stock it holds without being copied onto them, so changing its style changes every holding at once.
- **Reviewing the book:** a [morning run](../agents/morning-runs.md) on each of its run days, for its book only, reading its strategy first.
- **Acting on a fire:** a [trigger run](../agents/trigger-runs.md) decides in its style, and a buy that fires while it's full waits for you to choose what it replaces.
- **Sizing trades:** every buy and add is sized by its band. Its [proposals](approvals.md) name it, so you always know whose call it is.
- **Talking to you:** open [chat](../agents/chat.md) on it, and every edit and trade lands on its book.

## What every agent reads about it

Whichever agent is working (a [morning run](../agents/morning-runs.md), a [trigger run](../agents/trigger-runs.md), [chat](../agents/chat.md) on this analyst, [Discovery](../agents/discovery.md) or [the Writer](../agents/writer.md)), it reads the same brief: the analyst's name, its strategy word for word, its rule numbers, how many slots are free, and one line per setup it has chosen. It's written once, so no two agents can describe the same analyst differently.

## It never picks a size

Every buy is sized by risk: the dollars at risk divided by the distance to the floor, scaled by conviction, then held inside the analyst's band. An add risks half of the first buy. A tight, honest floor is what earns a bigger position.

- **Smallest trade:** a normal buy. Below this, it isn't worth the slot.
- **Largest trade:** a high-conviction buy, and the ceiling for one order.
- **Most in one stock:** where adding to a winner stops.

## The playbook

Every analyst trades from the same playbook of setups, each with its checklist for the buy, the floor, the target and the time limit. An analyst picks the ones that fit its style. The setups are defined in `lib/agent/knowledge/setups.ts`.

<!-- asset: playbook -->

## Built by conversation

Describe the style and the builder interviews you with question cards, checks the idea against today's market, and proposes the whole analyst side by side for you to accept. The editor on an analyst's page changes one the same way.

```chat
caption: Building a new analyst.
user: I want an analyst that buys biotech run-ups into FDA decisions.
tools: Pulling FDA decisions in the next 70 days, firm-wide
- 23 dated decisions · 9 above a $1B market cap · 4 already run 30%+
text: Enough supply to work with. How close to the decision should it sell: the day before, a week before, or hold through it?
```

<details>
<summary>Technical details</summary>

#### Stored as
`AgentConfig`: `analystPrompt`, the universe fields, `exclusionList`, `minPositionSize` / `maxPositionSize` / `maxPositionTotal`, `runDaysOfWeek`, `triggers`.

#### The brief
`analystBrief` in `lib/agent/analyst-brief.ts`, the one text every door puts in its prompt.

#### Sizing
`sizeByRisk` in `lib/agent/position-sizing.ts`, shared by the trade tools and the Settings screen.

#### Setups
`lib/agent/knowledge/setups.ts`

#### Sell rules
Resolved thesis → analyst → account; the most specific wins. Inherited, never copied onto a thesis.

#### Builder
`builder` and `editor` modes, `gpt-4o`, with `ask_question` and `suggest_config`.
</details>
