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
| **Secular Compounder** | **LIVE** | COMPOUNDER (years) | **$10k → $15k** (live promo cap $10k) | 4 | 78 | Best-in-class operators in secular themes (multi-year holds) |
| *4th seat — **open slot*** | — | — | — | — | — | *Deferred, not vacant-by-accident. Must bring **offset idle periods** vs all three above — not another underreaction/lookback style. See `ANALYST_LINEUP.md` (2026-07-27).* |

**Position-size floors are real and enforced in each analyst's prompt** (there is no `minPositionSize`
config field yet — a fix is in flight). A candidate that only justifies a sub-floor position is a
**WATCHING thesis, not a dispatch**. Size the conviction you actually have.

**Compounder went LIVE 2026-08-11** — promoted on operator call, ahead of the old "2–3 in-band
proposals across 2 themes" graduation bar (CEG was #1 of 3). Promotion closed its 2 paper positions
and left CEG + CRWD as PROMOTED theses for the first live run to resolve (`place_trade` to re-enter,
or demote to WATCHING). It runs with a **$10k live promotion cap** — a deliberate throttle, so every
live entry is exactly $10k until the seat proves out. Discovery for it should now assume real money
and a **2-slot** book, not a paper sandbox.

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

### Query design rules (added 2026-08-09, learned the hard way)

A Catalyst tech-lane session returned **"no rows qualify"** on every turn. The window wasn't
empty — the prompts were broken. Four rules came out of it. Apply them to every prompt this
playbook generates.

**1. Two filters max during retrieval. Everything else after.**
Date-window AND market-cap AND sector AND "must cite a primary docket" returns an empty set
every time — and worse, you can't tell whether the world is empty or your query was. Ask
wide, have the model *label* the attributes, and filter in the Hindsight paste (which
already hard-gates on cap, date, industry, and size).

**2. Never require the scout to have cited a primary source in-post.**
Almost nobody tweets EDIS/PTAB paper numbers or 8-K links. Ask for the claim + the date;
verify the date afterward in Perplexity/EDGAR. Requiring in-post citation deletes the
entire result set at the retrieval step.

**3. Never scope a summarize turn to the conversation when the thread was thin.**
`"Do not add names that didn't come up earlier"` is correct after a rich thread and fatal
after a thin one — the model intersects its own thin output instead of researching. Safer
close: *"keep every row with an exact date; mark unverified sources 'unverified' rather
than dropping the row."*

**4. Match the source to the beat, and fish where the fish are.**
X has a real biotech-catalyst beat (PDUFA handles post daily) — Grok is right for it. X has
**no ITC/PTAB beat**; nobody live-tweets docket target dates, so docket-shaped catalysts are
a primary-calendar job (EDGAR full-text, USITC EDIS, PTAB) → Perplexity, not Grok scouts.
Likewise, in the $1B–$20B tech band, IPR/antitrust is the *rarest* slice (chip patent fights
and Big Tech antitrust are mega-cap = out of fence). The **abundant** slice is announced
**M&A** (shareholder-vote dates, HSR expirations, outside dates — PE take-privates land
squarely in the band) and **index rebalance** adds. Aim the tech lane there.

> **Diagnostic habit:** an empty result is data. Log it in
> [`discovery/FUNNEL.md`](./discovery/FUNNEL.md) with the prompt that produced it. "Few names
> returned" and "many returned, none passed the gates" are different failures with different
> fixes — you can only tell them apart if both are recorded.

### Convergence is TWO metrics, and one of them is a warning (added 2026-08-09)

The Scout Loop's headline rule — *"a name's signal = (# trusted scouts on it) × (their track
record); 3+ handles = the triple-sourced tier, always lead with those"* — **is not safe to
apply uniformly.** A Catalyst session made this unmissable: the single highest-convergence
name in a 38-ticker sweep (seven named independent traders, "very high" convergence, the one
name flagged as a clear standout) was **TENX — a ~$0.5B unread Phase 3 binary**. Below the
cap floor, wrong archetype, and precisely the shape the seat's rules exist to exclude.

That is structural, not bad luck. **X convergence measures retail attention, not edge.**
Attention concentrates on small-cap, high-volatility, *unread* binaries because those are the
most exciting — not the most tradeable. Split the metric:

| Kind | What it actually measures | How to use it |
|---|---|---|
| **Calendar convergence** — N independent *calendar* sources carry the same date | The date is real | ✅ **Verification.** Use it. |
| **Trader convergence** — N traders are positioned in the name | The trade is crowded | ⚠️ **Caution flag, not confirmation.** |

