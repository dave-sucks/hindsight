# RAW — Perplexity Finance — Catalyst Event PM — 2026-08-10

> Verification layer for the Grok sweep. Prompt paired with output.
> Grok raw: [`2026-08-09-CATALYST-grok.md`](./2026-08-09-CATALYST-grok.md)
> · Prep: [`../../discovery-prep/2026-08-09-CATALYST.md`](../../discovery-prep/2026-08-09-CATALYST.md)
> · Yield: [`../FUNNEL.md`](../FUNNEL.md)

---

## Query 1 — pending tech M&A via EDGAR

### Prompt

```
Today is August 9, 2026.

Using SEC EDGAR filings as the primary source, list announced acquisitions of US-listed
SOFTWARE or SEMICONDUCTOR companies that have NOT yet closed, where the target's equity
value is between $1B and $20B.

For each deal: target ticker, acquirer, announcement date, deal price per share, current
share price and the spread, the shareholder vote date (from the DEFM14A or PREM14A), HSR
waiting-period status, any regulatory approvals still outstanding (CFIUS, EU, China SAMR),
the outside date in the merger agreement, and management's guided closing window.

Cite the specific filing for every date. Flag any deal where the spread is unusually wide
relative to time-to-close, and say what the market appears to be worried about.
```

### Output

I identified **two still-pending U.S.-listed semiconductor takeovers** that meet the $1–20B *target equity-value* screen as of 10 August 2026. I excluded already-closed transactions such as IonQ/SkyWater and software deals such as Hg/OneStream and Adobe/Semrush.

#### Pending deals

| Target / equity value | Acquirer | Announced / consideration | Current target price / spread | Vote | HSR / remaining approvals | Outside date | Guided close |
|---|---|---|---|---|---|---|---|
| **SLAB** — Silicon Laboratories; roughly $7.6B equity value at $231/share | Texas Instruments (**TXN**) | **4 Feb 2026**; **$231.00 cash/share**. [investor.silabs] | **$219.21** on 10 Aug; **$11.79, or 5.38% gross spread**. [trefis] | **30 Apr 2026**; approved. The DEFM14A set that meeting date and the subsequent 8-K reported passage. [sec] | **HSR expired 22 May 2026.** [sec] **China SAMR remains the material disclosed/market-identified approval risk.** The merger agreement contemplated additional regulatory approvals; no SEC filing located identifies an outstanding CFIUS or EU Commission approval specifically. [sec] | **4 Feb 2027**, auto-extendable to **4 Aug 2027** and then **4 Feb 2028** for regulatory conditions. [sec] | **First half 2027.** [investor.silabs] |
| **SYNA** — Synaptics; about $6.2B announced equity value / ~$7B EV | onsemi (**ON**) | **25 Jun 2026**; **1.350 ON shares per SYNA share**—a floating per-share value, not cash. [sec] | **SYNA $106.50**; using the latest available **ON $81.17** close, implied consideration is **$109.58**, for a **$3.08, or 2.89% gross spread**. [finance.yahoo] | **Not yet scheduled.** As of the cutoff, the companies had said the S-4/proxy would be filed; no DEFM14A/PREM14A or meeting date was located. [sec] | **No expiration/termination reported yet**; HSR and all applicable antitrust and foreign-direct-investment clearances remain closing conditions. The SEC filing does not name a CFIUS, EU, or SAMR decision/status; China SAMR is the principal externally cited substantive concern. [sec] | **25 Jun 2027**, extendable by up to an aggregate **21 months** to obtain regulatory approvals. [sec] | **Mid-2027.** [sec] |

#### Spread interpretation

- **SLAB — flag: moderately wide after domestic/vote derisking.** A 5.38% cash spread is not extraordinary given the stated first-half-2027 target, but it is conspicuous because shareholder approval is complete and HSR has expired. The apparent residual risk is principally **China/SAMR timing or remedies** in a politically sensitive semiconductor combination; the agreement's unusually long two-step regulatory extension mechanism supports that reading.

- **SYNA — not unusually wide in percentage terms, but it is a floating-stock consideration trade.** The 2.89% discount should not be read as a pure fixed-cash merger-arb annualized return: the consideration moves one-for-one with ON at a 1.35 exchange ratio. The market appears to be discounting a long timetable, unsatisfied shareholder/S-4 conditions, and regulatory uncertainty—particularly a potential SAMR review—rather than pricing a near-term break. The $320M regulatory termination fee is also evidence that clearance risk was explicitly allocated in the agreement.

#### Method notes

