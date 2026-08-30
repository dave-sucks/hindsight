# Book Review + Discovery — 2026-08-30 (Sunday)

**Session:** trader-style top-down book review → fence proposals → watchlist verdict →
discovery for all three seats → manual discovery pack.
**Ground truth:** every number re-verified against production today. The 08-28 audit's
figures all check out (7 positions, 22 watches, bands, fences, prices). 8/28 was Friday;
markets have been closed since, so the audit's close prices are still the latest.
**No DB writes were made.** Config changes and mints are proposed below with exact
before/after; each needs one click.

**Two structural facts found during verification (context, not re-diagnosis):**

- **The Sunday discovery cron has not fired since May 31.** Zero DISCOVERY-mode runs in
  all of June–August; none this morning either. The function is still in code
  (`discovery-run.ts`, Sundays 9 AM ET) and unconditional — it simply isn't firing.
  Same date the signal router went quiet (routing paused, P1-34 — that one is known and
  deliberate). If the cron silence is *not* deliberate, the Inngest app likely needs a
  manual re-sync (the registration-ghost failure mode). All discovery since June has
  been operator-driven — which is why "discovery has under-delivered for weeks" and why
  this session runs it by hand.
- **`read_analyst_inbox_stats` and `discover_signals_for_fence` run on routed-signal
  history that ends May 31.** The deployment handoff's advice to validate fence changes
  with those tools can't work as written right now. The fence evidence below comes from
  the raw signal flow and the PASS records instead.

---

## (a) The lineup, reviewed like a trader

### The three-seat structure is right. Keep it.

Event capture (Catalyst) + post-earnings drift (PEAD) + long-horizon quality at size
(Compounder) are three genuinely distinct return sources — the 2026-07-27 research
ruling (PEAD subsumes momentum at 0.63 correlation; quality/defensive and long-horizon
are the true diversifiers) still holds, and the week's live record backs the seats:
+$3,484 realized 8/18–8/28 with both losses being plan-driven floor exits. The spread
is not the problem. **The fences are.**

### What you are UNABLE to buy (the holes, with evidence)

