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
- **Sizing:** its smallest trade, its largest, and the most it will hold in one stock. No agent picks a size: a buy risks 1% of the account by default, scaled by conviction (half at low, 1.25× at strong), halved again for an all-or-nothing event or a cautious market, and sized by the distance to its floor inside this band. An add risks half the first buy. A tight, honest floor is what earns a bigger position.
- **Slots:** how many stocks it may hold at once, 5 by default. When every slot is held or waiting for approval, a new buy is refused until one frees up. Adding to a stock it already holds needs no slot.
- **Minimum score:** the lowest score a stock needs before the analyst may buy it. Scores are out of 10 and the setting is out of 100, so 70 means 7 out of 10. In chat a lower score is a line on the proposal, not a refusal.
- **Its rules:** its own [triggers](triggers.md), inherited by every stock it holds, like a review when a stock closes below its 200-day average.
- **Run days:** which mornings it reviews its book. Every weekday by default.

The sizing math, the market's effect and the account-wide limits: [Sizing and limits](../deep-dives/sizing-and-limits.md).

## How it shapes the agents

Every agent that touches one of its stocks reads the same brief first: the analyst's name, its strategy word for word, its rule numbers, how many slots are free, and one line per setup it has chosen. It's written once, so no two agents can describe the same analyst differently. Then:

- **[Discovery](../agents/discovery.md)** searches only inside its universe and scores each stock against its setups.
- **[The Writer](../agents/writer.md)** researches in its strategy and prices the plan from its setups' rules.
- **Its sell rules** guard every stock it holds without being copied onto them, so changing its style changes every holding at once.
- **[Morning runs](../agents/morning-runs.md)** review its book on its run days.
- **[Trigger runs](../agents/trigger-runs.md)** decide in its style. A buy that fires while it's full waits for you to choose what it replaces.
- **[Chat](../agents/chat.md)** opened on it makes every edit and trade on its book.

Every [proposal](approvals.md) names the analyst behind it, so you always know whose call it is.

**Paused.** A paused analyst runs nothing: no morning runs, no trigger runs, no buys or adds. A stock it still holds keeps its sale triggers, its own and the ones it inherits, and each one that fires comes to you as a sale instead of waking the analyst. An Auto-sell goes through your approval switch as usual; any other sale always waits for your approval.

## The playbook

Every analyst trades from the same playbook of setups, each with its checklist for the buy, the floor, the target and the time limit. An analyst picks the ones that fit its style. The setups are defined in `lib/agent/knowledge/setups.ts`.

<!-- asset: playbook -->

Every setup's rules in full: [Setups](../reference/setups.md).

## Built by conversation

Describe the style and the builder interviews you with question cards, checks the idea against today's market, and proposes the whole analyst side by side for you to accept. The editor on an analyst's page changes one the same way. How it works: [the analyst builder](../agents/analyst-builder.md).

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
`AgentConfig`: `analystPrompt`, the universe fields, `exclusionList`, `minPositionSize` / `maxPositionSize` / `maxPositionTotal`, `riskPct`, `maxOpenPositions`, `setupIds`, `runDaysOfWeek`, `triggers`. Sizing math: `sizeByRisk` in `lib/agent/position-sizing.ts`.

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
