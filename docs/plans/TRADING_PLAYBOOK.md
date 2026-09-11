# The trading playbook — how disciplined traders actually make money

> **What this is.** The reference the Hindsight analysts will be rebuilt
> from: how professional discretionary and systematic stock traders find
> names, decide what kind of trade a stock is, write the plan, set the
> numbers on the plan, size it, manage it and sell it. Written 2026-09-10
> from published sources (linked inline) plus standard practice. Plain
> language. Where the evidence is weak I say so.
>
> **How to read it.** Part A is the truth about edge. Part B is the loop
> every pro runs. Part C is market regime. Part D is the setup catalog, the
> "patterns for different types of buys." Part E is how the numbers on a
> plan are set. Part F is selling. Part G is what a thesis is. Part H maps
> every concept onto what Hindsight has today. The companion plan,
> `AGENT_REBUILD.md`, turns Part H into PRs.

---

## Part A — What edge actually is

A trading strategy is a business with four numbers: **how often it wins,
how big the average win is, how big the average loss is, and how
consistently it sizes.** Everything else is decoration. A 45% win rate with
winners 2.5× the size of losers is a good business. A 75% win rate with one
−30% blow-up every ten trades is a bad one. The single most-cited finding on
this: in a study Van Tharp used for years, *how much was risked per trade*
explained 91% of the variation in portfolio results
([Van Tharp Institute](https://vantharpinstitute.com/van-tharp-teaches-position-sizing-strategies-and-risk-management/)).

Documented, repeatable sources of edge in US stocks, in rough order of how
well they hold up:

| Edge | What it is | Evidence |
|---|---|---|
| **Post-earnings drift** | After a strong beat, prices keep drifting the same way for weeks | Bernard & Thomas; still measurable though shrinking ([Quantpedia](https://quantpedia.com/strategies/post-earnings-announcement-effect), [ScienceDirect review](https://www.sciencedirect.com/science/article/pii/S2214635020303750)) |
| **Momentum / 52-week high** | Stocks near their 52-week high with strong 3–12 month returns keep outperforming | George & Hwang 2004: roughly twice the return of plain momentum; works in 18 of 20 markets ([ResearchGate](https://www.researchgate.net/publication/4992688_The_52-Week_High_and_Momentum_Investing), [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0261560610001099)) |
| **Estimate revisions** | Stocks whose earnings estimates are being raised outperform | The whole Zacks Rank system; #1-rank stocks ~+24%/yr since 1988 ([Zacks](https://www.zackstrade.com/wp-content/uploads/2024/08/zacks-rank-guide-2022-09.pdf)) |
| **Insider cluster buying** | Three or more insiders buying on the open market within a month | Lakonishok & Lee: +4.8% over 12 months; clusters ≈ 2× solitary buys ([2iQ](https://www.2iqresearch.com/blog/what-is-cluster-buying-and-why-is-it-such-a-powerful-insider-signal), [Form4API](https://www.form4api.com/guides/cluster-buy-signals)) |
| **Trend filter** | Only own stocks / the market above the 200-day average | Faber 2012: 2008 drawdown cut from >40% to ~12%; Siegel on the Dow since 1900 ([Faber paper](https://www.trendfollowing.com/whitepaper/CMT-Simple.pdf)) |
| **Quality compounders** | High return on capital, high stable gross margin, strong free cash flow, reinvested | Fundsmith's record: portfolio ROCE 32% vs 16% index, gross margin 64% vs 45% ([investinassets](https://www.investinassets.net/p/how-terry-smith-beats-the-market)) |
| **Event risk premium** | Pre-catalyst run-ups; approval base rates | ~68% of PDUFA decisions approve; 6–8 weeks-before run-up is a known pattern ([BiopharmaWatch](https://www.biopharmawatch.com/blog/biotech-catalyst-trading-hedge-funds-insiders-fda-decisions), [Merlintrader](https://www.merlintrader.com/run-up-biotech/)) |

What is **not** edge on its own: a headline, an analyst price target, a
single indicator (RSI alone, a moving-average cross alone), a Fibonacci
level alone (studies find standalone Fibonacci levels perform no better than
random; they matter only where they coincide with structure — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0957417421012495),
[The Bull](https://thebull.com.au/technical-analysis/fibonacci-retracement-guide/)),
or "the chart looks good." Every setup in Part D is a **combination**: a
trend condition, a structure, a trigger, a confirmation, and a plan.

---

## Part B — The loop every professional runs

Discretionary or systematic, the process is the same nine steps, and the
decisive fact is that **the whole plan is written before the trade, and the
plan is a set of conditions** — which is exactly what a trigger ladder is.
Hindsight's framework is right. Its vocabulary is thin.

1. **Universe.** What you're allowed to trade: liquidity floor (dollar
   volume), price floor, market-cap band, sectors. Fixed, boring, enforced.
2. **Screen.** Numbers filter the universe to a shortlist: relative
   strength, distance from the 52-week high, volume surge, earnings
   surprise, revisions, insider buys, quality metrics. No reading yet.
   Qullamaggie's whole discovery is "the top 1–2% of stocks by 1-, 3- and
   6-month return" ([Qullamaggie](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)).
3. **Setup recognition.** For each survivor: which pattern is this, if any?
   Base breakout, pullback, earnings gap, pre-catalyst, accumulation. A stock
   that fits no setup is not a trade today, however good the story.
4. **Thesis.** Why it goes up, what the market is missing, what event makes
   the market agree, what would prove it wrong, by when. (Part G.)
5. **Plan.** Entry condition(s), stop, target, size, management rules, time
   limit. Written as conditions. The setup dictates the shape; the chart
   dictates the numbers. (Parts D and E.)
6. **Trigger and confirm.** The condition fires; the trader confirms
   (volume, close, no contradicting news) and executes, or passes and says
   why. Chasing more than a few percent past the entry is a rule
   violation, not a judgment call.
7. **Manage.** Add only on strength and only to winners; raise the stop as
   the trade proves itself; take partial profits where the setup says to.
8. **Exit.** By the plan: stop, trail, target, time, or invalidation. Not
   by mood.
9. **Post-mortem by setup.** Win rate, average gain in units of risk, hold
   time, give-back — per setup type. This is how thresholds get tuned.

---

## Part C — Regime: the market decides what you're allowed to do

The single cheapest improvement to any stock strategy is not buying
breakouts in a falling market. Faber's rule (own the index above its
10-month/200-day average, cash below) cut the 2008 drawdown from over 40% to
about 12% ([Faber](https://www.trendfollowing.com/whitepaper/CMT-Simple.pdf)).
Minervini's whole method starts with the market in a "Stage 2" uptrend.
O'Neil counts "distribution days" (down days on rising volume): four or
five in four weeks means the market is under pressure.

A practical regime rule, computed every morning from SPY and the book:

| Regime | Condition | What changes |
|---|---|---|
| **RISK_ON** | SPY above a rising 50-day and 200-day; ≥ 60% of the book's names above their 50-day | Full size, all setups |
| **CAUTION** | SPY below the 50-day, above the 200-day; or 4+ distribution days in 4 weeks | Half size on new entries; **no breakout entries** (they fail most here); pullback and event setups only |
| **RISK_OFF** | SPY below the 200-day | New longs only for event trades and mean-reversion; raise all trails |

Sector regime matters the same way: O'Neil's "L" is buy leaders in
**leading groups**; a stock's relative-strength line against SPY should be
rising into the entry ([TraderLion CANSLIM](https://traderlion.com/trading-strategies/canslim/)).

---

## Part D — The setup catalog

Each setup below is written the way a desk would write it: what it is, why
it works, how to find it, the **entry trigger as conditions**, how the stop
and target are set, size, management, time limit, and what failure looks
like. "Trigger vocabulary" notes what Hindsight can express today.

### D1. Base breakout (Minervini VCP / O'Neil cup-with-handle / flat base)

- **What.** A stock in a Stage 2 uptrend consolidates for 4–8+ weeks in a
  tightening range under a clear ceiling (the *pivot*), then breaks out on
  heavy volume. Minervini's Trend Template is the precondition: price above
  the 150- and 200-day, 200-day rising ≥ 1 month, 50-day above both, price
  ≥ 25–30% above the 52-week low, within 25% of the 52-week high, relative
  strength rank ≥ 70 ([ChartMill](https://www.chartmill.com/documentation/stock-screener/technical-analysis-trading-strategies/496-Mark-Minervini-Trend-Template-A-Step-by-Step-Guide-for-Beginners)).
  The VCP itself: 2–6 pullbacks inside the base, each smaller than the last
  (e.g. 20% → 10% → 5%), volume drying up into the pivot ([TraderLion](https://traderlion.com/technical-analysis/volatility-contraction-pattern/)).
- **Why it works.** Supply is exhausted (sellers are done), and the
  breakout on volume is institutions buying with size.
- **Screen.** Trend Template true; base length ≥ 20 days; base depth ≤
  ~25% (≤ 15% for a flat base); last contraction ≤ ~5–8%; volume in the
  final week below the 50-day average; earnings ≥ 10 days away.
- **Entry trigger.** Price crosses the pivot + a small buffer (O'Neil: 10¢;
  Minervini: 5–10¢) **on volume ≥ 1.4–1.5× the 50-day average** ([Fidelity](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/cup-with-handle)).
  Swing traders prefer a **close** above the pivot; the intraday cross alone
  is false roughly half the time ([Collin Seow](https://collinseow.com/breakout-confirmation/)).
  **Chase limit: do not buy more than 5% above the pivot** ([FinWiz](https://finwiz.io/day-trading/canslim)).
  In vocabulary: `AND[PRICE_ABOVE(pivot) basis=close, VOLUME_RATIO ≥ 1.5]`
  with a ceiling `PRICE_BELOW(pivot × 1.05)`. Today: price only, intraday
  only, no volume.
- **Stop.** Below the low of the last contraction, or below the base low
  if that's within 7–8%. O'Neil's hard rule: cut at 7–8% loss, because
  correctly bought leaders "rarely retrace more than 7–8%" ([ChartMill](https://www.chartmill.com/documentation/trading-and-investing/methodologies/527-William-ONeils-7-8-Sell-Rule-Explained)).
  Cross-check against volatility: a stop closer than ~1 ATR is inside noise.
- **Target.** Measured move: base depth added to the pivot ([StockCharts](https://articles.stockcharts.com/article/stockcharts-insider-measured-moves-and-the-art-of-setting-price-targets/)),
  or the next prior high. Must be ≥ 2R; 3R is O'Neil's design (7–8% stop,
  20–25% target).
- **Size.** Risk-based (Part E). Qullamaggie: positions 10–20% of account,
  risk 0.25–1% of account per trade.
- **Manage.** Move the stop to breakeven once up ~1R. Sell part into
  strength at +20–25% unless the stock gains 20% within 3 weeks of the
  breakout — then hold ≥ 8 weeks (O'Neil's "8-week rule" for leaders)
  ([Medium/MarketSmith](https://medium.com/@socialmedia_96459/selling-right-how-oneil-mastered-selling-4d5b7770119e)).
  Trail the rest under the 21-day EMA (trade) or 50-day (position).
- **Time.** A breakout that hasn't made progress in 10–20 trading days is
  a failed breakout; exit or re-set.
- **Failure looks like.** Closes back below the pivot within days on
  volume; volume on the breakout day below average; a breakout into
  earnings week.

### D2. Momentum-leader flag (Qullamaggie breakout)

- **What.** The stock already made a big move (30–100%+ over 1–3 months),
  pulls back in an orderly way with higher lows and a tightening range,
  and "surfs" its rising 10- and 20-day moving averages. The next leg
  starts when the range expands upward ([Qullamaggie](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)).
- **Screen.** Top 1–2% of the universe by 1-, 3- and 6-month return;
  average daily range (ADR) ≥ 3–5% ([Deepvue](https://deepvue.com/screener/qullamaggie-screens/));
  price above the 10/20-day; dollar volume high enough to fill the seat's
  size.
- **Entry trigger.** Break of the flag high on the daily chart (or the
  opening-range high intraday for those who can), on volume.
  Vocabulary: `AND[PRICE_ABOVE(flag high) basis=close, VOLUME_RATIO ≥ 1.5]`
  or `NEW_HIGH(20d)`.
- **Stop.** Low of the entry day; never wider than one ADR. If the
  structure forces a wider stop, the position is smaller, not the stop
  wider.
- **Target / manage.** No fixed target. Sell one-third to one-half after
  3–5 days of progress, move the stop to breakeven, trail the rest on the
  10-day (aggressive) or 20-day (patient) moving average; exit on the first
  **close** below it.
- **Time.** If it hasn't moved in 3–5 days, it's wrong; exit.
- **Fits.** A TRADE horizon. Not the Compounder.

### D3. Episodic pivot / earnings gap (Qullamaggie EP, O'Neil buyable gap-up)

- **What.** A neglected stock (flat or down for 3–6 months) gaps up 10%+
  on an unexpected catalyst — an earnings blow-out with big growth numbers,
  an approval, a contract — on volume many times average, ideally 10×
  ([Trading Research Hub](https://www.tradingresearchub.com/p/research-article-44-kristjan-kullamagis)).
  These start multi-month moves because institutions need weeks to build
  positions.
- **Why it works.** A genuine repricing; breakaway gaps on earnings fill
  within a month less than 30% of the time, versus 70–75% for ordinary
  gaps ([StockAlarm](https://pro.stockalarm.io/blog/stock-gap-up-gap-down-explained)).
- **Screen (daily, 7:45 ET and 9:45 ET).** Gap ≥ 8–10% at the open; volume
  pace ≥ 3× (pre-market or first 15 minutes); EPS and revenue growth
  mid-double-digit or better; the stock has **not** already run 30%+ in
  the prior 3 months; market cap and liquidity floors.
- **Entry trigger.** Break of the day-1 high (the opening-range high for an
  intraday desk; for Hindsight's once-a-day cadence, a close above the
  gap-day high or a hold above the gap-day midpoint on day 2). Vocabulary:
  `GAP_UP{minPct: 8, minVolRatio: 3}` then `PRICE_ABOVE(day-1 high)`.
- **Stop.** Low of the gap day. A close below the gap's midpoint is an
  early warning; a filled gap is invalidation.
- **Manage.** Same as D2: partial at 3–5 days, trail the 10/20-day.
- **Fits.** TRADE or TARGET horizon; the PEAD seat's aggressive cousin.

### D4. Post-earnings drift (PEAD, the fundamental version)

- **What.** A clean beat-and-raise that the market under-reacts to; the
  stock drifts for weeks. This is the PEAD seat's mandate and its prompt
  already states the rules correctly.
- **Screen (daily after the calendar updates).** Reported in the last 1–3
  sessions; EPS surprise ≥ 5% and revenue beat; guidance raised (needs the
  release or transcript — a web search per candidate is acceptable);
  reaction-day volume ≥ 2× the 20-day average (one study uses 2.8×;
  [DayTrading.com](https://www.daytrading.com/post-earnings-announcement-drift-pead-strategy));
  gap held (closed in the upper half of the day's range); **not** already
  up 10%+ past the gap — most of the edge is gone.
- **Entry trigger.** Day 1–3 after the print, above the gap-day low, and
  ideally on the first pullback that holds. Vocabulary:
  `AND[EARNINGS_SINCE 1..3, PRICE_ABOVE(gap-day low)]`, or simply
  **buy now** on day 1–2 when the screen passes. This is the setup where
  "the condition is already true today" is the normal case.
- **Stop.** The gap-day low (the market's own line), or −8% from entry,
  whichever is tighter but not inside 1 ATR.
- **Target / time.** Hold 30–60 days; the drift decays, with one source
  putting the bulk of it inside ~20 sessions ([StockAlarm](https://pro.stockalarm.io/blog/earnings-momentum-strategy)).
  Target the prior high or a measured move; take partial profits at 2R;
  **exit before the next print**.
- **The reaction rule.** A beat that gaps *down*, or a beat with flat or
  vague guidance, is the strongest fade signal in earnings trading — the
  market wanted more ([TradingView/Zacks](https://www.tradingview.com/news/zacks:0779a4a9f094b:0-earnings-beats-and-stock-drops-why-the-reaction-matters-more-than-the-number/)).
  Never buy a beat the market sold. On a held name, a beat-and-drop is a
  review-or-exit, not a hold.
- **Follow-through.** Day 2–3 is the cleaner read; rising revision breadth
  in the 1–10 days after the print extends the drift.

### D5. Pullback to a rising moving average (Weinstein Stage 2 / trend pullback)

- **What.** A stock in a confirmed uptrend (price above a rising 30-week /
  150-day, higher highs and higher lows, relative strength rising) pulls
  back to its 20- or 50-day average, or to 38–62% of its last up-leg, and
  resumes ([TraderLion Stage Analysis](https://traderlion.com/trading-strategies/stage-analysis/)).
- **Why it works.** Buying the trend at a discount with a natural stop;
  the moving average is where institutions re-buy.
- **Screen.** Trend Template true; price within 2–3% of the 20- or 50-day;
  relative strength vs SPY positive over 3 months; pullback on
  below-average volume (healthy) not above (distribution).
- **Entry trigger.** The reversal: a close above the prior day's high, or a
  reclaim of the average touched. Vocabulary: `NEAR_SMA{50, within 2%}` as
  the arming condition, then `PRICE_ABOVE(prior-day high) basis=close`.
  This is the entry that buys a stock that "never dips 10%" — MSFT dipped
  to its 50-day repeatedly on the way from $418 to $497.
- **Stop.** Under the pullback low (the swing low), checked ≥ 1 ATR from
  entry. A close below the 50-day on volume invalidates.
- **Target.** The prior high first (partial), then the measured move.
- **Fits.** TARGET and COMPOUNDER; the Compounder's own rule 5 names this.

### D6. Mean-reversion bounce in an uptrend (Connors RSI-2)

- **What.** A stock above its 200-day average has a sharp 2–5 day flush
  (RSI(2) under 5–10); it snaps back within 1–5 days ([QuantifiedStrategies](https://www.quantifiedstrategies.com/rsi-2-strategy/)).
- **Rules.** Trend filter: above the 200-day. Buy the close when RSI(2)
  < 5 (or < 10). Exit on a close above the 5-day average or RSI(2) > 65.
  Win rate 65–75%, small average gains, no fixed stop in the original
  (time and the 200-day are the stops).
- **Fits.** A short TRADE horizon or a **scale-in rule** for a held
  compounder ("add on a 2-day flush to the 20-day in an uptrend"). Not a
  primary seat today.

### D7. 52-week-high / relative-strength momentum

- **What.** A screen more than a setup: rank stocks by price ÷ 52-week
  high and by 3–12 month return vs the market; the top decile keeps
  outperforming for up to 12 months ([George & Hwang](https://www.researchgate.net/publication/4992688_The_52-Week_High_and_Momentum_Investing)).
  Momentum is *negative* under 1 month and beyond 3 years — the window
  matters.
- **Use.** Feeds D1/D2/D5: the screen says which names, the setups say
  when. Vocabulary: `PCT_FROM_52W_HIGH ≤ 5%` and `RS_VS_SPY{3M} > 0`.

### D8. Pre-catalyst run-up (PDUFA and dated binaries)

- **What.** A dated FDA decision, trial readout or ruling. Two ways to
  trade it: **the run-up** (buy 6–8 weeks before, sell 1–2 weeks before,
  typically +20–40%, never holding through the coin flip — [Merlintrader](https://www.merlintrader.com/run-up-biotech/))
  or **hold-through** at a size that survives a −60% gap.
- **Screen.** Catalyst 4–10 weeks out; prior advisory-committee vote
  positive if one happened (the FDA follows it the vast majority of the
  time); cash runway past the decision; for sub-$1B single-asset names,
  supplemental approvals and label expansions only (the Catalyst seat's own
  rule).
- **Entry trigger.** A technical entry inside the window (D1 or D5 shape),
  never the day before the event. Vocabulary: a catalyst-window predicate
  (`DAYS_TO_CATALYST 14..70` off `catalystDate`, or `EARNINGS_WITHIN` when
  the catalyst is the print) composed with the technical entry.
- **Stop.** Structural but advisory: gaps skip stops. **Size is the stop.**
- **Size.** If a −50% gap would cost more than 0.5% of equity, the position
  is too big. Base rate ~68% approval, but that is not this drug's odds.
- **Exit.** The run-up version sells 1–2 weeks before. The hold-through
  version exits at the event or T+30. Both are already how the Catalyst
  seat is written; the sizing enforcement is what's missing.

### D9. Insider cluster buying

- **What.** Three or more insiders buying on the open market within ~30
  days, ideally including independent directors. Predicts positive
  abnormal returns over 6–12 months; roughly double the effect of a single
  buy; stronger in small and mid caps ([2iQ](https://www.2iqresearch.com/blog/what-is-cluster-buying-and-why-is-it-such-a-powerful-insider-signal)).
- **Use.** A screen and a conviction input, combined with a technical
  entry (D1 or D5). Vocabulary: `INSIDER_CLUSTER{minBuyers: 3, days: 30}`
  computed from Form 4 data (Finnhub insider transactions). Stop: below the
  lowest insider purchase price or −12%, whichever is tighter (the Insider
  archetype already says this).

### D10. Estimate-revision momentum

- **What.** Names whose consensus EPS estimates rose in the last 30 days,
  especially right after a print. The Zacks Rank in one line ([Zacks](https://www.zacks.com/research/screening-education/7753)).
- **Use.** A screen and a confirmation for D4: revisions up within 72 hours
  of the print is the PEAD seat's third signal, and today it cannot check
  it. Vocabulary: `ESTIMATE_REVISION{direction: UP, days: 30}` — vendor
  permitting (Finnhub's EPS-estimate history; part of the DAV-239
  decision).

### D11. Compounder accumulation (Fundsmith / Buffett quality, Minervini entry)

- **What.** A business that will be structurally more valuable in 3–5
  years, bought at conviction size and held through volatility. The
  Secular Compounder's mandate.
- **Quality screen.** Return on invested capital > 20% (and above its cost
  of capital for years); gross margin high and stable for its industry;
  free-cash-flow margin ≥ 15%; high reinvestment rate at high incremental
  returns; low capital intensity; management aligned ([Compounding Quality](https://www.compoundingquality.net/p/my-quality-investment-philosophy),
  [investinassets](https://www.investinassets.net/p/identifying-quality-compounders)).
  Judge against the company's own industry norms.
- **Entry trigger — confirmation, not hope.** First tranche on whichever
  comes first: a base breakout (D1), a reclaim of the 50-day, or a pullback
  that holds the 50-day (D5). A stock at new highs on a working thesis is
  working, not "extended." If no pullback comes within 30 days in an
  uptrend, take the breakout. Vocabulary: `OR[breakout condition, NEAR_SMA
  50 + reversal, VS_SMA 50 reclaim]` plus **buy now** when one is already
  true.
- **Tranches.** First tranche 50% of target size; second on strength (+7%
  from the first fill, or a new high after a pause) or on a held pullback
  to the 50-day in a market-wide dip with the thesis intact. Never add into
  company-specific bad news.
- **Stop.** Thesis invalidation, named in advance (guidance cut ×2, margin
  break, capital-allocation failure). Price alarms are *reviews*: a close
  below the 200-day; a 15% give-back from the high. A **catastrophe line**
  at 20–25% off the high is the only automatic sale.
- **Target.** A 3–5 year valuation case; trims only at valuation extremes.
- **Time.** A 60-day business checkpoint ("is what I said would happen
  starting to happen?"), never a time stop.

### D12. Sector and theme rotation

- **What.** Stocks move in groups; leadership rotates. Buy the leader in a
  leading group; avoid the best chart in a lagging group. Groups are
  Leading / Weakening / Lagging / Improving by their relative strength vs
  SPY and its slope ([TradingView RRG](https://www.tradingview.com/script/JjGd88I8-US-Sector-Industry-Rotation-Performance/)).
- **Use.** A screen input (`GROUP_RS{rank ≥ 70}`) and a regime input for
  the daily run: "three of your names are in a group that just turned
  Lagging" is a review trigger.

### D13. Unscheduled news — how it is graded and traded

News is not a setup; it is an input that either **creates** a setup (D3),
**confirms** one (guidance raise on a D1 name), or **kills** one. Pros grade
it by type and by surprise, then look at the reaction, not the headline
([Benzinga Pro](https://www.benzinga.com/pro/blog/trading-news-events-how-to-build-a-catalyst-driven-strategy-with-benzinga-pro)):

| Tier | Examples | What a trader does |
|---|---|---|
| **Tier 1 — repricing** | Guidance raise or cut; M&A offer; FDA approval or rejection; a contract worth a large share of revenue; a short-seller report; a dilutive secondary | Long side: treat a positive one as a D3 candidate *if the reaction confirms* (gap holds, volume). Negative: on a held name, exit or tighten the same day; a dilutive offering is a sell, not a dip. |
| **Tier 2 — attention** | Analyst upgrade / price-target raise; index inclusion; partnership; product launch | Confirmation for an existing setup; never an entry by itself. Upgrades are best used as "estimates are moving" evidence for D4/D10. |
| **Tier 3 — noise** | Commentary, aggregator pieces, "shares rose as…" | Ignored. This is what the old signal pipeline routed. |

Two rules govern all of it. **The reaction is the information:** a "good"
headline the stock sells is bad news; a "bad" headline the stock holds is
priced in. **Magnitude scales with surprise, float and positioning**, which
is why the same headline moves a neglected small cap 40% and a crowded
mega-cap 2%.

---

## Part E — Setting the numbers on a plan

The methodology Dave asked for: not "pick a price," but how each number is
derived. A plan has six numbers. Each has a rule.

### E1. The entry level

| Setup | The level | Buffer | Basis | Confirmation |
|---|---|---|---|---|
| Base breakout | The pivot: high of the handle / last contraction | +10¢ or +0.1–0.3% | Close (swing) or intraday cross + volume | Volume ≥ 1.5× 50-day avg; ≤ 5% above the pivot |
| Flag | The flag high | +0.1–0.3% | Close or opening-range high | Volume; above the 10/20-day |
| Earnings gap | Day-1 high (or the gap-day midpoint on day 2) | — | Close | Gap held; volume ≥ 3× |
| PEAD | Above the gap-day low, days 1–3 | — | Now | Surprise ≥ 5%, revenue beat, guide up |
| Pullback | Prior-day high after touching the 20/50-day | — | Close | Pullback on light volume; RS intact |
| Compounder | Whichever of the above comes first | — | Close | Thesis intact |
| Pre-catalyst | A technical entry inside the 4–10 week window | — | Close | Never day-before |

**Buy now** is legal whenever the condition is already true and the price
is inside the chase limit. It is the normal case for PEAD and for a
compounder whose confirmation came last week.

### E2. The stop

1. Start from **structure**: the base low, the last contraction low, the
   pullback swing low, the gap-day low, the entry-day low.
2. Check it against **volatility**: the distance must be at least ~1 ATR(14)
   and, for trades, no more than ~1 ADR (Qullamaggie) or 7–8% (O'Neil). If
   structure demands a wider stop than the rule allows, **shrink the
   position**, don't widen the stop.
3. Check it against **the setup's time**: a TRADE stop that isn't tested in
   10–20 days is replaced by a time exit.
4. On a held position the stop **only rises** (Hindsight's ratchet rule).
   Standard raises: to breakeven at +1R; under the 21-day EMA once the
   trend is established; to lock ~50% of the gain after +20%.

### E3. The target

Best when two methods agree:

- **Measured move**: pattern height added to the breakout point (cup
  depth, base height, flag pole).
- **Prior high / resistance**: the last swing high, the 52-week high.
- **Risk multiple**: ≥ 2R minimum (Hindsight enforces this); 3R is the
  O'Neil design; flags and EPs target 5–10R with trails, not fixed targets.
- **Fibonacci extension** (1.272×, 1.618× of the last leg) as a third
  candidate, used only when it coincides with one of the above.
- **Analyst consensus target**: a sanity check on magnitude, never the
  target.

A target is where the plan is **reviewed**, not automatically sold, except
for TRADE-horizon partials.

### E4. Position size

    risk $ = equity × risk%
    shares = risk $ ÷ (entry − stop)

- risk% by conviction: LOW 0.25–0.5%, MEDIUM 0.5–0.75%, HIGH 0.75–1%,
  STRONG 1–1.25%. Binary catalysts: half, and cap the loss on a −50% gap at
  0.5%.
- Clamp to the seat's band (smallest / largest trade). A stop so tight the
  formula exceeds the band means the band wins; a stop so wide the formula
  falls under the smallest trade means **skip**, don't oversize.
- **Portfolio heat** (sum of open risk if every stop hits) ≤ 6% of equity
  (Elder's rule; 3% conservative, 10% aggressive — [Swingfolio](https://swingfolio.com/education/level-4-risk-money-management/portfolio-heat-and-correlation)).
  At the cap, no new entries.
- **Correlation**: no more than two positions in one industry group; ≤ 30%
  of heat in one sector. Three semiconductor longs are one bet.
- **Single name**: ≤ 15–20% of equity at cost, including adds.

### E5. The trail

| Horizon | Trail |
|---|---|
| TRADE | Close below the 10- or 20-day MA, or a chandelier stop 2–3 ATR under the 22-day high ([StockCharts](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/chandelier-exit)) |
| TARGET | Armed after +10%: max(3 ATR, 12–15%) under the high, or a close under the 21-day EMA |
| CATALYST | The structural stop until the event; the event is the exit |
| COMPOUNDER | No automatic sale under 20–25%; 15% give-back and a close under the 200-day are **reviews** |

The trail is the reason winners get to run; the 8% flat trail on a
position trade is the reason HPE and PRAX gave back 16–17 points.

### E6. The time limit

| Setup | Limit |
|---|---|
| Breakout / flag | 10–20 trading days without progress → exit or re-set |
| Earnings gap | Partial at 3–5 days; the trail decides the rest |
| PEAD | 30–60 days; out before the next print |
| Pullback | 10 days to reclaim the prior high, else review |
| Pre-catalyst | The event, or T+30 |
| Compounder | 60-day business checkpoint (a review) |
| **A buy level that hasn't filled** | Re-price after 20 trading days; a level parked for four months is a decision nobody made |

---

## Part F — Selling

The rules that separate a trader from a hoper, by horizon.

**Trades (D1–D4).** Cut at 7–8% or the structural stop, no exceptions.
Sell part into strength at +20–25%, unless the stock did +20% in ≤ 3 weeks
from the breakout — then hold 8 weeks minimum. Sell on a **climax top**
(vertical move on the heaviest volume in months, or the biggest one-day
gain of the move), on a close below the 50-day on heavy volume, on a
failed breakout, or when rallies come on fading volume ([O'Neil's 15 rules](https://x.com/IManghaila/status/2066477677947543634)).
Never average down: "only losers average losers."

**Position trades (D5, D8).** The plan's stop and trail; the prior high as
a partial; the catalyst as the exit.

**Compounders (D11).** Only a named invalidation sells. Price alarms open a
review with one question: is the reason we bought still true? Trim on
valuation extremes. The 25% catastrophe line is the one automatic sale.

**Every sale answers "did the story break or did the price?"** Hindsight
already asks this (`belief_survived`); the answer decides whether the name
goes back on watch with a re-entry plan.

---

## Part G — What a thesis is

The institutional shape, whichever seat writes it ([MidhaFin](https://www.midhafin.com/equity-investment-thesis),
[Street of Walls](https://www.streetofwalls.com/finance-training-courses/hedge-fund-training/hedge-fund-case-study/)):

1. **Business quality** in two lines.
2. **The key driver** — the one number that decides whether this works
   (datacenter revenue, gross margin, approval).
3. **Variant view** — what the market believes, what you believe
   differently, why it matters to value. If you can't state it, conviction
   is MEDIUM at best (Hindsight already enforces this).
4. **Valuation / upside** — where it trades if you're right, with a number.
5. **Catalyst and clock** — the event that makes the market agree, and by
   when. A catalyst two quarters late is evidence, not patience.
6. **Kill criteria** — 2–3 falsifiable trip-wires, named in advance.
7. **The setup** — which of D1–D12 this is, and therefore the plan shape.
8. **The plan** — entry condition(s), stop, target, size, trail, time limit
   (Part E), written as triggers.

Expected value in one line: `p(right) × upside − p(wrong) × downside`. A
thesis with a great story and 1.2R is not a trade; a boring one at 4R with a
dated catalyst is.

---

## Part H — Mapping the playbook onto Hindsight

| Concept | Today | Gap |
|---|---|---|
| Universe fence (sectors, cap, exclusions) | Yes (`AgentConfig`) | Add a liquidity floor (dollar volume) |
| Screens by numbers | **No** — discovery reads headlines, movers, a calendar; cron off since 05-31 | Deterministic screens per setup |
| Trend Template / regime | **No** | Compute from bars daily; regime rule in the daily run and `place_trade` |
| Relative strength vs SPY / group | **No** | Compute; screen input; `RS_VS_SPY` predicate |
| Setup recognition | **No** — the writer is asked for four prices with no pattern | Setup catalog; `setup_id` on the thesis |
| Entry: level + volume + close basis | Level only, intraday only | `basis: close`, `VOLUME_RATIO`, `NEW_HIGH`, `GAP_UP`, `NEAR_SMA`, composed with `AND` (which exists) |
| Entry: buy now | **Forbidden** | `entry_kind: NOW` |
| Entry: chase limit | No | Plan-sanity flag `ENTRY_CHASED` (> 5% past pivot) |
| Entry: days since / to earnings | "Reports within N days" built (#621, `EARNINGS_WITHIN`); "N days after the print" not yet | `EARNINGS_SINCE {min,max}` on the same calendar |
| Stop: structure + ATR check | ATR check exists as an after-the-fact flag; no structure in the writer's data | Price-structure module; writer rule |
| Stop: only rises | Yes (ratchet) | Keep |
| Target: measured move / prior high / R | 2R floor only | Method cited from the structure block |
| Size: risk-based, heat, sector cap | **No** — conviction band | `sharesForRisk`, heat cap, industry cap |
| Trail by horizon | **No** — one 8% trail for all | Per-horizon templates; the compounder one exists unwired |
| Partial profits / 8-week rule | No | TRADE/TARGET ladder rungs |
| Time limits | Review cadence only | `ENTRY_STALE`, per-setup time rungs |
| Adds: on strength only, stop up with each add | Partly (add rungs at ±7%, add-on-pullback allowed) | Setup-specific; remove pullback-add from TRADE |
| Reaction rule (beat-and-fade) | Partly: #621 seeds a review on every beat/miss and teaches the prompts the reading | Add the `AND[EARNINGS_BEAT, PRICE_MOVE_PCT DOWN]` composite as a same-day TRADE/TARGET default |
| News tiers | No (pipeline off) | Parked with Signals; D13 is the spec for when it returns |
| Insider cluster / revisions | No | Daily jobs off Finnhub; predicates; vendor decision |
| Thesis anatomy | Mostly yes (belief, assumptions, invalidations, variant view, conviction) | Add setup + driver + upside number |
| Post-mortem by setup | No (per analyst) | Scorecard grouped by `setup_id` |
| Fired buy → decide | Retune allowed as an equal answer | Buy, or set down with a reason; "raise the level" is not a resolution |

Every "No" in this table is a PR in `AGENT_REBUILD.md`.