"Current" prices are as-of the August 10 cutoff and may be intraday/stale depending on the market-data publisher. For SYNA, the economically relevant reference is the **exchange-ratio-implied value** (1.35 × ON), rather than a fixed nominal offer price. The regulatory columns distinguish what is actually disclosed in SEC filings from external merger-arbitrage reporting; absence of a named CFIUS/EU/SAMR status in the filing should not be treated as proof that no filing was made.

---

## Session notes — Query 1

**Quality contrast with Grok is stark.** Every date carries a specific SEC filing link; it
distinguishes what filings actually disclose from what arb reporting asserts; it states its
own price-staleness caveat. This is what the verification layer is supposed to look like.

**The finding: the deals exist, the *dated events* do not.**

| | SLAB | SYNA |
|---|---|---|
| Vote | **already held** (Apr 30, approved) | **not yet scheduled** |
| HSR | expired May 22 | still open |
| Guided close | 1H 2027 | mid-2027 |
| Outside date | Feb 2027 → Feb 2028 | Jun 2027 + 21mo |
| Spread | 5.38% cash | 2.89% floating |
| Real gate | **China SAMR — no public decision date** | **China SAMR — no public decision date** |

Both fail this seat's hard gate for the same structural reason: **the binding condition is a
foreign antitrust clearance, and SAMR does not publish decision dates.** There is no forward
date to enter 1–4 weeks ahead of. The tradeable event is "clearance arrives, someday within a
12–18 month window" — that is a duration bet, not a dated binary.

**This closes the tech-M&A question.** It was the last live hypothesis for the tech lane, and
it resolves against it on primary sources rather than on X chatter:
- Investor days / conferences → dated but **not binary**
- ITC / antitrust rulings → binary but **mega-cap**
- **M&A → in-fence and in-band, but the gating event is undated**

**Verification win — QRVO looks wrong.** Grok cited a "$QRVO / Skyworks cash deal" in August
2026 posts. A primary-source EDGAR screen for *pending* $1–20B semiconductor targets returns
**only SLAB and SYNA** — QRVO ($8.6B, Semiconductors) is absent. Either the deal already
closed or Grok's mention was stale/wrong. Exactly the class of error the verification layer
exists to catch, and a reminder not to dispatch on scout claims.

**Scope gap — RAMP still unverified.** LiveRamp/Publicis (vote reportedly Aug 17) did not
appear. Perplexity narrowed to semiconductors and named only closed software deals as
exclusions, so RAMP was likely never screened rather than deliberately rejected. It needs its
own targeted check before being written off.

---

## Query 2 — USITC Section 337 + PTAB IPR calendar

### Prompt

```
Today is August 9, 2026.

Search USITC EDIS and PTAB records: which Section 337 investigations have published target
dates for an initial determination or final determination between August 16 and December
31, 2026, and which IPR proceedings have final written decisions due in that window, where
a US-listed company is a party?

For each: investigation or proceeding number, parties, the exact target date, and which
listed company is exposed. Include all market caps and label them.
```

### Output

I found **three verified Section 337 matters** with a published merits deadline in the August 16–December 31, 2026 window and at least one U.S.-listed party. I could not validate a complete PTAB-wide IPR list from the public PTACTS search interface in this session; the IPR matters that surfaced with dates in the window were **denied institution**, so they do **not** have an actual final-written-decision deadline.

#### Section 337 calendar

| Investigation | Parties | Published merits date in window | U.S.-listed company exposed | Market cap / label |
|---|---|---|---|---|
| **337-TA-1446** — *Certain Active Electrical Cables and Components Thereof* | **Complainants:** Credo Semiconductor Inc./Credo Technology Group. **Respondents:** Amphenol Corp., Molex, and TE Connectivity plc | **Final initial determination: Aug. 17, 2026**; **Commission target/final determination: Dec. 17, 2026**. [usitc] | **CRDO** complainant; **APH** and **TEL** respondents | **CRDO: ~$47.7B — large cap**; **APH: ~$208.6B — mega cap**; **TEL: ~$62.5B — large cap**. [marketbeat] |
| **337-TA-1458** — *Certain Wearable Electroencephalogram Devices and Systems and Components Thereof* | **Complainant:** CeriBell. **Respondents:** Natus Medical, Excel-Tech, and Natus Neurology | **Final initial determination: Nov. 19, 2026**; Commission target date is **Mar. 19, 2027**. [usitc] | **CBLL** is the complainant; the named respondents are not separately U.S.-listed issuers | **CBLL: ~$0.7B — small cap**. [finance.yahoo] |
| **337-TA-1448** — *Certain Video-Capable Laptop, Desktop Computers, Handheld Computers, Tablets, Televisions, Projectors, and Components and Modules Thereof* | **Complainants:** Nokia Technologies Oy and Nokia Corp. **Respondents:** Acer, ASUS, and Hisense entities | **Commission target/final determination: Dec. 14, 2026**. The original schedule was October 3, but the target was extended; the final ID was due Aug. 14, just outside your start date. [ipfray] | **NOK** is the U.S.-listed Nokia ADR complainant; no named respondent is a U.S.-listed issuer | **NOK: ~$53.8B — large cap**. [marketbeat] |

