# Book Trust Audit — 2026-08-28

**Session:** full-book trust audit (special session, not the weekly cadence review).
**Why:** a week of heavy system changes (levels-are-triggers, the entry-bug fix in #566, the
EME sale) left the principal unsure whether the analysts, holdings, and watchlist can be
trusted. This audit looks at everything and renders a verdict per name.
**Prior baseline:** [2026-08-20](./2026-08-20.md) + its 08-24 addendum.
**Clock at session start:** 2026-08-28 19:43 ET (after market close).
**Every number below was verified against the production database tonight.** Prices are the
evening portfolio snapshot (generated 8:00 PM ET tonight) cross-checked against the latest
5-minute trigger price rows. Position sync health: HEALTHY — zero orphans, zero quantity
mismatches, cost-basis drift ~0.

---

## TL;DR — can you trust the book?

**Mostly yes. The mechanics that were rebuilt this week are visibly working** — today alone:
ANET's trail fired and re-checked the winner, EME's floor breach ran the full chain (trail
fired → sale executed at your approval → plan set down to a bare watch), and SMMT's buy
trigger fired this morning, proving the entry path is alive again after the #566 fix. Nothing
in the book is mystery state; every position has an armed ladder; no name is held or watched
by two analysts; the account reconciles to the penny.

**What needs your attention is three decisions, not thirty:**

1. **MU (PEAD)** — the position sits below both of its exit floors ($931 vs the $935 exit and
   the $948 trail floor), conviction was already cut to LOW, and the thesis itself says
   "defensive mode." The plan says this trade is over at +3.9%. Decide the exit.
2. **PRAX (Catalyst)** — the book's biggest winner-that-was. +22.5% at the August 17 peak, now
   +8.2%, and the only hard floor is $315 — *below* entry. It is the one position with no
   trail. Re-arm protection above entry or consciously accept round-trip risk into the
   December PDUFA.
3. **The Compounder watchlist** — 13 names for a 4-slot book with only 2 slots free, and 10 of
   the 13 fail this audit: 5 need re-pricing (one has a stop 48% below its buy level, one has
   target = buy price), 4 sit on research from mid-June, and ASML's buy level is 14% above a
   falling price. This seat's holdings are fine; its bench is not.

**Deployment:** $53,681 invested of $91,250 equity (**58.8%**), $37,569 cash. 7 of 15 slots.
**September binary window:** $5,377 held through it today (SRRK, 5.9% of equity) — but armed
buy plans on IONS (9/22) and MIRM (9/26) could take that to ~$21k (~23%) if both trigger and
fill at band max. Decide the event-mix question *before* those fills arrive, not after.

---

## The seats vs their mandates

| Seat | Env | Mandate | Band / slots | Holds | Watches | Coherent? |
|---|---|---|---|---|---|---|
| **PEAD Specialist** | LIVE | post-earnings drift, 30–60d | $7k–$14k / 6 | MU, ANET, PBH ($26.4k) | 4 | ✅ Yes — all three holds are fresh-print drift setups inside the fence; 4:6 watch ratio is right |
| **Catalyst Event PM** | LIVE | binary events, $1–20B health/tech | $5k–$8k / 5 | PRAX, SRRK ($12.3k) | 5 | ✅ Yes — all biotech catalysts in-fence, sizing inside band; event-*type* mix is the open question (below) |
| **Secular Compounder** | LIVE | secular holds, 18–24mo | $10k–$15k (realMax $10k) / 4 | CEG, WST ($15.0k) | 13 | ⚠️ Holdings yes, bench no — 13:4 watch ratio, 10 of 13 fail plan-sanity or freshness |

Sizing note on the Compounder: both holds are under the seat's own $10k floor at cost (CEG
$8.4k, WST $7.1k) — proposal-to-fill drift, worth one glance on the next entry, not a
structural problem. PEAD's ANET is $200 under its $7k floor; same category.

---

## Every open position (7, all LIVE)

Prices are tonight's close snapshot. "Floor" = the tightest armed EXIT trigger on the thesis.

