# Conviction Expression — how the writer says "high conviction, urgent buy"

> **What this is:** the design for letting the thesis-writer emit a single decisional **conviction tier** that the daily-run + tactical agents read AS A STRUCTURED INPUT instead of re-deriving it from prose rationale every run.
>
> **Status:** design, not yet implemented. Generalizes (and absorbs) [`GAPS.md`](../GAPS.md) **P1-6** (writer urgency signal on promotion refreshes). Touches [`GAPS.md`](../GAPS.md) **P1-3** at the edges but does not fix it.
>
> **Owner:** principal. **Audience:** future session implementing this.

---

## TL;DR

1. **Add ONE new field on `Thesis`: `conviction`** — a 5-value enum (`URGENT_BUY` / `HIGH` / `MEDIUM` / `LOW` / `AVOID`) plus a one-sentence `convictionRationale`. The writer sets it on every mint + refresh. PASS theses skip it (PASS is its own tier-equivalent).
2. **Promote ONE existing field to required: `targetSizePct`** for every directional thesis. Today it's optional and the writer rarely populates it; the daily run can't size a trade without it.
3. **Teach the daily-run prompt to read conviction first.** Per-tier interpretation: URGENT_BUY = "act on next review even without trigger fire," HIGH = "act on ENTER fast, full size," MEDIUM = "trade on ENTER with normal discipline," LOW = "ENTER fires are skip-by-default; require additional confirm," AVOID = "ENTER fires write REVIEWED-only audit row, no trade."
4. **Surface conviction as a badge in `ThesisSheet` header and `ThesisCard`**, alongside (not replacing) the existing 4-dim composite gauges. The composite stays as the analytical why; conviction is the verdict.
5. **No new tools, no new triggers, no compound predicates, no role-boundary changes.** Writer still doesn't trade. Daily run still owns status decisions. Just one structured field that compresses the writer's verdict so the daily run doesn't re-read prose.

Effort: **2–3 days** (schema + writer prompt + daily-run prompt + ThesisSheet badge + backfill + tests). No multi-PR workstream.

**Anchored on**: principal-provided fintwit examples (Traderstewie momentum/swing setups, Prof's $RDDT compounder commitment, confluence-is-king explainer) **plus** sell-side rating taxonomies (Goldman Buy/Neutral/Sell + Conviction List, Morgan Stanley OW/EW/UW, JPM OW/N/UW), buy-side pitch frameworks (R/R bands as conviction tiers, "passion + variant view" as HIGH markers), VC IC memo structure (Sequoia/a16z — used as a binary-conviction *counterpoint* to justify why 5-tier wins for Hindsight's many-names coverage), and WSB / retail position-sizing vocabulary (YOLO, Diamond Hands, "back up the truck," starter→scale-in→full size). Full citations in §12.

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

All 5 look structurally identical to the daily-run agent. MRVL (9/10, "textbook PEAD-qualifying") and OKTA (5/10, weak relative strength, late chase) have the **same shape**. The writer's verdict — Traderstewie-style "Holy Grail setup, explode this week" vs Prof-style "sleeping giant, I will hold" vs "eh, recalibrating" — exists only in `rationale` prose. The daily-run agent has to re-read that prose every run to grok how strongly the writer feels.

### What's missing: a tier-level verdict

The principal has been asking for weeks for a working way to say "the agent is HIGH on this stock." Today's structural fields are all near-misses:

- **`scoring.composite` (0–10)** — populated on every recent thesis, but it's a 4-dim setup-quality grade (trend × RS × entry × catalyst). A clean technical breakout on a name with crap fundamentals scores 7+ but isn't necessarily "high conviction." The composite answers "is the setup clean?" — it doesn't answer "what should you DO with this?"
- **`direction` (LONG/SHORT/PASS)** — covers the bull/bear/no-view trio but doesn't compress strength of view.
- **`targetSizePct`** — exists as an optional intent field; **populated on 1 of 5 recent writer runs** (ZS=5%; AVGO/TSM/MRVL/OKTA all null). Daily-run prompt doesn't read it.
- **`triggers`** — express WHEN, not HOW STRONGLY. An ENTER trigger on a HIGH-conviction thesis and an ENTER trigger on a LOW-conviction thesis look identical to the trigger evaluator.
- **`horizon` + `catalystDate` + `maxHoldDays`** — express time-window, not conviction-strength.
- **`confidenceScore` (0–100)** — **was dropped in PR-9** (`record-thesis.ts:101`). The renderer still synthesizes `confidence_score: composite * 10` for backward-compat (`get-theses.ts:414`), but it's a derived number, not a writer-emitted verdict.

Net: there is no structured field on the row that says "the writer's overall view on this trade." The writer produces deep research; the daily run has to re-form an opinion from prose every run.

### What the principal's example utterances demand

The 6 utterances from the brief:

| Utterance | What it expresses |
|---|---|
| "We think this can go up 500%. Buy ASAP even at current price." | URGENT, large size, no entry trigger wait |
| "Watching with high confidence, fire entry when volume reaches X and price up 3%." | HIGH, normal/large size, multi-condition entry |
| "Maybe buy, definitely sell if it hits $Y." | MEDIUM-LOW, smaller size, tight exit discipline |
| "Don't sell until it reaches $X." | HIGH (on a held position), exit only on a specific level |
| "Eh." | LOW — explicit "I'm not enthusiastic, don't act on small noise" |
| "No way." | AVOID — explicit "do NOT trade this, even if triggers fire" |

Today only #6 has a structural home (`direction=PASS`). The other 5 collapse to indistinguishable LONG WATCHING shapes plus prose rationale.

### What real-world conviction expression looks like (the anchors)

The brief asked for sell-side initiation notes, fintwit, WSB, VC memos, and Bloomberg analyst-rating taxonomy. Findings below; full vocabulary table in §1a, the five conviction dimensions in §1b.

**Traderstewie ($INTC, $AEHR — momentum/swing trader)**: conviction lives in **a tier verdict wrapped in setup vocabulary + a clean target + an implicit time horizon**:
- "A gorgeous 'Holy Grail' setup setting up in $INTC here!"
- "Thinking this one will explode higher in latter part of this week. Targets $130"
- "Gorgeous consolidation/digestion pattern building. Look for a breakout out of this coiling range any day now. Over 15% short interest! Targets $120 to $125"
- "$INTC is showing all the hallmarks of a stock that's quietly setting up for a big explosive move as early as tomorrow! The calm before the storm…"
- "$INTC starting to move again"

The tier verdict ("Holy Grail," "gorgeous," "calm before the storm," "explode this week") and the target ($130, $120-$125) are the two load-bearing elements. Stops are implicit. Position size is implicit. Time-urgency is in the tier verbiage ("this week," "as early as tomorrow," "any day now").

