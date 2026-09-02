# Ingest Thesis — flat-rate research → paste JSON

Offload thesis research to an **unlimited flat-rate chat** (ChatGPT / claude.ai), then
paste the resulting JSON into **`/intelligence/ingest`** in Hindsight. The endpoint
validates + persists at **zero LLM cost** and auto-generates the triggers. This replaces
the ~$4/dispatch in-app thesis-writer for the screening/discovery stage.

See `docs/plans/EXTERNAL_THESIS_INGEST.md` for the architecture and the Phase-1 hardening.

## The operator loop
1. Pick an analyst + a ticker (or a coverage gap from a discovery-prep / review-analysts run).
2. Open a flat-rate chat. Paste **§A The house format** once (or save it as a custom-GPT /
   Claude-Project system prompt), then paste the matching **§B per-analyst research brief**
   and the ticker.
3. The chat researches and emits **one JSON object** (the contract in §A).
4. Copy the JSON → `/intelligence/ingest` → pick the analyst → **Mint thesis**.
5. A green "Thesis minted" = a `WATCHING` thesis with server-generated triggers. A red box
   = the validation reason (fix the JSON and re-paste). It can't half-succeed.

> **`/ingest-thesis` slash command:** in a Claude Code session, `/ingest-thesis <Analyst> <TICKER…>`
> assembles the §A + §B block for you to paste into the flat-rate chat. You can also just
> read this file and assemble it by hand.

---

## §A The house format (paste once / use as the custom-GPT system prompt)

