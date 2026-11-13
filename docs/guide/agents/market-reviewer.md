# Market Reviewer

**The market, researched fresh every morning.** At 7:30 every weekday, before the analysts start, one call to the model researches the market on the web and writes the market digest, plus a note on each held or watched stock its research touched.

It never trades and never changes a stock's plan. You read the digest, and every agent that decides on stocks is given the same text, in its [Market and portfolio block](portfolio-digest.md#the-portfolio-snapshot), stamped with when it was written. Its notes go on the stocks they name, where you and their analysts read them.

```facts
Model: gpt-5.4
Starts: Weekdays · 7:30 AM ET
Steps: 1 call
Tools: OpenAI's web search
Saves: the market digest, and notes on stocks
```

## What it's given

<!-- asset: context market-reviewer -->

One request, with three things in it:
- its instructions;
- one first message: the [market numbers](#the-market-numbers), then the portfolio snapshot, the one set of numbers about the account every reader gets (its value, cash, day and since the start, each holding with its price, value, share of the account and moves, the day's fills and the proposals waiting, `lib/portfolio/snapshot.ts`), then each stock held or watched with its belief in one line, then its own notes of the last 5 days (each in a line: the day, the stocks, the impact and effect, the first sentence) and its own last digest, so it says what changed and doesn't repeat itself. A note has no book, so a paper and a live book of the same owner are shown the same notes;
- OpenAI's own web search. The model searches as many times as it needs inside that one call, the way ChatGPT does; the app runs no tools and makes no second call. Its instructions say the market numbers are the index, sector and earnings numbers to use: it searches for what moved them, not for the numbers.

## The market numbers

The market's numbers, written by code, with no view: the same text opens every agent's Market and portfolio block, and `get_market_context` reports the same numbers, from the same function. With made-up prices, it reads:

```
- S&P 500 (SPY) $600.00 −0.50% · Nasdaq 100 (QQQ) $500.00 −0.99%, at Wednesday's close, Nov 11.
- Market risk-on: SPY $603.00, above its 50-day ($590.00) and above its 200-day ($560.00), so full size (as of Tuesday's close, Nov 10).
- Sectors on the day, best to worst: XLU utilities +1.20%, XLE energy +0.80%, … XLK tech −1.40%.
- VIXY, a fund of VIX futures (not the VIX itself): +3.09% on the day.
- Our stocks reporting in the next 14 days: MU (held) Tue, Nov 17 after the close.
```

- **Prices:** the app's one price: live in the session, the close outside it, and how old a price is when it isn't current.
- **The regime:** the one that sizes every buy, SPY against its 50- and 200-day averages, from the 6:30 snapshot, so as of the last close.
- **VIXY** is a fund of VIX futures, reported by its day's move. No plan we hold serves the VIX index.
- **Reports:** the held and watched stocks on the earnings calendar's next 14 days, the same call the trigger check makes. A calendar that can't be read says so, never "none".
- About 850 characters on the live book, Nov 12; the report line grows with the stocks reporting. Anything that can't be read is named in its line, never left out.

## What it writes

Its reply is one JSON object with two parts: the digest and its notes (OpenAI's Structured Outputs, in the same call as the searches).

The digest is saved as it wrote it: six sections (market overview, sector developments, major developments, implications for your portfolio, what deserves attention, upcoming events), each about 500 characters, two to four sentences. About 3,000 characters in all, the links not counted. Nothing in code checks the length; the prompt sets it.

- Every number comes from the portfolio it was given or a page it found in this run.
- Facts come first; what they mean follows, starting "My interpretation is".
- Each fact's link sits right after that fact and goes to the page it came from: never a paragraph's links gathered at its end, never one page for several stories.
- Upcoming events is a short list: the economic calendar's dates for the next two weeks (Fed decisions, CPI, PPI, PCE, the jobs report), one line each with its link.
- When nothing important changed, it says so instead of forcing a call.
- A proposal waiting for your approval is your call: it says nothing for or against one, its timing or its size, in the digest or a note. News on that stock is still news.

A reply cut off at its limit, a reply that isn't the digest and its notes, or a call that fails saves nothing; the run is marked failed and says why.

## Its notes

A note is written only when the day's research touches why we own or watch a stock; most days have few or none, and nothing caps how many. One note may name several stocks that share a story. A story it noted in the last 5 days gets a new note only when something new happened, and the note says what. Nothing in code stops a repeat: it is shown what it wrote, and decides. Each note carries:
- the stocks it names, only from the ones it was given;
- its text: what happened, with its source, and what it means for these stocks;
- its **impact**: high when it could change a decision to buy, sell, add or trim; medium when it matters but changes no decision today; low when it is only worth remembering;
- its **effect**: stronger, weaker or neutral, for the reason we own or watch the stock.

Each note is saved once, as a shared note to the stocks it names (`SharedNote`, see [Theses](../concepts/theses.md)), with its run and its two fields:
- **High** is pinned for three days. Each stock it names is in the [pinned note to answer](../concepts/situations.md) situation, so the 8 AM morning run has it on its list and must answer it on that stock, until a run writes on the stock. Its run reads the note above the stock's newest 8 Activity lines.
- **Low and medium** are not pinned: a line in each stock's Activity, read by the next run as one of the stock's newest 8.

In each stock's Activity the note is one line, titled with who wrote it and its two fields ("Agent note to NVDA, AMD · high impact · weaker"), with that stock's price when the note was saved (kept per stock in `SharedNote.prices`; at 7:30 that is the last close). The paragraph under it is the model's own text, its sources drawn as the citation pill. A note that fails to save never costs the digest.

## When it runs

At 7:30 AM ET every weekday the market trades, once for each book being traded: an account and environment (paper or live) with an enabled analyst trading in it or a stock held in it. Each is listed in Runs as **Market Reviewer**.

The digest is on the home page, on the digest card's **Market** tab (the card opens on whichever digest was written last), and its run is in Runs.

Its run page is read only: your first message, then one line with the searches it made and the tokens the call used (in and out), then the digest, then each note under a title ("Note on NVDA, AMD · high · weaker · flagged for review"). **Context** shows the request exactly as it was sent: the instructions, the first message (the market numbers its own section), and its one tool; the reply's shape is in the raw request.

## Technical details

`lib/inngest/functions/market-reviewer.ts` (the 7:30 job, the books it runs for, the save into `MarketDigest`, one row per book per day, and then each note through `writeSharedNote`), `lib/agent/market-reviewer/run.ts` (its first message, built on `loadMarketNumbers` and `loadPortfolioSnapshot`, the reply's shape, which note is pinned (`notePin`), and the one call, OpenAI's Responses API with its `web_search` tool), `lib/agent/market-reviewer/prompt.ts` (its instructions; `DIGEST_CHARS` is the digest's length, each section a sixth), `lib/agent/shared-notes.ts` (how a note reads on a stock). The market numbers: `lib/market-data/load-market-numbers.ts` (one quotes call, SPY's snapshot row, the earnings calendar against the book) and `lib/market-data/market-numbers.ts` (the numbers and their text). The run is opened and closed by `runAccountCall` (`lib/runs/account-run.ts`), and the request is kept by `lib/agent/run-requests.ts`.
