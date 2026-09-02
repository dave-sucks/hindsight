# Discovery Prep — Secular Compounder — 2026-08-30

## Going-in context — this is a REPAIR pass, not a sourcing pass

- **Seat:** Secular Compounder (LIVE). Band $10k floor → $15k cap, live promotion cap $10k.
  **2 open / 4 max = 2 FREE SLOTS.** (The 08-28 handoff said 1 free slot — the database says
  2. Read the live count, never the doc; a wrong number here has suppressed sourcing before.)
- **Why no new names this week:** the seat holds **13 WATCHING names against a 4-slot book**,
  and 10 of the 13 failed the 08-28 audit — 6 need re-pricing, 4 sit on June research. Adding
  candidates to a 13-name bench that can't be acted on makes the bloat worse. **Repair first.**
- **Cadence:** monthly for this seat (Compounder loot lasts months, unlike Catalyst/PEAD).
- **Skip-list:** `CEG, WST, ABT, ASML, BWXT, EME, ETN, GD, GEV, ISRG, MSFT, NOW, PLTR, SYK, VST`
- **DISPATCH_CAP = 0 new managed watches this cycle.** Soft watches only, if anything.

---

## Part 1 — the repair paste (run this now)

> Run on `/analysts/<Compounder id>` → **Discovery mode** or the editor chat. This is a
> bench-repair instruction, not a sourcing paste, so there is no Grok/Perplexity output to
> paste above it.

```
No new candidates this session. This is a bench repair pass on the existing watchlist.
The seat holds 13 WATCHING names against a 4-position book with 2 free slots, and most
of the bench no longer has a usable plan. Work through it in this order and give every
name an explicit disposition.

RE-PRICE these four — the plans are incoherent against current price or risk:

- ABT — buy level $112 with the stock at about $112.01, so it is actively triggering,
  and the stop sits at $84, a 25% drawdown. Fix the plan before a fill happens, not
  after.
- NOW — stop at $78 against a target of $165 and a buy level of $150: risking roughly
  48% to make about 10%. The research is fresh; the numbers are not a plan. Note a
  previous update attempt on this name was refused for a missing ENTER trigger, so make
  sure the re-price includes one.
- PLTR — the target ($190) equals the buy level ($190), which is a plan with zero paid
  upside, against a stop at $110. This was flagged for re-pricing on August 24 and still
  has not been re-priced. If it cannot be given a coherent plan this pass, demote it.
- BWXT — buy level $170 with the stock at about $155.86, which is nearer the $150 demote
  floor than the entry. Re-anchor the entry to where the stock actually is.

REFRESH RESEARCH on these four — the plan shape may be fine but the research is stale:

- GEV — do this one FIRST. It has an earnings-gated entry armed at roughly the market
  price on research from June 12, which means it will fire on the next print using
  11-week-old reasoning.
- GD — June 12 research. The defense story has had a full summer of news since,
  including the FY26 defense bill enacted at $838.7B.
- ETN — June 15 research, dip-buy plan at under $380 with the stock around $416.
- VST — June 12 research, SMA-reclaim gate around $148 with the stock around $139.91.

DEMOTE CANDIDATE — flag for the principal, do not force:

- ASML — buy level $1,930 against a price of about $1,697.61, so the entry sits 13.7%
  above a falling stock, and it fired its own pullback review. This is the profile the
  soft-watch tier was built for: keep a wake condition, drop the review clock and the
  plan. Recommend it, but leave the decision to the principal.

For each name, end with one explicit disposition: KEEP (nothing changed), RE-PRICE (new
levels), RE-CLOCK (new review cadence), DEMOTE (drop the clock and plan, keep at least
one wake condition), or ARCHIVE. Remember that the triggers field is a wholesale
replace — resend every rung you intend to keep.
```

---

## Part 2 — theme prompts, NOW UNBLOCKED (fence widened 08-30)

The seat's mandate names seven themes. **Two of them cannot be reached by the current fence**:
"Energy transition" only reaches Utilities / Independent Power Producers / Electrical
Equipment (so CEG and VST, but no nuclear fuel, no midstream), and "Onshoring" only reaches
Machinery / Construction & Engineering (no materials, no chemicals). This is the same class of
bug found on 2026-08-12, when three of seven themes turned out to be structurally unreachable
and one config edit took aging from zero candidates to four in ten minutes.

**The widening landed 2026-08-30**: `sectors` gained Energy + Materials, `industries` gained
Oil & Gas Storage & Transportation, Metals & Mining, Chemicals, and Construction Materials
(all four verified canonical). Nuclear fuel, midstream, copper/electrification and onshoring
materials are reachable for the first time. **Still repair the bench first** — but these
prompts are no longer blocked, and anything they surface should land as a **soft watch** until
the 13-name bench is back under control.

**Play A, one theme per session, GLP-1 first** (it has zero bench behind
held WST, and the seat's own scout roster for it is seeded but unscored: @Biohazard3737,
@Ashwinreads, @academianlcap, @AndrewPannu):

```
Chat 1: I'm researching the GLP-1 and obesity supply chain — contract manufacturers,
injection device makers, fill-finish capacity — as a multi-year investment area. Give me
the current state of play: which sub-areas are heating up, key developments in the last
one to two months, and the 3-5 anchor names everyone references. US-listed common stock
with enough liquidity to support a $10,000 to $15,000 position ONLY — do not surface
Swiss, German, Indian or private companies.

Chat 2: Now the people. Who on X has a verifiable multi-year track record on this theme
— called the manufacturing and supply-chain winners early, not just posting now? Rank
10-15 by track record. For each, what they nailed and whether they're posting this
month.

Chat 3: From those people, which 5-10 US-listed names are they most bullish on right
now? Per name: ticker, how many of them are on it, and the specific claim. Flag any
name three or more of them independently like.
```

Then repeat with **THEME = "US onshoring and reshoring after the Supreme Court tariff
ruling"** (replacement tariffs are expected to be narrower and sectoral — steel, aluminum,
semis — which names beneficiaries), and **THEME = "the nuclear fuel cycle and datacenter
power"** (the part of energy transition the current fence cannot see).

The "US-listed only, liquid enough for a $10-15k position" line is not optional — on
2026-08-12 roughly half the GLP-1 session was spent surfacing names that could never be
bought.

---

## Standing reminders

- **Judge quality against the candidate's own industry**, never a software screen. The old
  "25% revenue growth + 30% FCF margin" screen was removed on 2026-08-12 because it filtered
  out every industrial, E&C, CDMO and utility compounder — including this seat's own book.
- **Validate any new industry string against the data before trusting it.** `Independent Power
  and Renewable Electricity Producers` appeared in zero Signal rows; the data emits
  `Independent Power Producers & Energy Traders`. A fence value that never matches is
  invisible dead weight.
- **Every surviving candidate must terminate in a row** — WATCHING or PASSED or soft watch.
  On 2026-08-12 two High-priority names (PWR, ROK) existed only in the chat transcript and
  were never recorded.