| # | Analyst | Ticker | Entry | Now | P&L | Effective floor | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | PEAD | **ANET** | $183.83 | $195.44 | **+6.3%** | ~$194.88 (4% trail off $203 peak) + $184.50 breakeven stop | **SOUND** |
| 2 | PEAD | **PBH** | $52.98 | $52.49 | −0.9% | $47.50 hard stop (−10.3%) + full standing ladder | **SOUND** |
| 3 | PEAD | **MU** | $895.94 | $931.24 | +3.9% | $935 exit + $948 trail — **both already breached** | **NEEDS ATTENTION** |
| 4 | Catalyst | **SRRK** | $53.90 | $57.82 | **+7.3%** | $55.90 (above entry — gain locked) | **SOUND** |
| 5 | Catalyst | **PRAX** | $318.81 | $344.95 | **+8.2%** | $315 — **below entry, no trail** | **NEEDS ATTENTION** |
| 6 | Compounder | **CEG** | $280.33 | $276.84 | −1.2% | ~$261.81 (8% trail) before the $220 hard stop | **SOUND** |
| 7 | Compounder | **WST** | $355.28 | $336.75 | −5.2% | $330 hard stop — **2.0% below tonight's price** | **NEEDS ATTENTION** |

### The three that need attention — exactly what

**MU — the plan says this trade is over; finish it.** 13 shares, $12.1k, the book's largest
position. The ladder was ratcheted well (exit raised to $935, an 8% trail off the $1,030.62
peak = $948 floor, plus earnings-miss and guidance-cut exits set to close without an agent in
the loop). Tonight's $931.24 is below *both* price floors, the analyst cut conviction to LOW
on 8/24, and the thesis prose is openly defensive. Exiting here books roughly +$459 (+3.9%)
on a trade whose own plan no longer supports holding. This is a decision sitting with you,
not a system failure — the protection did its job by putting it on your desk.

**PRAX — the only unprotected winner in the book.** 20 shares, $6.9k. Peaked at $390.54 on
8/17 (+22.5%); tonight $344.95 (+8.2%) — it has already given back 12% from the high. Unlike
every other winner in the book it carries **no trailing floor**, and its hard exit ($315)
sits below entry. The ladder does have a review at $347 (it fired today), so the analyst is
watching — but watching is not a floor. The catalysts (dual PDUFAs) are Dec 27 / Jan 29, so
there is no event-window reason to leave four months of gain unfloored. Either re-arm a floor
above entry (the standing ruling says only you can set levels down, but raising them is the
whole point of the ratchet) or explicitly accept that this one may round-trip.

**WST — the floor and the horizon disagree; pick one.** 20 shares, $6.7k, never traded above
entry since the 8/20 fill. The $330 stop is 2.0% below tonight's price — one ordinary red day
fires it for about a −$500 loss. That is working protection, and after the ISRG-era −21%
paper stop-outs, a small controlled exit is progress. But a −7% floor on an 18-month GLP-1
infrastructure thesis means the stop will almost always fire on noise before the thesis gets
its test. If you believe the 18-month story, expect this exit and treat it as a re-entry
question; if you don't, the stop is doing exactly what you want. No action required — just
don't be surprised, and don't call it a failure when it fires.

### The four that are sound — one line each

- **ANET:** textbook. Breakeven hard stop plus a deliberately tightened 4% trail off the $203
  peak; the trail fired on today's dip and the gain (~+6%) is effectively banked either way.
  Research 8 days old on a 60-day drift plan. HIGH conviction, earned.
- **PBH:** 4 days in, −0.9%, full standing ladder armed (8% trail, +10% checkpoint, −12%
  loser review, $47.50 stop), fresh research, HIGH conviction with an honest bear case.
- **SRRK:** the deliberate September binary. Floor ratcheted *above* entry ($55.90 vs $53.90
  cost) so the pre-event drift gain is locked; 5% giveback review fired today and was looked
  at. Be clear-eyed: a floor protects the drift, not the event — a CRL on 9/30 gaps through
  any stop. That risk is this seat's mandate, sized at $5.4k inside the band. Research 1 day old.
- **CEG:** −1.2%, effective floor is the 8% trail (~$262, capping downside ~−6.6% from here),
  with $220 as the thesis-broken level. 21-day-old research on a 24-month thesis is fine.

---

## Every WATCHING thesis (22)

Verdict key: **KEEP** = plan sane, price reachable, research fresh enough. **RE-PRICE** =
levels no longer make sense against price or risk >20%. **REFRESH** = plan may be fine but
the research is too old to trust. **DEMOTE-OR-DROP** = candidate for the new soft-watch tier
or removal.

### Catalyst Event PM (5) — freshest bench in the book

