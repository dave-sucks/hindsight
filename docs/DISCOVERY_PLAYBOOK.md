# Discovery Playbook

> **What this is:** the operator's reference for running discovery on each analyst. Per-analyst mandate summary + trigger rules + template winners + copy-pasteable query patterns for Grok, Perplexity Finance, and Reddit. The 4-step workflow that gets the best output into the Hindsight Discovery agent.
>
> **Status:** living doc. Updated as we learn what queries actually surface tradeable setups vs. what produces noise. See "Learnings" at the bottom of each analyst section.
>
> **Last updated:** 2026-08-03.

---

## The roster (quick reference)

| Analyst | Env | Horizon | Per-position (floor → cap) | Max open | Conf | What it hunts |
|---|---|---|---|---|---|---|
| **PEAD Specialist** | LIVE | TARGET (30-60d) | **$7k → $14k** | 6 | 70 | Clean beat-and-raise prints; 30-60d drift |
| **Catalyst Event PM** | LIVE | CATALYST (weeks) | **$5k → $8k** | 5 | 70 | Binary dated events (FDA, courts, contracts, M&A, earnings) |
| **Secular Compounder** | PAPER | COMPOUNDER (years) | **$10k → $15k** | 4 | 78 | Best-in-class operators in secular themes (multi-year holds) |
| *4th seat — **open slot*** | — | — | — | — | — | *Deferred, not vacant-by-accident. Must bring **offset idle periods** vs all three above — not another underreaction/lookback style. See `ANALYST_LINEUP.md` (2026-07-27).* |

**Position-size floors are real and enforced in each analyst's prompt** (there is no `minPositionSize`
config field yet — a fix is in flight). A candidate that only justifies a sub-floor position is a
**WATCHING thesis, not a dispatch**. Size the conviction you actually have.

**Compounder is deliberately still PAPER.** Graduation bar: **2–3 consecutive proposals at ≥$10k
across at least 2 different themes** (proves both the sizing rule and the theme-balance rule took).
Discovery for it should assume it is building toward live, not already there.

Retired: **Momentum Breakout** (disabled 2026-07-27 — PEAD/momentum zero-investment returns correlate
0.63 and PEAD subsumes momentum, so it duplicated a live seat rather than diversifying it; deliberately
**not replaced**). EV Catalyst Event Trader (themes folded into Compounder, 2026-05-27).

---

## The 4-step discovery workflow

Don't ask the Hindsight Discovery agent to do everything. **You scout, the agent triages.** The chain:

```
STEP 1 — Grok (or X directly via grok.com)
   → find names + people who've been historically right
   → output: tickers + sentiment + handle attribution

STEP 2 — Perplexity Finance (perplexity.ai/finance)
   → research the names from Step 1 (fundamentals, dates, sell-side)
   → output: structured per-ticker context

STEP 3 — Reddit (via direct search or Perplexity scoped to reddit.com)
   → high-conviction DD with retail catalyst awareness
   → output: contrarian / longer-form theses

STEP 4 — Paste all of it into Hindsight Discovery
   → /analysts/[id] → Run Discovery → paste compiled output
   → agent triages against analyst-specific mandate, 4-dim composite,
     DISPATCH_CAP=5, PASS-records the rest
```

