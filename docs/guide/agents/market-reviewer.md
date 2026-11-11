# Market Reviewer

**The market against the book, at 7:30.** Every weekday before the analysts start, one agent reads the market and every stock we hold or watch, and writes what the others should know.

It never trades and never changes a stock's plan. Each stock's analyst owns it, and its triggers decide when it needs a look. The Market Reviewer feeds that engine: a short brief every agent reads, the digest on your Market tab, and a note wherever it finds something. Most days it writes no note that asks for an answer.

```facts
Model: gpt-5.4
Starts: 7:30 AM ET, weekdays
Steps: Up to 25
Tools: 5
Saves: the market brief, the Market tab's digest, its notes
```

## What it does

Each analyst sees its own stocks. The Market Reviewer sees the market and the whole book together: a sector selling off across three holdings, a holding reporting the week of the inflation report, a ruling that touches two stocks two analysts own. It searches the web, looks at the stocks the news touches, and writes three things.

- **The market brief.** Three to five sentences, 700 characters at most, for the agents: why the market moved, what changed and what that means for this book, in the present tense, every claim with its outlet and date ("Reuters, Nov 10"). Every agent reads it beside the market numbers code prints (the index, VIX, yield and sector moves and the market dates ahead), so it never restates them. No forecasts, and it never tells a stock what to do. Every agent reads it at the top of its runs that day, with the time it was written.
- **The market digest.** For the homepage's **Market** tab, beside **Portfolio**: market overview, sector developments, major developments, implications for your portfolio, what deserves attention and upcoming events, each with the pages it rests on linked. Above them the tab prints the market numbers the run read, by code; the overview, like the brief, says why and never restates them. The tab links to the run that wrote it.
- **Notes**, only where it found something. One note can name several stocks, one analyst, or the whole account; a finding about a sector is one note naming each stock it touches, each with **its own level**, what of its thesis it touches and how much. A stock's line quotes the first words of the condition or assumption it cites, from the thesis, so you see the claim: `NVDA · on the waiting sale · condition 2 ("Guidance cut before the report…"): …`. A development that moves toward a line without doing what it says (a bill to extend export controls, against "export controls extended") is Review, and still cites that line; "a new risk" is only for a risk none of the stock's numbered lines names. Each field has a limit (title 80 characters, each stock's impact 120, evidence 300, source 60, what it means 200, what to check 150; the link isn't counted), about 1,250 characters on a two-stock note; a call with a field over its limit is refused once, naming each field and by how much. A date the note is about is kept only when it is ahead: the news's own date is its source date. In Activity its author reads **Market Reviewer**, with that stock's level.

## When it runs

At 7:30 AM ET every weekday, before the [morning runs](morning-runs.md) at 8:00. A market holiday writes nothing. There is one run per book being traded: an account and environment (paper or live) with an enabled analyst trading in it or a stock held in it. Each one is listed in Runs as **Market Reviewer**, and opening it shows every input, every search, every stock it looked at, every note, and the brief and digest.

## What it reads

Everything it is given is in one file, `lib/agent/market-reviewer/inputs.ts`, as a plain list: what each input is, where it comes from, how much of it, and why. The run's first message is the same list, each section headed by its reason.

- **The market, last session:** the S&P 500 and the Nasdaq 100, the S&P against its 50- and 200-day averages, the VIX and the 10-year yield at the close, and the 11 sectors' moves.
- **Market dates in the next 21 days:** Fed decisions, the inflation reports (CPI, the producer price index and PCE), the jobs report, elections.
- **Earnings dates of our holdings and watches, next 21 days.** A report out before that morning's open shows how it compared with the estimate.
- **The book,** one entry per stock we hold or watch: its analyst, its share of the account, its move last session, over about 30 days and since our entry, its next report and its catalyst date; its belief in one line; its **key assumptions and what would prove it wrong, word for word and numbered**, so a note can name the one a development touches; a sale waiting on it with the gist of the analyst's note; the [situations](../concepts/situations.md) it is in today; the words of the newest line a run wrote on it, so it can tell news a run has already covered; its company headlines since the last review (title, source and time, five at most, from Finnhub); and its own notes on the stock from the last 30 days.
- **The analysts:** each one's name and its strategy in one line, so a note goes to the right one.
- **The latest Portfolio Digest**, from the evening before.

