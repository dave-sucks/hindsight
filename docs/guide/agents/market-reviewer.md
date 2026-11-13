# Market Reviewer

**The market, researched fresh every morning.** At 7:30 every weekday, before the analysts start, one call to the model researches the market on the web and writes the market digest.

It never trades and never changes a stock's plan. You read the digest, and every agent that decides on stocks is given the same text, in its [Market and portfolio block](portfolio-digest.md#the-portfolio-snapshot), stamped with when it was written.

```facts
Model: gpt-5.4
Starts: 7:30 AM ET, weekdays
Steps: 1 call
Tools: OpenAI's web search
Saves: the market digest
```

## What it's given

One request, with three things in it:
- its instructions;
- one first message: the portfolio snapshot, the one set of numbers about the account every reader gets (its value, cash, day and since the start, each holding with its price, value, share of the account and moves, the day's fills and the proposals waiting, `lib/portfolio/snapshot.ts`), then each stock held or watched with its belief in one line, then its own last digest, so it says what changed and doesn't repeat itself;
- OpenAI's own web search. The model searches as many times as it needs inside that one call, the way ChatGPT does; the app runs no tools and makes no second call.

## What it writes

Its reply is the digest, saved as it wrote it: six sections, each a short paragraph linking the pages it rests on (market overview, sector developments, major developments, implications for your portfolio, what deserves attention, upcoming events). About 3,000 characters, the links not counted.

- Every number comes from the portfolio it was given or a page it found in this run.
- Facts come first, each with its source; what they mean follows, starting "My interpretation is".
- Upcoming events gives the economic calendar's dates for the next two weeks (Fed decisions, CPI, PPI, PCE, the jobs report), each with its source.
- When nothing important changed, it says so instead of forcing a call.

A reply cut off at its limit, or a call that fails, saves nothing; the run is marked failed and says why.

## When it runs

At 7:30 AM ET every weekday the market trades, once for each book being traded: an account and environment (paper or live) with an enabled analyst trading in it or a stock held in it. Each is listed in Runs as **Market Reviewer**.

The digest is on the home page, on the digest card's **Market** tab (the card opens on whichever digest was written last), and its run is in Runs.

Its run page is read only: your first message, then the searches it made in one line, then the digest. **Context** shows the request exactly as it was sent: the instructions, the first message, and its one tool.

## Technical details

`lib/inngest/functions/market-reviewer.ts` (the 7:30 job, the books it runs for, and the save into `MarketDigest`, one row per book per day), `lib/agent/market-reviewer/run.ts` (its first message, built on `loadPortfolioSnapshot`, and the one call, OpenAI's Responses API with its `web_search` tool), `lib/agent/market-reviewer/prompt.ts` (its instructions). The run is opened and closed by `runAccountCall` (`lib/runs/account-run.ts`), and the request is kept by `lib/agent/run-requests.ts`.