**Why this works better than agent-driven `web_search`:**
- Grok sees the X firehose with handle attribution + historical track record (agent's `twitter_search` returns less context)
- Perplexity Finance has structured finance data baked in (options-implied moves, sell-side targets, insider activity)
- You curate (decide which handles to trust, which leads to chase) — the agent doesn't have your taste yet
- Discovery agent does what it's best at — triage + scoring + dispatch against a specific mandate

You're the scout. The agent is the closer.

---

## The Grok Scout Loop (the meta-framework)

> The per-analyst query sections below are *instances* of this. This is the reusable
> framework behind all of them. `/discovery-prep` reads this section to build each session.

### The one principle

**Never ask Grok for "good stocks." Ask "who's been right, and what are they saying right
now."** Grok's real unit isn't stocks — it's **people**. Names are noise; *people with
verifiable track records* are signal, and names fall out of them. Keep each session to
**one theme** — broad sessions just re-pile whatever's hot.

### The session shape (the funnel)

Every session is the same funnel, 2–3 chats:

```
theme/name → 10–20 people → 10–20 names → triage to 5–10 → paste to Hindsight → dispatch ≤5
```

### The 4 plays

**▸ Play A — ROSTER → PICKS** (forward: theme → people → names). *Best for Compounder gap-fill.*
```
Chat 1: I'm researching [THEME] as a multi-year area. Give me the current state of play —
the sub-areas heating up, key developments in the last 1-2 months, and the 3-5 anchor names
everyone references. Tight — just the lay of the land.
Chat 2: Now the people. Who on X has a VERIFIABLE multi-year track record on [THEME] — called
the big winners early, not just posting now? Rank 10-15 by track record; for each, what they
nailed and whether they're posting this month. I'm drafting scouts.
Chat 3: From those 10-15, what 5-10 names are they MOST bullish on right now? Per name: ticker,
how many of them are on it (convergence), and the specific claim. Flag any name 3+ of them
independently like — those are priority.
```

**▸ Play B — ORBIT** (reverse: name → people → adjacent names). *Best for "I like $X, who else is near it."*
```
Chat 1: Find 10-20 credible people actively talking about [$X] — conviction + real track
record, not noise. Per person: their angle, and what they're known for nailing.
Chat 2: What OTHER names do those same people keep talking about in this space? Give me the
adjacency map — the stocks that come up alongside [$X], grouped by sub-theme.
Chat 3: Of those adjacents, the 5-8 they're most bullish on now + the thesis per name +
convergence count.
```

**▸ Play C — NARRATIVE NET** (words/news → people → names). *Best for Catalyst, PEAD, Momentum.*
```
Chat 1: Who on X is driving the conversation on [NARRATIVE/keywords/news]? Surface the PEOPLE
with track records, not the loudest posts.
Chat 2: What specific tickers are those people tying to [NARRATIVE]? Every ticker, with who's
mentioning it.
Chat 3: Which have the most conviction + what exactly is each saying? Rank by convergence ×
track record. [+ analyst filters: $5B+ no-earnings-5d for Momentum; dated catalyst $1B+ for
Catalyst; clean beat-and-raise for PEAD.]
```

**▸ Play D — TRANSFER** (reuse your roster on a new theme). *The cross-pollinate move.*
```
I trust these accounts on [THEME A]: [@handles]. What are these same people — or people they
engage with — saying about [THEME B]? Names + the claim per name.
```

### The meta-game (this is why it compounds)

- **🎖 Draft a bench of scouts.** Chat 2 of every session builds a roster. Persist the handles
  that keep proving credible in [`docs/discovery/scout-roster.md`](./discovery/scout-roster.md).
  **The durable asset is the team of scouts, not any single name.**
- **🎯 Score by convergence.** A name's signal = (# trusted scouts independently on it) ×
  (their track record). **3+ trusted handles = the "triple-sourced" tier** — always lead with those.
- **📈 Level up the roster.** Every few weeks: *"Of the calls @handle made 60–90 days ago, which
  actually played out?"* Promote the hitters, mute the talkers. `/review-discovery` updates the
  roster's hit/miss tally.
- **⏱ Freshness by horizon.** Momentum/Catalyst loot decays in days → re-net **2×/week**.
  Compounder loot (roster + names) lasts months.
- **🏁 Always close the funnel** with one clean extract per name to paste into Hindsight:
  `ticker | scout(s) | convergence | the claim | freshness`.

### Which play per analyst (the gap → play map)

`/review-analysts`'s "Feed to Discovery" section names the gap; this table maps it to a play.

| Analyst | Default play | Fill-in |
|---|---|---|
| **Secular Compounder** (gaps) | **A** (×2 sessions) | THEME = e.g. GLP-1 supply chain, then onshoring/reshoring. Scouts = multi-year fundamental holders. *Or Play D: reuse energy/AI scouts → ask the new theme.* **Priority seat — its watchlist is the firm's biggest gap.** |
| **Catalyst Event PM** | **C** | NARRATIVE = "biotech PDUFAs/readouts dated next 2–4 weeks." Also wake the **dormant in-fence tech lane**: semis IPR/patent rulings, Big Tech antitrust dates, semis/software M&A votes. |
| **PEAD Specialist** | **C** | NARRATIVE = "clean beat-and-raises last 5–10 days + PT raises." |

### Per-archetype triage filters (apply in the Hindsight paste)

- **Catalyst:** dated binary event (FDA/PDUFA/court/contract/M&A) within ~2–4 weeks, **$1B–$20B cap**.
  Hard gate: **no specific primary-sourced forward date = not this archetype**, however good the story.
  At equal upside prefer **"positive data already in hand + filing/PDUFA ahead"** (the de-risked-drift
  pattern behind XENE/ARQT) over pure coin-flip readouts.
- **PEAD:** clean beat-AND-raise in the last 5–10 days + PT raises, within the drift window. Reject
  **guidance reiterated (not raised)** — the #1 false positive — one-time-item beats, and names that
  already gapped >10% on the print.
- **Compounder:** best-in-class operator in a secular theme, multi-year durability, conviction-sized.
  **Theme-balance gate:** the current book is all tech/medtech — candidates in energy transition,
  defense, GLP-1 and onshoring outrank another AI name at equal quality.

---

## 1. Catalyst Event PM (LIVE)

### Mandate

Buys binary event setups — FDA approvals, M&A targets, positive trial readouts, guidance raises, court rulings — biotech-heavy + select tech, LONG-only with no shorting binary disasters. Holds weeks (CATALYST horizon), exits at event resolution or 30 days past the catalyst date — whichever comes first.

### Triggers

- **ENTER:** 1-4 weeks before a confirmed catalyst, never the day before; pre-event accumulation level; minConfidence ≥70
- **PASS:** already-de-risked catalysts (second filings on same indication), options-implied move too rich, catalyst points DOWN, catalysts without primary-source verification
- **HOLD:** through the event window; reassess only on thesis invalidation or catalyst slip (PDUFA extension, trial delay)
- **EXIT:** at event resolution (good or bad — no holding past), on thesis invalidation, or 30 days past the catalyst date if event keeps slipping

### Template winners (what this analyst SHOULD catch)

| Ticker | Catalyst | What ran |
|---|---|---|
| **SMR** (NuScale) | Trump SMR executive push (regulatory) | 3-5x in weeks |
| **VRTX** | Phase 3 vanzacaftor readouts (FDA) | Sustained multi-month run |
| **NOVO** | Wegovy / Ozempic label expansion (FDA) | Multi-year compounder out of catalyst chain |
| **PLTR** | Large government contract awards | Cycles of 30-50% runs |
| **CRSP** | Casgevy approval (FDA) | Multi-week event-driven rally |

### Datable catalyst categories — don't only think FDA

This is the analyst's bread and butter. Every category below has known dates and can be played.

| Category | Examples | Why it works |
|---|---|---|
| **Earnings + guidance** | Q1 print on June 12. Beat-and-raise probability. | Every analyst knows the date. Edge is in pre-positioning. |
| **FDA decisions** | PDUFA dates, advisory committees, Phase 3 readouts. | Binary outcome on known date. |
| **Court rulings** | Qualcomm v Arm IPR. Google antitrust. Biotech patent litigation. | Binary, dated, often mispriced. |
| **Legislation / regulation** | Defense reconciliation bill vote. Drug pricing reform. FCC spectrum auction. SEC ETF decisions. Trump SMR exec orders. | Vote/decision dates are public. Sector-wide moves. |
| **Contract awards** | DoD large contract decisions. FAA certifications. Government infrastructure bids. | Known award timelines. Sometimes pre-signaled. |
| **Investor days / capital markets days** | Apple WWDC, Nvidia GTC, company analyst days. | Companies pre-position guidance raises. |
| **M&A milestones** | Shareholder votes on announced deals. Antitrust review deadlines. Closing dates. | Deal premium or break. |
| **Index rebalances** | S&P 500 add/drop dates. Russell rebalance. | Mechanical buying pressure 1-2 weeks before. |

### Discovery queries

**STEP 1 — Grok:**

```
Who on X has correctly called dated catalysts in the last 6 months —
earnings beat-and-raises, FDA approvals, court rulings, contract awards,
or regulatory decisions? Show me their top 5 high-conviction calls
for events in the next 30 days. Filter to handles with verifiable
track records.
```

```
Find users on X who were early on $SMR (Trump SMR push), $PLTR
(government contracts), $VST (datacenter power regulation), $VRT
(AI infrastructure capex). What dated catalysts are they currently
positioned for? Last 14 days, FUNDAMENTAL + CATALYST_EVENT archetypes.
```

```
Trending catalyst plays on X with specific dated events in next 30
days. Mix: earnings, FDA, court rulings (patent/antitrust),
contract awards (DoD/FCC), investor days, M&A milestones, index
rebalances. Show ticker + event type + date + thesis. Skip pure
momentum / technical plays.
```

**STEP 2 — Perplexity Finance:**

```
List companies with dated binary catalysts in the next 30 days,
across ALL these event types: (1) earnings prints where sell-side
expects beat + guidance raise, (2) FDA PDUFA decisions and Phase 3
readouts, (3) court rulings (patent cases, antitrust, FTC/FCC
decisions), (4) major contract awards (DoD, infrastructure, FCC
spectrum), (5) investor days / capital markets days where guidance
reset expected, (6) M&A shareholder votes and antitrust review
deadlines. Market cap $1B-$20B. For each: company, event date,
asymmetric upside if positive outcome.
```

```
Upcoming legislative and regulatory catalyst dates in next 60 days
that could materially move sector ETFs or specific stocks. Include:
defense reconciliation votes, drug pricing legislation, FCC spectrum
auctions, SEC ETF decisions, FTC merger reviews, EPA rulings,
executive orders being telegraphed. Which sectors/companies have
the most asymmetric upside?
```

```
Court rulings and IPR decisions expected in next 4 weeks in
semiconductor patent disputes, Big Tech antitrust cases, biotech
patent litigation, and major commercial contract disputes. Include
case, parties, expected ruling date, what the market is currently
pricing in vs binary outcomes.
```

**STEP 3 — Reddit:**

```
site:reddit.com (r/wallstreetbets OR r/biotechplays OR r/SecurityAnalysis
OR r/investing) DD posts for upcoming dated catalysts (earnings,
court rulings, contracts, FDA, investor days) in next 30 days.
Sort by top upvotes last 30 days. Skip pure meme stocks.
```

**STEP 4 — Paste into Hindsight Discovery:**

```
Here are candidates I've sourced from X + Perplexity + Reddit for
upcoming catalysts in the next 30 days:

[paste Grok output of names + handles + thesis]
[paste Perplexity per-name research]
[paste Reddit DD highlights]

Triage against my mandate (LONG-only binary events, $1B-$20B market
cap, biotech-heavy + select tech). Score on 4-dim composite. Skip
already-covered: [LIST CURRENT WATCHING TICKERS]. Top 3-5 → dispatch.
Rest → PASS-record with rationale.
```

### Notes & Learnings

*(Updated as we run discovery and see what works. Add dated entries.)*

- 2026-06-04: PEAD-style "1 dispatch + many PASS theses" is the right ratio. Quality > volume.
- **2026-06-05: Grok >> Perplexity for live biotech catalyst discovery.** Two parallel sessions: Perplexity-led run produced 6 stale/post-window candidates (recycled 2025 PDUFA catalog data, half were already past entry). Grok-led run produced 5 dispatches + 1 PASS — all live future PDUFAs in next 25 days, composite scores 7-9, clean discriminating triage ($LNTH, $MRK, $IONS, $ARQT, $VRDN dispatched; $ABBV PASS-recorded because at 91% of 52w range = entry window closed).
- **Why:** Grok pulls live X chatter from biotech-focused handles (@AdamFeuerstein, @TheBioRunner, etc.) who post about THIS WEEK's PDUFAs they're actively trading. Perplexity's underlying data sources are catalogs that can be stale or recycle prior-year dates. For time-sensitive binary catalysts, freshness matters more than aggregated depth.
- **New rule for Catalyst PM:** Lead every session with Grok. Use Perplexity AFTER for fundamentals validation on the names Grok surfaces (per-ticker setup quality, options-implied moves, sell-side probabilities). Do NOT lead with Perplexity "give me upcoming PDUFAs" queries — they pull stale catalogs.
- **Boundary discipline working as designed:** Catalyst PM correctly rejects earnings-drift names ($NVDA, $ORCL, $ADBE — belong to PEAD), energy/utility plays ($SMR, $VST, $OKLO — belong to Compounder via energy transition theme), and "contract flow" momentum without a specific dated event ($PLTR ongoing AI narrative). This is the system enforcing analyst boundaries cleanly. The industry/sector fence is NOT too tight — it's the right shape.

---

## 2. PEAD Specialist (LIVE)

### Mandate

Buys post-earnings drift candidates — clean beat-and-raise prints (EPS beat ≥5% + revenue beat + raised guidance + gap-day volume >1.5x average + analyst revisions UP within 72hr), LONG-only across all sectors. Holds 30-60 days targeting the drift, never holds into the next earnings print.

### Triggers

- **ENTER:** 1-3 days after the print (not the gap day), once all 4 signals confirm; minConfidence ≥70
- **PASS:** one-time items driving the beat, guidance reiterated not raised, stocks that already gapped >10% on print, EPS miss + guidance cut (would be short — declines as institutional memory)
- **HOLD:** while drift is intact, no reversal candle on volume, no approaching earnings
- **EXIT:** -8% stop from entry, target hit (typically +12-18%), reversal candle with volume, OR within 5 days of next earnings print

### Template winners (what this analyst SHOULD catch)

| Ticker | Catalyst | What ran |
|---|---|---|
| **NVDA Q1 FY25** (May 2024) | Beat + raised on AI demand | $90 → $130 over 60 days |
| **CRWD Q1 FY25** | Clean beat-and-raise | ~30% drift over 60 days |
| **APP** (multiple prints) | Beat-and-raise on ad tech | +200%+ across cycles |
| **DELL** (recent prints) | AI server beats | Multi-week drifts post-print |
| **MU Q3-Q4 FY24** | HBM-driven beats | Sustained 60+ day drift |

### Discovery queries

**STEP 1 — Grok:**

```
Find X users who were bullish on $NVDA after May 2024 earnings and
correctly called the 60-day drift higher. What recent post-earnings
names are they currently bullish on for 30-60 day drift?
```

```
Find X users who called $APP's Q3 2024 drift from $150 to $300+
within a week of the print. What recent beat-and-raise names are they
flagging now for the same setup?
```

```
Sell-side analyst handles on X who actually posted UP revisions in
the last 7 days (not just general bullishness — specific PT raises).
Who's talking about which names? Filter ANALYST_NOTE archetype only.
```

**STEP 2 — Perplexity Finance:**

```
List US-listed companies that printed Q-earnings in the last 5 trading
days with: EPS beat ≥5%, revenue beat, AND raised full-year guidance.
Include actual numbers (EPS actual vs consensus, revenue beat %, old
vs new guide). Exclude one-time-item driven beats.
```

```
For earnings prints in the past 7 days, which companies had 3+ sell-side
firms raise price targets within 72 hours of the print? Include the
magnitude of revisions and any consensus theme (AI infra, GLP-1, defense).
```

```
Recent post-earnings setups with gap-day volume >1.5x the 20-day average
AND analyst estimate revisions UP within 72 hours. Looking for the
classic PEAD signal — clean signal, no one-time noise.
```

**STEP 3 — Reddit:**

```
site:reddit.com (r/wallstreetbets OR r/investing) DD posts for recent
earnings beats with raised guidance, last 7 days. Sort by upvotes.
Skip meme stocks and earnings misses.
```

**STEP 4 — Paste into Hindsight Discovery:**

```
PEAD candidates I've sourced from X + Perplexity for beats in the last
5 trading days:

[paste Grok / Perplexity output]

Triage on PEAD discipline: EPS beat ≥5%, revenue beat, raised guidance,
gap-day volume >1.5x, analyst revisions UP within 72hr. LONG only.
Skip already-covered: [LIST CURRENT WATCHING TICKERS]. Top 3-5 →
dispatch. Rest → PASS-record with rationale.
```

### Notes & Learnings

- 2026-06-04: First operator-driven discovery on PEAD landed 1 dispatch + many PASS theses. That's the right shape — PEAD's edge is selectivity.
- May/June is between Q1 / Q2 earnings seasons → expect fewer candidates than Jan/Feb/July/August.

---

## 3. Secular Compounder (PAPER)

### Mandate

Buys best-in-class operators with 3-5 year secular tailwinds across AI infrastructure, GLP-1, energy transition, defense reindustrialization, onshoring, and demographic aging — concentrated 10-15% positions in 3-4 names. Holds months to years (COMPOUNDER horizon, quarterly review cadence), tolerating -15% drawdowns when the thesis is intact.

### Triggers

- **ENTER:** scaled entry over 3-6 months on weakness; durable moat + verifiable secular tailwind + 25%+ revenue growth + 30%+ FCF margin; minConfidence ≥78
- **PASS:** profitless growth dressed as "secular," story stocks without unit economics, mediocre operator in a real theme, cyclical names mislabeled as secular
- **HOLD:** through earnings noise, intra-quarter volatility, -10% to -15% drawdowns; never trims on price alone
- **EXIT:** ONLY on invalidation — regulatory break, CFO departure, 2 consecutive guidance cuts, structural demand erosion, broken capital allocation discipline

### Template winners (what this analyst SHOULD catch)

| Ticker | Catalyst | What ran |
|---|---|---|
| **MU** | HBM / AI memory secular | $50 → $200 over 2024-26 |
| **VST** (Vistra) | AI datacenter power demand | $25 → $200 in 2024 |
| **GEV** (GE Vernova) | Grid + energy transition | $140 → $700 in 2024-26 |
| **LLY** | GLP-1 dominance | $300 → $900 over 2023-24 |
| **PLTR** | Government + commercial AI compounding | $20 → $180 over 2024-26 |
| **AVGO** | AI custom silicon (caught this one) | $90 → $450 over 2023-26 |

### Discovery queries

**STEP 1 — Grok:**

```
Find X users who were bullish on $VST or $GEV BEFORE they ran 3-5x
in 2024 (posts from late 2023 / early 2024). What are they currently
bullish on for multi-year holds? Filter FUNDAMENTAL archetype only.
```

```
Find X users who were early on $LLY's GLP-1 thesis in 2023. What are
they currently saying about obesity drug plays AND adjacent supply
chain names (CDMOs, injection device makers)? Want handle-attributed
conviction, not aggregated sentiment.
```

```
@stanphilduff OR @LongShortTrader OR @CharlieMunger OR @VitruvianMan:
secular long-term holds in energy transition (nuclear, SMR, grid) or
defense reindustrialization, last 30 days. FUNDAMENTAL archetype only,
exclude technical / options flow noise.
```

**STEP 2 — Perplexity Finance:**

```
What are the top 5 best-in-class operators in datacenter power
infrastructure (utilities + grid + cooling + electrical equipment) with
3-5 year tailwinds from AI capex acceleration through 2028? Exclude
pure-play hyperscalers and chip makers. Need 25%+ revenue growth and
management with proven capital allocation.
```

```
Which GLP-1 / obesity supply-chain plays (CDMOs, injection device makers,
manufacturing scale leaders) have the strongest competitive moats and
binding capacity commitments for 2026-2030 demand? Skip LLY + NVO
themselves — looking for the picks-and-shovels layer.
```

```
Highest-quality defense reindustrialization plays — primes (LMT/RTX/GD/
NOC), shipbuilders (HII), tier-1 suppliers (HEI/TDG, Curtiss-Wright,
Mercury Systems) — with the most leveraged exposure to the multi-year
FY26-FY30 budget acceleration. Rank by FCF growth and backlog conversion.
```

**STEP 3 — Reddit:**

```
site:reddit.com (r/SecurityAnalysis OR r/investing OR r/ValueInvesting)
DD posts on secular compounder plays in [GLP-1 / energy transition /
defense reindustrialization]. Sort by upvotes, last 90 days.
```

**STEP 4 — Paste into Hindsight Discovery:**

```
Secular Compounder candidates I've sourced from X + Perplexity + Reddit
for the theme gaps in my current watchlist (currently 100% IT/AI):

[paste Grok / Perplexity / Reddit output]

Triage against my mandate: 3-5 year secular tailwinds, best-in-class
operator, 25%+ revenue growth, 30%+ FCF margin, durable moat. Want 1-2
names each in GLP-1 supply chain, energy transition, defense reindustriali-
zation. Skip already-covered: [LIST CURRENT WATCHING TICKERS]. Top 3-5 →
dispatch. Rest → PASS-record with rationale.
```

### Notes & Learnings

- Current watchlist (as of 2026-06-05) is 100% IT/AI names — pre-rewrite history. Manual discovery needs to populate GLP-1, energy, defense before this analyst can execute its mandate fully.
- Don't promote to LIVE until the watchlist spans the new themes.

---

## 4. Momentum Breakout — ⚠️ RETIRED 2026-07-27, DO NOT RUN DISCOVERY

> **This seat is disabled and will be deleted.** Do not source names for it.
>
> **Why:** it duplicated PEAD rather than diversifying it. PEAD and price-momentum zero-investment
> returns correlate **0.63**, and PEAD *subsumes* momentum (drift explains momentum better than the
> reverse) — so this seat was a second helping of a live bet, not a new return source. Compounding
> that, it ran a day-scale style on a once-daily cron: 0W / 6L / 2BE, −$1,289. Structural, not variance.
>
> **It is deliberately not replaced.** The open 4th slot must bring *offset idle periods* vs the three
> live archetypes. Everything below is kept for forensics only.

### Mandate

Buys stocks making new 52-week highs on >2x volume with positive relative strength vs SPY, sector-agnostic, $5B+ market cap floor (no microcap whipsaws), LONG-only, no holding through earnings. Holds days to weeks (TRADE horizon, bounded by maxHoldDays), tight stops, fast exits — talent scout for setups, not long-term coverage.

### Triggers

- **ENTER:** breakout confirmation on volume + positive 30-day RS vs SPY + sector leadership + clean base or initial pullback; no earnings within 5 days; minConfidence ≥75
- **PASS:** late-cycle breakouts in distribution phases, volume-climactic tops on declining volume, low-float speculative names, anything with imminent earnings
- **HOLD:** while RS stays positive and price > 10-day EMA, no climactic volume signs
- **EXIT:** -5% stop OR 10-day EMA break (whichever tighter), target hit, volume-climactic top, maxHoldDays expired; never average down

### Template winners (what this analyst SHOULD catch)

| Ticker | Catalyst | What ran |
|---|---|---|
| **APP** | 2024 breakout king | +5x in months on multiple breakouts |
| **CVNA** | Short squeeze + recovery | Sustained multi-month runs |
| **RBLX** | Repeated 52-week-high breakouts | Multiple +30-50% runs |
| **PLTR** | Government + AI narrative | Multiple breakouts 2024-26 |
| **HOOD** | 2024-25 retail comeback | Multi-month uptrend |

### Discovery queries — **run 2× per week minimum, names rotate fast**

**STEP 1 — Grok:**

```
Find X technical handles (@AdamMancini4, @traderstewie, @hari_trades,
@AlpacaTrades, @StockMKTNewz) — current breakout calls from the last
48 hours with ≥10 likes. Filter TECHNICAL archetype only. $5B+ market
cap names.
```

```
Find X users who were early on $APP's 2024 breakout (posts from before
the +200% run). What names are they currently bullish on for breakout
setups in similar shape?
```

```
Stocks trending on fintwit X with TECHNICAL_BREAKOUT or NEW_52_WEEK_HIGH
tags in the last 48 hours. Filter $5B+ market cap, exclude any with
earnings in next 5 days.
```

**STEP 2 — Perplexity Finance:**

```
Today's top 15 stocks making new 52-week highs on >2x average volume,
market cap $5B+, US-listed common stock. Exclude any with earnings in
next 5 trading days. Include 30-day RS vs SPY and sector.
```

```
Stocks breaking out of multi-month consolidation bases this week, $5B+
market cap, sector-agnostic, with positive 90-day RS vs SPY. Include
base length, breakout volume vs average, and prior failed breakouts.
```

```
Mid- and large-cap names ($5B+) with the largest single-day volume
surges in the past 5 trading days that were NOT earnings-driven — looking
for institutional rotation signals or analyst-day reveals.
```

**STEP 3 — Reddit:**

```
site:reddit.com (r/StockMarket OR r/wallstreetbets) DD posts on 52-week
high breakouts last 7 days. Sort by upvotes. Skip pure meme / pump posts.
```

**STEP 4 — Paste into Hindsight Discovery:**

```
Momentum Breakout candidates from today's screen + X + Reddit:

[paste outputs]

Triage on momentum discipline: $5B+ market cap, new 52-week high or
multi-month base breakout, >2x volume, positive 30-day RS vs SPY, no
earnings within 5 days. LONG only. Skip already-covered: [LIST CURRENT
WATCHING TICKERS]. Top 3-5 → dispatch. Rest → PASS-record with rationale.
```

### Notes & Learnings

- Watchlist for momentum is different from other analysts — names CYCLE OUT every 5-10 days as setups fail. **Refresh discovery 2× per week minimum** (Sunday + Wednesday).
- Previous config (Tech-only, conf 70) returned -$1,692 / 42.9% win rate. New config (sector-agnostic, $5B floor, conf 75) needs 2-4 weeks of paper data before promotion decision.
- **For momentum to work with sub-50% win rate, avg win must be ≥2x avg loss.** Watch this ratio.

---

## Workflow learnings (cross-analyst)

*(Add dated entries as we discover patterns that work or fail across all analysts.)*

- **2026-05-31** (Catalyst PM Sunday discovery): cron-driven discovery surfaced 5 fresh theses (RBRK, AVGO, VEEV, ADBE, PANW) — all upcoming earnings catalysts. Cron-based discovery works for earnings-driven analysts (Catalyst PM + PEAD); weaker for thematic ones (Compounder needs operator-driven gap-fill).
- **2026-06-04** (PEAD operator-driven test): full prompt chain through Grok + Perplexity → 1 dispatch + many PASS theses. Right ratio. Confirms quality-over-volume is the correct shape.
- **2026-06-05** (Catalyst PM Grok vs Perplexity A/B): Grok-led discovery >>> Perplexity-led discovery for live biotech catalysts (5 quality dispatches vs 6 stale post-window candidates). See per-analyst Notes for full detail. Generalizable insight: **for any analyst whose edge depends on time-sensitive recency (live PDUFAs, this-week earnings, breakouts happening now), Grok is the primary source**. Perplexity is the secondary validation layer.

---

## See also

- [`docs/plans/ANALYST_LINEUP.md`](./plans/ANALYST_LINEUP.md) — why the 4-analyst lineup looks like it does + sizing math
- [`docs/THESIS_ARCHITECTURE.md`](./THESIS_ARCHITECTURE.md) — thesis state machine the discovery agent writes into
- [`docs/plans/DISCOVERY_OVERHAUL.md`](./plans/DISCOVERY_OVERHAUL.md) — PR #361 implementation history + MEDIUM-4 gap-analysis Stage 0 plan
- [`docs/plans/DISCOVERY_V2.md`](./plans/DISCOVERY_V2.md) — operator-driven discovery design (Principal Chat batched discovery)
- `lib/agent/knowledge/strategy-archetypes.ts` — the 10 archetypes; this playbook serves the 4 archetypes mapped to live analysts (THEMATIC_SECULAR, EARNINGS_DRIFT, CATALYST_EVENT, MOMENTUM_BREAKOUT)
- [`docs/discovery/scout-roster.md`](./discovery/scout-roster.md) — the durable per-theme bench of credible X handles (built by the Scout Loop, scored by `/review-discovery`)
- [`docs/prompts/DISCOVERY_PREP.md`](./prompts/DISCOVERY_PREP.md) — the `/discovery-prep` instruction doc (turns a "Feed to Discovery" gap into Grok/Perplexity prompts via the Scout Loop)