#### Exposure interpretation

- **337-TA-1446 is the principal tradable event.** Credo is asserting cable/active-electrical-connectivity patents against Amphenol, Molex, and TE Connectivity. The near-term catalyst is the ALJ's August 17 final ID, followed by the Commission's December 17 final determination; an adverse result can support limited exclusion and cease-and-desist relief.
- **337-TA-1458 is a small-cap complainant catalyst.** CeriBell is pursuing exclusionary relief relating to wearable EEG systems against the Natus/Excel-Tech group. It is a November 19 final-ID event, although the Commission's final determination is not due until March 2027.
- **337-TA-1448 is principally a Nokia legal catalyst.** The current U.S.-listed exposure is Nokia's ADR, rather than a listed respondent. The remaining event is the December 14 Commission determination, with the ALJ merits process apparently substantially complete.

#### PTAB IPR screen

I am **not including petitions that were denied institution** as "FWD due" events. That distinction matters: PTAB's statutory one-year final-written-decision period begins only after institution, and a denied petition has no final written decision to be issued.

Examples of potentially misleading screen hits that should be excluded:

- **IPR2025-00893**, *Sun Pharmaceutical Industries v. Nivagen Pharmaceuticals*: materials referenced a projected November 2026 FWD, but the Board **denied institution**, meaning no FWD will issue.
- **IPR2025-00606, -00608, -00609, and -00610**, *NVIDIA v. Neural AI*: these had projected October 2026 dates in briefing, but institution was denied.
- **IPR2025-00794 and -00795**, *Intel v. Advanced Cluster Systems*: similarly surfaced in the October 2026 projected-FWD context, but were denied.

#### Important limitation

The Section 337 results above are verified against USITC/EDIS-linked records and notices. A truly complete answer for **all instituted IPRs with an actual PTACTS-recorded final-written-decision due date** requires exporting/searching the PTAB case database by proceeding status and FWD deadline, then mapping every petitioner and patent owner to U.S.-listed parents. The public documents returned here identify projected dates in litigation briefing but do not reliably expose the complete live, instituted-case universe.

---

## Session notes — Query 2

**Best-methodology output of the entire session.** It refuses to count **denied-institution**
IPRs as FWD events — a trap that would have produced three fake dated catalysts (NVIDIA v.
Neural AI, Intel v. Advanced Cluster Systems, Sun v. Nivagen) with plausible-looking October/
November 2026 dates. It then states plainly what it could *not* verify. Grok never once said
"I could not confirm this."

**Result: three real, dated, binary ITC events — and all three miss the cap fence.**

| Matter | Date | Exposed | Cap | Verdict |
|---|---|---|---|---|
| 337-TA-1446 (Credo v. Amphenol/Molex/TE) | **final ID Aug 17**, Commission Dec 17 | CRDO / APH / TEL | $47.7B / $208.6B / $62.5B | ✗ all **above** $20B |
| 337-TA-1458 (CeriBell v. Natus) | **final ID Nov 19** | CBLL | **$0.7B** | ✗ **below** the $1B floor |
| 337-TA-1448 (Nokia v. Acer/ASUS) | Commission Dec 14 | NOK | $53.8B | ✗ above |

**This closes the tech lane on primary sources.** Three independent event families, three
different disqualification reasons, none of them a sourcing failure:

| Event family | Dated? | Binary? | In the $1–20B band? |
|---|---|---|---|
| Investor days / conferences | ✅ | ❌ | mostly ❌ |
| M&A (SLAB, SYNA) | ❌ *(SAMR undated)* | ✅ | ✅ |
| ITC / patent (1446, 1458, 1448) | ✅ | ✅ | ❌ |

**Never all three at once.** The tech-catalyst lane at $1–20B for a LONG-only dated-binary
mandate is empty *by construction*, not under-sourced. `ANALYST_LINEUP.md:165`'s "wake the
dormant in-fence tech lane via discovery" rests on an assumption this session disproves.

### 🟠 CBLL is a live data point for the deferred `marketCapMin` decision

`ANALYST_LINEUP.md` → *Deferred decision — Catalyst PM market-cap floor (2026-07-16)* parked a
proposed $1B → $500M floor drop, with the fallback "if revisited, go to ~$750M only paired
with half-size on sub-$1B names."

