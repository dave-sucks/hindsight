> **SHIPPED/SUPERSEDED — see [`../THESIS_GAME_PLAN.md`](../THESIS_GAME_PLAN.md) (the trigger ladder is how conviction is expressed now); kept as build history.**

# Conviction Expression — how the writer says "high conviction, urgent buy"

> **What this is:** design for letting the thesis-writer (and discovery) emit a structured **conviction tier**, a required **variant view** on top-tier calls, and a one-line **rationale** for the tier — so the daily-run + tactical agents read the writer's verdict as structured input instead of re-deriving it from prose rationale every run.
>
> **Status:** design, not yet implemented. Generalizes (and absorbs) [`GAPS.md`](../../GAPS.md) **P1-6** (writer urgency signal on promotion refreshes). Touches **P1-3** at the edges but does not fix it.
>
> **Owner:** principal. **Audience:** future session implementing this.
>
> **Version history:** v1 invented an `URGENT_BUY` tier that conflated conviction-strength with time-urgency, plus an `AVOID` tier the research didn't support. v2 split urgency into a separate `actNow` boolean and added the missing `variantView` field. v3 dropped `actNow` — triggers already express the "when," conviction expresses the "how strongly," and `actNow` was creating an ambiguity where the writer could set a waiting trigger AND tell the agent to skip it. v4 (this) adds the **reader-side resolver** on `get_theses` (a computed envelope with `actionability` state, live current price, trigger evaluation, and same-ticker supersession), answers v3's deferred §14 Q2 with two strict Layer-1 consistency gates (STRONG requires `composite ≥ 7`; STRONG/HIGH require `entryQuality ≥ 2`), and slims the daily-run prompt accordingly. The writer-side fields v3 introduced are unchanged — v4 closes the loop on the reader side so the daily-run agent reads a resolved verdict instead of re-deriving synthesis from the structured fields every cycle.

---

## TL;DR

**The gap (two halves).** A WATCHING thesis today is a flat row. Writer-side: the agent gets levels + a 4-dim setup-quality score + bull/bear bullets + structured triggers, but NOT the writer's opinion, variant view, or sizing intent. Reader-side: the agent gets a thesis ID + stored fields but NOT live current price, NOT trigger-fired state, NOT same-ticker supersession status, NOT a single "buyable today" rollup. Today's daily-run has to re-derive all of that in its own context every cycle. A thesis with `composite=9/10` and a thesis with `composite=5/10` look structurally identical, AND there's no way to glance at the list and see which one is actionable right now vs. waiting on a trigger that's $X away vs. already superseded by a newer sister thesis.

**The fix (two halves).**

**Writer-side — three new fields + one re-purpose:**

| Field | What it does | New or existing |
|---|---|---|
| `conviction` | Tier verdict: STRONG / HIGH / MEDIUM / LOW | NEW (stored) |
| `convictionRationale` | One-sentence why-this-tier (≤200 chars). Always paired with conviction. | NEW (stored) |
| `variantView` | "Consensus thinks X, I think Y, here's why." Required for STRONG/HIGH. | NEW (stored) |
| `targetSizePct` | % of portfolio at full position. Already a field; rarely populated. Promote to required for directional theses. | RE-PURPOSE |

**Writer-side — two Layer-1 consistency gates (new in v4):**
- Reject `conviction = STRONG` when `scoring.composite < 7`
- Reject `conviction ∈ {STRONG, HIGH}` when `scoring.entryQuality.score < 2`

These answer v3's deferred §14 Q2 and force the tier-composite-entryQuality discipline at the tool boundary rather than relying on prompt instruction alone. See §3.5.

**Reader-side — one computed envelope on `get_theses` (new in v4):**

Every `get_theses` row returns a `resolved` block alongside the stored fields:

| Sub-field | What it is |
|---|---|
| `currentPrice` | Live quote at read time (Finnhub, batched) |
| `entryQualityScore` | Surfaced flat from `scoring.entryQuality.score` (was nested) |
| `triggerState` | `ENTER_FIRED` / `ENTER_WAITING` / `EXIT_FIRED` / `NONE` — predicate evaluated against current price |
| `triggerDetail` | Human-readable: `"PRICE_ABOVE 92.5 (cur 90.30, -2.4%)"` |
| `actionability` | One of: `ENTER_NOW` / `WAIT_FOR_TRIGGER` / `PENDING_CATALYST` / `ACTIVE_HOLD` / `STALE_PAST_CATALYST` / `SUPERSEDED` / `DEAD` |
| `supersededBy` | Newer thesis ID on same ticker (when a sister thesis is INVALIDATED/ARCHIVED) |
| `staleness` | `FRESH` / `STALE` (past catalystDate with no resolution) |

Not a schema change — computed at read time. See §6.

No `actNow` boolean (v2 had one; removed — see §3.4). No new triggers, no compound predicates, no role-boundary changes. Writer still doesn't trade. Daily run still owns status decisions.

**Effort:** 5 days. Days 1-3 = the writer-side work (schema + gates + writer prompt + UI badges + backfill + tests). Days 4-5 = the reader-side work (resolver + slim daily-run prompt + actionability pill + tests). See §12 for the breakdown.

