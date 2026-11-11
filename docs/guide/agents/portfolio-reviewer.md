# Portfolio Reviewer

**The account's day, read once every evening.** At 8 PM ET the Portfolio Reviewer reads what the account did, gathered by code, and writes a short brief every agent reads and a longer digest for you.

It feeds the analysts; it never trades, and it never edits a thesis or a trigger.

```facts
Model: gpt-5.4
Starts: 8:00 PM ET, weekdays
Steps: Up to 2
Tools: 0
Saves: A brief and a digest
```

## What it does

Every analyst agent decides one stock at a time. The Portfolio Reviewer is the one look at the whole account: how it moved, what each holding did, what is waiting for your approval, and what the day left unsettled. Code gathers every number first, and the model only writes the words, so a figure in its brief or digest is always one the facts had.

It writes two things:

- **The portfolio brief:** 3 to 5 sentences, 700 characters at most, on what only a view of the whole account sees and one stock's run can't: a theme getting crowded across holdings, sales piling up against the analysts' own notes, how much of the account rides on one story. It never repeats a number the agents already have. Every agent that decides on stocks reads it in its [Market and portfolio block](../deep-dives/what-each-agent-is-given.md) until the next one is written.
- **The portfolio digest:** for you, on the home page's digest card. It opens with each sale waiting for your approval as one decision: the floor and where the price is now, how many times the sale has been proposed and since when, what the analyst's note says, and your choices by what it says. If the analyst argues to hold and names a price to hold at: approve the sale, or lower the floor to that price. If it argues to hold and names none: approve, or lower the floor yourself. If it agrees with the sale: approve, or keep it waiting; lowering the floor is yours to set, and the analyst names no level for it. Not answering means it's proposed again tomorrow. A price the note gives for something else (where to buy back, what would change its mind, the floor itself) is never offered as a floor, and neither is one at or above tonight's price; code checks each price the digest offers and sends the digest back once if one doesn't hold up; a sale's paragraph that still offers one is replaced by code's own, with the choices that name no level. The reviewer reports the analyst's view and the choices; it never advises hold or sell itself. Then today's recap: the value and the day's change ("closed at" only when the value is the close), each holding's move, what everything waiting adds up to, the open question, and tomorrow's priority. Agents never read the digest.

Cash is the broker's cash, never margin buying power, and it never suggests putting idle cash to work: cash is not a problem to fix.

## When it runs

At 8:00 PM ET on weekdays, after the market closes and the last trigger run settles, once for each account and book (paper or live) that traded or had a run that day. Each review is a run of its own, named "Portfolio Reviewer" on the Runs page. Open it to see the facts it was given, as its first message, and what it wrote. Above them are chips with exactly what each of its model calls sent: its instructions and the facts, and on a second try the ask that sent it back.

## What it reads

The facts code gathers for the day (`buildDigestFacts`):

- the account's value, the day's change and the change since the start, both net of deposits, with every holding at the app's own price (the close, after the bell) and never the broker's after-hours marks; the cash and its share of the account. A run after the broker has moved its prior close past the day reads the day's change from that day's earlier digest, or says it couldn't be worked out;
- the holdings, each with its move today and since entry;
- the proposals waiting for approval, each with its value at tonight's price, and their total. For each sale also: the floor that fired (the sell trigger's fire just before the proposal, its time and price) and how far tonight's price is from it, how many times the sale has been proposed since the position opened and since when, the move since, and the analyst's note on today's proposal in full;
- the day's runs, trades and thesis decisions, each with its analyst;
- the stocks passed on in the last 30 days and how they moved since.

It is not given the margin buying power, the idle cash or the empty slots: those read as orders to buy.

## What it decides

Only what to write. It replies in two parts, the brief and the digest. If a part is missing, the brief runs past 700 characters or the digest offers a floor price the note doesn't back, it is asked once more; after that a long brief is cut at its last full sentence that fits. If the model call fails, the digest is the plain facts and no brief is written that night.

## What happens next

The brief is saved on the day's digest row. If anything fails on the way, the run still ends (FAILED) and the digest is the plain facts; a rerun whose model fails never replaces a digest and brief already written. The next morning's runs, every trigger run, the chat and the Writer read it under "Portfolio brief" in their Market and portfolio block, for up to four days. You read the digest on the home page.

<details>
<summary>Technical details</summary>

#### Job
`lib/inngest/functions/portfolio-digest.ts` (cron `0 20 * * 1-5`, New York time). Which books qualify: `lib/portfolio/digest-pairs.ts`.

#### Facts
`buildDigestFacts` in `lib/portfolio/digest-facts-builder.ts`, assembled by `lib/portfolio/digest-facts.ts`. The day is the New York date the job runs on. The account is valued by `priceBook` and `dayChangeAt` (`lib/portfolio/value-at-quotes.ts`), on the quote path's prices.

#### The sales waiting
`loadWaitingForReview` in `lib/portfolio/load-sale-queue.ts`: every proposal waiting, and through `loadSaleQueue` with `decision: true` each waiting sale's `Order`, the sale proposals on its position, the `TRIGGER_FIRED` line of the sell trigger before it, and the note linked by `ThesisUpdate.tradeId`. The agents' block prints one line per sale from the same rows (`lib/portfolio/sale-queue.ts`), without the floor or the note.

#### The reviewer
`lib/agent/portfolio-reviewer.ts`: `PORTFOLIO_REVIEWER` (name, mode `PORTFOLIO_REVIEW`, model, steps), `REVIEWER_PROMPT`, `buildReviewerInput`, `parseReview`, `floorOfferProblems` (the check on each floor price the digest offers) and `writePortfolioReview`.

#### Saved
A `ResearchRun` (mode `PORTFOLIO_REVIEW`) with its thread (`saveRunThread`) and what each model call sent (`recordRequests`, "Main" and "Retry"), and one `PortfolioDigest` row per account, book and day: `brief` and `narrative`.

#### Trying it without saving
`npx tsx --env-file=.env.local scripts/portfolio-review-dry-run.ts --date <YYYY-MM-DD>` builds that day's input the way the job does, calls the model once and prints the input, the brief, the digest and the Market and portfolio block each analyst's morning run and a trigger run would get. It saves nothing; `--no-model` skips the model call. Its output holds the analysts' notes in full, so it stays out of the repo.
</details>