| Ticker | Buy level | Price | Gap | Stop risk | Catalyst | Research | Verdict |
|---|---|---|---|---|---|---|---|
| AGIO | >$35.70 | $34.30 | −3.9% | 14.6% | 11/1 | 1d | **KEEP** — clean setup, sane risk |
| SMMT | >$14.33 | $14.22 | −0.8% | 19.7% | 11/14 | 0d | **KEEP** — fired this morning (the #566 proof); risk just under the wire |
| CYTK | >$80 | $72.32 | −9.6% | 16.3% | 11/14 | 1d | **KEEP** — deliberate buy-on-reclaim above the 8/20 stop-out; only re-enters on repair |
| IONS | >$65 | $62.45 | −3.9% | **33.8%** | **9/22** | 4d | **RE-PRICE** — a $43 stop on a $65 entry is a one-third-loss plan; tighten it or size it as the binary it is, and apply the event-mix gate before this fills |
| MIRM | >$105 | $99.70 | −5.0% | **21.9%** | **9/26** | 4d | **RE-PRICE** — stop width just over the line; same September-binary decision as IONS |

Both RE-PRICE names are HIGH conviction with reachable buy levels — the *plans* need work,
not the ideas. The 8/20 review's finding stands: this seat's only double-digit losses came
from first-approval gaps. The playbook now says supplementals over first-approval binaries;
IONS and MIRM are where that rule meets the road, and both are within 5% of triggering.

### PEAD Specialist (4) — nothing wrong here

| Ticker | Buy level | Price | Gap | Stop risk | Research | Verdict |
|---|---|---|---|---|---|---|
| AMAT | >$498 | $482.51 | −3.2% | 8.0% | 8d | **KEEP** — tight, classic drift plan |
| CSCO | >$116.10 | $112.14 | −3.5% | 12.4% | 8d | **KEEP** |
| HPE | >$54.50 | $54.40 | −0.2% | 18.3% | 7d | **KEEP** — at the trigger; buy-on-reclaim after the profitable 8/19 stop-out; stop is wide for this seat but under the line |
| HWM | >$284 | $267.61 | −6.1% | 8.1% | 7d | **KEEP** — buy-on-strength plan; not triggering is the design, not a defect |

### Secular Compounder (13) — this is where the trust problem lives

| Ticker | Buy level | Price | Gap | Stop risk | Research | Verdict |
|---|---|---|---|---|---|---|
| SYK | >$348.15 | $342.70 | −1.6% | 11.0% | 16d | **KEEP** |
| ISRG | >$401.23 | ~$401 | at trigger | 16.3% | 16d | **KEEP** — but the 8/20 review's "deliberate re-entry decision" (it cost $2,930 in paper) is still unmade and the trigger is at the money |
| MSFT | <$480 (dip buy) | $506.24 | −5.2% dip | 12.5% | 25d | **KEEP** — sane dip plan; research at the freshness border |
| EME | *(no levels — demoted today)* | $758.31 | — | — | 16d | **KEEP** — sold today at your approval, plan correctly set down to a bare 7-day watch; re-underwrite before re-arming |
| ABT | >$112 | $112.01 | at trigger | **25.0%** | 16d | **RE-PRICE** — actively triggering with a $84 floor 25% down; fix before a fill, not after |
| NOW | >$150 | $145.16 | −3.2% | **48.0%** | 1d | **RE-PRICE** — stop $78 vs target $165: risking 48% to make 10%. The research is fresh; the numbers are not a plan |
| PLTR | >$190 | $185.28 | −2.5% | **42.1%** | 11d | **RE-PRICE** — target ($190) equals the buy level: a plan with zero paid upside. Flagged "re-price" on 8/24, still not re-priced |
| BWXT | >$170 | $155.86 | −9.1% | 14.7% | 7d | **RE-PRICE** — price is nearer the $150 demote floor than the buy level; re-anchor the entry |
| ETN | <$380 (dip buy) | $416.07 | −8.7% dip | 6.6% | **74d** | **REFRESH** — plan shape is fine, research is from June 15 |
| GD | ~$340 composite | $380.04 | −10.5% dip | 10.3% | **77d** | **REFRESH** — June 12 research; the defense story has had a whole summer of news since |
| GEV | earnings-beat gate ~$950 | $953.54 | at market | 17.9% | **77d** | **REFRESH** — an event-gated entry armed on 11-week-old research will fire on the *next* print with stale reasoning |
| VST | SMA-reclaim gate ~$148 | $139.91 | −5.7% | 17.5% | **77d** | **REFRESH** — June 12 research, price below the gate |
| ASML | >$1,930 | $1,697.61 | **−13.7%** | 18.1% | 21d | **DEMOTE-OR-DROP** — buy level 14% above a price that fired its own pullback review today; this is the exact profile the new soft-watch tier was built for |

**Bucket totals: KEEP 11 · RE-PRICE 6 · REFRESH 4 · DEMOTE-OR-DROP 1.**
Catalyst and PEAD contribute 7 of the 11 KEEPs and none of the REFRESHes. Every stale or
incoherent plan in the book belongs to the Compounder bench.

---

## Portfolio level

**Deployment.** $53,681.07 invested / $91,250.30 total equity = **58.8% deployed**, cash
$37,569.23 (41.2%). Slots 7/15 (PEAD 3/6, Catalyst 2/5, Compounder 2/4). Net contributed
capital $88,000; all-time P&L **+$3,250.30 (+3.7%)**, deposit-adjusted. Four days since the
last new entry — consistent with the now-fixed entry bug; the pipeline restarted this morning
(SMMT fired, a buy is in the queue).

**September binary cluster (IONS PDUFA 9/22 · MIRM 9/26 · SRRK 9/30).**
- Riding through it tonight: **$5,377 — SRRK only, 5.9% of equity**, floored above entry.
- Armed and near-trigger: IONS (3.9% below its buy level) and MIRM (5.0% below). If both
  trigger and fill at the seat's $8k band max, September-window exposure becomes
  **~$21.4k ≈ 23% of equity** — three binaries in nine days on one seat, the exact
  concentration the 8/20 review warned about. The gate to apply is event *type* (supplemental
  vs first-approval), and the moment to apply it is when those two fills ask for approval.
- PRAX's PDUFAs are Dec 27 / Jan 29 — outside the window.

**Cross-analyst overlap: none.** All 29 held-or-watched tickers are unique to one analyst.
No name is held by one seat and watched by another.

**Week's trading (8/18–8/28), for context:** 6 closes — SNOW +$2,863, ZETA +$1,243, EWTX
+$462, HPE +$63, CYTK −$416, EME −$731. Net **+$3,484 realized**, and both losses were
plan-driven exits at their floors. The EME chain (floor breach → your approval → sale →
plan set down) is the new machinery working end-to-end on a loser, which is exactly when it
matters.

---

## Flagged to the quarterback (one line each — not investigated, per charter)

- **MU's trigger prose contradicts its own levels** — the $935 exit's rationale still says
  "Exit below $814" and the $1,100 review says "reclaims the 50-day around $934"; ratchets
  moved the numbers and left the old sentences.
- **PRAX Position.stopLoss ($359.30) matches nothing in the thesis ladder** (hard exit $315)
  — display-field drift between the position row and the triggers.
- **MSFT's dip-buy trigger (buy below $480) shows lastFiredAt today with the stock at $506**,
  timestamp identical to the millisecond with SMMT's fire — looks like a lastFiredAt write
  landing on the wrong trigger.
- **EME's demoted thesis still displays the old plan prices** (entry $832.84 / target $1,150 /
  stop $770) in its price fields while the ladder is correctly empty — stale fields after demote.
