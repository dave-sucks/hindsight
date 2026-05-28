# Conviction Expression — how the writer says "high conviction, urgent buy"

> **What this is:** design for letting the thesis-writer emit a structured **conviction tier**, a separate **act-now flag**, and a required **variant view** that the daily-run + tactical agents read as structured input instead of re-deriving from prose rationale every run.
>
> **Status:** design, not yet implemented. Generalizes (and absorbs) [`GAPS.md`](../GAPS.md) **P1-6** (writer urgency signal on promotion refreshes). Touches **P1-3** at the edges but does not fix it.
>
> **Owner:** principal. **Audience:** future session implementing this.
>
> **History:** v1 of this doc (in git history) conflated conviction-strength with time-urgency in an invented `URGENT_BUY` tier, invented an `AVOID` tier the research didn't support, and missed the most important real-world gap — the "variant view" requirement that every buy-side pitch framework treats as table stakes. v2 (this doc) fixes those.

---

## TL;DR

1. **Add 4 new fields on `Thesis`**:
   - `conviction` — 4-value enum (`STRONG` / `HIGH` / `MEDIUM` / `LOW`). Strength of view only.
   - `convictionRationale` — one-sentence (≤200 char) explanation of the tier choice. Always required when conviction is set.
   - `variantView` — one-sentence "consensus thinks X, I think Y, here's why." **Required for `STRONG` and `HIGH` tiers.** This is the gap the v1 design missed. Every buy-side pitch framework treats variant-view as the load-bearing differentiator between a real edge and a consensus rehash.
   - `actNow` — boolean. Orthogonal to conviction strength. True = "act on next daily-run review without waiting for a trigger fire." Only legal on `STRONG` or `HIGH` tiers. Decouples "how strongly do I believe this" from "should the agent act immediately."