| Hole | Evidence | Who's blocked |
|---|---|---|
| **Energy — invisible to every seat** | 3rd-largest sector in your own signal flow (584 signals all-time, 22 in the last 30d: XOM, CVX, PSX, ET, TPL, BE…). Compounder has an "Energy transition" *theme* but no Energy *sector* — it can buy CEG/VST (Utilities) but not nuclear fuel, midstream, or any oil & gas name. In a sticky-inflation tape (core PCE 3.3%, Fed holding 3.50–3.75%) the book cannot own the classic inflation hedge. | All three seats |
| **Materials / Real Estate** | 288 / 73 signals all-time; zero seats. Materials is where half the onshoring theme lives (chemicals, construction materials, metals — copper/uranium for electrification). | All three seats |
| **Vendor-vocabulary rejections inside PEAD's "allowed" sectors** | FA: 20.7% EPS beat + raised guide, PASSed **"solely on universe exclusion"** (classified "Professional Services"). KR: "even if a clean beat-and-raise materializes, the universe fence prevents coverage" (classified "Retail" — KR is GICS Consumer *Staples*, which IS in the fence). ROST beat and jumped 7% this week — also "Retail," also invisible. The triage vocabulary (Finnhub) doesn't match the fence vocabulary (GICS); names die on string mismatch, not intent. | PEAD |
| **Catalyst's $1B floor** | See the floor section below — it has blocked two quality setups and never prevented a loss. | Catalyst |
| **Styles: ETFs, macro, dividend/defensive** | `markets` is US_EQUITIES-only on every seat; no seat runs defensive/income. Momentum is *deliberately* absent (correct — don't re-add). | Book-level |

### Fence-change proposals (each = one config edit, approval-gated, with before/after)

**P1 — PEAD: delete the sector fence.** `sectors: [7 GICS strings] → []` (empty = no
filter). Keep industries as-is or empty them too; keep `marketCapMin` $200M.
*Evidence for deletion rather than widening:* every fence-only rejection was a quality
print (FA, KR, ROST); every junk candidate was **also** rejected on print quality (RH
pop-and-fade, KMX overbought + bearish sell-side, SAIC composite 6/10) — the 4-signal
print discipline does all the real work, the fence only adds false rejections. This is
a deletion, not a new gate — consistent with the standing "stop adding gates" law and
with ANALYST_LINEUP's own note that PEAD's edge is sector-agnostic.
*Before:* FA, KR, ROST-class prints invisible. *After:* triage sees them; the print
gates still reject anything unclean. (Signal routing is paused, so there is no
router-noise cost today; revisit fence shape when Signals rebuild lands.)

**P2 — Catalyst: lower the cap floor $1B → $500M, paired with rules already in the
playbook.** `marketCapMin: 1000000000 → 500000000`, plus two prompt-side lines: sub-$1B
names are eligible **only** for supplemental/label-expansion events or
positive-Phase-3-data-in-hand setups, and they size at the $5k band floor exactly.
*Evidence:* The floor has **never prevented a loss** — IONS (−$752) and MLTX (−$911),
the seat's only two double-digit losses, were both comfortably above $1B. What it did
block, from the seat's own PASS records:

| Ticker | Cap at PASS | Event | What the floor cost |
|---|---|---|---|
| **REPL** | $799M (7/17) | RP1 melanoma BLA resubmission, PDUFA 8/2 | **Approved Aug 2 — stock rose >120% across three sessions.** PASS record cites the floor first. (Honesty: the 08-24 event-mix gate would ALSO have excluded it — single-asset resubmission binary. The floor wasn't the only guard; but it was the stated one.) |
| **IRD** | $322M (8/27) | Presbyopia **sNDA — a supplemental on an approved molecule**, 10/17 PDUFA, 96% buy | "Strong catalyst, wrong size for this book. Do not re-evaluate until market cap crosses $1B." **The floor was the only disqualifier** — this is the exact intersection where a setup passes the event-mix gate and dies on size alone. |

At $500M the junk still dies on size (CING $60M, BTAI $23M) and CAPR ($589M) still
dies on quality (negative AdCom, prior CRL — proving the event gates carry the real
protection). **Keep the $20B ceiling** — the RHHBY pass was correct: a supplemental on
a $294B pharma isn't an event for the stock.
*Before:* IRD-class supplementals invisible below $1B. *After:* IRD is actionable this
window at $5k; REPL-class binaries remain excluded by the event-mix gate, as decided.

**P3 — Compounder: give the energy-transition and onshoring themes the sectors and
industries they need.** `sectors: += ["Energy","Materials"]`; `industries: +=
["Oil & Gas Storage & Transportation","Metals & Mining","Chemicals","Construction
Materials"]` — all four validated against actual `Signal.industries` strings (24/46/10/3
occurrences; the 2026-08-12 rule: never add a fence value the data never emits).
*Before:* "Energy transition" reaches only Utilities/IPP/Electrical Equipment;
"Onshoring" reaches only Machinery/C&E. *After:* nuclear fuel (Cameco-type), midstream,
copper/electrification, and onshoring materials become reachable. The conf-78 bar and
theme gates still filter — this widens the seat's eyes, not its standards.

**Deliberately NOT proposed:** re-adding momentum (ruled out 7/27, correctly); dropping
Catalyst's ceiling; touching PEAD's prompt; a 4th seat *today*. On the 4th seat: the
uncovered regimes are commodity/inflation, defensive/dividend, and macro/ETF — a
defensive/ETF macro sleeve is the one candidate that plausibly clears the
offset-idle-periods bar (quality/defensive is productive exactly when event and drift
seats idle). If, after P1–P3 and this discovery cycle, idle cash is still >$25k,
that's the builder proposal to make. Not before.

---

## (b) The watchlist — verdicts confirmed, with challenges

**The audit's 11 KEEP / 6 RE-PRICE / 4 REFRESH / 1 DEMOTE bucketing survives
re-verification.** Every load-bearing number matched the DB (NOW's $78 stop vs $165
target, PLTR's target=buy-level, ABT's $84 floor 25% down, the four June research
dates). Challenges and sharpenings:

- **ISRG (KEEP → KEEP, but escalate):** the buy trigger is at the money and the 8/20
  review's "deliberate re-entry decision" (the stop-out cost $2,930 on paper) is still
  unmade. An armed $10k entry with an unresolved question attached is a decision, not a
  watch. It's on the click list.
- **PLTR (RE-PRICE, harder):** flagged for re-price on 8/24, still risking 42% for
  literally 0% paid upside. If Monday's run doesn't land the re-price, it joins ASML as
  a demote candidate (#575 isn't merged, so demote candidates are listed, not forced).
- **NOW (RE-PRICE, with context):** the 8/28 gate receipt shows the agent *tried* to
  update NOW and was refused for a missing ENTER trigger — the re-price is being
  attempted and bouncing. Expect it to need one clean pass Monday.
- **SMMT/CYTK (KEEP, note the cluster):** AGIO 11/1 + SMMT 11/14 + CYTK 11/14 is a
  second event cluster forming behind September's. Same discipline as IONS/MIRM: the
  moment to apply the event-mix/concentration question is at fill approval.
- **ASML (DEMOTE-OR-DROP — confirm):** buy level 14% above a falling price; first
  official soft-watch candidate. Listed, not forced.

**What the watchlist is missing as a whole:**

1. **PEAD has nothing from the freshest print window.** All 4 bench names date to the
   Aug 20–21 sessions; the Aug 25–28 wave (NVDA, MRVL, ADSK, CRWD, WDAY — the biggest
   print week of the quarter) is entirely unrepresented. For a seat whose edge decays
   in days, that's the hole. Discovery below fills it.
2. **Catalyst is 100% FDA.** The mandate lists M&A votes, court rulings, contract
   awards, index rebalances; the bench holds five biotech PDUFAs and zero of anything
   else — the in-fence tech lane ($1–20B semis/software M&A votes, per the playbook's
   own "abundant slice" finding) is empty. And December is bare: after 11/14 the next
   dated event on the book is held PRAX's 12/27.
3. **Compounder's holes are repair-shaped, not name-shaped.** All 7 themes have at
   least token coverage, but GLP-1 has zero bench behind held WST, and Energy-sector /
   Materials names are structurally unreachable until P3. The 13:4 bench needs pruning
   before feeding — the audit already said it; discovery for this seat this week is
   repairs plus at most soft watches.

---

## (c) Discovery — designed, scouted, dispatch-ready

The Sunday cron produced nothing (dead since 5/31), so I ran the scout layer myself
(calendar-first for Catalyst, print-quality-first for PEAD, per playbook). **I did not
hand-insert thesis rows into production** — a malformed hand-rolled row is exactly the
kind of thing that breaks Monday's 8 AM run, and the thesis-writer path exists to
price plans against live data. Each seat's mint is one paste (click list, section e).
Every candidate below already clears fence + event gates on the evidence gathered
today; the writer re-verifies live at dispatch.

### PEAD — fill the 3 empty bench slots (paste 1)

| # | Name | The print | The plan to propose |
|---|---|---|---|
| 1 | **TOST** | Aug 4: EPS + revenue beat, raised FY guide, 6 sell-side PT raises inside 72h, gap only ~+3% (clean), ~$36.6 now. Its own 8/20 PASS record says: "PASS only due to discovery cap — strong re-evaluation candidate." Day ~18 of the 30–60d window. | ENTER on reclaim of the post-print high (writer verifies level), stop −8%, target +15%, hard no-entry after ~Sep 20 (T+45) |
| 2 | **ADSK** | Aug 27: $2.05B rev +16%, EPS $3.30 vs $3.12, FY guide raised. Reaction mixed (+6.2% session, −5.1% after hours) — the 72-hour revision check IS the 4-signal process; Monday is day 2, the textbook entry day if revisions confirm. | Standard drift plan if signals confirm Monday: enter days 1–3, stop −8%, target +12–15% |
| 3 | **MRVL** | Aug 27: record $2.74B +37%, EPS $0.94 beat, FY27/FY28 targets raised to $12B/$18B — and the stock fell 10.3% Friday. A beat-and-raise rejected by the tape is NOT a drift entry — mint it as a **reclaim-gate watch** (the CYTK/HPE shape): it earns the entry only by repairing. | ENTER only on reclaim of the pre-print level on above-average volume; ages out in 3 weeks if no repair |
| 4 | **FA** *(only if P1 approved)* | Aug 6: 20.7% EPS beat, 8.1% rev beat, FY raised, Barclays PT $30, Needham upgrade. In window through early October. The name the fence cost you — still buyable. | Standard drift plan; writer confirms drift intact (~day 24) |

Overflow → **soft watches** (wake condition, no clock, no plan): ROST (fence-blocked
until P1; wake: +5%/1D), NVDA (mega-cap pass precedent stands; wake: drift persistence
+8% from print). CRWD/WDAY printed the same week but Friday reactions weren't
verifiable today — they're in the manual pack, not the mint.

### Catalyst — fill from the calendar under the event-mix gate (paste 2)

| # | Name | The event | Why it passes the gate |
|---|---|---|---|
| 1 | **BBIO** | BBP-418, LGMD2I — **11/27 PDUFA, Priority Review**, Phase 3 FORTIFY met ALL primary + secondary endpoints at interim | The de-risked shape behind XENE/ARQT: positive data already in hand, filing ahead. Multi-asset company (Attruby marketed) — passes the single-asset exclusion. ~$12B cap, in-fence. Outside the September cluster. Propose: accumulate 2–4 weeks pre-event, stop −8–10%, size in band |
| 2 | **IBRX** | ANKTIVA sBLA, papillary NMIBC — **PDUFA 1/6/27** | A **label expansion on an already-approved drug** — the event type the gate exists to prefer (a miss costs 5–8%, not 20%). Writer verifies cap in $1–20B and balance-sheet risk |
| 3 | **NUVB** | IBTROZI **sNDA** (ROS1 NSCLC) — **1/4/27** | Supplemental on an approved drug. Cap is borderline ~$1B — writer verifies at dispatch; if it's under and P2 hasn't landed, it's a soft watch |
| 4 | **IRD** *(only if P2 approved)* | Presbyopia sNDA — **10/17 PDUFA**, 96% buy | The floor test case. Sized at the $5k floor per P2's pairing rule |

**Explicitly NOT added, and why:** NUVL (9/18) and RARE (9/19) — first-approval
binaries *inside* the September window the book already carries (SRRK 9/30 held, IONS
9/22 + MIRM 9/26 armed); the event-mix gate says no. COGT (11/30) — single-asset
first-approval binary. SVRA (11/22) — sub-floor and first-approval. MRK (10/10) —
above the ceiling, and a supplemental on a mega-cap isn't an event for the stock.
The December hole is real; the manual pack's M&A-vote and court-docket prompts are
aimed at it.

### Compounder — repair before feeding (paste 3)

No new managed watches this week (bench 13:4, ten of thirteen failing). The paste
drives, in order: re-price ABT / NOW / PLTR / BWXT, refresh ETN / GD / GEV / VST
(GEV first — an event-gated entry armed at-market on 11-week-old research fires on the
*next* print with stale reasoning), and names **ASML** (and PLTR, if its re-price
doesn't land) as demote candidates for your call. After P3 lands, energy-sector and
materials candidates arrive through the manual pack as soft watches first.

---

## (d) The manual discovery pack

Rules of engagement (from the playbook, so the prompts don't repeat old failures):
two filters max at retrieval; never require in-post citations; label attributes,
filter in the Hindsight paste; calendar-first for dated events, Grok for "is it real /
is it crowded"; trader convergence is a crowding warning, not confirmation; every
name that survives must terminate in a row — WATCHING or PASSED, overflow = soft watch.

### Lane 1 — PEAD: the fresh-print sweep (run Monday evening, again Thursday)

**Grok (Play C):**
```
Who on X correctly called post-earnings drift winners this year (APP, NVDA-style
30-60 day runs after clean prints)? From the Aug 25–Sep 5 earnings wave — NVDA, MRVL,
ADSK, CRWD, WDAY, Snowflake, PANW (reports Sep 1), and anything mid-cap I'm not
naming — which beat-and-raise prints are those people actually buying for a 30-60 day
drift, and which do they say are already priced? US-listed, $2B+ only. For each:
ticker, the specific claim, and whether sell-side PT raises followed within 72 hours.
```

**Perplexity Finance:**
```
List US-listed companies that reported earnings between Aug 24 and Sep 5, 2026 with:
EPS beat ≥5%, revenue beat, AND raised full-year guidance. Include actual numbers
(EPS vs consensus, revenue beat %, old vs new guide), the stock's reaction on the
print day and since, and how many sell-side firms raised price targets within 72
hours. Exclude one-time-item beats. Flag any that already gapped more than 10%.
```

**Reddit:**
```
site:reddit.com (r/stocks OR r/investing OR r/wallstreetbets) DD posts on earnings
beats with raised guidance from the last week of August 2026. Sort by top, past week.
Skip meme stocks and misses.
```

### Lane 2 — Catalyst: December-and-beyond supplementals + the empty tech lane

**Perplexity (calendar-first — the primary source for this seat):**
```
List every FDA decision (PDUFA/action date) from November 15, 2026 through February
2027 that is a SUPPLEMENTAL application — sNDA, sBLA, or label expansion on an
already-approved drug. For each: company, ticker, market cap, drug, indication, exact
date, and the primary source (company PR or FDA document). Mark anything that is a
first approval or single-product company — do not drop it, label it.
```

**Perplexity (the tech lane nobody has fed):**
```
List announced M&A deals in US semiconductors and software with target market cap
$1B–$20B that have a dated milestone in the next 90 days: shareholder vote date, HSR
or other antitrust deadline, or outside date. Also list S&P 400/500 index rebalance
candidates for the September and December 2026 rebalances. For each: parties, date,
deal spread or expected move, and the primary source.
```

**Grok (qualitative layer, AFTER the calendar):**
```
For these dated events: [PASTE CALENDAR OUTPUT]. Which are the PDUFA/FDA-tracking
handles (@PDUFA_Pulse, @BPharmCatalyst, @adamfeuerstein and peers) actually talking
about? For each: is the date confirmed or in doubt, what residual risk do they flag
(AdCom history, CRL history, manufacturing), and how crowded does positioning look?
```

### Lane 3 — Compounder: theme gap-fill (after P3; soft watches first)

**Grok (Play A — one theme per session; run GLP-1 first):**
```
Chat 1: I'm researching the GLP-1/obesity supply chain — CDMOs, injection devices,
fill-finish capacity — as a multi-year theme. Current state of play, sub-areas heating
up, and the 3-5 anchor names. US-listed common stock with enough liquidity for a
$10-15k position ONLY.
Chat 2: Who on X has a verifiable multi-year record on this theme — called WST, LLY
supply-chain winners early? Rank 10-15 by track record.
Chat 3: What US-listed names are those people most bullish on right now? Ticker,
convergence count, specific claim.
```
Then repeat with THEME = "US onshoring/reshoring after the tariff ruling" and THEME =
"nuclear fuel cycle and datacenter power" (the P3 unlock).

### Lane 4 — Washington & the world (verified as of this weekend; who benefits)

- **The Supreme Court struck down the broad tariffs (~Aug 21)** — a ~$900B/decade
  budget hole and **$166B in already-collected tariffs to be refunded.** Two angles:
  (1) refund windfalls — importers/retailers/manufacturers that expensed big tariff
  costs get one-time cash and guidance tailwinds (Walmart's beat already leaned on
  tariff benefits — that's the pattern, and PEAD must reject the one-time versions of
  it); (2) **replacement tariffs** are expected to be narrower/sectoral — steel,
  aluminum, semis — which re-arms the onshoring theme with named beneficiaries.
  ```
  Perplexity: Which US-listed companies disclosed the largest tariff costs in 2025-26
  filings and now stand to receive refunds after the Supreme Court ruling striking the
  broad tariffs? Which sectors are expected to be covered by replacement Section 232
  tariffs, and which US producers benefit? Market cap $1B+, with the disclosure source.
  ```
- **Defense:** FY26 enacted at $838.7B (+$8.4B above request); FY27 appropriations
  season runs this fall.
  ```
  Perplexity: Which defense primes and tier-1 suppliers have the most FY27 US defense
  budget exposure in missiles/munitions, shipbuilding, and space, with backlog growth
  and book-to-bill above 1 in their latest quarter? Any dated contract award decisions
  or budget votes in the next 60 days?
  ```
  (Feeds the GD refresh and backs held HWM.)
- **The Fed:** Warsh has held at 3.50–3.75% five straight meetings; core PCE 3.3% and
  sticky; next FOMC **Sep 16** with market odds genuinely two-sided. Do NOT position
  the book on a rate guess — build both conditional lists:
  ```
  Grok: Who on X with a real macro track record is positioned for the Sep 16 FOMC,
  and what equities (not futures) do they name for (a) a hold-with-hawkish-tone and
  (b) a first cut? Two lists, tickers + claims.
  ```
- **AI power buildout** (the theme the book already owns via CEG and the fence
  currently blocks the rest of): after P3, the nuclear-fuel/midstream prompts in Lane
  3 cover it.

**Close every funnel with:** `ticker | source(s) | convergence | the claim | the dated
catalyst | freshness` — then paste into the seat's discovery with the standing gates
(composite ≥7, risk/reward ≥2:1, cap to free slots, overflow → soft watch, PASS-record
the rest).

---

## (e) Needs your click

1. **Run paste 1 (PEAD discovery)** — TOST, ADSK, MRVL-as-reclaim-watch (+FA if you
   approve P1). Fills the 3 empty bench slots from the freshest print window.
2. **Run paste 2 (Catalyst discovery)** — BBIO, IBRX, NUVB (+IRD if you approve P2).
3. **Run paste 3 (Compounder repair)** — re-prices, refreshes, ASML (± PLTR) as
   demote candidates. No new names for this seat this week.
4. **Approve/decline the fence changes:** P1 PEAD sector-fence deletion · P2 Catalyst
   floor $1B→$500M with the supplemental-only + floor-size pairing · P3 Compounder
   Energy/Materials widening. Exact before/after in section (a).
5. **Standing decisions already on your desk (referenced, not re-litigated):** MU exit,
   PRAX floor, WST stance, SMMT buy, and the IONS/MIRM event-mix call before those
   fills arrive. Plus ISRG: the re-entry decision, with its trigger at the money.
6. **Ops, one line:** the Sunday discovery cron and the signal router have both been
   silent since May 31. If the cron half isn't deliberate, the Inngest app needs a
   re-sync. (Handoff note only — no ticket filed, per rules.)

---

## Sources (external claims verified this session)

- REPL approval + >120% move: [STAT News](https://www.statnews.com/2026/08/06/replimune-melanoma-drug-rp1-fda-approves-phase-3-confirmatory-trial/), [CancerNetwork](https://www.cancernetwork.com/view/fda-approves-rp1-nivolumab-for-progression-on-anti-pd-1-therapy-in-melanoma)
- FA Q2 + PT raises: [Investing.com](https://www.investing.com/news/company-news/first-advantage-q2-2026-slides-15-revenue-growth-beats-expectations-93CH-4843505), [StockStory](https://stockstory.org/us/stocks/nasdaq/fa/news/earnings/first-advantage-nasdaqfa-reports-bullish-q2-cy2026)
- TOST price/consensus: [Yahoo Finance](https://finance.yahoo.com/quote/TOST/), [MacroTrends](https://www.macrotrends.net/stocks/charts/TOST/toast/stock-price-history)
- MRVL Q2 FY27 + reaction: [Yahoo Finance earnings call summary](https://finance.yahoo.com/markets/stocks/articles/marvell-technology-inc-q2-2027-123000519.html), [MarketBeat](https://www.marketbeat.com/earnings/reports/2026-8-27-marvell-technology-group-ltd-stock/)
- ADSK Q2 FY27: [Investing.com](https://www.investing.com/news/company-news/autodesk-q2-fy27-slides-revenue-up-16-guidance-raised-93CH-4880312)
- BBIO BBP-418 PDUFA 11/27: [BridgeBio IR](https://investor.bridgebio.com/news/news-details/2026/BridgeBio-Announces-FDA-Acceptance-and-Priority-Review-of-NDA-for-BBP-418-for-LGMD2IR9/default.aspx), [BioSpace](https://www.biospace.com/fda/fda-accepts-bridgebios-application-for-potential-first-limb-girdle-muscular-dystrophy-drug)
- IBRX ANKTIVA sBLA PDUFA 1/6/27: [ImmunityBio PR](https://immunitybio.com/immunitybio-announces-fda-acceptance-of-supplemental-bla-for-anktiva-plus-bcg-in-bcg-unresponsive-non-muscle-invasive-bladder-cancer-with-papillary-disease-pdufa-date-set-for-january-6-2027/)
- PDUFA calendar Sept–Jan: [MarketBeat FDA calendar](https://www.marketbeat.com/fda-calendar/upcoming/)
- Tariff ruling + refunds: [Washington Times](https://www.washingtontimes.com/news/2026/aug/21/supreme-court-blew-nearly-trillion-dollar-hole-budget-striking-trump/)
- Defense FY26 enacted: [CRFB Appropriations Watch](https://www.crfb.org/blogs/appropriations-watch-fy-2026)
- Fed/Warsh/rates: [TradingEconomics](https://tradingeconomics.com/united-states/interest-rate/news/485858), [Forbes Fed tracker](https://www.forbes.com/sites/investor-hub/article/fed-meeting-tracker-interest-rate-strategy/)
- Week's market/earnings context: [CNBC Aug 26](https://www.cnbc.com/2026/08/26/stock-market-today-live-updates.html), [Kiplinger NVDA live](https://www.kiplinger.com/investing/live/nvidia-earnings-live-updates-and-commentary-august-2026)