**Per archetype:**
- **Catalyst (de-risked drift):** high trader convergence is arguably a *negative*. The seat's
  winners (XENE, ARQT, VRDN) were boring de-risked drifts; its losers (IONS, MLTX) were
  coin-flip binaries — the crowded kind. Rank on **event quality + de-risking**, use trader
  convergence only to ask "why is this still cheap?"
- **Compounder (thematic):** convergence among *multi-year fundamental holders* is still the
  right signal — the universe is genuinely unbounded there and the social graph is the map.
- **PEAD:** convergence on *analyst revisions* (PT raises) is signal; convergence on trader
  excitement is not.

### Calendar-first vs. Grok-first — which lane is Grok actually good at

Same session, same day, same model: the **wide calendar sweep produced 6 usable names; the
social orbit/adjacency turn produced 0.** The difference was what Grok was reading — calendars
versus people.

**For dated-binary archetypes the candidate universe *is a calendar.*** The complete set of
PDUFAs in a window is enumerable from primary sources; it does not need to be discovered
socially. Play B (orbit) is for thematic discovery, where the universe is unbounded. Run it on
Catalyst and it just re-surfaces the loudest names on a list you could already enumerate.

**So Grok's job for Catalyst is narrower than this playbook originally assumed:** not
discovery, but (a) is the date real, (b) what is the residual risk / trade framing, (c) how
crowded is it. Get the candidate list from the calendar (pdufa.bio, BiopharmaWatch, FDA.gov).

> This **refines rather than overturns** the 2026-06-05 "lead with Grok, not Perplexity"
> learning. That finding was correct *against Perplexity's stale recycled catalogs*. The right
> shape is not Grok-first — it is **calendar-first, Grok-second as the qualitative layer.**

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
  Quality is judged **against the candidate's own industry**, never a software screen — see the
  yardstick note in §3.
  **Theme-balance gate:** as of 2026-08-12 the book covers AI/software and energy (CEG); **GLP-1,
  onshoring and demographic aging are empty**. Candidates in the empty themes outrank another AI
  name at equal quality. AI conviction is expressed through **position size** (AI sizes at the top
  of the band), not through sourcing more AI candidates.

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

## 3. Secular Compounder (LIVE — promoted 2026-08-11)

### Mandate

Buys best-in-class operators with 3-5 year secular tailwinds across AI infrastructure, GLP-1, energy transition, defense reindustrialization, onshoring, and demographic aging — concentrated 10-15% positions in 3-4 names. Holds months to years (COMPOUNDER horizon, quarterly review cadence), tolerating -15% drawdowns when the thesis is intact.

> **⚠️ The yardstick note — read before writing any screen for this seat.**
> This seat's quality bar is **relative to the candidate's own industry**, never absolute.
> Until 2026-08-12 this section carried a hard "25%+ revenue growth + 30%+ FCF margin"
> screen. That is a *software* yardstick: essentially no industrial, E&C, CDMO, medtech
> or utility compounder clears it, and neither does this seat's own live book (GD, ETN,
> CEG all fail it). Applied literally it filtered every non-tech candidate out before the
> operator saw it — which is a large part of why this seat's watchlist ran 9-of-14 AI/semis/
> software while three of its seven themes sat empty. It was also never in the analyst's
> `analystPrompt`; it existed only here, and re-injected itself into every prep session.
> **Judge instead on:** growth and margin trajectory vs. that industry's norms, backlog
> growth + conversion (industrials/E&C), contracted or binding capacity (CDMO/supply
> chain), ROIC vs. cost of capital, FCF conversion funding the next cycle, and capital-
> allocation record. Same strictness — right yardstick.

### Triggers

