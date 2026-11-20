# Market Reviewer

**The market, researched fresh every morning.** At 7:30 every weekday, before the analysts start, one call to the model researches the market on the web and writes the market digest, plus a note on each held or watched stock its research touched.

It never trades and never changes a stock's triggers. You read the digest, and every agent that decides on stocks is given the same text, in its [Market and portfolio block](portfolio-digest.md#the-portfolio-snapshot), stamped with when it was written. Its notes go on the stocks they name, where you and their analysts read them.

```facts
Model: gpt-5.4
Starts: Weekdays · 7:30 AM ET
Steps: 1 call
Tools: OpenAI's web search
Saves: the market digest, and notes on stocks
```

## What it's given

<!-- asset: context market_reviewer -->

One request, with three things in it:
- its instructions;
- one first message: the date line, then its context: the [market numbers](#the-market-numbers) and the portfolio snapshot, the one set of numbers about the account every reader gets (its value, cash, day and since the start, each holding with its price, value, share of the account and moves, the day's fills and the proposals waiting, `lib/portfolio/snapshot.ts`), under "Market and portfolio"; the book, each stock held or watched with its belief in one line; what each thesis rests on, every stock's assumptions and what would prove it wrong, so it reads news against the thesis and not one sentence of it (`the_cases`, `lib/agent/book.ts`); and its last output, its own notes of the last 5 days (each in a line: the day, the stocks, the impact and effect, the first sentence) and its own last digest, so it says what changed and doesn't repeat itself. A note has no book, so a paper and a live book of the same owner are shown the same notes;
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

A note is evidence for the stock's analyst: the Market Reviewer gives the first read, and the analyst, who knows the whole thesis, decides what it means. A note is written when something happened to a company we hold or watch; most days have few or none, and nothing caps how many. It is one note per event, however many outlets carry it. A story it noted in the last 5 days gets a new note only when something new happened, and the note opens with what. A date that is coming is not a note. One note names several stocks only when the event happened to each. Nothing in code stops a repeat: it is shown what it wrote, and decides. Each note carries:
- the stocks it names, only from the ones it was given;
- its text: what happened and when, with its source, and which line of the thesis it bears on;
- its **impact**, which says how soon the analyst should look and never how far it should change its mind: high when it happened to this company since the last digest and could change what we do today; medium when it bears on the thesis and changes no decision today; low for background on the company or its industry. A report's results are medium at most, because the stock's report trigger already brings its analyst that day;
- its **effect**: its first read of which way the news pushes the thesis, stronger, weaker or neutral. The analyst may rule otherwise.

Each note is saved once, as a shared note to the stocks it names (`SharedNote`, see [Theses](../concepts/theses.md)), with its run and its two fields:
- **High** is pinned for three days. Each stock it names is in the [a note to answer](../concepts/situations.md) situation, so the 8 AM morning run has it on its list and must answer it on that stock, until a run writes on the stock. Its run reads the note above the stock's newest 8 Activity lines.
- **Low and medium** are not pinned: a line in each stock's Activity, read by the next run as one of the stock's newest 8.

In each stock's Activity the note is one line: "Agent note to NVDA, AMD", then its two fields as one signal, the conviction chip's flame only on a high-impact note and Bullish, Bearish or Neutral for stronger, weaker or neutral (`components/domain/note-signal.tsx`). A run reads the same line with the words ("· high impact · weaker"). The line carries that stock's price when the note was saved (kept per stock in `SharedNote.prices`; at 7:30 that is the last close). The paragraph under it is the model's own text, its sources drawn as the citation pill. A note that fails to save never costs the digest.

## When it runs

At 7:30 AM ET every weekday the market trades, once for each book being traded: an account and environment (paper or live) with an enabled analyst trading in it or a stock held in it. Each is listed in Runs as **Market Reviewer**.

The digest is on the home page, on the digest card's **Market** tab (the card opens on whichever digest was written last), and its run is in Runs. The notes its run wrote are listed under it, on the card and under **Agent notes** in its dialog: one row per note, its stocks' chips (each opens the stock) and its signal, high first.

Its run page is read only: your first message, then one line with the searches it made and the tokens the call used (in and out), then the digest, then each note under a title ("Note on NVDA, AMD · high · weaker · flagged for review"). **Context** shows the request exactly as it was sent: the instructions, the first message (the market numbers its own section), and its one tool; the reply's shape is in the raw request.

## Technical details

`lib/inngest/functions/market-reviewer.ts` (the 7:30 job and the books it runs for), `lib/agent/market-reviewer/run.ts` (its run's arguments, `reviewerArgs`: the account as its subject and the stocks its notes may name, `reviewTickers`; its last output, `reviewerLastOutput`; the reply's shape; how its reply reads on the run page, `reviewThread`; its own save, `keepReview`: the `MarketDigest` row, one per book per day, then each note through `writeSharedNote`; which note is pinned (`notePin`); and `REVIEWER_RUN`, how the agent runner runs it: OpenAI's Responses API with its `web_search` tool and the reply's JSON schema, a 20,000-token budget, 600 seconds), its record `MARKET_REVIEWER` in `lib/agent/engine/agents/market-reviewer.ts` (its model, its context list and the reply's schema; `DIGEST_CHARS` is the digest's length, each section a sixth) and its instructions, one document, `market-reviewer.md`, the same on every run. Its context is read for the account by one loader per fact (`lib/agent/context/`: the market numbers, the portfolio, the book and its last output), and the agent engine (`buildAgentRequest`, `lib/agent/engine/build.ts`) builds its request and names each part for the run's Context panel, `lib/agent/shared-notes.ts` (how a note reads on a stock). The market numbers: `lib/market-data/load-market-numbers.ts` (one quotes call, SPY's snapshot row, the earnings calendar against the book) and `lib/market-data/market-numbers.ts` (the numbers and their text). The agent runner (`runAgentAsRun`, `lib/agent/engine/run.ts`) opens the run, makes the call through the AI SDK, and keeps the request (`lib/agent/run-requests.ts`), the thread, the token use and the status.