**Prof / @TheProfInvestor ($RDDT — long-term holder)**: conviction is even more compressed:
- "$RDDT This is a sleeping giant. I own it. And I will hold it. Make note of this one."

Tier verdict ("sleeping giant"), skin-in-the-game commitment ("I own it"), time horizon ("I will hold" — i.e., COMPOUNDER), and a "remember this" cue. No price target. No setup detail.

**The general pattern (per the principal's confluence explainer)**: conviction is driven by **3+ aligned signals across price action, volume, catalyst, sentiment, supporting indicators**. 1–2 signals = low conviction. 3+ = high conviction sizing.

Hindsight's 4-dim composite already captures the confluence math. What it doesn't do is collapse the composite + the writer's qualitative judgment + the catalyst posture into a single decisional tier the daily-run can act on at-a-glance.

---

## 1a. Conviction vocabulary across sources — the table

Aggregated from sell-side disclosures (Goldman, Morgan Stanley, JPM), buy-side pitch frameworks, VC IC memos (Sequoia, a16z), retail momentum traders (Traderstewie, "Holy Grail"-style setups), and WSB. Mapped onto Hindsight's 5 tiers.

| Source / context | Their vocabulary | Action implication | Hindsight tier |
|---|---|---|---|
| **Goldman Sachs** | Buy / Neutral / Sell + separately a curated **Conviction List** (subset of Buy-rated names with "best alpha generation opportunities"). Conviction List membership is NOT a rating change — it's a separate axis on top of the rating. | The Conviction List is the firm's highest-confidence Buys. Membership signals "bigger position, act sooner, narrower exit tolerance." | URGENT_BUY (Conviction List) / HIGH (Buy not on Conviction) / MEDIUM (Neutral) / LOW (Neutral with caveats) / AVOID (Sell). The Goldman pattern validates **tier-as-separate-axis from direction** — exactly the design here. |
| **Morgan Stanley** | Overweight / Equal-weight / Underweight / Not-Rated. Time horizon 12-18 months. Framing is RELATIVE TO BENCHMARK, not absolute Buy/Hold/Sell. | OW = outperform; EW = market-match; UW = underperform. Recommended portfolio weightings, not buy/sell directives. | OW → HIGH or MEDIUM (depending on conviction); EW → MEDIUM-LOW (track but no aggressive bias); UW → AVOID. |
| **JPMorgan** | Overweight / Neutral / Underweight, 6-12 month horizon. OW = "outperform sector or broader market." | OW falls into "buy" bucket; N = hold; UW = sell. Time horizon shorter than MS. | Same mapping as MS. |
| **Buy-side hedge fund pitch** | Recommendation + upside $/% + downside $/% + thesis + what the Street is missing + catalysts + scenarios. Explicit conviction in **R/R bands**: **3:1-5:1 = strongest conviction → largest positions**; 2:1-3:1 = core/moderate; 1:1-2:1 = usually pass. | "Passion, variant view, unit economics" = HIGH markers. "Consensus ideas, low conviction" = "major don'ts" — PMs reject pitches the analyst doesn't believe. | R/R ≥ 3:1 + variant view → URGENT_BUY or HIGH; R/R 2:1-3:1 + standard thesis → MEDIUM; sub-2:1 → LOW or PASS. The R/R bands map cleanly onto Hindsight's existing 2:1 floor. |
| **Sequoia IC memo (YouTube, 2005)** | Sections: Introduction / Deal / Competition / Hiring plan / Key risks / **Recommendation** (at the END, not the top). Phrasing: "I recommend that we proceed with the financing as proposed." | Conviction is NARRATIVE, not numerical: "clear lead," "pole position," urgency cues ("I'd like to give the company our decision on Monday"). Risks are 5 contextual categories, NO severity ratings. | Sequoia's IC has no tier system — Pat Grady: "Presence of conviction is what matters" (binary). The counterpoint to a 5-tier enum — see §2.5. |
| **VC IC memo (general)** | Standard sections: Executive Summary (Deal / Thesis / **Recommendation**) → Market → Team → Product → Business model → Risks & Mitigants. "Recommend a tranched $X investment" is the canonical recommendation line. | Sections explicitly warn against "Recommend / Pass / Pass for now" graduated language: *"Outlier returns in VC are built on conviction, not defensive politics."* Risks paired with **concrete mitigants** (expert diligence, customer data, sensitivity scenarios, monitoring). | The binary stance is the VC opposite of sell-side's 5-tier. Hindsight is many-names coverage like sell-side, not few-investments commitment like VC — 5-tier wins for Hindsight. |
| **Traderstewie (fintwit, momentum/swing)** | "Holy Grail setup," "gorgeous consolidation," "calm before the storm," "explode this week," "as early as tomorrow," "Targets $130," "$INTC starting to move again." Updates live as move unfolds. | Tier verdict in the setup vocabulary + clean target + implicit time horizon ("this week"). Stops implicit at consolidation base. Position sizing implicit. | "Holy Grail" / "explode this week" + clean catalyst firing → URGENT_BUY. "Gorgeous consolidation building, any day now" → HIGH. |
| **Prof / @TheProfInvestor (long-term holder)** | "$RDDT This is a sleeping giant. I own it. And I will hold it. Make note of this one." | Tier + skin-in-game commitment + implicit COMPOUNDER horizon. No price target, no stop, no setup detail. | "Sleeping giant" + "I own it" + "I will hold" → HIGH on COMPOUNDER. |
| **WSB / r/wallstreetbets** | YOLO (high-risk concentrated bet), Diamond Hands (hold through volatility, high conviction), Paper Hands (sells too early, low conviction), Tendies (profits), "loading the boat" / "back up the truck" (substantial purchase, extreme bullishness). Language designed to frustrate outsiders. | YOLO / "back up the truck" → URGENT_BUY (concentrated high-conviction). Diamond Hands → wide hold tolerance on ACTIVE positions (= HIGH/URGENT_BUY tier semantics). Paper Hands → MEDIUM/LOW (the agent equivalent). | "Back up the truck" maps to URGENT_BUY. Diamond Hands hold-tolerance maps to HIGH/URGENT_BUY on ACTIVE. The retail vocabulary VALIDATES the tier→hold-tolerance link in the daily-run prompt. |
| **Position-sizing schools** | "Starter position" (10% initial entry), "Scale in" (20% → 10% → 20% as pivots trigger), "Small Early, Big Late" pyramiding. | Two schools: (a) **size based on conviction** ("scale into high-conviction trades 3-5 times, moving stop each time"); (b) **fixed % per trade regardless of conviction** (the disciplined view — "your 'best' ideas often fail"). | The debate matters — see §2.5. Hindsight resolves it: writer expresses intent via `targetSizePct`, daily-run applies discipline at execution. Both views honored. |
| **Stock-analysis aggregators (TipRanks, etc.)** | Aggregate analyst ratings into 3-tier consensus (Buy / Hold / Sell) or 5-tier (Strong Buy / Buy / Hold / Sell / Strong Sell). Note: "outperform" at one firm may be "buy" at another — taxonomy is non-uniform across firms. | 3-tier is the consumer-facing simplification; 5-tier is the underlying analyst taxonomy. | 5-tier validates the proposal. The cross-firm inconsistency validates having ONE canonical Hindsight taxonomy instead of N analyst-specific schemes. |

**Cross-source pattern that emerges:** every framework has at minimum a **rating tier** (the verdict). Beyond that, the disciplined ones add a **conviction modifier** (Goldman's Conviction List, the buy-side R/R band, the position-sizing intent). The retail / fintwit voices collapse both into a single colorful phrase ("Holy Grail," "sleeping giant," "back up the truck"). Hindsight's `conviction` field collapses the two into one structured tier — close to the retail / fintwit pattern but with the sell-side discipline of a defined 5-value enum.

---

## 1b. The five conviction dimensions (the Step 3 framework)

Reading across all the sources above, conviction expression in financial-analyst output decomposes into five orthogonal dimensions. Hindsight already covers four; the new `conviction` field covers the fifth.

| # | Dimension | What it answers | Where it lives in Hindsight today | Coverage |
|---|---|---|---|---|
| 1 | **Directional view** | Bullish / bearish / no view | `direction` (LONG / SHORT / PASS / PENDING) | ✓ Already structured |
| 2 | **Setup quality / confluence** | How many signals align? How clean is the technical / fundamental setup? | `scoring` (4-dim composite: trend + RS + entry quality + catalyst freshness, sum /10) | ✓ Already structured |
| 3 | **Time horizon / urgency** | When will the view play out? Days / weeks / months / years? | `horizon` (CATALYST / TRADE / TARGET / COMPOUNDER) + `catalystDate` + `maxHoldDays` | ✓ Already structured |
| 4 | **Position sizing intent** | How big a position relative to portfolio? | `targetSizePct` (0-100, % of portfolio at full position) | ⚠ Field exists, **rarely populated** (1 of 5 recent writer theses). Promotion to required closes this gap. |
| 5 | **Overall conviction strength** (the writer's verdict) | Across all the above, how strongly should the daily-run act on this thesis? Trade aggressively, normally, skeptically, or not at all? | **No structured field today.** Lives in prose `rationale` ("Decision: RE-ENTER," "pre-earnings chase violates breakout-confirmation rules," "Recalibrating entry/target/stop"). | ✗ **Missing.** New `conviction` field fills this. |

Why these five and not more:
- "Risk-reward" is a derived value from target/entry/stop. Already on every thesis. Not a separate dimension.
- "Catalyst" is part of dimension 2 (composite's `catalystFreshness`) and dimension 3 (`horizon=CATALYST` + `catalystDate`).
- "Valuation" is captured in the bull/bear case bullets and the composite's other dimensions. Not a separate top-level field.
- "Sentiment" is captured in the analyst consensus widget + signal types. Not a separate top-level conviction dimension.

Dimension 5 is the only one missing structurally. Every other dimension has a field. This is what justifies adding `conviction` and stopping there — not adding `urgency`, `confidenceTier`, `priorityScore`, or any of the other near-misses I considered.

---

## 2. The proposal — `conviction` as a tier verdict

Add ONE new field on `Thesis`:

```prisma
model Thesis {
  // ... existing fields ...

  /// Writer's overall verdict on this thesis as a decisional tier.
  /// Read by the daily-run + tactical agents to interpret how aggressively
  /// to act on triggers and how to size on entry. Distinct from
  /// `scoring.composite` (the 4-dim setup-quality grade) and from
  /// `direction` (LONG/SHORT/PASS). Null on pre-V2 rows; required on every
  /// directional thesis the writer mints or refreshes after this ships.
  /// PASS theses don't carry a conviction value (PASS is its own equivalent
  /// of AVOID-and-archive).
  conviction         String? // "URGENT_BUY" | "HIGH" | "MEDIUM" | "LOW" | "AVOID"
  convictionRationale String? // ≤200 chars; one sentence explaining the tier choice
}
```

That is the **entire schema change**. Everything else is prompt + UI + a `targetSizePct`-required gate.

### The five tiers

```
URGENT_BUY  "Buy now, even at current price. Don't wait for a trigger."
            Daily-run reads this on next review; default action is place_trade
            in this same run regardless of trigger fires. Tier reserved for
            setups where the writer would buy immediately if it were their
            own money — clean catalyst with the move starting, fresh confirm,
            high R/R, deep conviction. Full target_size_pct (typically 5%+).

HIGH        "Strong conviction. When the ENTER trigger fires, act fast,
            full size. Wide hold-tolerance — don't let small noise trigger
            exits." Daily-run reads HIGH and acts on ENTER without
            second-guessing. Default size = full targetSizePct. Mirrors
            Goldman's "Conviction Buy" or Prof's "sleeping giant."

MEDIUM      "Reasonable setup. Trade on ENTER with normal discipline.
            Standard size, standard exits." The default for most clean
            theses. ~MRVL/AVGO/TSM in the recent batch would land here.

LOW         "Eh. I'm tracking this but don't expect much. Most ENTER fires
            here should be skipped — agent should require an additional
            confirming signal before acting. Half size or smaller if traded
            at all." OKTA (composite 5/10, weak RS, late chase) would land
            here today. Today the OKTA thesis looks identical to MRVL's
            (composite 9/10, textbook PEAD) to the daily-run agent.

AVOID       "No way. Even if triggers fire, do NOT trade. Daily-run writes
            a REVIEWED audit row citing the AVOID verdict and skips action.
            Reserved for tickers the user wants tracked (PENDING seed or
            user-added) where the writer's recommendation is structurally
            against trading. Distinct from direction=PASS, which archives
            the thesis off the watchlist entirely. AVOID keeps it visible
            with an explicit do-not-trade verdict."
```

### Mapping the 6 utterances + the anchor styles

| Utterance / source | Tier | Structural shape |
|---|---|---|
| "Buy ASAP even at current price. Up 500%." | URGENT_BUY | entry=current; target=current×6; targetSizePct large; no ENTER trigger gate |
| Traderstewie "Holy Grail, explode this week, Targets $130" | URGENT_BUY or HIGH (depending on whether the move's started) | entry=current; target=$130; horizon=TRADE; stop at consolidation base |
| "Watching with high confidence, fire entry when volume reaches X and price up 3%" | HIGH | LONG WATCHING; ENTER on PRICE_ABOVE; volume confirm in `key_assumptions`; daily-run reads conviction=HIGH and acts on first ENTER without dispatching another refresh |
| Prof "$RDDT sleeping giant, I own it, I will hold" | HIGH on COMPOUNDER | LONG ACTIVE; no auto-exit on target; INVALIDATED only on broken belief |
| "Maybe buy, definitely sell if it hits $Y" | MEDIUM-LOW | LONG WATCHING; ENTER with a higher confidence bar; stop tight at $Y; targetSizePct half |
| "Don't sell until it reaches $X" (on ACTIVE position) | HIGH | ACTIVE; triggers list is ONLY stop + target $X; agent ignores noise per HIGH tier |
| "Eh." | LOW | LONG WATCHING; ENTER trigger present but daily-run requires confirming signal before acting |
| "No way." (on a name we're tracking) | AVOID | LONG WATCHING; daily-run treats ENTER fires as skip-by-default |
| "No way." (researched fresh, never want to trade) | direction=PASS (already exists, status=ARCHIVED) | Off the watchlist; institutional memory only |

This is the full coverage of the principal's brief. Two utterances (PASS vs AVOID) compose:
- **AVOID** = "I'm telling you not to trade this name we're tracking; keep it on the watchlist so you can re-evaluate if conditions change."
- **PASS** = "I'm done with this name; archive it."

Both legal; they answer different questions.

---

## 3. What the writer must emit

After this ships, every `record_thesis` or `update_thesis` call from the thesis-writer agent — on a directional thesis — must include:

```ts
{
  conviction: "URGENT_BUY" | "HIGH" | "MEDIUM" | "LOW" | "AVOID",
  convictionRationale: string,  // ≤200 chars; one sentence; the why
  targetSizePct: number,        // already exists; now REQUIRED for LONG/SHORT
  // ... all existing required fields (target_price, stop_loss, etc.)
}
```

**Layer-1 gate**: `record_thesis` + `update_thesis` (in PENDING-promotion paths) reject directional writes without `conviction` set. The error message tells the agent which tier to pick from the rubric below.

**Rubric the writer applies** (taught in the writer system prompt):

| Tier | When to use it |
|---|---|
| URGENT_BUY | Composite ≥ 8, catalyst is firing NOW (within ~24h), R/R ≥ 3:1, no contradicting evidence, you'd buy at market if it were your money. |
| HIGH | Composite ≥ 7, catalyst window is open, R/R ≥ 2.5:1, strong confluence across at least 3 of the 4 composite dimensions. The default for clean PEAD setups, dated-catalyst trades, breakouts with volume confirm. |
| MEDIUM | Composite 6–7, OR composite ≥ 7 with one weak dimension (e.g. great setup but weak RS). The honest middle. Most theses should not be HIGH — HIGH is for clear conviction, not "I wrote a thesis so I guess I have to commit." |
| LOW | Composite 4–6, OR composite ≥ 6 with material reservations (extended chase, weak peer rank, fundamentals problem). The writer is saying "I researched it, I don't love it, I'm not stopping the user from tracking it." |
| AVOID | The writer believes this name should NOT trade even if triggers fire. Use when the user/builder has added a name to the watchlist that the writer judges structurally unsuitable — broken fundamentals, dead catalyst, opposing tape, structural compression, etc. — but the user explicitly wants it tracked rather than archived. For "researched and walked away," use direction=PASS instead. |

`convictionRationale` is one sentence (≤200 chars) explaining the tier choice. Examples:

- URGENT_BUY: "Clean PEAD beat-and-raise printed last night, first day of drift, no analyst PT updates yet, +3:1 R/R."
- HIGH: "Composite 8/10, June 3 catalyst 8 days out, hyperscaler backlog $73B, conviction confirmed by 93% analyst Buy."
- MEDIUM: "Decent technical breakout but weak peer rank (-33% YTD vs +20% peers); wait for confirmed beat before sizing up."
- LOW: "Late-stage chase, RSI 73, volume below threshold; thesis works only on perfect Q3 print."
- AVOID: "User-added name; revenue growth decelerated 4 consecutive quarters and Microsoft Entra is taking share; do not trade."

---

## 4. What the daily-run prompt must do with it

Add a per-thesis hint to `buildDailyRunSystemPromptV2` that teaches the agent to read `conviction` first when interpreting `needsAction`:

```
## Conviction-aware action discipline

Every thesis carries a `conviction` tier set by the writer. Read it FIRST
when deciding what to do with a needsAction trigger:

- conviction=URGENT_BUY on a WATCHING thesis with needsAction != null
  → default action is place_trade in THIS run, regardless of which trigger
    fired. The writer is telling you the setup is hot and waiting another
    24h is too slow. Confirm with get_stock_data, then place_trade at
    market and update_thesis(change_status:"ACTIVE") in the same run.
    The only acceptable defer is a fresh red flag in today's data that
    invalidates the writer's URGENT call.

- conviction=HIGH on a WATCHING thesis with TRIGGER_FIRED ENTER
  → default action is place_trade fast at full targetSizePct. The writer's
    conviction is strong; don't second-guess the ENTER fire unless live
    data contradicts the trigger predicate. Standard discipline (R/R
    check, slot budget) still applies.

- conviction=MEDIUM on TRIGGER_FIRED
  → trade on ENTER with normal discipline. This is the default flow you
    already know.

- conviction=LOW on TRIGGER_FIRED ENTER
  → ENTER fires here are SKIP-BY-DEFAULT. To trade, you must cite an
    additional confirming signal (a fresh routed signal, a volume confirm,
    a peer leadership shift). Most LOW ENTER fires should resolve as
    update_thesis() with a rejection rationale; thesis stays WATCHING.

- conviction=AVOID on TRIGGER_FIRED
  → do NOT place_trade. Write update_thesis() with a REVIEWED-only audit
    row citing the AVOID verdict. The thesis stays WATCHING; the user can
    override the writer's call by manually trading or by re-prompting the
    writer with new context.

On a held position (status=ACTIVE):
- HIGH/URGENT_BUY → wider hold tolerance; only EXIT triggers fire close_position.
- MEDIUM → standard discipline.
- LOW/AVOID → tighten stop on next REVIEW, consider preemptive close if
  thesis is no longer applicable.
```

This is the only conceptual addition to the daily-run prompt. The existing trigger-handling logic stays.

The tactical-run prompt gets a parallel hint (shorter — tactical is single-thesis, so it just reads `conviction` and applies the same tier semantics).

---

## 5. UI changes

### `ThesisSheet` header

Add a **conviction badge** next to the existing `StatusPill`:

```
[STATUS: WATCHING] [CONVICTION: HIGH]  ←  Two pills, same row.
                                          Tooltip on conviction shows
                                          convictionRationale.
```

Tier → badge variant:
- URGENT_BUY → `positive` variant, bold
- HIGH → `positive` variant
- MEDIUM → `secondary` variant
- LOW → `secondary` variant, muted
- AVOID → `negative` variant

No emoji, no icon — just a labeled `Badge` (per CLAUDE.md, ShadCN components as-is).

Composite score block (the 4 `ScoringRow` gauges + `CompositeScoreSkeleton`) **stays** — it's the analytical "why" supporting the conviction tier. The header badge IS the verdict; the gauges are the defense.

### `ThesisCard` (the carousel/list rendering)

Add a small conviction tier label to each card. Same variant palette as the sheet header.

### Read-theses table row

Add a conviction column next to the existing status/direction columns. Sort order: AVOID first (visual warning), then URGENT_BUY (action-required), then HIGH/MEDIUM/LOW in order.

### What does NOT change in the UI

- `composite` score gauges stay.
- Activity timeline stays.
- Price targets block stays.
- Analyst consensus widget stays.
- Research synthesis accordion stays.

The conviction badge is **additive**, not replacement. It's the at-a-glance verdict on top of the existing analytical surface.

---

## 6. New field vs re-purpose — explicit decisions

| Dimension | Decision | Reason |
|---|---|---|
| **Overall verdict (tier)** | NEW field `conviction` + `convictionRationale` | No existing field collapses the writer's qualitative verdict into a tier. Composite is setup-quality, not decisional. Direction is bull/bear/skip, not strength. |
| **Position-sizing intent** | RE-USE `targetSizePct` (make required) | Field already exists, optional, rarely populated. Promotion to required (for directional theses) costs nothing structurally and gives the daily-run a real input for sizing. |
| **Time-urgency** | RE-USE `horizon` + `catalystDate` + `maxHoldDays` | The existing 4-horizon enum already captures CATALYST (event-bound) / TRADE (days) / TARGET (weeks-months) / COMPOUNDER (years). Conviction composes with horizon; both are needed but they're orthogonal axes. URGENT_BUY can apply to a TRADE or a COMPOUNDER — the conviction tier signals "act now" regardless of horizon. |
| **Multi-condition entry ("volume AND price")** | RE-USE existing triggers + key_assumptions | The current trigger system is single-predicate per row. A true AND-composition would need a new predicate kind (`COMPOUND_AND` with sub-predicates) which is a refactor. For now: writer expresses the secondary condition (volume) in `key_assumptions` and uses the primary condition (price) as the ENTER predicate. Daily-run reads the assumption when ENTER fires and pulls live volume via `get_stock_data` to confirm before trading. Documented as a known limitation. |
| **"Buy at current price without trigger wait"** | NEW value via `conviction=URGENT_BUY` | Today the writer expresses this by setting entry_price = current_price + setting the ENTER trigger to PRICE_ABOVE(target), but the daily-run treats it identically to a "wait for breakout" setup. URGENT_BUY makes the "don't wait" semantic explicit. |
| **Setup-quality grade** | RE-USE `scoring` (composite + 4 dims) | Composite stays. It IS the analytical defense for the conviction tier — a HIGH conviction with composite 4 is the writer contradicting themselves and the UI should surface that as a warning (or the writer prompt should reject it as inconsistent). |
| **"Tracking but actively recommending against"** | NEW value via `conviction=AVOID` | Distinct from PASS (which archives off the watchlist). AVOID keeps the thesis on the watchlist with an explicit "do-not-trade" verdict, letting the user override or letting future refreshes upgrade conviction if conditions change. |

### Counterpoints from the research worth addressing

**Counterpoint 1: Sequoia / a16z treat conviction as binary.** Pat Grady (Sequoia): *"Presence of conviction is what matters."* VC IC memo guides explicitly reject graduated `Recommend / Pass / Pass for now` framing as "defensive politics." If the best investors don't use a tiered system, why should Hindsight?

→ **Reply:** VCs commit to 5-10 investments per fund out of thousands of pitches. The decision is *invest or don't* — binary makes sense at that ratio. Hindsight's writer covers 30+ names per analyst per cycle, more like a sell-side analyst initiating coverage across a sector. Sell-side IS graduated (5+ tiers across firms). Hindsight is structurally sell-side, not VC. The 5-tier design follows the structural cousin.

**Counterpoint 2: "Sizing based on conviction" is undisciplined.** Position-sizing schools explicitly warn that "your 'best' ideas often fail" and that fixed % per trade is the disciplined path. If conviction is unreliable as a sizing input, why let the writer encode it via `targetSizePct`?

→ **Reply:** Hindsight ALREADY applies discipline at execution — `maxPositionSize` / `realMaxPosition` / `maxOpenPositions` are account-level caps the daily-run enforces. The writer's `targetSizePct` is INTENT, not authority. Daily-run sees intent + applies cap → actual position size. The intent expression doesn't break discipline; it just gives the daily-run a structured input instead of forcing it to guess. Worst case: writer says HIGH+6%, account cap is 3%, daily-run trades 3%. Best case: writer says LOW+2%, daily-run trades 2% on the few trades that survive the tier semantics.

**Counterpoint 3: Goldman separates "rating" from "Conviction List."** Goldman has Buy/Neutral/Sell ratings AND a separately curated Conviction List. Two axes, not one. The proposed Hindsight design collapses them into one tier — is that the right trade?

→ **Reply:** This is a real consideration. Two fields would be `direction` + `conviction` (already in this design) PLUS a separate `onConvictionList: boolean` modifier. That'd be a 6-tier matrix (3 directions × Buy/Conviction-Buy × N). Strictly more expressive, but adds a field for marginal benefit. The 5-tier `conviction` collapses URGENT_BUY (= Conviction List membership) into the top of the same axis as HIGH (= ordinary Buy). The collapse loses one bit of information (whether a HIGH thesis is "regular high" or "Conviction List high") in exchange for one fewer field. I judged the trade worth it; principal can disagree and we add the second field.

**Counterpoint 4: Cross-firm rating taxonomies are non-uniform.** Same stock can be "Outperform" at one firm, "Buy" at another, "Overweight" at a third — none meaning quite the same thing. Aggregators have to normalize across firms. Does Hindsight risk the same fragmentation across analysts?

→ **Reply:** Hindsight has ONE canonical taxonomy (the 5-value enum) applied across all analysts. The fragmentation problem is cross-firm; we control the writer's taxonomy because we own the writer prompt. Anti-pattern would be letting each analyst define their own conviction scheme — we explicitly aren't doing that.

### What I considered and rejected

- **Deriving conviction from composite via arithmetic** (e.g., composite ≥ 8 = HIGH, 6-7 = MEDIUM, < 5 = LOW). Rejected because (1) the writer's qualitative judgment is the point — a 9/10 composite on a chase-mode breakout is NOT URGENT_BUY in the writer's mind; (2) URGENT_BUY isn't derivable from composite alone — it requires the catalyst-firing-NOW judgment; (3) AVOID isn't derivable from composite — it's a "structurally unsuitable for trading" judgment.
- **A `recommendedAction` enum** (per `GAPS.md` P1-6 for PROMOTION): rejected as the GENERAL solution because it conflates verdict with action. `BUY_LIVE / DEFER_TO_WATCHING / INVALIDATE` are PROMOTION-specific actions; conviction is a general verdict. This design SUPERSEDES P1-6 — the daily-run reads `conviction` on PROMOTED rows the same way it reads it on WATCHING rows. URGENT_BUY/HIGH on PROMOTED = re-enter; LOW = defer to WATCHING; AVOID = defer to WATCHING with stronger language; PASS-direction = invalidate.
- **A 3-tier enum (AVOID / NORMAL / HIGH)**: rejected because most theses would collapse to NORMAL and the differentiation the principal wants is lost. The 5-tier matches Wall Street's effective tier count (Sell / Underperform / Hold / Buy / Strong Buy) and maps cleanly to the 6 utterances.
- **A `urgency` field separate from a `conviction` field**: rejected. The principal's utterances collapse strength + urgency onto one decisional axis ("act now" vs "act on trigger" vs "skip"). Horizon already captures time-window. Separating urgency from conviction would be 2 fields for one decision.
- **Letting the writer call a new tool** (`emit_verdict()`): rejected. A field on the row is cheaper, simpler, and surfaces in the UI without tool plumbing.

---

## 7. Migration plan

### Schema migration

```sql
ALTER TABLE "Thesis" ADD COLUMN "conviction" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "convictionRationale" TEXT;
-- No NOT NULL constraint — legacy rows are null; new directional rows must
-- populate it via the Layer-1 gate in record_thesis / update_thesis.
```

No constraint at the DB level — the Layer-1 gate in the tool enforces it for directional writes after this ships. PASS theses + PENDING seeds + pre-V2 rows stay null.

### Backfill for existing rows

**Backfill strategy:** derive a default tier from existing fields for the ~50 rows in production, but mark them as `derived` (in a separate annotation or just by absence of `convictionRationale`) so the UI can show them differently if needed.

Derivation rule:
- composite ≥ 8 AND status=ACTIVE → `HIGH`
- composite 6–7 → `MEDIUM`
- composite < 6 → `LOW`
- direction=PASS → leave null (PASS is its own equivalent)
- direction=PENDING → leave null (no view yet)
- No `scoring.composite` (legacy pre-PR-9) → leave null

The first refresh after this ships overwrites the derived tier with the writer's actual judgment + a proper `convictionRationale`.

### What stays null

- All PASS theses (PASS is its own tier-equivalent)
- All PENDING seeds (no view yet)
- Pre-V2 rows whose composite is also null
- Manual UI-added watchlist rows that haven't been researched yet

The UI handles null conviction gracefully by hiding the badge (same way it handles missing composite today).

---

## 8. Prompt diffs — concrete

### `lib/agent/run-thesis-writer.ts` (`buildThesisWriterSystemPrompt`)

Insert a new step between step 3 (decision) and step 4 (persist):

```diff
   3. Make the decision on top of the research:
        - direction: LONG / SHORT / PASS
        - status: WATCHING (...) / ACTIVE (...)
        - horizon: CATALYST / TARGET / TRADE / COMPOUNDER
        - entry_price / target_price / stop_loss
        - R/R FLOOR — MANDATORY 2:1 MINIMUM
        - confidence_score (...)
        - core_belief / key_assumptions / invalidation_conditions
        - triggers (with the WATCHING/ACTIVE/PROMOTED template)
+
+ 3.5. Set the CONVICTION tier (REQUIRED on every directional thesis).
+
+      Pick ONE of:
+        URGENT_BUY — composite ≥ 8, catalyst firing NOW, R/R ≥ 3:1, you
+                     would buy at market immediately if it were your money.
+                     Reserved for clean PEAD post-print, dated event
+                     within ~24h, or any setup where waiting for a
+                     trigger would miss the move.
+        HIGH       — composite ≥ 7, catalyst window open, R/R ≥ 2.5:1,
+                     strong confluence across ≥ 3 of the 4 composite dims.
+                     The default for clean dated-catalyst trades and
+                     breakouts with volume confirm.
+        MEDIUM     — composite 6–7 OR composite ≥ 7 with one weak dim.
+                     The honest middle. Most theses are MEDIUM — HIGH is
+                     for clear conviction, not "I wrote a thesis so I
+                     have to commit."
+        LOW        — composite 4–6 OR composite ≥ 6 with material
+                     reservations (extended chase, weak peer rank,
+                     fundamentals problem). "I researched it; I don't
+                     love it; I'm not stopping you from tracking it."
+        AVOID      — the writer believes this should NOT trade even if
+                     triggers fire. Use when a user-added name is
+                     structurally unsuitable (broken fundamentals, dead
+                     catalyst) but the user wants it tracked rather than
+                     archived. For "researched and walked away," use
+                     direction=PASS instead.
+
+      ALSO REQUIRED: convictionRationale, one sentence (≤200 chars)
+      explaining the tier. Examples:
+        URGENT_BUY: "Clean PEAD beat-and-raise printed last night, first
+                     day of drift, no analyst PT updates yet, +3:1 R/R."
+        HIGH:       "Composite 8/10, June 3 catalyst 8 days out,
+                     hyperscaler backlog $73B, 93% analyst Buy."
+        MEDIUM:     "Decent technical breakout but weak peer rank (-33%
+                     YTD vs +20% peers); wait for confirmed beat."
+        LOW:        "Late-stage chase, RSI 73, volume below threshold;
+                     works only on perfect Q3 print."
+        AVOID:      "Revenue decelerated 4 consecutive quarters; MSFT
+                     Entra taking share; do not trade."
+
+      ALSO REQUIRED on every directional thesis: target_size_pct (the
+      % of portfolio you'd commit at full position). Pair this with the
+      conviction tier — URGENT_BUY/HIGH typically 4-6%; MEDIUM 2-4%;
+      LOW 1-2%; AVOID = 0 (not applicable, no trade intended).
```

### `lib/agent/tools/record-thesis.ts` (and `update-thesis.ts`)

Add to the Zod schema:

```ts
conviction: z
  .enum(["URGENT_BUY", "HIGH", "MEDIUM", "LOW", "AVOID"])
  .optional()
  .describe(
    "Writer's overall verdict on this thesis as a decisional tier. " +
    "REQUIRED for directional theses (LONG/SHORT). " +
    "URGENT_BUY = act on next review without trigger wait; " +
    "HIGH = strong conviction, act on ENTER fast at full size; " +
    "MEDIUM = normal discipline, normal size; " +
    "LOW = ENTER fires are skip-by-default, require additional confirm; " +
    "AVOID = do not trade even if triggers fire; thesis stays WATCHING. " +
    "For 'researched and walked away,' use direction=PASS instead."
  ),
convictionRationale: z
  .string()
  .max(200)
  .optional()
  .describe(
    "One sentence (≤200 chars) explaining the conviction tier choice. " +
    "REQUIRED whenever conviction is set."
  ),
target_size_pct: z
  .number()
  .min(0)
  .max(100)
  .optional()  // → REQUIRED in the Layer-1 gate for directional theses
  .describe(/* existing description */),
```

Add to `execute()` for directional writes:

```ts
// Conviction gate — required on every directional thesis after this ships.
if (
  (args.direction === "LONG" || args.direction === "SHORT") &&
  !args.conviction
) {
  return {
    summary: `Thesis rejected for ${args.ticker}: conviction tier required.`,
    data: { thesis_id: null, status: "FAILED", note: /* tier rubric */ },
    sources: [],
  };
}
// targetSizePct gate — same.
if (
  (args.direction === "LONG" || args.direction === "SHORT") &&
  args.target_size_pct == null &&
  args.conviction !== "AVOID"
) {
  return { /* reject with "target_size_pct required for tradeable theses" */ };
}
```

AVOID bypasses the targetSizePct gate because the writer is explicitly recommending no trade.

### `lib/agent/system-prompt.ts` (`buildDailyRunSystemPromptV2`)

Add a new section between "How you work" and the per-needsAction walk:

```diff
+## Conviction-aware action discipline
+
+Every thesis carries a `conviction` tier set by the writer
+(URGENT_BUY / HIGH / MEDIUM / LOW / AVOID). Read it FIRST when deciding
+what to do with a needsAction trigger. Per-tier semantics:
+
+- conviction=URGENT_BUY on a WATCHING thesis with needsAction != null
+  → default action is place_trade in THIS run, regardless of which trigger
+    fired. The writer is telling you the setup is hot and waiting another
+    24h is too slow. Confirm with get_stock_data, then place_trade at
+    market and update_thesis(change_status:"ACTIVE") in the same run.
+    Only defer if today's data invalidates the writer's URGENT call.
+
+- conviction=HIGH on TRIGGER_FIRED ENTER
+  → default action is place_trade fast at full targetSizePct. Don't
+    second-guess the ENTER fire unless live data contradicts the trigger
+    predicate.
+
+- conviction=MEDIUM on TRIGGER_FIRED
+  → trade on ENTER with normal discipline (the default flow you know).
+
+- conviction=LOW on TRIGGER_FIRED ENTER
+  → ENTER fires here are SKIP-BY-DEFAULT. To trade, cite an additional
+    confirming signal (fresh routed signal, volume confirm, peer
+    leadership shift). Most LOW ENTER fires resolve as update_thesis()
+    with a rejection rationale; thesis stays WATCHING.
+
+- conviction=AVOID on TRIGGER_FIRED
+  → do NOT place_trade. Write update_thesis() with a REVIEWED-only
+    audit row citing the AVOID verdict. The thesis stays WATCHING; the
+    user can override by manually trading.
+
+On a held position (ACTIVE):
+- HIGH/URGENT_BUY → wider hold tolerance; only EXIT triggers close.
+- MEDIUM → standard discipline.
+- LOW/AVOID → tighten stop on next REVIEW, consider preemptive close.
+
+If `conviction` is null on a row, treat it as MEDIUM. Pre-V2 legacy
+rows + the first daily-run after this ships will see this until the
+writer refreshes them.
```

The tactical-run prompt gets a 1-paragraph version of the same.

---

## 9. Effort estimate

Total: **2–3 days** of work, single PR shippable end-to-end.

| Day | Work |
|---|---|
| 1 | Schema migration + record_thesis/update_thesis Zod schema + Layer-1 gates + writer prompt with the conviction rubric + backfill SQL for the ~50 existing rows |
| 2 | Daily-run prompt update (conviction-aware action discipline section) + tactical-run prompt parallel hint + UI: conviction badge in ThesisSheet header + ThesisCard tier label |
| 3 | Read-theses table conviction column + tests (Layer-1 gate rejections, daily-run prompt integration tests via a curated thesis fixture, UI snapshot) + soak via a manual writer-dispatch on 3 test tickers |

No multi-PR workstream. No new tools. No new triggers. No role-boundary changes. No mid-run dispatching changes. Pure field + prompt + UI.

---

## 10. What's explicitly NOT changing

- **Role boundaries** stay. Writer still doesn't trade. Daily run still owns status decisions. Discovery still mints. Promotion-action still flips ACTIVE → PROMOTED.
- **Trigger primitives** stay. No new predicate kinds. No compound AND. Multi-condition "volume AND price" still expressed via primary-predicate ENTER + secondary-condition in `key_assumptions` + agent confirms with `get_stock_data` at ENTER fire.
- **The 4-dim `scoring` composite** stays. It's the analytical defense for the conviction tier. Composite ≥ 7 is still the "ADD/ROTATE eligible" threshold today; conviction adds a tier verdict on top of that, it doesn't replace the composite math.
- **`direction=PASS`** stays. PASS = "researched, walked away, archive." AVOID = "tracking but recommend against trading." Both legal; they answer different questions.
- **PROMOTION refresh flow** stays — but the writer now emits `conviction` instead of a separate `recommendedAction`. P1-6 is absorbed into this design.
- **`get_theses` response shape** stays. `conviction` and `convictionRationale` are added to the per-thesis JSON; the existing `cards` array gets two new fields. No structural rewrite.
- **`needsAction`** logic stays. The 4 kinds (PROMOTED_AWAITING_RESOLUTION, TRIGGER_FIRED, TRIGGER_MATCHING_NOW, REVIEW_DUE) are unchanged. Conviction is read AFTER needsAction tells the agent there's work to do.
- **`targetPrice` overload** (P1-3) is NOT fixed here. Conviction expression and the target-price split are orthogonal. P1-3 stays open.
- **Activity log** is unchanged. ThesisUpdate rows still capture status changes, REVIEWED, INVALIDATED, etc. The new conviction field will appear in the `fieldChanges` diff when an update changes it.

---

## 11. Open questions for principal

1. **Conviction-composite consistency check.** Should the writer be REJECTED at Layer-1 for emitting `conviction=HIGH` with `composite=4`? The two should be coherent. Suggested default: reject `URGENT_BUY` or `HIGH` when composite is null OR < 6, with the rejection message asking the writer to either downgrade conviction or re-justify the composite. Strict gate, or soft warning?

2. **AVOID + WATCHING semantics on the watchlist.** AVOID on a WATCHING thesis keeps it visible but flagged. Should AVOID rows still surface in `needsAction` (so the daily-run sees them as work to walk through)? Or should AVOID-WATCHING be invisible from `needsAction` (the writer's call is "leave this alone")? Suggested default: surface in `needsAction` so the agent reads + acknowledges the AVOID, then writes a REVIEWED row and moves on. The user sees the conviction tier in the UI separately.

3. **URGENT_BUY trade gate.** URGENT_BUY tells the daily-run to act WITHOUT trigger fire. Should this be a hard "place_trade in this run" (potentially aggressive on a stale URGENT_BUY) or a "place_trade only if URGENT_BUY was set within last 24h" (decays over time)? Suggested default: decay after 24h to HIGH. A 3-day-old URGENT_BUY is suspect — either the move already happened or the writer's call has aged out.

4. **Backfill aggressiveness.** Derived backfill from composite gives ~50 rows a default tier. Alternative: leave them all null and let the next refresh populate them organically. Suggested default: derive, mark with `convictionRationale = "backfilled from composite on YYYY-MM-DD"` so the UI can distinguish and the next writer refresh overwrites cleanly.

5. **UI badge color for LOW vs AVOID.** Both are negative-ish but mean different things. Suggested default: LOW = `secondary` (muted), AVOID = `negative` (red). Or pick a different palette pairing — your call on the visual hierarchy.

6. **Tier name for `URGENT_BUY`.** The name is verbose and asymmetric (`URGENT_BUY` vs `HIGH/MEDIUM/LOW/AVOID`). Sell-side anchors: Goldman uses "Conviction Buy" (separate from rating axis), aggregators standardize on "Strong Buy" as the top tier above "Buy." Retail anchor: "back up the truck" / "loading the boat" / "YOLO" all map to the same semantic. Three alternatives, principal's call:
   - `URGENT_BUY` (current) — explicit, captures the "act now without trigger" semantic that's the load-bearing differentiator from HIGH
   - `STRONG_BUY` — matches Wall Street aggregator taxonomy; conventional; loses the "act NOW" specificity
   - `CONVICTION_BUY` — matches Goldman's separately-curated list; signals "the writer's strongest call"; tighter than URGENT_BUY

   Same question applies to the bottom tier: `AVOID` (current, explicit) vs `STRONG_PASS` (mirrors Wall Street "Strong Sell"). I'd keep `AVOID` because it carries the "actively tracked but recommend against trading" semantic that `STRONG_PASS` doesn't.

7. **Should `direction=PASS` carry a conviction value too?** Today the design says PASS skips conviction (PASS is its own equivalent of AVOID-and-archive). But Sequoia / a16z memo language for declines is "Pass" with a one-line rationale — they don't grade the PASS. Hindsight should follow suit. Suggested default: PASS theses have `conviction=null`, and the UI infers "PASS" as the tier label for display. No change needed; just documenting the inherited behavior.

---

## 12. See also

### Hindsight internal
- [`THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) §0 (the five roles — this design keeps all boundaries intact) and §8 (Fields — `conviction` joins the operational-state group)
- [`GAPS.md`](../GAPS.md) **P1-6** (writer urgency signal on promotion refreshes — absorbed into this design)
- [`GAPS.md`](../GAPS.md) **P1-3** (targetPrice overload — adjacent but not addressed here)
- [`PRINCIPLES.md`](../PRINCIPLES.md) — the three-layer principle. Conviction lives at Layer-2 (a structured tool-result field that pre-digests state for the agent) + Layer-3 (the daily-run prompt teaches per-tier judgment). The Layer-1 gate just enforces that directional theses HAVE a conviction set — it doesn't second-guess WHICH tier.
- [`MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — the V2 daily-run prompt design this builds on. The conviction-aware action discipline section is additive to V2's needsAction walk.

### Real-world conviction-vocabulary sources (the Step 3 research)

Sell-side rating taxonomies:
- [Morgan Stanley General Research Disclosures](https://www.morganstanley.com/eqr/disclosures/webapp/generalresearch) — Overweight / Equal-weight / Underweight definitions
- Goldman Sachs Conviction List — see [Benzinga: Goldman Sachs Updates Its Conviction List](https://www.benzinga.com/analyst-ratings/analyst-color/17/07/9778951/goldman-sachs-updates-its-conviction-list-what-that-mean) for the framing that Conviction List is a separate axis from Buy/Neutral/Sell ratings
- [stockanalysis.com — What Do Stock Analyst Ratings Mean?](https://stockanalysis.com/article/analyst-ratings-explained/) — cross-firm rating taxonomy (Strong Buy / Buy / Hold / Sell / Strong Sell) and the cross-firm normalization problem
- [TipRanks Analyst Consensus glossary](https://www.tipranks.com/glossary/a/analyst-consensus) — 3-tier (Buy / Hold / Sell) aggregator framing

Buy-side / hedge fund pitch frameworks:
- [Mergers & Inquisitions — Stock Pitch Guide](https://mergersandinquisitions.com/stock-pitch-guide/) — components of a hedge fund pitch sheet (recommendation, upside/downside, thesis, what street is missing, catalysts, scenarios)
- [Finance Interview Prep — Hedge Fund Stock Pitch Framework](https://financeinterviewprep.com/blog/hedge-fund-stock-pitch-framework) — R/R conviction bands (3:1-5:1 = HIGH, 2:1-3:1 = core/moderate, 1:1-2:1 = usually pass)
- [Street of Walls — Stock Pitch Do's and Don'ts](https://www.streetofwalls.com/articles/hedge-fund/recruiting-interviewing/stock-pitch-the-dos-and-donts/) — "consensus ideas and low conviction" as major don'ts

VC IC memo structure (for the binary-conviction counterpoint):
- [Alex Jarvis — The confidential YouTube Investment Memo by Sequoia](https://www.alexanderjarvis.com/the-confidential-youtube-investment-memo-by-sequoia-you-were-never-meant-to-see/) — the actual Sequoia memo, sections + the narrative-not-numerical conviction expression
- [The VC Factory — IC Memos guide](https://thevcfactory.com/investment-committee-memos/) — Pat Grady's "Presence of conviction is what matters" quote + the rejection of graduated "Recommend / Pass / Pass for now" framing

Retail / fintwit anchors (provided by principal):
- @Traderstewie ($INTC "Holy Grail setup, explode this week, Targets $130"; $AEHR "Gorgeous consolidation, any day now, Targets $120-$125")
- @TheProfInvestor ($RDDT "sleeping giant, I own it, I will hold")
- Principal's confluence explainer (3+ aligned signals = high conviction sizing)

WSB / retail vocabulary:
- [Infinity Investing — The Ultimate Guide to Reddit's WSB Slang](https://infinityinvesting.com/wallstreetbets-slang-meaning/) — YOLO, Diamond Hands, Paper Hands, Tendies vocabulary
- [SuperMoney — The Back Up The Truck Strategy](https://www.supermoney.com/encyclopedia/backing-up-the-truck) — "back up the truck" semantic (substantial purchase, extreme bullishness) and origin

Position sizing schools (for the sizing-vs-conviction debate):
- [TraderLion — Position Sizing Strategies](https://traderlion.com/risk-management/position-sizing-strategies/) — starter position (10%), scale-in (20%/10%/20%), Small-Early-Big-Late pyramiding, and the conviction-vs-fixed-% debate
