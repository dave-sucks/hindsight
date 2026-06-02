# ANALYST_LINEUP — Reference Doc

**Status (last verified 2026-06-02):**

| Analyst | Before | After | Outcome |
|---|---|---|---|
| Earnings Drift Trader | LIVE, BOTH dir, $3k/$1k cap, IT-only | **PEAD Specialist** (LIVE, LONG, $3k/$6k cap, 7 sectors) | ✅ Shipped via SQL 2026-05-27. Currently `enabled: false` (paused by principal). 2 open LIVE positions (TSM, MRVL) untouched. |
| Secular Theme Architect | PAPER, $2.5k/$1k cap, AI-only themes | **Secular Compounder** (PAPER, LONG, $15k/$15k cap, 7 themes spanning AI/GLP-1/energy/defense) | ✅ Shipped via SQL 2026-05-27. Watchlist still IT-heavy from pre-rewrite history — refresh via Discovery Strategist (see [`DISCOVERY_STRATEGIST.md`](./DISCOVERY_STRATEGIST.md)). |
| Tech Momentum Trader | PAPER, Tech-only fence, $2.5k cap | **Momentum Breakout** (PAPER, LONG, sector-agnostic, $5B+ floor, $5k cap) | ✅ Shipped via SQL 2026-05-27. Old paper P&L was −$1,692; new config needs 2-4 weeks to re-measure before promotion. |
| Catalyst Event Raider | PAPER, BOTH dir, 13 industries, $2k cap | **Catalyst Event PM** (PAPER, LONG, 6 industries, $8k cap) | ✅ Shipped via SQL 2026-05-27. 5 fresh watching theses minted 5/31 (RBRK, AVGO, VEEV, ADBE, PANW). |
| EV Catalyst Event Trader | PAPER, 10 open positions, EV-only | **disabled** (`enabled: false`) | ✅ Disabled 2026-05-27. 0 open positions at disable. Themes folded into Compounder. Row preserved for forensics. |

**Scope (historical):** restructured the live analyst roster from "5 vaguely-themed analysts" to "4 edge-defined PMs sized for big-conviction outcomes." Touched `AgentConfig` rows only. No code changes.

**Anchor:** principal's stated goal — "big gains, conviction holds like the $MU breakout, ideally long-term." All sizing math is for a $100k paper book, LONG-only across the board.

**This doc now serves as:** the reference for *why* the lineup looks like it does (4 archetype-based PMs, not 5+ theme-locked analysts), what was changed in the 2026-05-27 migration, and the sizing math. Live config state is in the `AgentConfig` table — when fields drift from this doc, the table wins.

---

## TL;DR

Today's 5 analysts are organized by **theme** (EV, Earnings) or **sector** (Tech Momentum) rather than by **edge**. A real fund doesn't have an "EV PM" — they have a *secular-themes PM* who happens to cover EV alongside AI, GLP-1, defense, etc. Theme-locked analysts starve when their theme is cold and over-trade when it's hot. The fix is to re-cast each analyst around its archetype + horizon + position-sizing band.

