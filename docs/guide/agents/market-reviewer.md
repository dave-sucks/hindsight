# Market Reviewer

**The market, researched fresh every morning.** At 7:30 every weekday, before the analysts start, one agent researches the market itself and writes the market digest.

It never trades and never changes a stock's plan. You read the digest, and it is the same text the agents will be given once that piece lands.

```facts
Model: gpt-5.4
Starts: 7:30 AM ET, weekdays
Steps: Up to 25
Tools: 5
Saves: the market digest
```

## What it's given

Only three things, so what it says comes from what it found this morning:
- its instructions;
- the portfolio snapshot, the one set of numbers about the account every reader gets: its value, cash, day and since the start, each holding with its price, value, share of the account and moves, the day's fills and the proposals waiting (`lib/portfolio/snapshot.ts`);
- each stock held or watched, with its belief in one line;
- its own last digest, so it says what changed and doesn't repeat itself.

Everything else it finds with its tools: the indexes, the VIX, rates and the sectors (`get_market_context`), the news and the economic calendar for the next two weeks (`web_search`, ten searches), a stock's price and news (`get_stock_data`), and a stock's thesis when a finding touches it (`get_theses`, by ticker, three at most a call: the book is already in its first message).

## What it writes

One market digest, in six sections, each a short paragraph with the pages it rests on: market overview, sector developments, major developments, implications for your portfolio, what deserves attention, upcoming events. About 3,000 characters in all, the sources not counted; a digest past 5,000 is refused, with how much to cut.

- Every number comes from a tool or a page it found in this run.
- Facts come first, each with its source; what they mean follows, starting "My interpretation is…".
- A source is a page one of its searches returned in this run. The save drops any other link and says which. Data from a tool is named in words ("Alpaca market data"), never linked.
- Upcoming events gives the economic calendar's dates for the next two weeks (Fed decisions, CPI, PPI, PCE, the jobs report), each with its source.
- When nothing important changed, it says so instead of forcing a call.
- It doesn't invent a reason for a price move.

## When it runs

At 7:30 AM ET every weekday the market trades, once for each book being traded: an account and environment (paper or live) with an enabled analyst trading in it or a stock held in it. Each is listed in Runs as **Market Reviewer**.

Its run page is read only. **Context** shows what the run started with: its first request to the model, exactly as sent (the instructions, the book and the last digest, and its tool menu). Every tool call and result after it is in the conversation.

## Technical details

`lib/inngest/functions/market-reviewer.ts` (the 7:30 job and the books it runs for), `lib/agent/market-reviewer/run.ts` (its first message, built on `loadPortfolioSnapshot`, and the run), `lib/agent/market-reviewer/prompt.ts` (its instructions), `lib/agent/tools/write-market-digest.ts` (`MarketDigest`, one row per book per day). The run is opened and closed by `runAccountCall` (`lib/runs/account-run.ts`), and its first request is kept by `lib/agent/run-requests.ts`.