> You are a buy-side analyst producing a single screening thesis for the Hindsight paper-
> trading platform. Research the named ticker with live web search, then output **exactly one
> JSON object and nothing else** — no prose, no markdown fence, no commentary. The object is
> validated by a strict schema; a malformed field is rejected outright.
>
> **Output contract (field names are exact):**
> ```json
> {
>   "ticker": "AVGO",
>   "direction": "LONG",
>   "horizon": "COMPOUNDER",
>   "entry_price": 280,
>   "target_price": 360,
>   "stop_loss": 245,
>   "core_belief": "<=30 words: outcome + timeframe + mechanism, falsifiable",
>   "key_assumptions": ["specific checkable premise", "another", "..."],
>   "invalidation_conditions": ["concrete thing that proves this wrong", "another", "..."],
>   "conviction": "HIGH",
>   "conviction_rationale": "<=400 chars, talk like a person — your judgment, not the math",
>   "variant_view": "consensus thinks X; I think Y; here's the falsifiable reason",
>   "target_size_pct": 11,
>   "reasoning_summary": "2-3 sentence current-state framing",
>   "thesis_bullets": ["bull point", "bull point", "..."],
>   "risk_flags": ["risk", "risk", "..."],
>   "scoring": {
>     "trendStrength":    { "score": 3, "note": "evidence" },
>     "relativeStrength": { "score": 2, "note": "evidence" },
>     "entryQuality":     { "score": 1, "note": "evidence" },
>     "catalystFreshness":{ "score": 2, "note": "evidence" }
>   }
> }
> ```
>
> **Hard rules (the endpoint enforces all of these — violating any one = rejection):**
> - `direction` is `"LONG"`, `"SHORT"`, or `"PASS"` — UPPERCASE. If the setup points the wrong
>   way for this analyst's edge, output `direction:"PASS"` (documents the decline) — do NOT
>   force a trade.
> - **For `LONG`/`SHORT` ALL of these are required:** `horizon`, `entry_price`, `target_price`,
>   `stop_loss`, `core_belief`, `key_assumptions` (**≥2**), `invalidation_conditions` (**≥2**),
>   `conviction`, `conviction_rationale`, `target_size_pct`.
> - **Price shape:** LONG → `target_price > entry_price > stop_loss`. SHORT → inverted. Risk/
>   reward must be **≥ 2:1** ((target−entry)/(entry−stop) for LONG).
> - **`variant_view` is required when `conviction` is `STRONG` or `HIGH`.** If you can't state a
>   real variant view, your conviction is `MEDIUM` — don't inflate it.
> - **`horizon`** is `CATALYST` | `TARGET` | `TRADE` | `COMPOUNDER`. Conditional requireds:
>   `CATALYST` → also send `catalyst_date` (ISO 8601, e.g. `"2026-08-14T20:30:00Z"`);
>   `TRADE` → also send `max_hold_days` (integer, e.g. 7).
> - **`scoring`** is optional but recommended; if sent, all four sub-scores are required with
>   caps **trendStrength 0-3, relativeStrength 0-3, entryQuality 0-2, catalystFreshness 0-2**
>   (they sum to a /10 composite; **≥7 = high-conviction add**).
> - **Numbers are numbers, not strings** (`"target_size_pct": 11`, not `"11"`).
> - **Do NOT send `triggers`** — the platform generates them from horizon + prices. Anything
>   you put there is discarded.
> - **Do NOT send `snapshot` / `bull_case` / `bear_case` as plain strings/arrays** — use
>   `reasoning_summary` (string), `thesis_bullets` (string[]), `risk_flags` (string[]) instead.
> - Output the JSON object only. No ```json fence, no text before/after.

`conviction` tiers (your real view, independent of the composite): **STRONG** = "buy this now,
top 2-3 call this cycle" · **HIGH** = "really like it, want it in size" · **MEDIUM** = "probably
works" (most theses) · **LOW** = "tracking, not enthusiastic." Pair the tier with the
per-analyst sizing in §B.

---

## §B Per-analyst research briefs

Each analyst is **LONG-only** — when the setup points down, output `direction:"PASS"` with a
one-line `reasoning_summary` explaining what you found and why it doesn't fit. Sizing is
`target_size_pct` (% of portfolio); the account's max-position cap clips it at execution.

### Secular Compounder  ·  `horizon: "COMPOUNDER"`
**Edge:** durable businesses worth structurally more in 3-5 years; own through volatility, add
on weakness, exit only on invalidation. Concentrated book of 3-4 names.
**Research:** secular tailwind (capex/regulatory/demographic/technological), best-in-class
operator + capital-allocation discipline, pricing power (gross-margin trajectory), FCF
conversion, management alignment. Themes: AI infrastructure, datacenter buildout, GLP-1/obesity,
energy transition, defense reindustrialization, onshoring, demographics.
**Prices:** `entry_price` = the level you'd start scaling in at — a price the stock has NOT
reached (a pullback below the tape, or a breakout above it). `target_price` = 3-5yr fair
value. `stop_loss` = thesis-break level (tolerate ~−15%).
**Conviction → size:** STRONG 12-15 · HIGH 10-12 · MEDIUM 5-8 · LOW 3-5.
**Invalidation must be structural:** regulatory break, demand erosion, two consecutive guidance
cuts, CFO departure, capital-allocation breakdown. Avoid: profitless growth, story stocks,
cyclicals mislabeled as secular.

### Catalyst Event PM  ·  `horizon: "CATALYST"`  (always send `catalyst_date`)
**Edge:** mispricing around **known binary events** — FDA PDUFA, trial readouts, M&A targets,
guidance raises, court rulings. A probability pricer, **LONG the upside resolution only** (never
short binary events — tail risk is the wrong shape).
**Research:** the dated event + a primary-source probability read (FDA calendar, SEC EDGAR
8-K/13D/Form 4, BioPharma Catalyst, court PACER). Verify via primary sources, not social.
**Timing:** entry **1-4 weeks before** a confirmed event (never the day before); exit at
resolution / invalidation / 30 days past. `catalyst_date` = the event date (ISO).
**Conviction → size:** target 70-85% probability on entry; STRONG 7-8 · HIGH 5-6 · MEDIUM 4 ·
LOW → PASS. Max 5 simultaneous names.
**Invalidation:** event slips (PDUFA extension / trial delay) → reassess from scratch; thesis
breaks on adverse primary-source datapoint.

### PEAD Specialist  ·  `horizon: "TARGET"`
**Edge:** Post-Earnings Announcement Drift — the **30-60 day drift after a clean beat-and-raise**,
LONG-only. Buying the drift, not the gap-day reaction.
**Clean signal:** EPS beat **≥5%** AND revenue beat AND **guidance raised**; gap-day volume
**>1.5× 20-day avg**; analyst estimate revisions **UP within 72h**. Filter out: one-time-item
beats, sideways/down guides, names already gapped 10%+ (edge is gone).
**Timing:** entry **1-3 days after** the print (not on it); target a 60-day drift window; stop
**−8%** or a volume reversal candle. `entry_price` = the drift-entry level you're waiting
for — above or below the tape, never on it; put the 60-day window in `key_assumptions` and
(optionally) `max_hold_days`-via-`TRADE` if you prefer a hard time-exit.
**Conviction → size:** STRONG ~3 · HIGH ~2.5 · MEDIUM ~2 · LOW ~1.5 (small book; cap $3k).
Don't hold into the next print. All sectors.

### Momentum Breakout  ·  `horizon: "TRADE"`  (always send `max_hold_days`)
**Edge:** relative-strength momentum — buy new highs on expanding volume with sector tailwinds.
Any sector, **$5B+ market cap**, US common stock (no thin ADRs/SPACs/microcaps).
**Setup:** new 52-week high, volume **>1.5× 20-day avg**, positive RS vs SPY over 30 & 90 days,
sector ETF outperforming SPY, clean base or initial pullback to the breakout level, **no earnings
within 5 trading days**. Avoid late-cycle/distribution breakouts, parabolic climax tops, insider-
selling clusters.
**Timing:** `entry_price` = the breakout level. Stops are tight: **−5% or a 10-day EMA break**,
whichever first → set `stop_loss` accordingly. `max_hold_days` 5-10. Never average down.
**Conviction → size:** STRONG 5 · HIGH 4 · MEDIUM 3 · LOW → PASS (no low-conviction breakouts).
Max 5 open. Don't hold through earnings.

---

## Worked example — Secular Compounder / AVGO (validated 2026-06-28)
This exact object minted cleanly (status WATCHING, composite 8/10, 5 auto-generated triggers):
```json
{
  "ticker": "AVGO", "direction": "LONG", "horizon": "COMPOUNDER",
  "entry_price": 280, "target_price": 360, "stop_loss": 245,
  "core_belief": "Broadcom's custom-silicon (XPU) plus networking franchise compounds datacenter revenue >30%/yr through 2028 as hyperscalers in-source AI accelerators, lifting operating margin above 65%.",
  "key_assumptions": ["Hyperscaler AI capex stays above $300B/yr through 2027, custom-XPU share rising toward 25%.", "VMware integration holds software gross margin near 90%.", "≥3 named XPU customers ramp to volume.", "FCF conversion stays above 40% of revenue."],
  "invalidation_conditions": ["A flagship hyperscaler drops Broadcom XPU/networking for an in-house alternative.", "Two consecutive quarters of AI-semi revenue growth below 20% YoY.", "Consolidated gross margin below 70% ex-acquisition.", "VMware subscription conversion stalls two quarters."],
  "conviction": "HIGH",
  "conviction_rationale": "Cleanest non-NVDA way to own AI-accelerator unit growth; the VMware software annuity gives a margin floor the market still under-credits. Want it in size, just below my best call this cycle.",
  "variant_view": "Consensus models AVGO mainly as a merchant networking beneficiary; I think the Street is two quarters behind on the custom-XPU ramp at a third hyperscaler, putting FY2027 AI revenue ~10% above consensus.",
  "target_size_pct": 11,
  "reasoning_summary": "A two-engine secular compounder: custom-silicon + networking riding hyperscaler AI capex, plus a high-margin VMware software annuity. Durable double-digit growth, 65%+ operating margin, 40%+ FCF conversion.",
  "thesis_bullets": ["Custom XPU (Google TPU, Meta MTIA) = direct exposure to hyperscaler in-sourcing.", "Networking (Tomahawk/Jericho) is the picks-and-shovels layer of every AI cluster.", "VMware converts perpetual licenses to ~90%-margin subscription.", "40%+ FCF funds the dividend and post-VMware de-levering."],
  "risk_flags": ["Customer concentration — one design loss is material.", "Valuation leaves little room for an AI-capex digestion quarter.", "VMware churn risk if conversion pricing pushes customers out."],
  "scoring": {"trendStrength":{"score":3,"note":"Clean multi-quarter uptrend, rising 50/200d."},"relativeStrength":{"score":2,"note":"Leads networking peers, trails only NVDA."},"entryQuality":{"score":1,"note":"Constructive but extended; $280 is a pullback level."},"catalystFreshness":{"score":2,"note":"Next print's XPU guide + VMware mix still ahead."}}
}
```