**The single biggest issue:** `Secular Theme Architect` (the analyst that's supposed to catch the next MU) is sized to `maxPositionSize: $2,500` and `realMaxPosition: $1,000` on a $100k book — 2.5% per position in paper, 1% if promoted live. That defeats the entire purpose of a conviction seat. **One config change** (raise both to $15,000) is the highest-leverage edit on the platform.

**Target lineup:** 4 analysts, each with a distinct edge, total soft-allocation ~161% of book (intentional — conviction wins the slot, not pre-allocated sleeves):

```
Secular Compounder ………… 4 × $15k = $60k    (THE MU seat)
PEAD Specialist (LIVE) ………… 6 × $6k  = $36k    (kept narrow — already proven)
Catalyst Event PM ……………… 5 × $8k  = $40k    (biotech FDA + M&A + binary events)
Momentum Breakout …………… 5 × $5k  = $25k    (talent scout, fast cadence)
                                  ──────
                                  161%
```

**Drop:** `EV Catalyst Event Trader`. EV is a theme inside the Compounder, not a whole analyst.

---

## Why this matters (the framing)

The principal's confusion was framed as "1-2 analysts × 50% per position vs 50 analysts × $1k" — a false binary. The real answer is **3-5 analysts × 5-15% per position**, with **one concentrated seat** for true conviction (the Compounder) and **smaller seats** for talent-scouting / catalyst capture.

Pattern after Druckenmiller / early Buffett / Loeb:
- Top 3-5 conviction names = ~60-75% of book
- Smaller "venture" positions = remaining 25-40%
- Cash buffer naturally results from soft over-allocation when not every analyst is fully loaded

The system already has the right primitive: 10 strategy archetypes in [`lib/agent/knowledge/strategy-archetypes.ts`](../../lib/agent/knowledge/strategy-archetypes.ts) and 4 horizons (CATALYST / TRADE / TARGET / COMPOUNDER). The current configs use these inconsistently. The fix is alignment, not new infrastructure.

---

## Current state (as of 2026-05-27)

Pulled from the live `AgentConfig` table + 30-day activity rollup:

| Analyst | Env | Open Pos | Watching | Closed | Runs/30d | Verdict |
|---|---|---|---|---|---|---|
| **Earnings Drift Trader** | **LIVE** | 2 | 6 | 17 | 84 | ✅ Keep. PEAD prompt is genuinely good. Narrow edge, real history. Don't disturb. |
| **Catalyst Event Raider** | PAPER | 3 | 2 | 13 | 88 | ✅ Closest to "Catalyst PM" target. 167 terminal theses = real discipline. Tighten industries. |
| **Secular Theme Architect** | PAPER | 2 | 12 | 10 | 69 | 🟠 Strategy correct; **sizing fatally wrong**. 12 watching theses = finding ideas but can barely act. |
| **Tech Momentum Trader** | PAPER | 0 | 9 | 14 | 119 | 🟠 Running 4×/day with 0 fills. Either over-cautious or Tech-only fence is structurally rejecting. |
| **EV Catalyst Event Trader** | PAPER | 0 | 2 | 8 | 73 | ❌ Dead capital. 8 closes in 8+ weeks. Theme-locked. Delete. |

### What each one is actually configured as

#### 1. Earnings Drift Trader (LIVE)
```
direction: BOTH        holdDurations: [SWING, POSITION]
maxPositionSize: $3000 maxOpenPositions: 6     minConfidence: 70
realMaxPosition: $1000  ← live cap, currently throttling everything
sectors: [Information Technology]
industries: [Semiconductors, Technology Hardware]
themes: [AI_CAPEX, EARNINGS_BEAT]
feeds: [EARNINGS_CALENDAR]
```
**Strengths:** crisp PEAD-only prompt ("the edge is the 30-60 day drift after a clean beat-and-raise, not the gap day reaction"). Filters out one-time items, sub-1.5× volume, post-gap chases. Genuinely well-defined edge.
**Issues:** `realMaxPosition: $1000` makes it 1% per position when live. Sectors fence to IT only — but PEAD edge works across all sectors. BOTH direction conflicts with principal's LONG-only choice.

#### 2. Catalyst Event Raider (PAPER)
```
direction: BOTH        holdDurations: [SWING, POSITION]
maxPositionSize: $2000 maxOpenPositions: 4     minConfidence: 65
sectors: [Health Care, Information Technology]
industries: [13 industries — Biotech, Pharma, Health Care Equipment/Providers/Services/Tech,
             Life Sciences, Semis, Semi Equipment, Software, IT Services, Comm Equipment,
             Tech Hardware, Electronic Equipment]
themes: []     feeds: [EARNINGS_CALENDAR]
```
**Strengths:** prompt is well-articulated (FDA PDUFA, M&A, trial readouts). 167 terminal theses + 13 closed positions = real discipline.
**Issues:** 13 industries is too broad — dilutes the edge. Should narrow to biotech-heavy + select tech catalyst names.

#### 3. Secular Theme Architect (PAPER) — the misfire
```
direction: LONG        holdDurations: [POSITION]
maxPositionSize: $2500 maxOpenPositions: 5     minConfidence: 75
realMaxPosition: $1000  ← would cripple it if promoted
sectors: [Information Technology]
industries: [Semiconductors, IT Services, Software]
themes: [AI_CAPEX, AI_INFRA, AI_DEMAND]   ← all AI, no other secular themes
feeds: []
```
**Strengths:** philosophy is right — "scale in over 3-6 months, exit on thesis invalidation only." This IS the Compounder pattern. 12 watching theses = the strategy is sourcing well.
**Issues:**
- **Sizing is fatally wrong.** $2,500 per position on a $100k book is 2.5% — not "concentration."
- **`realMaxPosition: $1000` (1%)** if promoted live. The conviction seat literally cannot hold a conviction-sized position.
- **Themes are AI-only.** Real secular-theme PMs spread across AI + GLP-1 + energy transition + defense + onshoring + demographics. AI-only = single-theme bet dressed up as "secular."
- **Industries are IT-only.** Compounder names live in Biotech (LLY, NOVO), Aerospace (LMT, GD), Utilities (VST, NRG), too.

#### 4. Tech Momentum Trader (PAPER) — running but not entering
```
direction: LONG        holdDurations: [SWING]
maxPositionSize: $2500 maxOpenPositions: 5     minConfidence: 70
sectors: [Information Technology]
industries: [Semiconductors, Software, Tech Hardware]
feeds: [MARKET_MOVERS_GAINERS, MARKET_MOVERS_ACTIVES]
```
**Diagnostic:** 119 runs in 30 days (3-4 per market day) with **0 positions opened**. The strategy is searching constantly and finding nothing actionable. Most likely cause: Tech-only fence + LONG-only + minConfidence 70 = the intersection of "tech is in an extended uptrend everywhere" + "every momentum signal looks late" = nothing passes the bar.
**Fix:** drop the sector fence (momentum strategy doesn't care about sectors — it cares about relative strength). Raise confidence floor to 75 to compensate for the broader universe.

#### 5. EV Catalyst Event Trader (PAPER) — delete candidate
```
direction: BOTH        holdDurations: [SWING]
maxPositionSize: $2000 maxOpenPositions: 10    minConfidence: 70
sectors: [IT, Consumer Discretionary, Energy]
industries: [Automobiles, Semiconductors]
themes: [EV_INFRASTRUCTURE, EV_ADOPTION, BATTERY_TECH]
feeds: [MARKET_MOVERS_LOSERS, MARKET_MOVERS_GAINERS]
```
**Diagnostic:** 0 open, 2 watching, 8 total closes in 8+ weeks. The EV theme has been dead capital since early 2025. `maxOpenPositions: 10` for 2 industries is absurd — that's the configuration of an indiscriminate buyer in a graveyard.
**Action:** delete. Themes fold into the Compounder. Auto industry exposure picked up by Catalyst PM if anything genuinely catalytic happens.

---

## Target state — 4 analysts

### 1. Secular Compounder (was: Secular Theme Architect)

**Role:** the principal's biggest sleeve. Catches multi-month / multi-year compounders (MU, NVDA, LLY pattern). Holds through volatility. Never trades — only adds on weakness when thesis intact.

**Archetype:** `THEMATIC_SECULAR`
**Horizon:** `COMPOUNDER` (primary) + `TARGET` (secondary for shorter conviction names)
**Direction:** LONG
**holdDurations:** `["POSITION"]`

**Config:**
```diff
- maxPositionSize: 2500
+ maxPositionSize: 15000        ← 6× sizing increase
- realMaxPosition: 1000
+ realMaxPosition: 15000        ← match paper sizing, no live throttle
- maxOpenPositions: 5
+ maxOpenPositions: 4           ← tighter concentration
- minConfidence: 75
+ minConfidence: 78             ← higher bar for bigger bets
- themes: [AI_CAPEX, AI_INFRA, AI_DEMAND]
+ themes: [
+   "AI infrastructure",
+   "Datacenter buildout",
+   "GLP-1 / obesity drugs",
+   "Energy transition",
+   "Defense reindustrialization",
+   "Onshoring",
+   "Demographic tailwinds"
+ ]
- industries: [Semiconductors, IT Services, Software]
+ industries: [
+   "Semiconductors",
+   "Software—Infrastructure",
+   "Biotechnology",
+   "Pharmaceuticals",
+   "Aerospace & Defense",
+   "Utilities—Regulated Electric",
+   "Electrical Equipment"
+ ]
- sectors: [Information Technology]
+ sectors: ["Information Technology", "Health Care", "Industrials", "Utilities"]
+ feeds: ["EARNINGS_CALENDAR"]    ← was empty
```

**analystPrompt (target):**
> I'm a secular-themes PM. I find businesses that will be structurally more valuable in 3-5 years and own them through volatility. I do NOT trade in and out. I add on weakness when the thesis is intact. I exit only when an invalidation condition trips — regulatory break, structural demand erosion, two consecutive guidance cuts, CFO departure. I tolerate -15% drawdowns on conviction names; I don't tolerate broken theses at any price. Position sizes are 10-15% of book per name. I run a concentrated book of 3-4 names at any time. If I can't articulate why this name compounds over 3+ years, I don't own it.

**Why these changes:**
- Position sizing is the single most impactful edit. $15k × 4 = $60k = 60% of book in the conviction seat. That's where MU-pattern returns come from.
- Theme expansion: the AI-only fence misses LLY (GLP-1), VST/GEV (grid + nuclear), LMT (defense reindustrialization), and any other secular play that isn't a chip.
- COMPOUNDER horizon is non-negotiable. Without it, the daily run's TARGET-cadence 30-day hygiene review will keep dragging long holds into churn.

**Seed watchlist (suggested):**
`NVDA, AVGO, ASML, MU, LLY, VST, GEV, PLTR, ANET, ORCL` — 10 names to research; the Compounder picks the 3-4 it wants to own at any time.

---

### 2. PEAD Specialist (was: Earnings Drift Trader — LIVE)

**Role:** post-earnings drift specialist. The narrowest, most discriminating analyst. The proven seat (only one in LIVE today). Treat with care — don't break what works.

**Archetype:** `EARNINGS_DRIFT`
**Horizon:** `TARGET` (for the 30-60d drift window)
**Direction:** LONG (was BOTH — flipped per principal's call)
**holdDurations:** `["SWING", "POSITION"]`

**Config:**
```diff
- direction: BOTH
+ direction: LONG               ← LONG-only across the board
- realMaxPosition: 1000
+ realMaxPosition: 6000         ← raise live cap to 6% per position
  maxPositionSize: 3000         ← keep paper at $3k (proven)
  maxOpenPositions: 6           ← unchanged
  minConfidence: 70             ← unchanged
- sectors: [Information Technology]
+ sectors: [
+   "Information Technology",
+   "Health Care",
+   "Consumer Discretionary",
+   "Industrials",
+   "Communication Services"
+ ]                              ← PEAD works across all sectors
  industries: [Semiconductors, Technology Hardware]
+ industries: [
+   ...keep current,
+   "Software", "IT Services",
+   "Biotechnology", "Pharmaceuticals",
+   "Aerospace & Defense",
+   "Specialty Retail"
+ ]
```

**analystPrompt:** keep current. It's genuinely good. Add a single sentence: "I trade LONG only — no shorting earnings misses. If the signal points down, I skip the name and look for another."

**Why these changes:**
- LONG-only direction matches principal's call.
- `realMaxPosition: $1000` was 1% — promotion to live was symbolic, not real. Raise to $6k (6% per position) so live PEAD trades actually move the needle.
- Sector broadening: PEAD edge is universal — earnings drift works in retail, pharma, industrials too. IT-only was a needless fence.
- **Do NOT touch the prompt.** It articulates the edge crisply. Don't break it.

---

### 3. Catalyst Event PM (was: Catalyst Event Raider)

**Role:** binary-event specialist — FDA decisions, M&A, court rulings, guidance changes. Sizes positions to expected variance. Exits at event resolution or 30 days after the catalyst date.

**Archetype:** `CATALYST_EVENT`
**Horizon:** `CATALYST`
**Direction:** LONG (was BOTH)
**holdDurations:** `["SWING", "POSITION"]`

**Config:**
```diff
- direction: BOTH
+ direction: LONG
- maxPositionSize: 2000
+ maxPositionSize: 8000         ← 4× sizing increase
- maxOpenPositions: 4
+ maxOpenPositions: 5
  minConfidence: 65             ← keep (catalyst trades have variance)
- industries: [13 industries]
+ industries: [
+   "Biotechnology",
+   "Pharmaceuticals",
+   "Health Care Equipment & Supplies",
+   "Life Sciences Tools & Services",
+   "Semiconductors",
+   "Software"
+ ]                              ← narrow from 13 to 6 — biotech-heavy + select tech catalyst plays
  sectors: [Health Care, Information Technology]
  feeds: [EARNINGS_CALENDAR]
```

**analystPrompt:** keep core content. Edit to remove BOTH-direction references; add the LONG-only constraint:
> I trade binary events long-only — FDA approvals, positive trial readouts, M&A targets, guidance raises, court rulings going my way. If the catalyst points DOWN, I document the bear thesis as a PASS and move on. I do not short binary events.

**Why these changes:**
- Industries reduced from 13 to 6 — concentration on the edge (biotech/health for FDA, select tech for guidance/M&A). Avoids the "drift into momentum-trading" failure mode where 13 industries means the analyst becomes a generalist by accident.
- Position sizing $2k → $8k (8% per position) — catalyst trades with strong setups deserve real allocation.
- LONG-only flip — matches the principal's choice across the board.

---

### 4. Momentum Breakout (was: Tech Momentum Trader)

**Role:** talent scout. Faster cadence, tighter stops, smaller bets. Finds the names that the slower analysts pick up later. Runs systematic relative-strength + volume breakouts.

**Archetype:** `MOMENTUM_BREAKOUT`
**Horizon:** `TRADE`
**Direction:** LONG (unchanged)
**holdDurations:** `["SWING"]`

**Config:**
```diff
- maxPositionSize: 2500
+ maxPositionSize: 5000         ← 2× sizing
  maxOpenPositions: 5           ← unchanged
- minConfidence: 70
+ minConfidence: 75             ← higher bar to compensate for broader universe
- sectors: [Information Technology]
+ sectors: []                   ← drop sector fence entirely (momentum is sector-agnostic)
- industries: [Semiconductors, Software, Technology Hardware]
+ industries: []                ← drop industry fence
+ marketCapMin: 5000000000      ← $5B+ only (no microcap whipsaw)
  feeds: [MARKET_MOVERS_GAINERS, MARKET_MOVERS_ACTIVES]
+ feeds: [MARKET_MOVERS_GAINERS, MARKET_MOVERS_ACTIVES, EARNINGS_CALENDAR]
  exclusionList: ["Low-float speculative stocks"]
```

**analystPrompt:** keep core. Add one new line about the universe broadening:
> I take momentum breakouts wherever the relative strength leads — I do not restrict to tech. I do require $5B+ market cap (no microcap whipsaws). Tight stops (-5% or 10-day EMA, whichever is tighter). Quick exits at target or volume-climactic tops. I do not average down.

**Why these changes:**
- The 119-runs-with-0-fills problem is a universe problem. Tech-only + LONG-only + 70% confidence in a market where every tech breakout is "obvious" = nothing passes the discrimination test. Broadening to all sectors with a market-cap floor opens the search space.
- Raise minConfidence from 70 to 75 to compensate. Broader universe + higher bar = better signal-to-noise.
- $2.5k → $5k position size (5% per position) — these are talent-scout trades; they should matter enough to move the book if they work.

---

### 5. EV Catalyst Event Trader — DELETE

**Reason:** theme-locked analyst on a dead theme. 0 open positions, 8 closes in 8+ weeks, 2 watching. The EV themes (`EV_INFRASTRUCTURE`, `EV_ADOPTION`, `BATTERY_TECH`) get inherited by the Compounder's expanded theme list — when EV becomes a tailwind again, the Compounder will pick it up via the secular theme fence.

**Migration:**
- Confirm 0 open positions (verified: 0 open as of 2026-05-27)
- 2 watching theses → manually archive (or let them age out via ARCHIVED via update_thesis)
- `enabled: false` first, monitor for one week, then delete the row
- Auto industry exposure stays available via Catalyst PM (Automobiles wasn't a sub-industry there but can be added if M&A activity warrants)

---

## Sizing math + portfolio logic

Total at full simultaneous deployment:
```
Secular Compounder ………… 4 × $15k = $60k    (60% of book)
PEAD Specialist (LIVE) ………… 6 × $6k  = $36k    (36% — live cap is the realistic constraint)
Catalyst Event PM ……………… 5 × $8k  = $40k    (40%)
Momentum Breakout …………… 5 × $5k  = $25k    (25%)
                                  ──────
                            Total: 161% (~$161k)
```

**Why soft over-allocation is correct:**

Real funds don't pre-allocate fixed sleeves to PMs. They run capital "first-come, conviction-served." When the Compounder has 4 high-conviction names + the Catalyst PM has a hot FDA setup, both deploy capital. When the Compounder has only 1 conviction name + Momentum has nothing on its watchlist, the Catalyst PM gets more room. The `place_trade` gate's existing buying-power check handles the worst case (system rejects with "insufficient buying power" if all 4 try to fill simultaneously — the agent re-prioritizes its best idea).

**Typical realistic deployment:** 60-90% of book deployed, 10-40% cash buffer. Heavy weighting toward whichever analyst has the strongest current setup.

**Why this beats fixed sleeves:** if you pre-allocate Compounder = $60k, Catalyst = $20k, etc., and the Compounder has 4 amazing ideas but the Catalyst PM has nothing, you've left $20k idle. Soft over-allocation lets capital flow to conviction.

---

## Migration plan

**Order of operations** (lowest risk first, highest risk last):

### Phase 1 — Quick wins (lowest risk)

**1a. Secular Theme Architect — sizing fix only**
- `maxPositionSize: 2500 → 15000`
- `realMaxPosition: 1000 → 15000`
- (Defer the theme/industry expansion for Phase 2.)

This single SQL UPDATE 6× the conviction capacity. No prompt change, no scope change. If it goes badly, revert.

**1b. EV Catalyst Event Trader — disable**
- `enabled: false`
- Verify 0 open positions stays 0 for one week.
- Archive 2 watching theses via `update_thesis(change_status: ARCHIVED, rationale: "Folded into Secular Compounder")`.

### Phase 2 — Prompt + scope changes (medium risk)

**2a. Secular Theme Architect — full evolution to Secular Compounder**
- Update `analystPrompt` to the new version above.
- Expand themes from `[AI_CAPEX, AI_INFRA, AI_DEMAND]` to the full secular set.
- Expand industries beyond IT-only.
- Expand sectors beyond IT.
- `maxOpenPositions: 5 → 4`, `minConfidence: 75 → 78`.

**2b. Tech Momentum Trader → Momentum Breakout**
- Drop sector + industry fences.
- Add `marketCapMin: 5000000000`.
- `maxPositionSize: 2500 → 5000`, `minConfidence: 70 → 75`.
- Update analystPrompt with the all-sectors language.

**2c. Catalyst Event Raider → Catalyst Event PM**
- Narrow industries from 13 to 6.
- Flip `direction: BOTH → LONG`.
- `maxPositionSize: 2000 → 8000`.
- Update analystPrompt for LONG-only.

### Phase 3 — LIVE analyst (highest risk, last)

**3. Earnings Drift Trader sizing fix + LONG flip**
- `direction: BOTH → LONG` (verify no open SHORT positions first — current data shows 2 OPEN positions, neither flagged as SHORT, but confirm via direction check on Position rows).
- `realMaxPosition: 1000 → 6000`.
- Broaden sectors + industries.
- **Do NOT touch the analystPrompt.** It's working.
- Monitor live trades for one week after the change.

### Delete Phase (after 1 week of stability)

**4. EV Catalyst Event Trader — hard delete**
- After 1 week with `enabled: false` and no surprises, DELETE the AgentConfig row.
- Cascade should clean up ResearchRuns, Theses, Signals routes.

---

## Open questions / decisions deferred

1. **Should the Compounder use both COMPOUNDER and TARGET horizons?** Recommendation: yes. Some "conviction" plays are 6-month TARGET trades (the MU/+150% scenario), some are multi-year COMPOUNDER (the LLY/GLP-1 secular hold). Let the agent pick per-thesis based on the structural belief.

2. **Should we add a 5th analyst — a sector specialist (e.g., Semis)?** Not recommended initially. Semis exposure already lives in Compounder + Catalyst + Momentum. Adding a Semis specialist re-introduces the "theme-locked analyst" failure mode unless we can articulate an edge that the 3 broader analysts don't have. Defer until 3 months of data shows a Semis-specific gap.

3. **Should the PEAD Specialist be allowed to short?** Per principal's call: no. LONG-only across the board. The asymmetric tail risk of shorting earnings misses contradicts the "big gains, conviction" thesis.

4. **What about a DAY trader?** No current DAY-only analyst exists. The `INTRADAY_MOMENTUM_SCALPER` archetype is available but contradicts the principal's stated goal of long-term conviction. Defer indefinitely.

---

## What this plan does NOT do

- **Does not change any code.** Zero modifications to `lib/agent/`, `lib/inngest/`, or any UI.
- **Does not modify Strategy Archetypes.** The 10 existing archetypes are correct; this plan uses 4 of them.
- **Does not modify the daily-run prompt or any agent behavior.** The agents will use the same V2 prompts; only their input config changes.
- **Does not affect Discovery / Tactical / Thesis-writer roles.** Those are orthogonal to the config.
- **Does not touch Position sizing logic in `place_trade`.** The sizing gates already work; we're just configuring sensible inputs.

---

## Success criteria

After 2-4 weeks of running the new lineup:
1. **Secular Compounder** has 2-4 ACTIVE positions sized $10k-$15k each. At least one position held >30 days without panic-closing on intra-month volatility.
2. **PEAD Specialist** is live with ≥3 trades at $5k-$6k size (vs. $1k cap today).
3. **Catalyst Event PM** has narrower industries reflected in its watchlist (biotech-heavy, fewer tech generalist names).
4. **Momentum Breakout** is opening ≥1-2 positions per week (vs. 0 today). Mix of sectors, not just tech.
5. **No EV-only analyst.** Theme is folded into the Compounder.
6. Total deployed capital at any time: 60-90% of book. Cash buffer: 10-40%.

If after 4 weeks any analyst is still inactive (0 positions opened), revisit its config. Don't let dead seats linger.

---

## See also

- [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle (this plan is pure Layer 3 config; no Layer 1/2 changes)
- [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — thesis state machine that the new analysts will produce
- [`docs/VISION.md`](../VISION.md) — Part 2 (hold-style spectrum) is the load-bearing concept this plan implements
- [`lib/agent/knowledge/strategy-archetypes.ts`](../../lib/agent/knowledge/strategy-archetypes.ts) — the 10 archetypes; this plan maps 4 of them to live analysts