2. **Promote existing `targetSizePct` to required** for every directional thesis. Today it's optional and the writer rarely populates it.
3. **Daily-run prompt reads `conviction` first, then `actNow`, then `variantView`** when interpreting `needsAction` triggers.
4. **Surface in ThesisSheet** as a 2-element badge group (tier + actNow chip when set), with `variantView` rendered as a tier-1 always-visible callout block (it's more important than most of the existing accordion sections).
5. **No new tools, no new triggers, no compound predicates, no role-boundary changes.** Writer still doesn't trade. Daily run still owns status decisions.

Effort: **3–4 days** (schema + writer prompt + daily-run prompt + ThesisSheet badge + variantView block + backfill + tests). Single PR shippable end-to-end. Slightly more than v1 because there are 3 more fields with conditional Layer-1 gates instead of 1.

**Anchored on**: sell-side rating taxonomies (Goldman's two-axis Buy/Neutral/Sell + Conviction List pattern explicitly inspires the conviction-as-separate-axis-from-direction shape), buy-side pitch frameworks (variant view required, R/R bands as tier thresholds, "passion + variant view" as HIGH markers), Sequoia/a16z memo structure (used as binary-conviction counterpoint and addressed in §3.5), retail/fintwit anchors provided by principal (Traderstewie momentum patterns, Prof compounder commitment), WSB position-sizing vocabulary. Full citations in §14.

---

## 1. The problem

### What the writer produces today

Look at the 5 most recent THESIS_WRITER runs (all 2026-05-26):

| Ticker | composite | The writer's actual verdict (prose `rationale`) | What the daily-run agent SEES structurally |
|---|---|---|---|
| AVGO | 7/10 | "Decision: RE-ENTER (WATCHING → ready to activate on June 3 beat confirmation)" | LONG WATCHING + ENTER on EARNINGS_BEAT, 4 REVIEWs |
| TSM  | 8/10 | "Decision: RE-ENTER LONG" | LONG WATCHING + 2 ENTER triggers + 5 REVIEWs |
| MRVL | 9/10 | "Re-entering as WATCHING; entry 1-3 days post-gap per PEAD discipline" | LONG WATCHING + ENTER on PRICE_ABOVE $215 + 6 REVIEWs |
| ZS   | 7/10 | "pre-earnings chase violates breakout-confirmation rules; enter on confirmed beat" | LONG WATCHING + ENTER on EARNINGS_BEAT + 5 REVIEWs |
| OKTA | 5/10 | "Recalibrating entry/target/stop around new breakout structure with 2.05:1 R/R" | LONG WATCHING + ENTER on PRICE_ABOVE $92.5 + 5 REVIEWs |

All 5 look structurally identical to the daily-run agent. MRVL (9/10, "textbook PEAD-qualifying") and OKTA (5/10, weak relative strength, late chase) have the **same shape**. The writer's verdict — Traderstewie's "Holy Grail, explode this week" vs Prof's "sleeping giant, will hold" vs "eh, recalibrating" — exists only in `rationale` prose. The daily-run agent has to re-read that prose every run to grok how strongly the writer feels.

There are three separate signals being collapsed into prose today: **strength of conviction**, **whether to act immediately or wait**, and **what consensus has wrong**. None of them have a structured surface.

### What's missing: a tier-level verdict + an act-now flag + a variant view

The principal has been asking for weeks for a working way to say "the agent is HIGH on this stock." Today's structural fields are all near-misses:

- **`scoring.composite` (0–10)** — populated on every recent thesis, but it's a 4-dim setup-quality grade. A clean technical breakout on a name with weak fundamentals scores 7+ but isn't necessarily "high conviction." Answers "is the setup clean?" not "what should you DO with this?"
- **`direction` (LONG/SHORT/PASS)** — the bull/bear/no-view trio, doesn't compress strength.
- **`targetSizePct`** — exists as optional intent; populated on 1 of 5 recent writer runs. Daily-run prompt doesn't read it.
- **`triggers`** — express WHEN, not HOW STRONGLY.
- **`horizon` + `catalystDate` + `maxHoldDays`** — time-window, not conviction-strength.
- **`confidenceScore` (0–100)** — dropped in PR-9. The renderer derives `confidence_score: composite * 10` for backward-compat but it's a number, not a writer-emitted verdict.

There's no structured field that captures the writer's overall view, no field for "act now vs wait," and no field for "what's my contrarian take." The writer produces deep research; the daily run has to re-form an opinion from prose every run.

### What the principal's example utterances demand

| Utterance | What it expresses |
|---|---|
| "We think this can go up 500%. Buy ASAP even at current price." | STRONG conviction + actNow=true + large size |
| "Watching with high confidence, fire entry when volume reaches X and price up 3%." | HIGH conviction + actNow=false + multi-condition entry |
| "Maybe buy, definitely sell if it hits $Y." | MEDIUM conviction + smaller size + tight exit at $Y |
| "Don't sell until it reaches $X." | STRONG/HIGH on an ACTIVE position; exit only at $X |
| "Eh." | LOW conviction; track but don't act on small signals |
| "No way." | direction=PASS (already exists) |

Today only the last has a structural home. The other 5 collapse to indistinguishable LONG WATCHING shapes plus prose rationale.

### The bigger gap the research surfaced

Beyond strength + urgency, the research surfaced a gap I missed in v1 of this doc: **no field for the writer's variant view ("what does consensus have wrong")**. Every buy-side hedge fund pitch framework treats this as table stakes. From Street of Walls: *"consensus ideas and low conviction are major don'ts — portfolio managers reject pitches the analyst doesn't truly believe in."* From a16z / Sequoia IC memo guides: *"recommendations should be short and direct... the differentiated view is what justifies the conviction."*

Hindsight has `bull_case` and `bear_case` bullets but no single field that says "here's where I disagree with the market." Without it, the daily-run agent can't tell a consensus play (low edge) from a variant view (high edge) — and the principal's "high conviction" semantic largely depends on whether the writer can articulate a variant view.

### What real-world conviction expression looks like (the anchors)

The brief asked for sell-side notes, fintwit, WSB, VC memos, and Bloomberg-style analyst-rating taxonomy. Findings below; full vocabulary table in §1a, the six conviction dimensions in §1b.

**Traderstewie ($INTC, $AEHR — momentum/swing trader)**: conviction lives in a tier verdict wrapped in setup vocabulary + a clean target + an implicit time horizon:
- "A gorgeous 'Holy Grail' setup setting up in $INTC here! ... Thinking this one will explode higher in latter part of this week. Targets $130"
- "Gorgeous consolidation/digestion pattern building. Look for a breakout out of this coiling range any day now. Over 15% short interest! Targets $120 to $125"

Tier verdict ("Holy Grail," "gorgeous," "calm before the storm") + clean target + implicit urgency ("this week," "any day now"). Stops implicit. Sizing implicit.

**Prof ($RDDT — long-term holder)**:
- "$RDDT This is a sleeping giant. I own it. And I will hold it. Make note of this one."

Tier verdict ("sleeping giant") + skin-in-the-game + implicit COMPOUNDER horizon. No target. No stop. No detail.

**Goldman Sachs** explicitly separates direction from conviction-strength: Buy/Neutral/Sell ratings PLUS a separately curated **Conviction List** of "best alpha generation opportunities." Two axes, not one. This directly inspires the conviction-as-separate-axis-from-direction shape here.

**Buy-side pitch frameworks**: explicit R/R bands as conviction tiers — 3:1-5:1 = largest positions, 2:1-3:1 = core, sub-2:1 = pass. Maps cleanly onto Hindsight's existing 2:1 floor.

Hindsight's 4-dim composite already captures the confluence math. What it doesn't do is collapse the composite + the writer's qualitative judgment + the catalyst posture + the variant view into structured fields the daily-run can act on at-a-glance.

---

## 1a. Conviction vocabulary across sources — the table

Aggregated from sell-side disclosures (Goldman, Morgan Stanley, JPM), buy-side pitch frameworks, VC IC memos (Sequoia, a16z), retail momentum traders, and WSB.

| Source / context | Their vocabulary | Action implication | Hindsight mapping |
|---|---|---|---|
| **Goldman Sachs** | Buy / Neutral / Sell + separately a curated **Conviction List** (subset of Buy-rated names with "best alpha generation opportunities"). Conviction List membership is NOT a rating change — it's a separate axis. | Conviction List = highest-confidence Buys. "Bigger position, act sooner, narrower exit tolerance." | direction (LONG/SHORT/PASS) maps to Buy/Sell/declined coverage. Conviction List maps to `conviction=STRONG`. The two-axis pattern directly inspires this design. |
| **Morgan Stanley** | Overweight / Equal-weight / Underweight / Not-Rated. 12-18 month horizon. Framing is RELATIVE TO BENCHMARK. | OW = outperform; EW = market-match; UW = underperform. | OW → HIGH/STRONG; EW → MEDIUM; UW → LOW or direction=PASS. |
| **JPMorgan** | Overweight / Neutral / Underweight, 6-12 month horizon. | OW = "outperform sector or broader market." | Same as MS. |
| **Buy-side hedge fund pitch** | Recommendation + upside $/% + downside $/% + thesis + **what the Street is missing (variant view)** + catalysts + scenarios. R/R bands: 3:1-5:1 = strongest conviction; 2:1-3:1 = core; 1:1-2:1 = usually pass. "Passion + variant view + unit economics" = HIGH markers. "Consensus ideas + low conviction" = major don'ts. | PMs reject pitches without a variant view. Variant view IS the conviction differentiator. | R/R ≥ 3:1 + clear variant view → STRONG/HIGH; R/R 2:1-3:1 + standard thesis → MEDIUM; sub-2:1 → LOW or PASS. **`variantView` field directly traces to this requirement.** |
| **Sequoia IC memo (YouTube, 2005)** | Sections: Intro / Deal / Competition / Hiring plan / Key risks / **Recommendation** (at the END). Conviction is NARRATIVE, no scoring. | "Presence of conviction is what matters" (binary). Risks paired with contextual analysis, no severity ratings. | Counterpoint to graduated tiers — see §3.5. |
| **VC IC memo (general)** | Sections: Exec Summary (Deal / Thesis / **Recommendation**) → Market → Team → Product → Business model → **Risks & Mitigants**. "Recommend a tranched $X investment." | Explicitly rejects "Recommend / Pass / Pass for now" graduated framing as "defensive politics." | Counterpoint addressed in §3.5. |
| **Traderstewie (fintwit, momentum/swing)** | "Holy Grail setup," "gorgeous consolidation," "calm before the storm," "explode this week," "Targets $130." | Tier verdict + clean target + implicit time horizon. | "Holy Grail / explode this week / catalyst firing" → STRONG + actNow=true. "Gorgeous consolidation, any day now" → HIGH + actNow=false. |
| **Prof (long-term holder)** | "$RDDT sleeping giant. I own it. I will hold." | Tier + commitment + implicit COMPOUNDER horizon. | "Sleeping giant + I will hold" → STRONG on COMPOUNDER. |
| **WSB / r/wallstreetbets** | YOLO, Diamond Hands, Paper Hands, Tendies, "loading the boat," "back up the truck." | "Back up the truck" / YOLO = highest conviction concentrated bet. Diamond Hands = wide hold tolerance (HIGH tier semantic). | "Back up the truck" → STRONG + actNow=true. Diamond Hands on ACTIVE = STRONG/HIGH hold tolerance. |
| **Position-sizing schools** | Starter (10%) → scale-in (20/10/20) → full size. "Small Early, Big Late" pyramiding. Two schools: (a) size based on conviction; (b) fixed % per trade regardless of conviction. | Active debate. | See §3.5. Hindsight resolves: writer expresses intent via targetSizePct, daily-run applies discipline at execution. Both views honored. |
| **Stock aggregators (TipRanks, etc.)** | 5-tier (Strong Buy / Buy / Hold / Sell / Strong Sell) or 3-tier (Buy / Hold / Sell). Cross-firm taxonomies non-uniform (Outperform/Buy/Overweight subtly differ). | Consumer-facing simplification. | 4-tier conviction (STRONG/HIGH/MEDIUM/LOW) is a subset of the 5-tier with the negative side compressed into `direction=PASS`. |

**Cross-source pattern**: every framework has minimum a **direction**, plus a **conviction modifier** (Goldman's Conviction List, buy-side R/R band, retail vocabulary intensity), AND for the disciplined ones a **variant view requirement**. v1 of this doc collapsed all three into one tier; v2 separates them into three fields.

---

## 1b. The six dimensions of conviction (the Step 3 framework)

The brief asked for the 5-8 dimensions the research surfaced. Re-reading all sources, six dimensions consistently show up:

| # | Dimension | Question it answers | Hindsight field today | Coverage |
|---|---|---|---|---|
| 1 | **Directional view** | Bullish / bearish / no view | `direction` (LONG/SHORT/PASS/PENDING) | ✓ Already structured |
| 2 | **Setup quality / confluence** | How many signals align? How clean? | `scoring` (4-dim composite) | ✓ Already structured |
| 3 | **Time horizon** | Days / weeks / months / years? | `horizon` + `catalystDate` + `maxHoldDays` | ✓ Already structured |
| 4 | **Position sizing intent** | How big a position? | `targetSizePct` (0-100) | ⚠ Field exists, **rarely populated** (1 of 5 recent runs). Promotion to required closes this gap. |
| 5 | **Overall conviction strength** | How strongly should the daily-run act? | **No structured field today.** Lives in prose `rationale`. | ✗ Missing → new `conviction` (+ `convictionRationale`) |
| 6 | **Variant view** | What does consensus have wrong? Where's the edge? | **No structured field today.** Bull/bear bullets capture the case but not the contrarian framing. | ✗ Missing → new `variantView` |
| (orthogonal) | **Time urgency** | Act NOW or wait for trigger fire? | **No structured field today.** Embedded in horizon and prose. | ✗ Missing → new `actNow` |

V1 of this doc collapsed dimension #5 (strength) with the orthogonal time urgency via an invented `URGENT_BUY` tier. v2 separates them: `conviction` is strength only; `actNow` is the urgency flag.

V1 missed dimension #6 (variant view) entirely. The research is unanimous that buy-side pitches require it. v2 fills the gap with a required field on STRONG/HIGH tiers.

Dimensions 1-3 are already structured. Dimension 4 needs a re-purpose (make required). Dimensions 5, 6, and the urgency axis need 4 new fields total (one of them is the rationale paired with conviction). That's the minimum the research justifies.

---

## 2. The proposal — four new fields, one re-purpose

### Schema change

```prisma
model Thesis {
  // ... existing fields ...

  /// Writer's overall view strength on this thesis.
  /// Separate axis from `direction` (which is bullish/bearish/no-view).
  /// Required on every directional thesis (LONG/SHORT). Null on PASS,
  /// PENDING, and pre-V2 legacy rows.
  ///   STRONG  — top-tier conviction. Goldman Conviction List equivalent.
  ///             Writer's best calls (~2-3 names per analyst typical).
  ///   HIGH    — solid conviction. Standard Buy / Overweight.
  ///   MEDIUM  — normal conviction. The honest middle.
  ///   LOW     — weak conviction. "Eh." Track but most signals skip.
  conviction          String? // "STRONG" | "HIGH" | "MEDIUM" | "LOW"

  /// One-sentence justification for the conviction tier. Required
  /// whenever `conviction` is set. ≤200 chars.
  convictionRationale String?

  /// The writer's contrarian take. One sentence: "Consensus thinks X,
  /// I think Y, here's why." REQUIRED when conviction is STRONG or
  /// HIGH — every buy-side pitch framework requires a variant view
  /// for top-tier conviction. Optional on MEDIUM and LOW (where
  /// consensus alignment is acceptable). ≤300 chars.
  variantView         String?

  /// Time-urgency flag. True = "act on next daily-run review without
  /// waiting for a trigger fire." False (default) = "respect the
  /// trigger fence; wait for predicate." Only legal when conviction
  /// is STRONG or HIGH (Layer-1 gate). Orthogonal to conviction
  /// strength — decouples "how strongly do I believe" from "act
  /// immediately vs wait."
  actNow              Boolean @default(false)
}
```

Four new fields. PASS theses + PENDING seeds + pre-V2 rows leave them null.

### Layer-1 gates

Added in `record_thesis` and `update_thesis`:

```
For directional writes (LONG/SHORT):
  REQUIRED:
    - conviction        (one of STRONG/HIGH/MEDIUM/LOW)
    - convictionRationale (≤200 char string)
    - targetSizePct     (promoted to required; was optional)

  CONDITIONAL:
    - variantView REQUIRED when conviction ∈ {STRONG, HIGH}
    - actNow=true ONLY legal when conviction ∈ {STRONG, HIGH}

For PASS writes:
  conviction / variantView / actNow stay null (PASS is its own equivalent)

For PENDING writes (UI/builder/editor seeds):
  All four stay null (no view yet)
```

### Why these four fields and not fewer

Honest accounting against the principal's "max 4 new, prefer 0" constraint:

- Could conviction + actNow be one field? — No. The research is explicit that strength and urgency are separate axes. Goldman keeps them separate (Conviction List membership ≠ "act today"). v1 conflated them via URGENT_BUY and it muddled the daily-run prompt semantics.
- Could variantView be folded into convictionRationale? — No. Rationale is "why this tier" (e.g., "composite 8/10 + R/R 3:1 + catalyst 8 days out"). Variant view is "where the analyst disagrees with consensus" (e.g., "Street expects Q2 inline; I expect 5%+ beat on AI segment"). Different shapes, different requirements (variant required only for HIGH/STRONG). Conflating muddies the writer's mental model.
- Could actNow be derived from horizon + catalystDate? — Partially. CATALYST horizon within 48h ≈ actNow. But COMPOUNDER + actNow ("buy this generational name today even though the move plays out over years") is a real case the principal explicitly called out ("Buy ASAP up 500%") and horizon doesn't capture it.
- Could variantView be optional everywhere? — Yes, but then the "high conviction requires variant view" buy-side discipline isn't enforced. Making it conditionally required for STRONG/HIGH bakes the discipline into the tool gate instead of the prompt.

Net: four fields is the minimum that captures the research-validated dimensions without overlap.

---

## 3. Tier semantics

### What each tier means operationally

```
STRONG  (top-tier conviction; "Conviction List" / "back up the truck" / "Holy Grail")
  Writer is calling out their best ideas — typically 2-3 names per
  analyst per cycle. Requires variantView. actNow allowed.
  Daily-run discipline: act on triggers FAST at full targetSizePct;
  if actNow=true, place_trade in same run without waiting for trigger;
  on ACTIVE positions, wider hold tolerance (small noise doesn't exit).

HIGH  (solid conviction; "Buy" / "Overweight")
  The standard high-conviction buy. Requires variantView. actNow allowed.
  Daily-run discipline: act on ENTER triggers at full targetSizePct;
  on ACTIVE, standard discipline plus slightly wider hold tolerance.

MEDIUM  (normal conviction; "Hold" / "Equal-weight" / "Maybe buy")
  The honest middle. Trade with normal discipline. variantView
  optional. actNow=true rejected by Layer-1.
  Daily-run discipline: trade on ENTER with standard checks
  (R/R, slot budget, live data confirm).

LOW  ("Eh"; weak conviction)
  Tracking but not enthusiastic. Most ENTER fires should be skipped
  unless an additional confirming signal appears. variantView
  optional. actNow=true rejected by Layer-1.
  Daily-run discipline: ENTER fires are SKIP-BY-DEFAULT; require
  cite of additional signal to trade. Default position is half
  targetSizePct if traded. On ACTIVE, tighten stop on next REVIEW
  and consider preemptive close.
```

`AVOID` is not a tier in v2. The "no way" case maps to `direction=PASS` (which archives off the watchlist) — the v1 invention of "AVOID-but-still-tracked" doesn't match how real analysts work and the principal can override at the UI level for the rare case where a name should be tracked despite the writer's "no way" call.

### How `actNow` composes with tier

```
STRONG + actNow=true   → daily-run: trade in THIS run without waiting for ENTER trigger.
                         Writer is saying "the move is starting; trigger fence is too slow."
STRONG + actNow=false  → daily-run: act fast when ENTER fires; full size; wide hold tolerance.
HIGH   + actNow=true   → daily-run: trade in THIS run without trigger. Unusual but legal
                         (e.g., post-print PEAD entry with the gap already digested).
HIGH   + actNow=false  → daily-run: act on ENTER fast; full size; standard discipline.
MEDIUM + actNow=false  → daily-run: trade on ENTER with normal discipline. (actNow=true rejected.)
LOW    + actNow=false  → daily-run: ENTER fires skip-by-default. (actNow=true rejected.)
```

`actNow` is the "skip the trigger fence" signal. It's intentionally only available on the top two tiers because skipping the trigger fence is risky — the fence exists to prevent the agent from chasing — and only the writer's strongest convictions should override it.

### How variantView interacts

`variantView` is required when conviction is STRONG or HIGH. The Layer-1 gate enforces it. The writer prompt teaches the shape: "Consensus expects X, I think Y, here's the falsifiable reason." Examples:

- STRONG: "Street consensus PT $478 implies in-line Q2; I expect a guide-raise that forces 30-day estimate revisions to $520+, driven by hyperscaler XPU backlog upside not yet in models."
- HIGH: "Most analysts treat MRVL as the #3 AI-silicon name; I think the AWS Trainium 3 program is being underweighted by 2 quarters of run-rate, putting Q4 FY2027 revenue 8% ahead of consensus."
- MEDIUM: (optional — can be empty if the thesis IS the consensus view but the trade-off is reasonable)
- LOW: (optional)

For MEDIUM and LOW, no variant view is OK — the writer is admitting the call is consensus or thin. That admission itself is informative; the writer isn't pretending to have an edge they don't have.

---

## 3.5. Counterpoints from the research

**Counterpoint 1: Sequoia / a16z treat conviction as binary.** Pat Grady (Sequoia): "Presence of conviction is what matters." VC IC memo guides explicitly reject graduated framing as "defensive politics."

→ **Reply:** VCs commit to 5-10 investments per fund out of thousands of pitches. Binary makes sense at that ratio. Hindsight's writer covers 20-30+ names per analyst per cycle, structurally closer to a sell-side analyst initiating coverage across a sector — and sell-side IS graduated (5-tier across firms). The 4-tier `conviction` (STRONG/HIGH/MEDIUM/LOW) follows the structural cousin. The Sequoia binary view is preserved at a different layer: the `actNow` boolean IS a binary commitment ("trade or wait") on top of the graduated strength tier.

**Counterpoint 2: "Sizing based on conviction" is undisciplined.** Position-sizing schools warn that "your 'best' ideas often fail" and fixed % per trade is the disciplined path.

→ **Reply:** Hindsight already applies discipline at execution — `maxPositionSize`, `realMaxPosition`, `maxOpenPositions` are account-level caps the daily-run enforces. The writer's `targetSizePct` is INTENT, not authority. Worst case: writer says STRONG+6%, account cap is 3%, daily-run trades 3%. Best case: writer says LOW+1%, daily-run trades 1% on the few trades that survive the tier semantics. The intent expression doesn't break discipline; it gives the daily-run a structured input instead of forcing it to guess.

**Counterpoint 3: Goldman has TWO axes (rating + Conviction List) — the v2 design has ONE.** Goldman: Buy/Neutral/Sell plus separately a curated Conviction List. v2 collapses both into the `conviction` field.

→ **Reply:** v2 actually preserves the two-axis pattern. `direction` (LONG/SHORT/PASS) is the rating axis. `conviction` (STRONG/HIGH/MEDIUM/LOW) is the conviction modifier. STRONG = Conviction List equivalent. HIGH = ordinary Buy. The two axes are kept separate; they're just both already-existing structural fields rather than one being introduced new. v1 of this doc collapsed direction and conviction into a single tier (URGENT_BUY); v2 preserves the separation properly.

**Counterpoint 4: Cross-firm rating taxonomies are non-uniform.** Same stock can be "Outperform" at one firm, "Buy" at another, "Overweight" at a third — none meaning quite the same thing.

→ **Reply:** Hindsight has ONE canonical taxonomy (the 4-value enum) applied across all analysts. The fragmentation problem is cross-firm; we control the writer's taxonomy because we own the writer prompt. Anti-pattern would be letting each analyst define their own conviction scheme — explicitly not doing that.

---

## 4. The 6 utterances mapped

| Utterance | direction | conviction | actNow | variantView | targetSizePct | other |
|---|---|---|---|---|---|---|
| "Buy ASAP even at current price. Up 500%." | LONG | STRONG | **true** | "Street has multi-year ramp underweighted by ~3 quarters; current entry is well below normalized FCF multiple." (required) | 5-6% | target = current × 6; entry = current |
| "Watching with high confidence, fire entry when volume reaches X and price up 3%." | LONG | HIGH | false | required (e.g., "Consensus skeptical of post-print follow-through; volume confirm is the leading indicator they're missing.") | 3-4% | ENTER trigger on PRICE_ABOVE; volume condition in `key_assumptions`; daily-run pulls live volume at ENTER fire |
| "Maybe buy, definitely sell if it hits $Y." | LONG | MEDIUM | false | optional | 2% | tight stop at $Y; standard discipline |
| "Don't sell until it reaches $X." (on ACTIVE) | LONG (already) | STRONG or HIGH | n/a | required (since STRONG/HIGH) | already sized | triggers list = stop + target $X only; wide hold tolerance per tier |
| "Eh." | LONG | LOW | false | optional (likely empty) | 1-2% | ENTER fires skip-by-default; half size if traded |
| "No way." | **PASS** | null | null | null | null | terminal at write (status=ARCHIVED) |

All six covered. The principal's brief is fully expressible without inventing AVOID or URGENT_BUY.

---

## 5. What the writer must emit

After this ships, every `record_thesis` or `update_thesis` call from the thesis-writer agent — on a directional thesis — must include:

```
direction         : "LONG" | "SHORT"
conviction        : "STRONG" | "HIGH" | "MEDIUM" | "LOW"
convictionRationale : string ≤200 chars (always required when conviction is set)
variantView       : string ≤300 chars (REQUIRED when conviction ∈ {STRONG, HIGH})
actNow            : boolean (only legal as true when conviction ∈ {STRONG, HIGH})
targetSizePct     : number 0-100 (promoted to required)
+ all existing required fields (target / stop / entry / belief / triggers / etc.)
```

**Rubric the writer applies** (taught in the writer system prompt):

| Tier | When to use it | actNow guidance | variantView |
|---|---|---|---|
| STRONG | Composite ≥ 8 + R/R ≥ 3:1 + strong confluence across ≥3 of 4 composite dims + a real variant view + the writer would buy at market today if it were their money. Reserved for top 2-3 calls per analyst per cycle. | Use actNow=true when the move has started (PEAD post-print drift, breakout confirming on volume) and waiting for a separate ENTER trigger fire would miss the meaningful entry. | REQUIRED. A STRONG call without a clear variant view is contradictory — by definition the edge is what makes it STRONG. |
| HIGH | Composite ≥ 7 + R/R ≥ 2.5:1 + the writer has a defensible variant view. The default for clean dated-catalyst trades and breakouts with volume confirm. | actNow=false is the default. actNow=true only when there's a specific reason waiting is wrong (e.g., post-earnings gap already digested). | REQUIRED. |
| MEDIUM | Composite 6–7 OR composite ≥ 7 with one weak dimension. The honest middle. Most theses should be MEDIUM — HIGH is for clear conviction with edge, not "I wrote a thesis so I have to commit." | actNow rejected (Layer-1). | Optional. If you have a variant view, say it; if the trade is consensus-but-reasonable, leave empty. |
| LOW | Composite 4–6 OR composite ≥ 6 with material reservations. "I researched it, I don't love it, I'm not stopping the user from tracking it." | actNow rejected. | Optional (typically empty — LOW conviction often means no edge). |

`convictionRationale` examples:
- STRONG: "Composite 8/10, R/R 3:1 at current entry, June 3 catalyst 8 days out, hyperscaler backlog signals a clean guide-raise."
- HIGH: "Composite 7/10, post-print PEAD setup with first day of drift, no analyst PT updates yet — R/R 2.6:1."
- MEDIUM: "Decent technical breakout but weak peer rank (-33% YTD vs +20% peers); wait for confirmed beat before sizing up."
- LOW: "Late-stage chase, RSI 73, volume below threshold; thesis works only on perfect Q3 print."

`variantView` examples (required for STRONG/HIGH):
- STRONG/AVGO: "Street consensus PT $478 implies in-line Q2; I expect a guide-raise that forces 30-day estimate revisions to $520+, driven by hyperscaler XPU backlog upside not yet in models."
- HIGH/MRVL: "Most analysts treat MRVL as the #3 AI-silicon name; AWS Trainium 3 is being underweighted by 2 quarters of run-rate, putting Q4 FY2027 revenue 8% ahead of consensus."
- HIGH (defensive): "Consensus expects a Q3 beat; I disagree only on magnitude — guide-raise is the swing factor not the print itself, and few models account for the seasonality."

---

## 6. What the daily-run prompt does with it

Add to `buildDailyRunSystemPromptV2`:

```
## Conviction-aware action discipline

Every thesis carries a `conviction` tier (STRONG / HIGH / MEDIUM / LOW),
an `actNow` flag (boolean), and on the top two tiers a `variantView`
sentence. Read these BEFORE choosing what to do with a needsAction
trigger. Per-tier semantics:

- conviction=STRONG with actNow=true on any WATCHING thesis with
  needsAction != null
  → default action is place_trade in THIS run, regardless of which
    trigger fired. The writer is saying the move is starting and the
    trigger fence is too slow. Confirm with get_stock_data; if live
    data still supports the variantView, place_trade at market and
    update_thesis(change_status:"ACTIVE") in the same run.
    Only defer if today's data invalidates the writer's variantView.

- conviction=STRONG with actNow=false on TRIGGER_FIRED ENTER
  → default action is place_trade at full targetSizePct, fast.
    Wide hold tolerance once ACTIVE — small noise doesn't exit.

- conviction=HIGH with actNow=true on needsAction != null
  → similar to STRONG+actNow but slightly more skepticism. Pull
    get_stock_data, re-verify the variantView holds, then place_trade.

- conviction=HIGH with actNow=false on TRIGGER_FIRED ENTER
  → place_trade at full targetSizePct with standard discipline.
    Don't second-guess the ENTER fire unless live data contradicts
    the variantView.

- conviction=MEDIUM on TRIGGER_FIRED
  → trade with normal discipline (the default flow). Standard size.

- conviction=LOW on TRIGGER_FIRED ENTER
  → SKIP-BY-DEFAULT. To trade, you must cite an additional confirming
    signal (fresh routed signal, volume confirm, peer leadership shift).
    Most LOW ENTER fires resolve as update_thesis() with a rejection
    rationale; thesis stays WATCHING. If you DO trade, default to half
    targetSizePct.

On a held position (ACTIVE):
- STRONG/HIGH → wider hold tolerance; only EXIT triggers close.
- MEDIUM → standard discipline.
- LOW → tighten stop on next REVIEW; consider preemptive close if
  thesis is no longer applicable.

If `conviction` is null on a row, treat it as MEDIUM. Pre-V2 legacy
rows + the first daily-run after this ships will see this until the
writer refreshes them.

The `variantView` field, when present, is the writer's specific
edge — "consensus thinks X, I think Y." When you read a STRONG/HIGH
thesis, the variantView is the load-bearing claim to verify against
fresh data. If today's signals say the variantView no longer holds
(e.g., consensus moved to the writer's position, or the catalyst
the writer was front-running printed in the opposite direction),
that's a stronger signal to defer/invalidate than any single trigger
fire.
```

The tactical-run prompt gets a parallel hint — shorter, single-thesis scope.

---

## 7. UI changes

### `ThesisSheet` header

Two-element badge row next to `StatusPill`:

```
[STATUS: WATCHING]  [CONVICTION: STRONG]  [ACT NOW]
                                          ^ small chip when actNow=true
```

Tier → badge variant:
- STRONG → `positive` variant, bold
- HIGH → `positive` variant
- MEDIUM → `secondary` variant
- LOW → `secondary` variant, muted

actNow chip only renders when `actNow=true`. Same `positive` palette for visual urgency, tooltip explaining "writer recommends acting on next review without waiting for a trigger fire."

### `variantView` callout block

This is the v1 design's biggest missing UI piece. Render as a **tier-1 always-visible block** in the sheet body, ABOVE the bull/bear case accordion sections. Visual treatment: a card with a left border + "Variant View" label + the sentence.

Position in the sheet: right after the status pills, before the price targets block. It's that important — it's the writer's stated edge, and it should be the first thing the user reads after seeing the conviction tier.

If `variantView` is null (MEDIUM/LOW theses), the block doesn't render — no empty container.

### `ThesisCard` (carousel/list rendering)

Add a small conviction tier label. Same variant palette as the sheet. actNow indicated by a tiny chip beneath.

### Read-theses table row

Add a conviction column. Sort order: STRONG-with-actNow first (the "act today" pile), then STRONG, then HIGH, then MEDIUM, then LOW.

### What does NOT change in the UI

- `scoring` composite gauges stay (the analytical "why" behind the conviction tier)
- Activity timeline stays
- Price targets block stays
- Analyst consensus widget stays
- Research synthesis accordion stays

The conviction badge + variantView block are **additive**, not replacement. They're the verdict surface on top of the existing analytical surface.

---

## 8. Field-by-field decisions (new vs re-purpose)

| Dimension | Decision | Reason |
|---|---|---|
| **Overall conviction strength (tier)** | NEW field `conviction` | No existing field collapses the writer's strength judgment into a tier. Composite is setup-quality, not decisional. |
| **Tier rationale** | NEW field `convictionRationale` | Always-required one-liner pairing with the tier. No existing field plays this role. |
| **Variant view** | NEW field `variantView` | The research's most-emphasized requirement that Hindsight was missing entirely. Bull/bear bullets don't capture the contrarian framing. |
| **Time urgency** | NEW field `actNow` boolean | Cleanly separates urgency from strength. Goldman keeps these separate (Conviction List membership ≠ "act today"). |
| **Position-sizing intent** | RE-USE `targetSizePct` (make required for directional) | Field already exists, optional, rarely populated. Promotion to required costs nothing structurally. |
| **Direction (bull/bear/no-view)** | RE-USE `direction` | Already exists. PASS handles "no way." |
| **Setup quality / confluence** | RE-USE `scoring` (composite + 4 dims) | Composite stays as the analytical defense for the conviction tier. STRONG + composite 4 is inconsistent and the writer prompt should reject it. |
| **Time horizon** | RE-USE `horizon` + `catalystDate` + `maxHoldDays` | Already structured. Composes with conviction (STRONG on COMPOUNDER vs STRONG on TRADE are both legal and meaningful). |
| **Multi-condition entry** | RE-USE existing triggers + `key_assumptions` | No new compound predicate. Documented as a known limitation; daily-run pulls live data at ENTER fire to confirm secondary conditions. |
| **"Tracking but recommend against trading"** (AVOID semantic) | NOT a new tier; use direction=PASS | v1 invented AVOID-on-WATCHING. Real analysts don't have this — they Sell/Underweight/drop coverage. If a user explicitly wants to keep tracking despite a "no way" call, that's a UI override of the writer's PASS verdict, not a separate tier. |

### What I considered and rejected (v2)

- **A 5-tier enum (STRONG/HIGH/MEDIUM/LOW + a 5th below LOW)**: rejected. 4 tiers covers the principal's brief and matches sell-side aggregator standard (4-tier non-Sell side: Strong Buy / Buy / Hold / [Sell merged into direction=PASS]). A 5th tier below LOW would just be a fancy PASS.
- **A 3-tier enum (HIGH/MEDIUM/LOW)**: rejected. Loses the Goldman Conviction List equivalent (STRONG). The principal's "Buy ASAP 500%" requires a tier above ordinary HIGH; without STRONG it gets collapsed.
- **Separate `urgency` field with values (IMMEDIATE/SOON/PATIENT)**: rejected. A boolean (act or wait) is enough. Time-window granularity is already in horizon. Three values for urgency is over-engineering.
- **Variant view optional everywhere**: rejected. Buy-side discipline requires it for high-conviction calls. Making it conditionally required for STRONG/HIGH bakes the discipline into Layer-1.
- **One field combining tier + actNow** (the v1 URGENT_BUY approach): rejected explicitly because v1 made this mistake. The research is unanimous that strength and urgency are separate axes.
- **One field combining conviction + variantView** (compress to one rationale string): rejected. Different semantics, different requirements, different shapes.
- **Deriving conviction from composite arithmetic** (composite ≥ 8 = STRONG, etc.): rejected. Composite is setup-quality; conviction is the writer's overall judgment which incorporates setup quality AND variantView AND catalyst posture AND the writer's gut. URGENT_BUY/STRONG isn't derivable from composite alone.

---

## 9. Migration

### Schema migration

```sql
ALTER TABLE "Thesis" ADD COLUMN "conviction" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "convictionRationale" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "variantView" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "actNow" BOOLEAN NOT NULL DEFAULT false;
```

No NOT NULL constraints on the three string fields at the DB level — the Layer-1 gate in the tool enforces them for directional writes after this ships. PASS theses + PENDING seeds + pre-V2 rows stay null.

### Backfill for existing rows

Derive a default `conviction` tier from composite for the ~50 rows in production:

- composite ≥ 8 → `HIGH` (not STRONG — STRONG requires explicit writer judgment, can't be auto-derived)
- composite 6–7 → `MEDIUM`
- composite < 6 → `LOW`
- direction=PASS → leave null
- direction=PENDING → leave null
- No composite (legacy pre-PR-9) → leave null

`actNow` defaults to false for all backfilled rows.
`variantView` stays null on backfill (no honest way to derive it).
`convictionRationale` stays null on backfill (or filled with `"backfilled from composite on YYYY-MM-DD"` for transparency).

The first refresh after this ships overwrites with the writer's actual judgment.

### What stays null

- All PASS theses (PASS is its own equivalent)
- All PENDING seeds (no view yet)
- Pre-V2 rows whose composite is also null
- Manual UI-added watchlist rows that haven't been researched yet

The UI handles null gracefully — no badge renders, no variantView block.

---

## 10. Prompt diffs — concrete

### `lib/agent/run-thesis-writer.ts` (`buildThesisWriterSystemPrompt`)

Insert a new step 3.5 between step 3 (decision) and step 4 (persist):

```diff
+ 3.5. Set the CONVICTION fields (REQUIRED on every directional thesis).
+
+      Three fields plus a boolean:
+
+      `conviction` — pick ONE of:
+        STRONG  — top-tier conviction. Reserved for your best 2-3
+                  calls per cycle. Use when composite ≥ 8, R/R ≥ 3:1,
+                  the variant view is clear, and you would buy at
+                  market today if it were your own money.
+        HIGH    — solid conviction. Use when composite ≥ 7, R/R ≥
+                  2.5:1, and you have a defensible variant view. The
+                  default for clean dated-catalyst trades and
+                  breakouts with volume confirm.
+        MEDIUM  — normal conviction. Composite 6–7 or composite ≥ 7
+                  with one weak dimension. The honest middle. Most
+                  theses are MEDIUM; HIGH is for clear conviction
+                  with edge.
+        LOW     — weak conviction. "Eh." Composite 4–6 or higher with
+                  material reservations. "I researched it, I don't
+                  love it, I'm not stopping the user from tracking
+                  it."
+
+      `convictionRationale` — REQUIRED. One sentence (≤200 chars)
+      explaining why this tier. Examples:
+        STRONG: "Composite 8/10, R/R 3:1, June 3 catalyst 8 days out,
+                 hyperscaler backlog signals clean guide-raise."
+        HIGH:   "Composite 7/10, post-print PEAD setup, first day of
+                 drift, no analyst PT updates yet — R/R 2.6:1."
+        MEDIUM: "Decent technical breakout but weak peer rank (-33%
+                 YTD vs +20% peers); wait for confirmed beat."
+        LOW:    "Late-stage chase, RSI 73, volume below threshold;
+                 works only on perfect Q3 print."
+
+      `variantView` — REQUIRED for STRONG and HIGH; OPTIONAL for
+      MEDIUM and LOW. One sentence (≤300 chars) stating "consensus
+      expects X, I think Y, here's the falsifiable reason." Every
+      buy-side pitch framework requires this for high-conviction
+      calls — without it, your STRONG/HIGH call is consensus-rehash
+      with no edge. Examples:
+        "Street PT $478 implies in-line Q2; I expect a guide-raise
+         driving 30-day estimate revisions to $520+ on hyperscaler
+         XPU backlog upside not yet in models."
+        "Most analysts treat MRVL as #3 AI-silicon; AWS Trainium 3
+         is being underweighted by 2 quarters of run-rate, putting
+         Q4 FY2027 8% above consensus."
+      If you can't articulate a variant view, your conviction tier
+      is MEDIUM at best — don't claim STRONG/HIGH without one.
+
+      `actNow` — boolean. Default false. Set true ONLY when:
+        (1) conviction is STRONG or HIGH (Layer-1 rejects otherwise), AND
+        (2) the move is starting and the standard trigger fence would
+            make the daily-run miss the meaningful entry. Examples:
+            post-print PEAD first-day drift, breakout already confirming
+            on volume above threshold, dated catalyst within 24h with
+            data already in.
+      actNow=true tells the daily-run to skip the trigger fence and
+      trade at market on next review. Use sparingly — most clean
+      setups should still go through the ENTER trigger.
+
+      `targetSizePct` — REQUIRED on every directional thesis (was
+      optional pre-V2). Express % of portfolio you'd commit at full
+      position. Pair with conviction tier:
+        STRONG → 4-6%
+        HIGH   → 3-5%
+        MEDIUM → 2-3%
+        LOW    → 1-2% (if traded at all)
```

### `lib/agent/tools/record-thesis.ts` (and `update-thesis.ts`)

Add to Zod schema:

```ts
conviction: z
  .enum(["STRONG", "HIGH", "MEDIUM", "LOW"])
  .optional()
  .describe(
    "Writer's view strength on this thesis. " +
    "REQUIRED for directional theses (LONG/SHORT). " +
    "STRONG = top-tier (your best 2-3 calls per cycle); " +
    "HIGH = solid conviction with variant view; " +
    "MEDIUM = normal; LOW = weak. " +
    "Separate from `direction` (bull/bear/no-view) and `actNow` (urgency)."
  ),
convictionRationale: z
  .string()
  .max(200)
  .optional()
  .describe(
    "One sentence (≤200 chars) explaining the conviction tier choice. " +
    "REQUIRED whenever conviction is set."
  ),
variantView: z
  .string()
  .max(300)
  .optional()
  .describe(
    "One sentence (≤300 chars) stating the writer's contrarian take: " +
    "\"consensus expects X, I think Y, here's why.\" " +
    "REQUIRED when conviction is STRONG or HIGH (Layer-1 enforced). " +
    "Optional on MEDIUM/LOW where consensus alignment is acceptable."
  ),
actNow: z
  .boolean()
  .optional()
  .describe(
    "Time-urgency flag. true = act on next daily-run review without " +
    "waiting for a trigger fire. ONLY legal when conviction is STRONG " +
    "or HIGH (Layer-1 enforced). Use sparingly — most setups should " +
    "still go through the ENTER trigger fence."
  ),
target_size_pct: z
  .number().min(0).max(100)
  .optional()  // → REQUIRED in the Layer-1 gate for directional theses
  .describe(/* existing */),
```

Layer-1 execute() additions:

```ts
const isDirectional = args.direction === "LONG" || args.direction === "SHORT";

if (isDirectional && !args.conviction) {
  return reject("conviction tier required for directional theses (one of STRONG/HIGH/MEDIUM/LOW)");
}

if (args.conviction && !args.convictionRationale) {
  return reject("convictionRationale required whenever conviction is set");
}

if ((args.conviction === "STRONG" || args.conviction === "HIGH") && !args.variantView) {
  return reject(
    `${args.conviction} conviction requires variantView — what does consensus have wrong? ` +
    "If you can't articulate a variant view, downgrade conviction to MEDIUM."
  );
}

if (args.actNow === true && args.conviction !== "STRONG" && args.conviction !== "HIGH") {
  return reject(
    "actNow=true only legal on STRONG or HIGH conviction. " +
    "Skipping the trigger fence on lower-conviction theses is too risky."
  );
}

if (isDirectional && args.target_size_pct == null) {
  return reject("target_size_pct required on directional theses (% of portfolio at full position)");
}
```

### `lib/agent/system-prompt.ts` (`buildDailyRunSystemPromptV2`)

Add the conviction-aware action discipline block per §6 above.

### Tactical-run prompt

Parallel one-paragraph addition that reads conviction + actNow on the single triggered thesis and applies the same per-tier semantics.

---

## 11. Effort estimate

Total: **3–4 days**, single PR shippable end-to-end.

| Day | Work |
|---|---|
| 1 | Schema migration + record_thesis/update_thesis Zod schema (4 new fields) + Layer-1 gates (3 conditional rules: convictionRationale-paired, variantView-required-for-STRONG/HIGH, actNow-only-on-STRONG/HIGH) + writer prompt with the tier rubric + variantView guidance |
| 2 | Daily-run prompt (conviction-aware action discipline section) + tactical-run prompt parallel hint + backfill SQL for ~50 existing rows |
| 3 | UI: conviction badge in ThesisSheet header + actNow chip + **variantView callout block** (the new tier-1 block) + ThesisCard tier label + read-theses table conviction column |
| 4 | Tests (Layer-1 rejection paths, daily-run prompt integration via curated thesis fixtures, UI snapshots for all 4 tier × actNow combinations) + soak via manual writer-dispatch on 3 test tickers |

A day longer than v1 (which was 2-3) because there are 4 fields with conditional Layer-1 gates instead of 1 simple field, and the variantView UI callout is a new tier-1 block instead of just a badge.

No multi-PR workstream. No new tools. No new triggers. No compound predicates. No role-boundary changes.

---

## 12. What's explicitly NOT changing

- **Role boundaries** stay. Writer still doesn't trade. Daily run still owns status decisions. Discovery still mints. Promotion-action still flips ACTIVE → PROMOTED.
- **Trigger primitives** stay. No new predicate kinds. No compound AND. Multi-condition "volume AND price" still expressed via primary predicate + secondary condition in `key_assumptions` + agent confirms with `get_stock_data` at ENTER fire.
- **The 4-dim `scoring` composite** stays. It's the analytical defense for the conviction tier.
- **`direction=PASS`** stays. PASS = "researched, walked away, archive."
- **PROMOTION refresh flow** stays — the writer now emits `conviction` + `variantView` + `actNow` instead of a separate `recommendedAction`. P1-6 absorbed.
- **`get_theses` response shape** stays. The four new fields are added to the per-thesis JSON.
- **`needsAction` logic** stays. The 4 kinds are unchanged. Conviction is read AFTER needsAction tells the agent there's work to do.
- **`targetPrice` overload** (P1-3) is NOT fixed here. Adjacent but orthogonal — P1-3 stays open. Bull/base/bear scenario price targets are the next thing worth tackling after this design lands.
- **Activity log** unchanged.

---

## 13. Open questions for principal

1. **Tier names.** `STRONG / HIGH / MEDIUM / LOW` is the proposed enum. Alternatives:
   - `CONVICTION / BUY / HOLD / WEAK` — matches Goldman/sell-side vocabulary directly
   - `TOP_PICK / BUY / NORMAL / WEAK` — action-anchored
   - `1 / 2 / 3 / 4` — pure numeric, no narrative anchor (rejected as too quant)
   Current names are explicit and consistent on the same strength axis. Principal's call.

2. **Conviction-composite consistency check.** Should the writer be REJECTED at Layer-1 for emitting `conviction=STRONG` with `composite=4`? Suggested default: reject STRONG when composite is null OR < 7, with the rejection message asking the writer to either downgrade tier or re-justify composite. Strict gate, or soft warning that lands in the rationale field?

3. **`variantView` length cap.** Proposed 300 chars (twice the convictionRationale cap because variant view often needs more nuance). Too tight? Too loose? Sell-side variant views are typically 2-3 sentences (~300-500 chars) — 300 is a tight discipline forcing function.

4. **`actNow` decay.** A 3-day-old STRONG+actNow=true is suspect — either the move already happened or the writer's call has aged out. Suggested default: daily-run treats `actNow=true` as expired if conviction was set more than 24h ago, and demotes to standard STRONG behavior. Or should it stay live until manually overridden?

5. **`variantView` rendering on STRONG/HIGH where the writer left it null** (legacy / pre-V2 / backfilled rows). UI options:
   - Hide the variantView block entirely (current proposal)
   - Render a "variantView pending — next refresh will populate" placeholder
   First is cleaner; second flags the gap. Your preference.

6. **Backfill aggressiveness.** Derived backfill from composite gives ~50 rows a default tier (no STRONG, no variantView, actNow=false). Alternative: leave them all null and let the next refresh populate organically. Suggested: derive tier, flag with `convictionRationale = "backfilled from composite on YYYY-MM-DD"` so the UI can distinguish and the next writer refresh overwrites cleanly.

7. **Should `direction=PASS` carry a conviction value?** Today the design says PASS skips conviction. Sequoia / a16z memo language for declines is "Pass" with a one-line rationale, no tier. Hindsight follows suit. No change needed; documenting the inherited behavior.

8. **UI placement of `variantView`.** Proposed as a tier-1 always-visible callout block right after the status pills, before the price targets block. Alternative: fold into the bull case section as a labeled subsection. Tier-1 callout makes the variant view the visual headline; folding into bull case keeps the existing layout. Your call.

---

## 14. See also

### Hindsight internal
- [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) §0 (the five roles — this design keeps all boundaries intact) and §8 (Fields — the four new fields join the operational-state group)
- [`GAPS.md`](../GAPS.md) **P1-6** (writer urgency signal on promotion refreshes — absorbed into this design via `conviction` + `actNow`)
- [`GAPS.md`](../GAPS.md) **P1-3** (targetPrice overload — adjacent but not addressed here)
- [`PRINCIPLES.md`](../PRINCIPLES.md) — the three-layer principle. Conviction lives at Layer-2 (structured tool-result fields the agent reads) + Layer-3 (the daily-run prompt teaches per-tier judgment). The Layer-1 gate enforces that directional theses HAVE the required fields — it doesn't second-guess WHICH tier the writer picks.
- [`MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — the V2 daily-run prompt design this builds on.

### Real-world conviction-vocabulary sources

Sell-side rating taxonomies:
- [Morgan Stanley General Research Disclosures](https://www.morganstanley.com/eqr/disclosures/webapp/generalresearch) — Overweight / Equal-weight / Underweight definitions
- [Benzinga: Goldman Sachs Updates Its Conviction List](https://www.benzinga.com/analyst-ratings/analyst-color/17/07/9778951/goldman-sachs-updates-its-conviction-list-what-that-mean) — Conviction List as a separate axis from Buy/Neutral/Sell ratings (this is the pattern v2 follows)
- [stockanalysis.com — What Do Stock Analyst Ratings Mean?](https://stockanalysis.com/article/analyst-ratings-explained/) — cross-firm rating taxonomy and cross-firm normalization problem
- [TipRanks Analyst Consensus](https://www.tipranks.com/glossary/a/analyst-consensus) — 3-tier aggregator framing

Buy-side / hedge fund pitch frameworks:
- [Mergers & Inquisitions — Stock Pitch Guide](https://mergersandinquisitions.com/stock-pitch-guide/) — pitch components including variant view
- [Finance Interview Prep — Hedge Fund Stock Pitch Framework](https://financeinterviewprep.com/blog/hedge-fund-stock-pitch-framework) — R/R conviction bands
- [Street of Walls — Stock Pitch Do's and Don'ts](https://www.streetofwalls.com/articles/hedge-fund/recruiting-interviewing/stock-pitch-the-dos-and-donts/) — "consensus ideas and low conviction" as major don'ts

VC IC memo structure (binary-conviction counterpoint):
- [Alex Jarvis — The confidential YouTube Investment Memo by Sequoia](https://www.alexanderjarvis.com/the-confidential-youtube-investment-memo-by-sequoia-you-were-never-meant-to-see/)
- [The VC Factory — IC Memos guide](https://thevcfactory.com/investment-committee-memos/) — Pat Grady's "Presence of conviction is what matters"

Retail / fintwit anchors (provided by principal):
- @Traderstewie ($INTC "Holy Grail setup, explode this week, Targets $130"; $AEHR "Gorgeous consolidation, Targets $120-$125")
- @TheProfInvestor ($RDDT "sleeping giant, I will hold")
- Principal's confluence explainer

WSB / retail vocabulary:
- [Infinity Investing — WSB Slang guide](https://infinityinvesting.com/wallstreetbets-slang-meaning/) — YOLO, Diamond Hands, Paper Hands, Tendies
- [SuperMoney — The Back Up The Truck Strategy](https://www.supermoney.com/encyclopedia/backing-up-the-truck) — "back up the truck" semantic and origin

Position sizing schools:
- [TraderLion — Position Sizing Strategies](https://traderlion.com/risk-management/position-sizing-strategies/) — starter/scale-in/full sizing and conviction-vs-fixed-% debate