**Anchored on:** sell-side rating taxonomies (Goldman's two-axis Buy/Neutral/Sell + Conviction List inspires the conviction-as-separate-axis-from-direction shape), buy-side pitch frameworks (variantView required for high-conviction; R/R bands as tier thresholds), retail/fintwit anchors provided by principal (Traderstewie momentum patterns, Prof compounder commitment). Sequoia/a16z IC memo binary-conviction view addressed as counterpoint in §11. Full research appendix in Appendix A. The reader-side resolver is anchored on a separate failure mode: tonight's ranking exercise produced a shallow answer because the structured fields, even with conviction tiers added, still required the agent to re-derive (live price, trigger state, supersession) in its own context. The resolver moves that derivation once-into-tool-code instead of N-agents × M-cycles into prompt context.

---

## 1. The gap (in your framing)

A WATCHING thesis is supposed to tell the agent: **what we think will happen, how confident we are, what we'll do, when we'll do it, and what would change our mind.** Hindsight today has structured fields for almost all of these — except "how confident."

Today, on a WATCHING thesis, the agent sees:

- **WHERE the levels are**: `entryPrice` + `targetPrice` + `stopLoss` (plus a gauge in the UI showing target/stop with current price marker)
- **WHAT the case is**: `snapshot` + `bullCase` bullets + `bearCase` bullets + `coreBelief` (the one-sentence prediction) + `keyAssumptions` + `invalidationConditions`
- **WHEN to act**: `triggers` (structured ENTER/REVIEW predicates)
- **HOW LONG to hold**: `horizon` + `catalystDate` + `maxHoldDays`
- **A setup-quality score**: `scoring.composite` (4-dim grade, /10)

The agent does NOT see:

- **Whether the writer is HIGH on this stock** (no opinion / verdict)
- **Whether this is the writer's BEST CALL right now** (no top-tier flag)
- **WHY this trade vs the others on the watchlist** (no variant view / contrarian take — bull bullets aren't the same thing)
- **What POSITION SIZE the writer would take** (the field exists, nobody fills it)
- **A "100% buy as soon as XYZ happens, hold X time, targeting $Y" plan statement** (the components are scattered across 4 fields with no synthesis)

The result: every WATCHING thesis looks structurally similar in the daily-run agent's view. The writer's qualitative judgment lives entirely in prose `rationale` and the daily-run agent has to re-read it every cycle to grok how strongly the writer feels.

---

## 2. The full field list, with real examples

Two real theses, both 2026-05-26 promotion-refresh runs. Existing fields in the top rows, proposed-new fields in the bottom rows. Categorization in the rightmost column.

### Field categorization legend

- **TS** = Table-stakes. Real analysts (sell-side, buy-side, or both) have this. Missing it is a gap, not a design choice.
- **HS** = Hindsight-specific. Exists because of how the product works (automated triggers, agent cadence, status lifecycle).
- **YO** = Your-ask-driven. Proposed because of how the brief was phrased, not because real analysts have it.

### The full field list

| Field | What it does | MRVL today | OKTA today | After the change | Category |
|---|---|---|---|---|---|
| `direction` | Bullish / bearish / no view | `LONG` | `LONG` | (same) | **TS** |
| `coreBelief` | The one-sentence falsifiable prediction | "MRVL drifts to $270 within 60 days of its confirmed Q1 FY2027 beat-and-raise…" | "OKTA reaches $103 within 6–8 weeks as KeyBanc's PT raise and a 100% EPS beat streak sustain post-earnings breakout momentum…" | (same) | **TS** |
| `entryPrice` | Reference / planned entry | $196.33 | $92.24 | (same) | **TS** |
| `targetPrice` | Upside level | $270 | $103 | (same — but P1-3 overload remains; not addressing here) | **TS** |
| `stopLoss` | Downside level | $195 | $87 | (same) | **TS** |
| `horizon` | Time-window kind | `null` (broken — should be set) | `TRADE` | (same — separate fix) | **TS** |
| `catalystDate` | Dated event | past (May 27 earnings) | n/a | (same) | **TS** |
| `scoring.composite` | 4-dim setup grade (/10) | 9/10 (3+3+1+2) | 5/10 (2+1+1+1) | (same) | **HS** (IDEA is TS; the 4 specific dims are HS) |
| `bullCase` | Bullets making the case for entry | 5 bullets | 5 bullets | (same) | **TS** |
| `bearCase` | Bullets against | 5 bullets | 5 bullets | (same) | **TS** |
| `keyAssumptions` | What must remain true (≥2) | 4 assumptions | 4 assumptions | (same) | **TS** |
| `invalidationConditions` | What would prove wrong (≥2) | 4 conditions | 4 conditions | (same) | **TS** |
| `triggers` | Structured event predicates (when to act) | ENTER on PRICE_ABOVE $215 + 6 REVIEWs | ENTER on PRICE_ABOVE $92.5 + 5 REVIEWs | (same) | **HS** (real analysts use prose, but Hindsight needs structured predicates for trigger evaluator) |
| `targetSizePct` | % of portfolio at full position | `null` | `null` | **MRVL: 4%, OKTA: 1%** — promote to required | **TS** (field exists; we're just not using it) |
| `status` | Lifecycle (WATCHING / ACTIVE / etc.) | `WATCHING` | `WATCHING` | (same) | **HS** |
| **NEW** `conviction` | Tier verdict — STRONG / HIGH / MEDIUM / LOW | `null` (no surface) | `null` | **MRVL: HIGH, OKTA: LOW** | **TS** — every Wall Street firm rates this way |
| **NEW** `convictionRationale` | One-sentence why-this-tier (≤200 chars) | `null` | `null` | MRVL: "Composite 9/10, R/R 3:1, AWS Trainium 3 underweighted by Street. Entry conditioned on post-print drift above $215." / OKTA: "Composite 5/10, weak RS, late chase; works only if KeyBanc PT sustains and breakout holds — marginal R/R." | **TS** — every sell-side rating ships with a 1-line justification |
| **NEW** `variantView` | "Consensus thinks X, I think Y, here's why." Required when conviction is STRONG or HIGH. | `null` | `null` | MRVL: "Most analysts treat MRVL as #3 AI-silicon; AWS Trainium 3 is being underweighted by 2 quarters of run-rate, putting Q4 FY2027 revenue 8% above consensus." / OKTA: (optional on LOW — can be empty) | **TS** — every buy-side pitch framework requires this for high-conviction calls |

### What's the agent looking at, end-to-end

**Today, MRVL row from `get_theses`:**
```
ticker: MRVL, direction: LONG, status: WATCHING, composite: 9/10
target: $270, entry: $196.33, stop: $195, horizon: null
ENTER trigger: PRICE_ABOVE $215
+ snapshot/bull/bear bullets in prose
```
Agent reaction: "OK, LONG WATCHING with a $270 target. Trigger fires at $215. Bull case is PEAD. I'll wait for ENTER."

**After the change, MRVL row:**
```
ticker: MRVL, direction: LONG, status: WATCHING, composite: 9/10
conviction: HIGH, targetSizePct: 4%
variantView: "Most analysts treat MRVL as #3 AI-silicon; AWS Trainium 3
              is being underweighted by 2 quarters of run-rate, putting
              Q4 FY2027 revenue 8% above consensus."
convictionRationale: "Composite 9/10, R/R 3:1, AWS Trainium 3
                      underweighted by Street. Entry conditioned on
                      post-print drift above $215."
target: $270, entry: $196.33, stop: $195, horizon: TARGET (60d)
ENTER trigger: PRICE_ABOVE $215
```
Agent reaction: "HIGH conviction with a clear variant view about Trainium 3 underweighting. 4% size when ENTER fires at $215. If today's signals say Street is moving toward the writer's view on Trainium 3 (variantView dying), defer."

**OKTA row, today vs after:**
```
TODAY:
  ticker: OKTA, direction: LONG, status: WATCHING, composite: 5/10
  target: $103, entry: $92.24, stop: $87, horizon: TRADE, max_hold: 14d
  ENTER trigger: PRICE_ABOVE $92.5
  + snapshot/bull/bear bullets

AFTER:
  ticker: OKTA, direction: LONG, status: WATCHING, composite: 5/10
  conviction: LOW, targetSizePct: 1%
  variantView: null (not required on LOW)
  convictionRationale: "Composite 5/10, weak RS, late chase; works only
                        if KeyBanc PT sustains and breakout holds —
                        marginal R/R."
  target: $103, entry: $92.24, stop: $87, horizon: TRADE, max_hold: 14d
  ENTER trigger: PRICE_ABOVE $92.5
```

Today, the agent treats MRVL and OKTA identically when ENTER fires. After the change, MRVL=HIGH → trade fast at 4% size; OKTA=LOW → ENTER fires are skip-by-default unless additional signal appears; if traded, half size.

### Edge case: the "Buy ASAP, even at current price" thesis

Your example utterance: *"We think this can go up 500%. Buy ASAP even at current price."*

This is expressible WITHOUT a new `actNow` flag. The writer encodes it via:

```
conviction: STRONG
convictionRationale: "Most obvious trade — fundamentals + technicals + sentiment
                      align; Street consensus PT is half my fair value."
variantView: "Street has Z multiple compressed; normalized FCF supports 5x
              today's price within 18 months."
targetSizePct: 5%
entryPrice: <current price>
targetPrice: <current * 6>
stopLoss: <reasonable stop>
horizon: COMPOUNDER (or TARGET — writer's call)
triggers: [ EXIT on PRICE_BELOW(stop), REVIEW on earnings, REVIEW on filings ]
         (NO ENTER trigger — writer is saying "buy now," not "wait for X")
```

Daily-run reads:
- conviction=STRONG → "this is one of my top calls"
- no ENTER trigger → "the writer didn't gate entry on anything; the buy condition is just 'now'"
- entry = current price → "we're at the entry now"
- targetSizePct = 5% → "act at 5% of the portfolio"

Action: place_trade in this run at 5% size. The "act now" semantic falls out of the combination of conviction tier + trigger structure + entry near current.

If the writer wanted a conditional buy ("buy when it goes up to $114 tomorrow"), they'd set `ENTER on PRICE_ABOVE $114` and `conviction=HIGH`. Daily-run waits; when $114 hits, ENTER fires; daily-run reads HIGH conviction and trades fast at full size.

The trigger system is the "when." Conviction is the "how strongly." No need for a separate boolean.

---

## 3. The proposal — three new fields, one re-purpose

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
}
```

Three new fields. PASS theses + PENDING seeds + pre-V2 rows leave them null.

### Layer-1 gates

In `record_thesis` and `update_thesis`:

```
For directional writes (LONG/SHORT):
  REQUIRED:
    - conviction          (one of STRONG / HIGH / MEDIUM / LOW)
    - convictionRationale (≤200 char string)
    - targetSizePct       (promoted to required; was optional)

  CONDITIONAL:
    - variantView REQUIRED when conviction ∈ {STRONG, HIGH}

For PASS writes:
  conviction / variantView stay null (PASS is its own equivalent of "no view")

For PENDING writes (UI/builder/editor seeds):
  All three stay null (no view yet)
```

### Why only three new fields

Strict accounting against the "max 4 new, prefer 0" budget:

- **Could `conviction` and `convictionRationale` be one field?** No. Rationale is required text; tier is a structured enum. Conflating loses queryability.
- **Could `variantView` be folded into `convictionRationale`?** Different semantics: rationale = "why this tier" (e.g., "composite 9/10 + R/R 3:1"); variantView = "what's my edge vs consensus" (e.g., "Trainium 3 underweighted"). Different requirements: variantView required only for STRONG/HIGH; rationale required always. Different shapes. Conflating muddies the writer's mental model.
- **Could `variantView` be optional everywhere?** Yes, but then the "high conviction requires variant view" buy-side discipline isn't enforced. Making it conditionally required bakes the discipline into Layer-1.
- **What about a `planSummary` field?** Considered and cut. "If MRVL breaks $215, buy 4% targeting $270 over 60d" is derivable from `triggers` + `targetSizePct` + `targetPrice` + `horizon`. A separate prose field would just be a redundant restatement that could drift. UI should render this synthesized; no need to store.
- **What about `actNow`?** v2 had this. v3 removed it — see §3.4 below.

### 3.4. Why we cut `actNow` (the v2 → v3 change)

v2 of this doc had a boolean `actNow` flag that meant "trade in this same daily-run review without waiting for a trigger fire." The thinking was: cover the "Buy ASAP, even at current price" utterance with a flag that lets the writer say "skip the trigger fence."

That's wrong. Two reasons:

**Reason 1: triggers and conviction already cover the two real axes.** Triggers are the **WHEN** (what predicate must be true for entry). Conviction is the **WITH WHAT INTENSITY** (how aggressively the agent acts when conditions are met). The "Buy ASAP" semantic is just: writer sets no ENTER trigger (or sets one that fires immediately) AND conviction=STRONG. The combination IS the buy-now signal. No third axis needed.

**Reason 2: `actNow` created an ambiguity.** If the writer set `ENTER on PRICE_ABOVE $215` AND `actNow=true`, which wins — wait for the trigger or skip the fence? The trigger is the writer's expression of "wait for this." If the writer wants no waiting, they shouldn't set a waiting trigger. Letting `actNow` override the trigger fence means the writer can be self-contradictory and the agent has to guess intent.

The clean version: writer expresses entry timing through the trigger structure (or absence of a trigger). Conviction tier modulates how the agent responds when conditions are met. No extra boolean. The principal pushed back on this and was right.

Triggers themselves are a Hindsight workaround for the fact that agents aren't continuously running — in a "agent evaluates every minute" world, you wouldn't even need a separate triggers array; the agent would just check conditions each pass. Given we DO have triggers, they're the right place for "when," and conviction is the right place for "with what intensity." Separate axes. No collapsing.

### 3.5. Layer-1 consistency gates — REMOVED 2026-05-31

> **What was here:** two consistency gates — Gate A (STRONG requires composite ≥ 7) and Gate B (STRONG/HIGH require entryQuality ≥ 2). They were dropped after the first demo proved they made conviction nothing more than a derived label on composite. Conviction is the writer's INDEPENDENT view; coupling it to composite via gates defeated the whole point.
>
> **What stays:** the field-presence gates in §3 (required-when-directional, conviction_rationale required when conviction set, variantView required for STRONG/HIGH, targetSizePct required). Those don't couple conviction to composite — they just require fields to exist.
>
> **What the writer prompt now teaches:** conviction is INDEPENDENT of composite. You can be HIGH on a composite-6 thesis if the variant view is sharp; you can be MEDIUM on a composite-9 if the catalyst won't land. Composite is rubric-based; conviction is the writer's call.

The original (removed) text below is kept as historical context for the v4 → v4.1 reversal.

---

**[REMOVED]** Beyond the field-presence gates in §3 (required-when-directional, variantView-required-for-STRONG/HIGH, targetSizePct-required), two additional Layer-1 gates enforce **tier-composite-entryQuality consistency**. These answer §14 Q2 (which v3 deferred as "strict gate, or soft warning?") with **strict gate**.

```
Gate A — composite floor for STRONG:
  IF args.conviction == "STRONG" AND scoring.composite < 7:
    REJECT with: "STRONG conviction requires composite ≥ 7. Current composite
                  is N. Either downgrade to HIGH/MEDIUM/LOW, or re-score
                  composite with justification for the dimensions you raised."

Gate B — entryQuality floor for STRONG/HIGH:
  IF args.conviction ∈ {"STRONG", "HIGH"} AND scoring.entryQuality.score < 2:
    REJECT with: "Late-stage / extended entries cannot carry STRONG or HIGH
                  conviction. entryQuality is N (< 2). Either downgrade to
                  MEDIUM/LOW, or wait for a better entry and re-score
                  entryQuality with justification."
```

**Why strict, not warning.** Without these gates, the tier is "another field the writer can be inconsistent in" — exactly the failure mode v4 is trying to fix. With them, the rubric in §4 becomes enforced at the tool boundary, not aspirational guidance buried in the writer system prompt. A writer model that wants to mark every thesis STRONG to look productive is mechanically stopped.

**Concrete example from tonight's production data.** OKTA on 2026-05-26: composite 7, entryQuality 1 ("RSI ~70, low volume participation"). Under the §4 rubric, this maps to MEDIUM ("composite 6-7"). But the §4 rubric is teaching, not enforcement — without Gate B, a writer could still emit `conviction=HIGH` on this row. With Gate B, `HIGH` is mechanically rejected, forcing MEDIUM or LOW.

**What's NOT gated.** The mapping from composite to MEDIUM vs LOW (and from HIGH to STRONG within the allowed band) stays in writer judgment. Gates A and B set FLOORS, not exact assignments. A writer can land at MEDIUM with composite 8 + entryQuality 3 — that's the writer's call about variantView strength, R/R, conviction-on-the-narrative. The gates only block the impossible combinations.

**Where the gate lives.** `lib/agent/tools/record-thesis.ts` and `update-thesis.ts`, in `execute()` before the persist call. The gate reads `args.scoring` (already required in the schema). Rejection returns a `ToolResult` with `ok: false` and the rejection message; the agent retries on the next loop iteration with the corrected fields.

**Counter-question — should there be a STRONG-budget gate?** Open: should Layer-1 also reject a writer's Nth STRONG emission within a single run/cycle? §4 rubric says "reserved for top 2-3 calls per analyst per cycle." Without a budget gate, that's just teaching. With one, it's enforced — but it requires per-run state in the gate (counting STRONG emissions). Deferred to §14 (new Q8) — likely yes, but additional complexity worth a separate decision.

---

## 4. Tier semantics

```
STRONG  ("top-tier conviction; Goldman Conviction List equivalent")
  Writer's best calls — typically 2-3 names per analyst per cycle.
  Requires variantView.
  Daily-run discipline: act on triggers FAST at full targetSizePct;
  if no ENTER trigger (or entry condition is "now"), trade in this run;
  on ACTIVE positions, wider hold tolerance (small noise doesn't exit).

HIGH    ("solid conviction; standard Buy")
  Default for clean dated-catalyst trades and breakouts with volume
  confirm. Requires variantView.
  Daily-run discipline: act on ENTER triggers at full targetSizePct;
  on ACTIVE, standard discipline + slightly wider hold tolerance.

MEDIUM  ("normal conviction; Hold / Equal-weight")
  The honest middle. Trade with normal discipline.
  variantView optional.
  Daily-run discipline: trade on ENTER with standard checks
  (R/R, slot budget, live data confirm).

LOW     ("Eh; weak conviction")
  Tracking but not enthusiastic. Most ENTER fires should be skipped
  unless an additional confirming signal appears.
  variantView optional.
  Daily-run discipline: ENTER fires are SKIP-BY-DEFAULT; require
  cite of additional signal to trade. Default position is half
  targetSizePct if traded. On ACTIVE, tighten stop on next REVIEW
  and consider preemptive close.
```

`AVOID` is NOT a tier (v1 invented it, v3 cuts it). The "no way" case maps to `direction=PASS` — already exists, archives off the watchlist.

### Writer rubric (taught in the writer system prompt)

| Tier | When to use it | variantView |
|---|---|---|
| STRONG | Composite ≥ 8 + R/R ≥ 3:1 + clear variant view + you'd buy at market today if it were your own money. Reserved for top 2-3 calls per analyst per cycle. | REQUIRED. A STRONG call without a variant view is contradictory. |
| HIGH | Composite ≥ 7 + R/R ≥ 2.5:1 + you have a defensible variant view. The default for clean dated-catalyst trades and breakouts with volume confirm. | REQUIRED. |
| MEDIUM | Composite 6–7, OR composite ≥ 7 with one weak dimension. The honest middle. Most theses should be MEDIUM — HIGH is for clear conviction with edge, not "I wrote a thesis so I have to commit." | Optional. |
| LOW | Composite 4–6, OR composite ≥ 6 with material reservations. "I researched it, I don't love it, I'm not stopping the user from tracking it." | Optional (typically empty). |

### Position sizing guidance (writer pairs `targetSizePct` with the tier)

- STRONG → 4-6%
- HIGH   → 3-5%
- MEDIUM → 2-3%
- LOW    → 1-2% (if traded at all)

Account-level caps (`maxPositionSize`, `realMaxPosition`) still apply at execution. Writer's intent gets clipped to the cap by the daily-run; the intent is data for the execution decision.

### `variantView` examples (required for STRONG/HIGH)

- STRONG/AVGO: "Street consensus PT $478 implies in-line Q2; I expect a guide-raise that forces 30-day estimate revisions to $520+, driven by hyperscaler XPU backlog upside not yet in models."
- HIGH/MRVL: "Most analysts treat MRVL as the #3 AI-silicon name; AWS Trainium 3 program is being underweighted by 2 quarters of run-rate, putting Q4 FY2027 revenue 8% ahead of consensus."
- HIGH (defensive): "Consensus expects a Q3 beat; I disagree only on magnitude — guide-raise is the swing factor not the print itself, and few models account for the seasonality."

---

## 5. The 6 utterances mapped

| Utterance | direction | conviction | variantView | targetSizePct | triggers |
|---|---|---|---|---|---|
| "Buy ASAP even at current price. Up 500%." | LONG | STRONG | required (e.g., "Street has multi-year ramp underweighted; entry well below normalized FCF multiple") | 5% | NO ENTER trigger (or PRICE_ABOVE(current-0.01) which fires immediately); EXITs on stop |
| "Watching with high confidence, fire entry when volume reaches X and price up 3%." | LONG | HIGH | required (e.g., "Consensus skeptical of post-print follow-through; volume confirm is the leading indicator they're missing") | 4% | ENTER on PRICE_ABOVE; volume condition in `key_assumptions`; daily-run pulls live volume at ENTER fire |
| "Maybe buy, definitely sell if it hits $Y." | LONG | MEDIUM | optional | 2% | ENTER trigger; tight stop at $Y |
| "Don't sell until it reaches $X." (on ACTIVE) | LONG (already) | STRONG or HIGH | required | already sized | EXIT triggers = stop + target $X only; wide hold tolerance per tier |
| "Eh." | LONG | LOW | optional (typically empty) | 1% | ENTER trigger; daily-run treats fires as skip-by-default |
| "No way." | **PASS** | null | null | null | terminal at write (status=ARCHIVED) |

All six covered. No `actNow`, no `AVOID` tier.

---

## 6. The resolved envelope on `get_theses`

This is the v4 reader-side fix. The premise: even with conviction tiers, variantView, and the consistency gates from §3.5, the daily-run agent still has to do too much synthesis per cycle. It still has to figure out *"is OKTA above $92.50 right now,"* *"is this older ZS thesis still live or superseded by the newer INVALIDATED one,"* *"is DELL's earnings catalyst still in the future."* All of that is derivable from existing data — but every agent has to derive it in its own context, every cycle, possibly inconsistently.

The fix: when `get_theses` returns a thesis, it returns a `resolved` block alongside the stored fields. The block is computed at read time, fresh per call, never stored.

### Shape

```ts
type GetThesesRow = {
  // ... existing stored fields (id, ticker, direction, status, conviction,
  //                            variantView, scoring, triggers, entryPrice,
  //                            targetPrice, stopLoss, catalystDate, ...) ...

  resolved: {
    currentPrice: number | null;          // Finnhub quote at read time; null on quote failure
    entryQualityScore: number | null;     // Surfaced flat from scoring.entryQuality.score

    triggerState: "ENTER_FIRED" | "ENTER_WAITING" | "EXIT_FIRED" | "NONE";
    triggerDetail: string | null;         // For WAITING: "PRICE_ABOVE 92.5 (cur 90.30, -2.4%)"

    actionability:
      | "ENTER_NOW"              // entry trigger fired (or no trigger + entry ≈ current)
      | "WAIT_FOR_TRIGGER"       // ENTER trigger exists, not yet fired
      | "PENDING_CATALYST"       // catalystDate in future, can't act until after
      | "ACTIVE_HOLD"            // status=ACTIVE; this row tracks an open position
      | "STALE_PAST_CATALYST"    // catalystDate in past, no resolution recorded
      | "SUPERSEDED"             // newer thesis on same ticker exists (INVALIDATED/ARCHIVED)
      | "DEAD";                  // status ∈ {INVALIDATED, ARCHIVED, CLOSED}

    supersededBy: string | null;          // newer thesis id, when supersession applies
    staleness: "FRESH" | "STALE";         // FRESH | past catalystDate w/ no resolution → STALE

    resolvedAt: string;                   // ISO timestamp — when this envelope was computed
    quoteAgeMs: number | null;            // 0 if live; up to cache TTL otherwise
  };
};
```

### Actionability decision tree

The order of checks matters. First match wins.

```
1. status ∈ {INVALIDATED, ARCHIVED, CLOSED}                  → DEAD
2. A newer (createdAt) thesis on same (ticker, accountId)
   has status ∈ {INVALIDATED, ARCHIVED} or is direction=PASS  → SUPERSEDED
   (and populate supersededBy)
3. status == ACTIVE                                           → ACTIVE_HOLD
4. catalystDate is in future                                  → PENDING_CATALYST
5. catalystDate in past with no resolution audit row recorded → STALE_PAST_CATALYST
   (the daily-run that the catalyst was for never came back to update)
6. ENTER trigger exists AND predicate evaluates true vs cur   → ENTER_NOW
7. NO ENTER trigger AND entryPrice within ±1% of cur          → ENTER_NOW
   (the "writer is saying buy at market" case from §2)
8. ENTER trigger exists AND predicate evaluates false         → WAIT_FOR_TRIGGER
9. Else                                                       → WAIT_FOR_TRIGGER
   (defensive — shouldn't hit in practice)
```

### Implementation notes

**Quote fetching.** Batched across all tickers in one `get_theses` call. Finnhub `/quote` supports per-ticker; batch to a single concurrent fan-out (existing pattern in `lib/intelligence/`). On quote failure (network, rate-limit), `currentPrice = null` and `actionability` falls back to `WAIT_FOR_TRIGGER` for any row that would have needed a live price comparison; the agent reads `quoteAgeMs = null` as the signal that resolved state is degraded.

**Quote staleness budget.** Open question — see §14 Q9. Default proposed: 60-second in-memory cache keyed by (ticker, market-open-flag). Live every call would 10× the Finnhub call rate from the morning cron; 60s cache is well within the half-life of a meaningful price move during normal market regime.

**Trigger predicate evaluation.** Reuse the predicate evaluator already in `lib/inngest/functions/trigger-evaluator.ts`. The shapes are identical; the only new wrapper is a synchronous call that takes `(predicate, currentPrice, fundamentals)` and returns boolean. Extract into `lib/agent/triggers/evaluate.ts` so both the cron evaluator and the resolver share one source of truth.

**Supersession query.** One additional SQL per `get_theses` call (not per thesis):

```sql
SELECT ticker, MAX("createdAt") AS deadAt, MAX(id) AS deadId
FROM "Thesis"
WHERE accountId = $1
  AND ticker = ANY($2)  -- tickers from the main result
  AND (status IN ('INVALIDATED','ARCHIVED','CLOSED') OR direction = 'PASS')
GROUP BY ticker;
```

Join in code: for each row in the main result with `createdAt < deadAt`, set `supersededBy = deadId` and `actionability = SUPERSEDED`. This catches tonight's two-ZS case (older WATCHING row with a newer INVALIDATED sister).

**Cost.** Per `get_theses` call: 1 batched quote fetch (1 HTTP, all tickers) + 1 supersession SQL + N synchronous predicate evaluations. For a typical 30-row watchlist, the added cost is ~200ms (the Finnhub round-trip dominates). Acceptable. Resolver result can be cached per-(runId, tickerSet) for the duration of a single agent run — most runs call `get_theses` once early and reference the same data throughout.

### Why NOT stored

- Prices change every minute. Storing means stale within seconds and triggering invalidation churn.
- Trigger state is by definition derived (predicate × current value).
- Supersession depends on the existence of *other* rows; storing it on one row creates write-ordering problems when a sister row is created.
- The whole point is to give the agent a fresh resolved verdict per read. Storing it would re-introduce the same staleness/synthesis-burden problem v4 is trying to eliminate.

### What this enables for tonight's failed ranking exercise

Re-running the test with the resolver: a single SQL-equivalent on the agent's side becomes "filter rows where `resolved.actionability = ENTER_NOW`, sort by conviction tier descending, then by composite descending, then by R/R descending." No prose-reading. No cross-thesis dedup. No live-price fetch in the agent's context. The two ZS rows collapse to one (newer INVALIDATED → DEAD, older WATCHING → SUPERSEDED with the newer's id). OKTA shows ENTER_NOW with triggerDetail explaining the price relationship. DELL shows PENDING_CATALYST until the May 28 print resolves. NVTS and PLTR show WAIT_FOR_TRIGGER with the price gap. The agent reads a resolved verdict and can rank deterministically.

---

## 7. What the daily-run prompt does with it

Slimmer in v4 than v3 because the resolver from §6 carries most of the synthesis. The prompt teaches **two rules**: filter by `actionability` first, then use `conviction` to modulate. The five tier×trigger conditionals from v3 collapse because `actionability` already encodes "trigger fired AND price still valid AND not superseded AND not stale."

Add to `buildDailyRunSystemPromptV2`:

```
## Action discipline — actionability first, conviction modulates

Every `get_theses` row carries a `resolved` block with an `actionability`
state, a `triggerDetail` describing trigger state, and a fresh
`currentPrice`. Use those — do not re-derive them.

Step 1: Filter by actionability.

  ENTER_NOW          → candidate to trade in this run
  ACTIVE_HOLD        → managed position; check exit triggers + hold
                       tolerance per conviction tier (Step 2)
  WAIT_FOR_TRIGGER   → do not trade. Note in run summary if conviction
                       is STRONG/HIGH and triggerDetail shows price
                       within ~2% of trigger (writer would want to know).
  PENDING_CATALYST   → do not trade; revisit after catalystDate
  STALE_PAST_CATALYST→ do not trade; consider update_thesis to archive
                       or refresh if the original thesis is still valid
  SUPERSEDED         → ignore; the newer thesis (supersededBy) is the
                       live one. Do not trade the stale row.
  DEAD               → ignore

Step 2: For each ENTER_NOW / ACTIVE_HOLD, modulate by conviction.

  STRONG → full targetSizePct; on ACTIVE, wider hold tolerance
           (small noise doesn't exit). Verify variantView still holds
           against today's fresh data — if consensus moved to the
           writer's view, defer.
  HIGH   → full targetSizePct; standard discipline. Same variantView
           freshness check.
  MEDIUM → standard targetSizePct; standard discipline. No variantView
           required.
  LOW    → SKIP-BY-DEFAULT on ENTER_NOW. To trade, cite an additional
           confirming signal (fresh routed signal, volume confirm,
           peer leadership shift) AND use half targetSizePct.
           On ACTIVE, tighten stop on next REVIEW.

Account-level caps still apply at execution. targetSizePct is intent;
the trade tool clips to maxPositionSize.

If `conviction` is null on a row (pre-v4 legacy + the first daily-run
after this ships), treat as MEDIUM until the writer refreshes.

When you read a STRONG/HIGH thesis, the `variantView` field IS the
writer's specific edge — "consensus thinks X, I think Y." That's a
falsifiable claim. If today's signals (routed news, analyst PT moves,
catalyst print direction) say the variantView no longer holds, defer
even on ENTER_NOW.
```

The tactical-run prompt gets a parallel one-paragraph version that reads `resolved.actionability` and `conviction` on the single triggered thesis.

---

## 8. UI changes

### `ThesisSheet` header

Two badges next to `StatusPill` — conviction (writer's view) + actionability (resolver verdict):

```
[STATUS: WATCHING]  [CONVICTION: HIGH]  [READY TO BUY]
```

**Conviction badge** — tier → badge variant:
- STRONG → `positive`, bold
- HIGH → `positive`
- MEDIUM → `secondary`
- LOW → `secondary`, muted

Tooltip on the conviction badge shows `convictionRationale`.

**Actionability badge** (new in v4) — driven by `resolved.actionability` from §6:

| State | Label shown | Variant | Tooltip / detail |
|---|---|---|---|
| `ENTER_NOW` | READY TO BUY | `positive` | `triggerDetail` if present; otherwise "writer entry ≈ current price" |
| `WAIT_FOR_TRIGGER` | WAITING — needs $X.XX, at $Y.YY (-Z%) | `secondary` | full `triggerDetail` |
| `PENDING_CATALYST` | PENDING — earnings May 28 | `secondary` | catalystDate localized |
| `ACTIVE_HOLD` | HOLDING | `secondary` | current P&L if available |
| `STALE_PAST_CATALYST` | STALE — catalyst was May 26 | `secondary`, muted | "no resolution recorded" |
| `SUPERSEDED` | SUPERSEDED | `secondary`, muted | "by newer thesis on $TICKER" — link to supersededBy |
| `DEAD` | (use existing status pill — DEAD redundant) | n/a | n/a |

The actionability badge gives at-a-glance "can I act on this now or not" without reading any other field. It's the primary scan target on the sheet header.

### `variantView` callout block

Render as a tier-1 always-visible block in the sheet body, AFTER the status pills and BEFORE the price targets gauge. Card with a left border + "Variant View" label + the sentence. This is the writer's stated edge; it should be the first content the user reads after seeing the conviction tier.

If `variantView` is null (MEDIUM/LOW theses or backfill rows), the block doesn't render.

### `ThesisCard` (carousel/list)

Add a conviction tier label AND an actionability state label. The actionability label is the headline — "READY TO BUY" or "WAITING $5.20 below trigger" — because that's what makes the card scannable in a list view.

### Read-theses table row

Add two columns: conviction + actionability. Default sort:
1. `actionability` (ENTER_NOW → ACTIVE_HOLD → PENDING_CATALYST → WAIT_FOR_TRIGGER → others)
2. `conviction` (STRONG → HIGH → MEDIUM → LOW)
3. `scoring.composite` (descending)

That sort answers the user's tonight's-test question directly: top of the list = "what should we be acting on, in priority order."

### What does NOT change in the UI

- `scoring` composite gauges stay (analytical "why" behind the tier)
- Activity timeline stays
- Price targets gauge stays — though it now sits in the context of an explicit actionability badge above
- Analyst consensus widget stays
- Research synthesis accordion stays

Conviction badge, actionability badge, and variantView block are additive, not replacement.

---

## 9. Migration

### Schema migration

```sql
ALTER TABLE "Thesis" ADD COLUMN "conviction" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "convictionRationale" TEXT;
ALTER TABLE "Thesis" ADD COLUMN "variantView" TEXT;
```

No NOT NULL constraints at the DB level — Layer-1 gates enforce them for directional writes after this ships. PASS / PENDING / pre-V2 rows stay null.

### Backfill for existing rows

Derive a default `conviction` from composite for ~50 production rows:

- composite ≥ 8 → `HIGH` (not STRONG — STRONG requires explicit writer judgment, no auto-derive)
- composite 6–7 → `MEDIUM`
- composite < 6 → `LOW`
- direction=PASS → leave null
- direction=PENDING → leave null
- No composite → leave null

`variantView` stays null on backfill (no honest auto-derive).
`convictionRationale` filled with `"backfilled from composite on YYYY-MM-DD"` for transparency.

First writer refresh after this ships overwrites the backfilled value.

---

## 10. Prompt diffs (concrete)

### `lib/agent/run-thesis-writer.ts` (`buildThesisWriterSystemPrompt`)

Insert a new step 3.5 between step 3 (decision) and step 4 (persist):

```diff
+ 3.5. Set the CONVICTION fields (REQUIRED on every directional thesis).
+
+      `conviction` — pick ONE of:
+        STRONG  — top-tier conviction. Reserved for your best 2-3 calls
+                  per cycle. Use when composite ≥ 8, R/R ≥ 3:1, the
+                  variant view is clear, and you would buy at market
+                  today if it were your own money.
+        HIGH    — solid conviction. Use when composite ≥ 7, R/R ≥ 2.5:1,
+                  and you have a defensible variant view. Default for
+                  clean dated-catalyst trades and breakouts with volume
+                  confirm.
+        MEDIUM  — normal conviction. Composite 6–7 or ≥ 7 with one weak
+                  dimension. The honest middle. Most theses are MEDIUM.
+        LOW     — weak conviction. "Eh." Composite 4–6 or higher with
+                  material reservations.
+
+      `convictionRationale` — REQUIRED. One sentence (≤200 chars)
+      explaining why this tier. Examples:
+        STRONG: "Composite 8/10, R/R 3:1, June 3 catalyst 8 days out,
+                 hyperscaler backlog signals clean guide-raise."
+        HIGH:   "Composite 7/10, post-print PEAD setup, first day of
+                 drift, no analyst PT updates yet — R/R 2.6:1."
+        MEDIUM: "Decent technical breakout but weak peer rank (-33% YTD
+                 vs +20% peers); wait for confirmed beat."
+        LOW:    "Late-stage chase, RSI 73, volume below threshold."
+
+      `variantView` — REQUIRED for STRONG and HIGH; OPTIONAL for MEDIUM
+      and LOW. One sentence (≤300 chars) stating "consensus expects X,
+      I think Y, here's the falsifiable reason." Every buy-side pitch
+      framework requires this for high-conviction calls — without it,
+      your STRONG/HIGH call is consensus-rehash with no edge.
+      If you can't articulate a variant view, your tier is MEDIUM at
+      best — don't claim STRONG/HIGH without one.
+
+      `targetSizePct` — REQUIRED on every directional thesis (was
+      optional pre-V2). % of portfolio at full position. Pair with tier:
+        STRONG → 4-6%
+        HIGH   → 3-5%
+        MEDIUM → 2-3%
+        LOW    → 1-2% (if traded at all)
+
+      EXPRESSING "BUY NOW" (no separate field for this):
+      If you want the daily run to trade immediately at market without
+      waiting for an entry trigger:
+        1. Set entry_price = current price.
+        2. Set NO ENTER trigger (or set ENTER to PRICE_ABOVE(current-
+           0.01) which fires immediately on next evaluation).
+        3. Set conviction = STRONG (and the variantView that justifies it).
+      The combination IS the "buy now" signal. Don't set a waiting
+      trigger and then expect the agent to skip it.
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
    "Separate from `direction` (bull/bear/no-view)."
  ),
convictionRationale: z
  .string()
  .max(200)
  .optional()
  .describe(
    "One sentence (≤200 chars) explaining the conviction tier. " +
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
target_size_pct: z
  .number().min(0).max(100)
  .optional()  // → REQUIRED in the Layer-1 gate for directional theses
  .describe(/* existing */),
```

Layer-1 execute() additions:

```ts
const isDirectional = args.direction === "LONG" || args.direction === "SHORT";

if (isDirectional && !args.conviction) {
  return reject("conviction tier required for directional theses (STRONG/HIGH/MEDIUM/LOW)");
}

if (args.conviction && !args.convictionRationale) {
  return reject("convictionRationale required whenever conviction is set");
}

if ((args.conviction === "STRONG" || args.conviction === "HIGH") && !args.variantView) {
  return reject(
    `${args.conviction} conviction requires variantView — what does consensus have wrong? ` +
    "If you can't articulate a variant view, downgrade to MEDIUM."
  );
}

if (isDirectional && args.target_size_pct == null) {
  return reject("target_size_pct required on directional theses (% of portfolio at full position)");
}
```

### `lib/agent/system-prompt.ts` (`buildDailyRunSystemPromptV2`)

Add the action-discipline block (actionability-first, conviction-modulates) per §7 above.

### Tactical-run prompt

Parallel paragraph reading conviction + variantView on the single triggered thesis.

---

## 11. Counterpoints from the research

**Counterpoint 1: Sequoia / a16z treat conviction as binary.** Pat Grady (Sequoia): "Presence of conviction is what matters." VC IC memo guides explicitly reject graduated framing as "defensive politics."

→ **Reply:** VCs commit to 5-10 investments per fund out of thousands of pitches. Binary makes sense at that ratio. Hindsight's writer covers 20-30+ names per analyst per cycle, structurally closer to a sell-side analyst initiating coverage across a sector — and sell-side IS graduated. The 4-tier `conviction` follows the structural cousin.

**Counterpoint 2: "Sizing based on conviction" is undisciplined.** Position-sizing schools warn that "your 'best' ideas often fail" and fixed % per trade is the disciplined path.

→ **Reply:** Hindsight already applies discipline at execution — account-level caps (`maxPositionSize`, `realMaxPosition`, `maxOpenPositions`) bound what the daily-run can place. The writer's `targetSizePct` is INTENT, not authority. Worst case: writer says STRONG+6%, account cap is 3%, daily-run trades 3%. The intent expression doesn't break discipline; it gives the daily-run a structured input instead of forcing it to guess.

**Counterpoint 3: Goldman has TWO axes (rating + Conviction List).** Goldman: Buy/Neutral/Sell PLUS a separately curated Conviction List. Does this design preserve that?

→ **Reply:** Yes. `direction` (LONG/SHORT/PASS) is the rating axis. `conviction` (STRONG/HIGH/MEDIUM/LOW) is the conviction modifier. STRONG = Conviction List equivalent. HIGH = ordinary Buy. The two axes are kept separate; they're just both already-existing structural fields (one new, one not). v1 of this doc collapsed direction and conviction into a single tier (URGENT_BUY) which was the actual mistake.

**Counterpoint 4: Cross-firm rating taxonomies are non-uniform.** "Outperform" at one firm ≠ "Buy" at another ≠ "Overweight" at a third.

→ **Reply:** Hindsight has ONE canonical taxonomy. We control the writer's prompt. Anti-pattern would be letting each analyst define their own scheme — not doing that.

---

## 12. Effort estimate

Total: **5 days**, splittable into two PRs along the writer-side / reader-side seam.

| Day | Work | Ships in |
|---|---|---|
| 1 | Schema migration (3 nullable columns: `conviction`, `convictionRationale`, `variantView`) + record_thesis/update_thesis Zod schema + Layer-1 field-presence gates (required-when-directional, variantView-on-STRONG/HIGH, targetSizePct-required) + Layer-1 consistency gates from §3.5 (Gate A composite≥7 for STRONG, Gate B entryQuality≥2 for STRONG/HIGH) + writer prompt with tier rubric + variantView guidance + "buy now" trigger guidance + backfill SQL for ~50 existing rows | PR 1 |
| 2 | UI: conviction badge in ThesisSheet header + variantView callout block + ThesisCard tier label + read-theses table conviction column | PR 1 |
| 3 | Tests for PR 1 (Layer-1 rejection paths for all 5 gate conditions, writer-dispatch on 3 test tickers, UI snapshots for all 4 tiers) | PR 1 |
| 4 | `get_theses` resolver: extract trigger predicate evaluator into `lib/agent/triggers/evaluate.ts` (shared with `trigger-evaluator.ts` cron) + Finnhub batched quote fetcher + supersession SQL + actionability classifier + `resolved` envelope on response | PR 2 |
| 5 | Slim daily-run prompt (actionability-first, conviction-modulates) + parallel tactical-run prompt update + actionability state pill in UI (ThesisSheet, ThesisCard, read-theses table sort) + tests for resolver (one fixture per actionability state — ENTER_NOW, WAIT_FOR_TRIGGER, PENDING_CATALYST, ACTIVE_HOLD, STALE_PAST_CATALYST, SUPERSEDED, DEAD) | PR 2 |

**Why split into two PRs.** PR 1 (writer-side, days 1-3) is shippable end-to-end — writer starts emitting conviction tiers, UI shows them, the daily-run keeps using the existing prompt and ignores the new fields until PR 2. After PR 1 lands, you get a few days of writer data emitting tiers in production before PR 2 turns on the reader-side machinery. This is the safest cadence given the recurring-bug warnings on `lib/agent/system-prompt.ts` in CLAUDE.md — the daily-run prompt change should not ship alongside the schema/writer changes.

**Could ship as one PR** if the urgency demands it; the two halves don't actually depend on each other for correctness, only for observable behavior (PR 2's prompt change references conviction tiers that PR 1 introduces, and treats null conviction as MEDIUM in the legacy-row path).

No new tools (in the agent-tool sense). No new triggers. No compound predicates. No role-boundary changes. The resolver lives inside the existing `get_theses` tool, not as a new one.

---

## 13. What's explicitly NOT changing

- **Role boundaries** stay. Writer still doesn't trade. Daily run still owns status decisions.
- **Trigger primitives** stay. No new predicate kinds. No compound AND. Multi-condition "volume AND price" still expressed via primary predicate + secondary condition in `key_assumptions` + agent confirms with `get_stock_data` at ENTER fire.
- **The 4-dim `scoring` composite** stays. Analytical defense for the conviction tier — and the input to the §3.5 Layer-1 consistency gates.
- **`direction=PASS`** stays. PASS = "researched, walked away, archive." Covers the "No way" utterance.
- **PROMOTION refresh flow** stays — writer now emits `conviction` + `variantView` instead of a separate `recommendedAction`. P1-6 absorbed.
- **Stored `Thesis` schema beyond the 3 new fields** is unchanged. The resolver is read-time only — no new columns, no new indexes, no migration churn beyond the conviction additions.
- **`needsAction` logic** stays.
- **`triggers` JSON shape** stays. Same predicates, same evaluator. The resolver only ADDS a synchronous wrapper that evaluates against the live quote; the cron evaluator and the resolver share one source of truth via `lib/agent/triggers/evaluate.ts`.
- **`targetPrice` overload** (P1-3) NOT fixed here. Bull/base/bear scenario price targets are the next thing worth tackling after this lands.
- **Activity log** unchanged.

**WHAT IS CHANGING that the original v3 doc's "NOT changing" list said wasn't:**
- **`get_theses` response shape** — v3 said this stayed the same. v4 adds the `resolved` envelope to every row. The stored fields are unchanged; the response gains a sibling block.

---

## 14. Open questions for principal

1. **Tier names.** `STRONG / HIGH / MEDIUM / LOW`. Alternatives:
   - `CONVICTION / BUY / HOLD / WEAK` — matches Goldman/sell-side directly
   - `TOP_PICK / BUY / NORMAL / WEAK` — more action-anchored
   Current names are explicit and consistent on the strength axis. Your call.

2. **Conviction-composite consistency check.** ~~Should the writer be REJECTED at Layer-1 for emitting `conviction=STRONG` with `composite=4`?~~ **ANSWERED IN v4 (§3.5): strict gate, not soft warning.** Two gates landed: Gate A rejects STRONG when composite < 7; Gate B rejects STRONG/HIGH when entryQuality < 2. Reasoning: without enforcement, the tier is "another field the writer can be inconsistent in" — which is the exact failure mode v4 is trying to fix.

3. **`variantView` length cap.** Proposed 300 chars. Too tight? Sell-side variant views are typically 2-3 sentences (~300-500 chars) — 300 is a tight discipline forcing function.

4. **`variantView` rendering on STRONG/HIGH where the writer left it null** (legacy / pre-V2 / backfilled rows). UI options:
   - Hide the variantView block entirely (current proposal)
   - Render a "variantView pending — next refresh will populate" placeholder
   First is cleaner; second flags the gap.

5. **Backfill aggressiveness.** Derived backfill from composite gives ~50 rows a default tier (no STRONG, no variantView). Alternative: leave all null and let the next refresh populate organically. Suggested: derive tier + flag with `convictionRationale = "backfilled from composite on YYYY-MM-DD"` so the UI can distinguish and the next refresh overwrites cleanly.

6. **Should `direction=PASS` carry a conviction value?** No — PASS skips conviction (PASS is its own equivalent of "no view"). Sequoia / a16z memo language for declines is "Pass" with a one-line rationale, no tier. Hindsight follows suit. Documented; no change needed.

7. **UI placement of `variantView`.** Proposed as a tier-1 always-visible callout block right after status pills, before the price targets gauge. Alternative: fold into the bull case section as a labeled subsection. Tier-1 callout makes the variant view the visual headline; folding into bull case keeps existing layout.

8. **STRONG-budget gate (referenced from §3.5).** Should Layer-1 reject the writer's Nth `STRONG` emission within a single run/cycle? §4 rubric says "reserved for top 2-3 calls per analyst per cycle" but that's teaching, not enforcement. Without a budget gate, a poorly-calibrated writer model could mark every thesis STRONG. With one, it requires per-run state in the gate (counting STRONG emissions across the run's record_thesis + update_thesis calls). Suggested default: cap at 3 STRONG emissions per analyst per cycle; reject the 4th with "you've already marked 3 STRONG calls this cycle; if this one is genuinely top-tier, downgrade an earlier one to HIGH first."

9. **Quote staleness budget for the resolver (referenced from §6).** When `get_theses` is called twice in the same agent run (e.g., once at Phase 0 and once at Stage 4), should the second call re-fetch live quotes or reuse a cache? Options:
   - **Live every call** — always fresh, 2x Finnhub call rate per run
   - **60s in-memory cache** (proposed default) — accepts up to 60s staleness, halves the call rate for typical runs
   - **Per-run snapshot** — fetch once at first `get_theses`, freeze for the run; cheapest but trigger state can go stale across a 5-10 min run
   60s is the proposed middle path. If we see runs where a critical trigger fires within the 60s window and the agent acts on a stale read, drop to live-every-call.

10. **Should the actionability classifier surface a `nearMiss` flag?** A WAIT_FOR_TRIGGER row where the current price is within 1-2% of the ENTER predicate is qualitatively different from one that's 20% away. The §7 prompt asks the agent to "note in run summary if conviction is STRONG/HIGH and triggerDetail shows price within ~2% of trigger" — that's enforced in prose, not structure. Could add `resolved.nearMiss: boolean` (computed: trigger price within 2% of current). Adds noise to the envelope but makes the daily-run's "watch this one" logic structural. Defer unless the §7 prose proves insufficient in practice.

---

## Appendix A — Conviction vocabulary across sources

Full vocabulary table from the research, mapping 11 source contexts onto the 4 conviction tiers + direction=PASS.

| Source / context | Their vocabulary | Action implication | Hindsight mapping |
|---|---|---|---|
| **Goldman Sachs** | Buy / Neutral / Sell + separately a curated **Conviction List** (subset of Buys with "best alpha generation opportunities"). Conviction List membership is NOT a rating change — it's a separate axis. | Conviction List = highest-confidence Buys. "Bigger position, act sooner, narrower exit tolerance." | direction (LONG/SHORT/PASS) maps to Buy/Sell/declined coverage. Conviction List maps to `conviction=STRONG`. The two-axis pattern directly inspires this design. |
| **Morgan Stanley** | Overweight / Equal-weight / Underweight / Not-Rated. 12-18 month horizon. Framing is RELATIVE TO BENCHMARK. | OW = outperform; EW = market-match; UW = underperform. | OW → HIGH/STRONG; EW → MEDIUM; UW → LOW or direction=PASS. |
| **JPMorgan** | Overweight / Neutral / Underweight, 6-12 month horizon. | OW = "outperform sector or broader market." | Same as MS. |
| **Buy-side hedge fund pitch** | Recommendation + upside $/% + downside $/% + thesis + **what the Street is missing (variant view)** + catalysts + scenarios. R/R bands: 3:1-5:1 = strongest conviction; 2:1-3:1 = core; 1:1-2:1 = usually pass. "Passion + variant view + unit economics" = HIGH markers. "Consensus ideas + low conviction" = major don'ts. | PMs reject pitches without a variant view. Variant view IS the conviction differentiator. | R/R ≥ 3:1 + clear variant view → STRONG/HIGH; R/R 2:1-3:1 + standard thesis → MEDIUM; sub-2:1 → LOW or PASS. **`variantView` field directly traces to this requirement.** |
| **Sequoia IC memo (YouTube, 2005)** | Sections: Intro / Deal / Competition / Hiring plan / Key risks / **Recommendation** (at the END). Conviction is NARRATIVE, no scoring. | "Presence of conviction is what matters" (binary). Risks paired with contextual analysis, no severity ratings. | Counterpoint to graduated tiers — see §11. |
| **VC IC memo (general)** | Sections: Exec Summary (Deal / Thesis / **Recommendation**) → Market → Team → Product → Business model → **Risks & Mitigants**. "Recommend a tranched $X investment." | Explicitly rejects "Recommend / Pass / Pass for now" graduated framing as "defensive politics." | Counterpoint addressed in §11. |
| **Traderstewie (fintwit, momentum/swing)** | "Holy Grail setup," "gorgeous consolidation," "calm before the storm," "explode this week," "Targets $130." | Tier verdict + clean target + implicit time horizon. | "Holy Grail / explode this week / catalyst firing" → STRONG. "Gorgeous consolidation, any day now" → HIGH. |
| **Prof (long-term holder)** | "$RDDT sleeping giant. I own it. I will hold." | Tier + commitment + implicit COMPOUNDER horizon. | "Sleeping giant + I will hold" → STRONG on COMPOUNDER. |
| **WSB / r/wallstreetbets** | YOLO, Diamond Hands, Paper Hands, Tendies, "loading the boat," "back up the truck." | "Back up the truck" / YOLO = highest conviction concentrated bet. Diamond Hands = wide hold tolerance (HIGH tier semantic on ACTIVE). | "Back up the truck" → STRONG. Diamond Hands on ACTIVE = STRONG/HIGH hold tolerance. |
| **Position-sizing schools** | Starter (10%) → scale-in (20/10/20) → full size. Two schools: (a) size based on conviction; (b) fixed % per trade regardless of conviction. | Active debate. | Hindsight resolves: writer expresses intent via `targetSizePct`, daily-run applies discipline at execution. |
| **Stock aggregators (TipRanks, etc.)** | 5-tier (Strong Buy / Buy / Hold / Sell / Strong Sell) or 3-tier (Buy / Hold / Sell). | Consumer-facing simplification. | 4-tier `conviction` (STRONG/HIGH/MEDIUM/LOW) is a subset with the negative side compressed into `direction=PASS`. |

---

## Appendix B — The six conviction dimensions

Re-reading all sources, six dimensions consistently show up across analyst output:

| # | Dimension | Question | Hindsight field today | Coverage |
|---|---|---|---|---|
| 1 | **Directional view** | Bullish / bearish / no view | `direction` | ✓ Already structured |
| 2 | **Setup quality / confluence** | How many signals align? | `scoring` (4-dim composite) | ✓ Already structured |
| 3 | **Time horizon** | When will the view play out? | `horizon` + `catalystDate` + `maxHoldDays` | ✓ Already structured |
| 4 | **Position sizing intent** | How big? | `targetSizePct` | ⚠ Field exists, rarely populated → promote to required |
| 5 | **Overall conviction strength** | How strongly should the daily-run act? | None | ✗ Missing → new `conviction` (+ `convictionRationale`) |
| 6 | **Variant view** | What does consensus have wrong? | None | ✗ Missing → new `variantView` |

Time urgency is NOT a separate dimension — it's a derived view from triggers (when conditions are met) + conviction tier (how aggressively to act when met). v2 of this design added an `actNow` boolean for time urgency; v3 dropped it.

---

## 15. See also

### Hindsight internal
- [`THESIS_ARCHITECTURE.md`](../../THESIS_ARCHITECTURE.md) §0 (the five roles) and §8 (Fields — the three new fields join the operational-state group)
- [`GAPS.md`](../../GAPS.md) **P1-6** (writer urgency signal on promotion refreshes — absorbed)
- [`GAPS.md`](../../GAPS.md) **P1-3** (targetPrice overload — adjacent, not fixed here)
- [`PRINCIPLES.md`](../../PRINCIPLES.md) — three-layer principle. Conviction lives at Layer-2 (structured tool-result fields the agent reads) + Layer-3 (daily-run prompt teaches per-tier judgment). Layer-1 gate enforces required fields; doesn't second-guess WHICH tier.
- [`MORNING_RUN_V2_DESIGN.md`](./MORNING_RUN_V2_DESIGN.md) — the V2 daily-run prompt this builds on.

### Real-world conviction-vocabulary sources

Sell-side rating taxonomies:
- [Morgan Stanley General Research Disclosures](https://www.morganstanley.com/eqr/disclosures/webapp/generalresearch) — OW / EW / UW definitions
- [Benzinga: Goldman Sachs Updates Its Conviction List](https://www.benzinga.com/analyst-ratings/analyst-color/17/07/9778951/goldman-sachs-updates-its-conviction-list-what-that-mean) — Conviction List as separate axis from Buy/Neutral/Sell
- [stockanalysis.com — What Do Stock Analyst Ratings Mean?](https://stockanalysis.com/article/analyst-ratings-explained/)
- [TipRanks Analyst Consensus](https://www.tipranks.com/glossary/a/analyst-consensus)

Buy-side / hedge fund pitch frameworks:
- [Mergers & Inquisitions — Stock Pitch Guide](https://mergersandinquisitions.com/stock-pitch-guide/) — pitch components including variant view
- [Finance Interview Prep — Hedge Fund Stock Pitch Framework](https://financeinterviewprep.com/blog/hedge-fund-stock-pitch-framework) — R/R conviction bands
- [Street of Walls — Stock Pitch Do's and Don'ts](https://www.streetofwalls.com/articles/hedge-fund/recruiting-interviewing/stock-pitch-the-dos-and-donts/) — variant view requirement

VC IC memo structure (binary-conviction counterpoint):
- [Alex Jarvis — The confidential YouTube Investment Memo by Sequoia](https://www.alexanderjarvis.com/the-confidential-youtube-investment-memo-by-sequoia-you-were-never-meant-to-see/)
- [The VC Factory — IC Memos guide](https://thevcfactory.com/investment-committee-memos/) — Pat Grady's "Presence of conviction is what matters"

Retail / fintwit anchors (provided by principal):
- @Traderstewie ($INTC "Holy Grail setup, explode this week, Targets $130"; $AEHR "Gorgeous consolidation, Targets $120-$125")
- @TheProfInvestor ($RDDT "sleeping giant, I will hold")
- Principal's confluence explainer

WSB / retail vocabulary:
- [Infinity Investing — WSB Slang guide](https://infinityinvesting.com/wallstreetbets-slang-meaning/)
- [SuperMoney — The Back Up The Truck Strategy](https://www.supermoney.com/encyclopedia/backing-up-the-truck)

Position sizing schools:
- [TraderLion — Position Sizing Strategies](https://traderlion.com/risk-management/position-sizing-strategies/) — starter/scale-in/full + conviction-vs-fixed-% debate
