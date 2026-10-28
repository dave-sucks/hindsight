# The analyst builder

**Describe a style, get an analyst.** The builder interviews you, checks the idea against today's market, and proposes a whole analyst for you to accept.

It sets up the analysts the other agents work for. It never researches a stock in depth, never writes a thesis and never trades.

```facts
Model: gpt-4o
Starts: When you build or edit one
Steps: Up to 25
Tools: 11
Saves: A whole analyst, on your yes
```

```chat
caption: Building a new analyst.
user: I want an analyst that buys biotech run-ups into FDA decisions.
tools: Pulling FDA decisions in the next 70 days, firm-wide
- 23 dated decisions · 9 above a $1B market cap · 4 already run 30%+
text: Enough supply to work with. How close to the decision should it sell: the day before, a week before, or hold through it?
```

## What it does

The builder turns a trading idea into an [analyst](../concepts/analysts.md): a strategy in your words, a universe, setups, sizing and a starting watchlist. The editor (**Edit with Agent** on an analyst's page) changes one the same way.

An analyst is a long-lived choice: every morning run, trigger run and Writer run reads it. So the builder grounds the idea in today's market before it proposes anything, and nothing is saved until you accept the whole proposal.

It runs on GPT-4o rather than the reasoning models the trading agents use, because you're waiting on every reply.

## When it runs

When you start one. The builder runs at **New analyst**; the editor runs from **Edit with Agent** on an analyst's page. Each reply is one step of a conversation, not a scheduled run.

> I want an analyst that buys biotech run-ups into FDA decisions.
>
> Tighten this one's universe to mid-caps.
>
> Make it sell earlier on a failed breakout.

## What it reads

- **Your answers.** `ask_question` asks one question at a time as a card of two to five choices, so you pick rather than type.
- **The playbook.** `read_knowledge_library` gives the strategy archetypes and the [setups](../reference/setups.md) it can choose from.
- **Today's market.** `get_market_context` first, then real candidates from `get_market_movers` or `get_earnings_calendar`, checked with `get_stock_data` for sector, industry and size. `get_catalyst_calendar`, `get_sec_filings` and `web_search` fill in the rest.
- **The analyst itself,** for the editor: its whole current configuration comes with every request.

## What it decides

One proposal, through `suggest_config`, shown beside the chat as a side-by-side change you can read before accepting:

- **The strategy:** three to five paragraphs on the edge, what it buys, how it enters and what it never does. Every agent reads it word for word. It names no stops, targets or sizes: the setups, the settings and the account's rules own those, and a number written into the strategy would go stale the day one of them changed.
- **The universe:** markets, sectors, industries, themes, a market-cap band and an exclusion list.
- **The setups:** the playbook patterns it will write plans on. The first is its **signature setup**, and that setup's reviews start on the analyst's Triggers tab. None chosen means the whole playbook.
- **Sizing and slots:** its smallest trade, its largest, and how many stocks it may hold at once. Also how long it holds. A new analyst is long-only unless you ask for shorts. Risk per trade and most in one stock aren't in the proposal: you set them on the panel, or they start at 1% and twice the largest trade.
- **A starting watchlist:** names it checked against the universe, never tickers recalled from memory.

If you ask for changes, it proposes again. The editor first sorts each request into one of four kinds (a question, a change to the numbers, a change to the universe, a new strategy) and grounds the bigger two in real names before proposing anything.

## What happens next

When you accept, the analyst is created in one step:

- Its watchlist lands as **seeds**: stocks with no view yet, each due its first research. The next [morning run](morning-runs.md) sends them to [the Writer](writer.md).
- Its signature setup's reviews are written onto its Triggers tab, where every stock it holds inherits them. You can edit them there. A PEAD, catalyst or compounder signature has reviews; any other has none, so its tab starts blank. None of them sells: the account's own sell rules cover every holding.

The editor's proposal saves the same fields. A field it leaves out keeps its value, and changing the setups later leaves the Triggers tab as it is (its re-seed shows what the new signature setup would add).

From then on the analyst runs on its run days like any other.

## Tools

Everything the builder and the editor can call, read from `lib/agent/modes.ts`.

<!-- asset: tools builder -->

<details>
<summary>Technical details</summary>

#### Modes
`builder` and `editor` in `lib/agent/modes.ts`: `gpt-4o`, up to 25 and 20 steps. Both add `suggest_config`. The editor has no `get_sec_filings` or `get_catalyst_calendar`.

#### Prompts
`BUILDER_SYSTEM_PROMPT` and `buildEditorSystemPrompt` in `lib/agent/modes.ts`.

#### Saving
`createAnalystFromBuilder` in `lib/actions/analyst.actions.ts`: the `AgentConfig` and one seed thesis per watchlist ticker (`direction: null`, `status: WATCHING`, `source: BUILDER`) in one transaction, then `seedAnalystTriggers` (`lib/agent/triggers/seed-analyst.ts`) for the signature setup's reviews. The editor saves through `updateAnalystFromBuilder`. Both take the panel's values through `components/analysts/builder-config.ts`, so a field the panel shows is a field that saves.

#### Pages
`/analysts/new` and the editor at `/analysts/[id]/edit`, both through `/api/agent/[mode]` with mode `builder` or `editor`. The proposal's fields are the `suggest_config` schema in `lib/agent/tools/suggest-config.ts`.
</details>