**CeriBell (CBLL) is exactly the case that decision was about:** in-fence industry (Health
Care Equipment & Supplies), genuinely binary and dated (final ID Nov 19), single-product
exclusionary-relief upside — and **$0.7B, just under the floor.** It would clear a $500M floor
and miss a $750M one. Worth carrying into `/review-analysts` as a concrete example rather than
a hypothetical — though note it is also precisely the gap-through-stop profile the floor
exists to exclude, so it argues both sides.

---

## Query 3 — biotech date verification (run in-session, 2026-08-10)

*The biotech verification screen was never fired at Perplexity — both operator queries went to
the tech lane. Verified here directly against company IR / press releases, with caps from
Finnhub live.*

| Ticker | Grok's claim | **Verified** | Cap (live) | Status |
|---|---|---|---|---|
| **ZYME** | PDUFA Aug 25 | ✅ **Aug 25, 2026** — sBLA priority review, zanidatamab 1L HER2+ GEA | **$1.63B** | ✅ **confirmed + upgraded** |
| **NUVL** | PDUFA Sep 18 | ✅ **Sep 18, 2026** — zidesamtinib, ROS1+ NSCLC; Breakthrough Therapy designation | **$9.79B** | ✅ confirmed |
| **MIRM** | PDUFA Sep 26 | ✅ **Sep 26, 2026** — zilurgisertib FOP, Priority Review | **$6.41B** | ✅ confirmed |
| **SRRK** | PDUFA Sep 30 | ✅ **Sep 30, 2026** — apitegromab SMA | **$6.32B** | ✅ **confirmed + de-risking understated** |
| **SVRA** | PDUFA **Aug 22** | ❌ **WRONG — extended 3 months to Nov 22, 2026** | $1.17B | ❌ **date corrected** |
| **INO** | PDUFA Oct 30, "under $2B" | ✅ date **Oct 30** — but cap claim wildly wrong | **$0.08B** | ❌ **dead — 12× below floor** |

### The corrections that matter

**SVRA — the entry window doesn't exist.** FDA extended the review by three months; responses
to information requests were deemed a **major amendment**. New PDUFA **Nov 22, 2026**. No
safety/efficacy/manufacturing concerns cited. Grok hedged this correctly ("or shifted later in
some notes") and I carried it forward as "open now" — **it was never enterable.** Entry window
is now ~Oct 25 – Nov 15.

**INO — dead on arrival, and worse than the cap.** $80M market cap, not "under $2B" — **12×
below the $1B floor.** Independently, the FDA's file-acceptance letter flagged a preliminary
conclusion that the company **had not justified eligibility for accelerated approval**, and
cash runway extends only "into Q4 2026" — i.e. it runs out around the PDUFA. Financing risk
stacked on a flagged review. Textbook gap-through-stop.

**SRRK — the de-risking was *understated*, not overstated.** Grok said Scholar Rock is
"removing the Catalent Indiana facility after an OAI classification and shifting to a second
already-cleared site." The primary source says the review is advancing with **both** the
Catalent Indiana facility **and** a second fill-finish site — *"two independent fill/finish
paths"* to an approval decision, with commercial supply ready and awaiting packaging. I had
flagged this as the claim most likely to turn into an IONS-shaped loss; verification runs the
other way. Still a CMC-gated approval, but genuinely two-path.

**ZYME — upgraded to the strongest candidate in the session.** Verification surfaced what
neither Grok nor I had: approval triggers a **$250M milestone payment to Zymeworks** (first of
up to $440M) — against a **$1.63B market cap, that is ~15% of the company in cash on a single
binary.** Phase 3 HERIZON-GEA-01 is **published in NEJM** with ASCO 2026 subgroup analyses, so
the efficacy data is fully in hand and the remaining step is the regulatory decision. That is
the de-risked-drift pattern with a quantified, contractual payoff — a cleaner version of the
XENE/ARQT shape, and reachable only because JAZZ (the $8–16B partner carrying the same
catalyst) was skip-listed.

### Verification scorecard

**6 dates checked → 4 confirmed, 1 materially wrong, 1 fatal cap error.** A **33% error rate
on X-sourced facts**, both errors in the direction of making a name look tradeable when it
wasn't. Neither would have survived contact with the position, but both would have consumed a
dispatch slot and a review cycle.

**This is the single strongest argument in the file for the calendar-first / verify-always
rule.** Grok is a lead generator whose output is ~1/3 wrong on checkable facts; nothing should
reach a thesis without a primary-source pass.