Mid-run it can search the web (ten searches in all), read a stock's thesis and Activity (`get_theses`), and pull a stock's price, chart and news (`get_stock_data`). Left out on purpose: Fed betting odds. On a book of about 30 stocks the inputs run to some 75,000 characters (about 19,000 tokens, read once and cached across the run's steps); the written claims are most of it.

## What it decides

Only whether something deserves a note, and each stock's level in it, judged against that stock's own written claim, in its direction:

| The stock | The development | Level |
|---|---|---|
| Held | Hits one of its numbered "what would prove it wrong" conditions, outside an earnings report | **Urgent** |
| Held | Moves toward one of its numbered conditions without doing what it says, weakens one of its key assumptions, or is a serious risk none of its lines names | **Review** |
| Held, with a sale waiting | Argues for or against that sale | **On the waiting sale** |
| Watched | Its catalyst lands, or one of its numbered conditions is hit | **Urgent** |
| Watched | Other news makes the buy case now, weakens it, or moves toward one of its numbered conditions | **Review** |
| Either | Relevant, but leaves the claim untouched | **Context** |

It writes nothing for a move the market or its sector explains, recycled coverage (fund holdings, roundups, an old story retold), an earnings report (the account's earnings rules cover those), or anything the stock's newest run line or its own notes already say. An urgent stock names the condition it hits or the catalyst that landed.

- **Context:** saved. A run on the stock reads it.
- **Review:** the stock also goes on its analyst's next run, in the [note to answer](../concepts/situations.md) situation, until a run writes on it.
- **Urgent:** once the brief is saved, a run also starts on the stock, through the account rule **Review if an urgent note names this stock** (Send to Agent), so that run reads this morning's brief. Every stock inherits that rule; it is in Settings → Triggers, and it is never copied onto a stock. A stock a run has written on since the note is skipped. An account set up before the rule existed gets it once, on the next Market Reviewer run; no other rule is added back, and one the owner deletes stays deleted.
- **On the waiting sale:** a stock with a sale waiting is off its analyst's list until the owner decides, so the note is shown on the sale's proposal card instead, under the analyst's note. A note asking for a look at such a stock goes there too, and one about a sale that isn't waiting is context; the tool says when it changed a level.

## What happens next

At 8:00 the morning runs start with the brief at the top. A stock it flagged for review is on its analyst's list with the note above its Activity. A run on a stock reads up to 3 notes naming it, whoever wrote them: the one it is waiting to answer first, then the newest written since the stock's last run line. An urgent note's run is a [trigger run](trigger-runs.md) on that stock, in the note to answer situation. Whatever an analyst decides, the stock's own case and plan decide it.

## Tools

Everything the Market Reviewer can call, read from `lib/agent/modes.ts`.

<!-- asset: tools market -->

<details>
<summary>Technical details</summary>

#### Clock
`lib/inngest/functions/market-reviewer.ts`: `TZ=America/New_York 30 7 * * 1-5`, skips market holidays (`isTradingDay`). The inputs load in their own step, then the run.

#### Inputs
`lib/agent/market-reviewer/inputs.ts`: `INPUTS` (what, source, cap, why), the builders, `renderInputs` and `loadMarketReviewerInputs`. The book's situations and newest run lines come from `loadStockFacts` (`lib/agent/stock-facts.ts`) and `situationsFor`; headlines from Finnhub `/company-news` since `previousReviewAt` (`HEADLINES_PER_STOCK`), asked after the earnings lookups and once more a minute later for any the key refused (about two calls a stock, against Finnhub's 60 a minute); its own notes from `SharedNote` (`OWN_NOTES_DAYS`). Market dates: `lib/market-data/market-calendar.ts`. The VIX and the 10-year: `lib/market-data/cboe-closes.ts`, until the Market and portfolio block's market-numbers loader takes its place.

#### Mode
`market-reviewer` in `lib/agent/modes.ts`: the morning runs' model (`gpt-5.4`), up to 25 steps; the last two can only call `write_market_brief` (`forceBriefAtTheEnd`), so a run always ends with a brief. `web_search` allows it ten searches (`MARKET_REVIEWER_SEARCH_BUDGET`) and no per-stock news search.

#### Run
`lib/agent/market-reviewer/run.ts`: a `ResearchRun` with mode `MARKET_REVIEWER`, no analyst, its inputs on `parameters.facts`; the thread through `saveRunThread`; it stops once `write_market_brief` has saved, then `startUrgentRuns` fires each URGENT stock (also after a failed run, for notes written before the failure) and writes one `urgent_runs` event. `ensureAccountStandingRules` runs first. Prompt, with the levels as its rules: `lib/agent/market-reviewer/prompt.ts`, with the voice rules. The model call is `callReviewer`, with the tools from `reviewerTools`.

#### A run that saves nothing
`scripts/market-reviewer-dry-run.ts` reads the real inputs, makes the same model call with the same tools, and writes everything to a file: the inputs, every tool call, the brief, the digest and each note with its levels. The two saving tools run check only (`dryRun`), no run row is opened, no urgent run starts, and every database write is blocked and listed. Its output is the account's book: it is never committed.

#### Notes
`write_market_note` (`lib/agent/tools/write-market-note.ts`, `NOTE_FIELD_CHARS`, the cited line quoted by `firstWords`) saves a `SharedNote` with author `MARKET_REVIEWER` and `levels` (ticker → CONTEXT, REVIEW, URGENT or PROPOSAL) through `writeSharedNote`. What a run on a stock reads (`notesForRun`), and the note-to-answer situation: `lib/agent/shared-notes.ts` and `lib/agent/stock-context-for.ts`. A fire of the `note` measure codes PINNED_NOTE (`fireCodes`, `lib/agent/situations.ts`). The proposal card's notes: `saleNotes` (`lib/agent/shared-notes.server.ts`), returned by `/api/proposals/[orderId]` and shown by `components/domain/proposal-note.tsx`. An urgent note fires the account rule (measure `note`, `lib/agent/triggers/condition/measures/note.ts`; seeded in `lib/agent/triggers/seed-account.ts`, added to older accounts once from `URGENT_NOTE_RULE_SINCE`) through `fireUrgentNote` (`lib/agent/triggers/urgent-note.ts`), the same `app/thesis.trigger.fired` event the trigger check sends.

#### Storage
`MarketDigest` (account, environment, date, brief, narrative, facts, model, runId), one row per book per day, written by `write_market_brief` (`lib/agent/tools/write-market-brief.ts`). Read by `latestMarketDigest` and `latestMarketBrief` (`lib/agent/market-reviewer/latest.ts`, the brief with `writtenAt`): the homepage card (`components/dashboard/DigestCard.tsx`) and every agent's Market and portfolio block.
</details>