- **Tonight's digest shows CEG's position with `thesisId: null`** although a HOLDING CEG
  thesis exists — linkage miss in the digest builder.
- **5-minute price rows are uneven across theses** — WST's latest is 8/20, SYK 8/12, ISRG 8/19
  while sibling names update daily; anything reading "latest price" per thesis sees stale data
  for those names.

---

## Appendix — how the numbers were produced

- Roster/mandates: `AgentConfig` (bands, slots, fences) — three enabled LIVE seats confirmed.
- Positions: `Position` `status='OPEN'` joined to `AgentConfig`; entry = `avgCost`,
  peak = `peakPrice`.
- Prices: tonight's `PortfolioDigest` (LIVE, generated 8:00 PM ET 8/28) `facts.book.held[]`
  cross-checked against latest `ThesisUpdate.priceAtTime` per ticker.
- Ladders: `Thesis.triggers` JSON per HOLDING/WATCHING thesis (flattened action/kind/level/pct);
  floors computed from armed EXIT triggers and `peakPrice` for trails.
- Research age: `Thesis.researchUpdatedAt` (never `updatedAt`, which daily reviews refresh).
- Deployment/equity/cash/contributions: `PortfolioDigest.facts` (`totalEquity`,
  `grossExposure`, `cash`, `netContributed`, `totalPnl`).
- Week's closes: `Position` `status='CLOSED' AND closedAt >= 2026-08-18`.
- Sync health: `v_sync_health_now` — HEALTHY, 0 orphans / 0 mismatches.
- No DB writes were made; SELECT-only throughout.