- **ENTER:** scaled entry over 3-6 months on weakness; durable moat + verifiable secular tailwind + growth and cash generation that are best-in-class **for that name's own industry** (see the yardstick note below); minConfidence ≥78
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
pure-play hyperscalers and chip makers. Rank by backlog growth and
conversion, ROIC vs cost of capital, margin trajectory, and management
with proven capital allocation.
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
operator, durable moat, and growth + cash generation that are top-decile
FOR THAT NAME'S OWN INDUSTRY — do not apply software growth/margin
screens to industrials, CDMOs or medtech. Want 1-2
names each in GLP-1 supply chain, energy transition, defense reindustriali-
zation. Skip already-covered: [LIST CURRENT WATCHING TICKERS]. Top 3-5 →
dispatch. Rest → PASS-record with rationale.
```

### Notes & Learnings

- Current watchlist (as of 2026-06-05) is 100% IT/AI names — pre-rewrite history. Manual discovery needs to populate GLP-1, energy, defense before this analyst can execute its mandate fully.
- ~~Don't promote to LIVE until the watchlist spans the new themes.~~ Superseded — promoted 2026-08-11 on operator call with energy covered (CEG) but GLP-1 / onshoring / aging still empty. The theme-population job is now a **live** priority, not a pre-promotion gate.
- **2026-08-12 — the fence was silently blocking three of the seven themes.** The seat's `industries` array had no entry that could reach GLP-1 picks-and-shovels (Life Sciences Tools, Health Care Equipment), onshoring (Machinery, Construction & Engineering), or aging/medtech. Only Pharmaceuticals (LLY/NVO) and Electrical Equipment were reachable. **Diagnosis rule learned: when an analyst keeps drifting to one theme, check `industries` against `themes` before blaming the prompt or the sourcing.** Fixed by adding the four industries.
- **2026-08-12 — GICS industry vs sub-industry strings matter.** The fence carried `Independent Power and Renewable Electricity Producers` (the GICS *industry* name), which appears in **zero** `Signal` rows; the data emits the *sub-industry* `Independent Power Producers & Energy Traders`. A fence value that never matches is invisible dead weight. **Validate any new industry value against `SELECT DISTINCT unnest(industries) FROM "Signal"` before trusting it.**
- **2026-08-12 — the 25%/30% screen was removed.** See the yardstick note in the Mandate section above. It was never in the `analystPrompt`; it lived only in this doc and re-injected itself into every prep session, filtering out the exact non-tech candidates the seat was being asked to find.

#### 2026-08-12 discovery session — first post-fence-fix run (batched paste, PRINCIPAL_CHAT)

Ran Play A ×2 (GLP-1, onshoring) + Play D (aging) via 10 batched pastes into Principal Chat.
**Result: 5 dispatched (WST, SYK, ISRG, EME, ABT), 4 PASS-recorded (TMO, STVN, FIX, POWL).**

**What worked**
- **The fence fix paid off within 10 minutes.** The industries widening landed 03:40; the run
  started 03:50 and immediately scored TMO/STVN/WST/BDX — and later ISRG/SYK/ABT — as
  "✅ universe fit" on the newly-added `Life Sciences Tools & Services` and `Health Care
  Equipment & Supplies`. Aging went from **zero reachable candidates to four in one config edit.**
- **Batched-paste triage is the right shape.** Running-list-then-score (rather than dispatching
  per paste) let later pastes demote earlier candidates on evidence — STVN went High→Medium when
  Perplexity showed 1.6% FCF margin and no named counterparty. That is the process working.
- **The industry-relative yardstick immediately mattered.** Every dispatched name (WST, SYK, ISRG,
  EME, ABT, plus PWR/ROK in the queue) would have been filtered by the old 25%/30% software screen.

**What went wrong**
- **DISPATCH_CAP ignored slot reality.** Cap was 5; the seat had **2** free positions. Five
  dispatches take the watchlist from 14 → 19 WATCHING against a 4-name book — the bloat problem
  compounding. **Cap to free slots, not to a constant.**
- **Two High-priority names fell through the closeout: PWR and ROK.** Both were 🔴 High in the
  final triage table; neither was dispatched nor PASS-recorded. They exist only in the chat
  transcript. **Every surviving candidate must terminate in a row — WATCHING or PASSED. "Still in
  the research queue" is not a terminal state.**
- **The GLP-1 picks-and-shovels layer is mostly not US-listed.** Bachem, Ypsomed, Gerresheimer,
  SHL, Divi's, PolyPeptide — the highest-conviction names in the theme are Swiss/German/Indian or
  private. Bachem's OTC line (`BCHMY`) is too thin for a $10k position. Roughly half the chat
  turns were spent surfacing names that could never be bought. **Put "US-listed common stock only,
  sufficient liquidity for a $10-15k position" in the Grok prompt itself for any supply-chain theme.**
- **Play D transfer across unrelated themes returned nothing** — see the scout roster's aging
  section. Adjacent domains only.
- **Thesis-writer fan-out is slow and fragile.** The 5 dispatches spawned 5 `THESIS_WRITER` runs
  advertised at "~60-120s" that actually took **400-560s+**, and the same night's CRWD writer
  **FAILED at 774s** — suspiciously close to the 770s abort derived from `maxDuration` 800 in
  `lib/agent/modes.ts`. A 5-name dispatch is 5 independent model loops. Budget real time for it,
  and expect losses at the cap. (Under separate investigation.)

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
