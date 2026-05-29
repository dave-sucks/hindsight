# Hindsight — Discovery V2 (signal sources reference)

> **What this is:** a catalog of the signal source archetypes that could feed a stronger discovery pipeline. For each: what the signal looks like in the world, the kind of action it should produce, and the realistic dollar outcome on a representative trade.
>
> **What this is not:** an implementation plan. The architecture, the agent modes, the cadences, the dispatch logic — all of that belongs in a follow-up plan that respects the platform's agent-driven shape. This doc is just the reference of *what's out there*.
>
> **Premise.** Today's discovery is anemic: Perplexity Sonar searches + FMP movers + Finnhub earnings calendar, batched weekly. The rest of the platform (signal-router → trigger-evaluator → tactical-run → place_trade) is already capable of acting on signals in seconds. The bottleneck is the inputs, not the machinery downstream. The catalog below is the universe of inputs to pick from.

---

## 1. The state of discovery today

The current Sunday discovery cron is a once-a-week funnel that reads three surfaces (Sonar searches, FMP top movers, Finnhub earnings calendar), scores candidates, dispatches the thesis-writer for the survivors, and writes PASS-archived rows for the rejects. It works. But it produces ~5-10 candidates per analyst per week, mostly already-mainstream names, with no event-driven cadence and no social/regulatory/options-flow visibility at all.

Meanwhile the same time period has produced:
- Hundreds of SEC filings (8-Ks, Form 4s, 13Ds) on tickers in active analyst universes
- Dozens of unusual options blocks on names within market-cap fences
- Tens of congressional STOCK Act disclosures from members with documented alpha
- A continuous social conversation on X and Reddit naming tickers
- Real-time news headlines that historically predict 5-15% moves over the following days

None of this reaches an analyst inbox. That's the gap.

---

## 2. What "better discovery" means

Independent of any specific architecture, better discovery means:

1. **Continuous, not weekly.** Material events happen at all hours; waiting until Sunday to look at Wednesday's 8-K is a guaranteed miss.
2. **Source-natural cadences.** SEC filings are event-driven; congressional trades have a 45-day statutory lag; social attention shifts in minutes; earnings calendars are dated weeks in advance. Each source has its own natural rhythm.
3. **Event class matters more than volume.** A single 13D from a top-tier activist is a higher-value event than a hundred news headlines. The pipeline should distinguish.
4. **Author/source provenance is durable.** When @traderstewie or a specific monitor produces signals that lead to winning trades over time, that needs to be remembered and weighted. The existing `Monitor.successScore` pattern is the model.
5. **The system already has the right hammer.** `dispatch_thesis_research` produces a full dossier on any ticker in ~90 seconds; `update_thesis` writes durable REVIEWED audit rows; `place_trade` executes. Discovery's job is to identify *what* to point those at — not to replace them.

That's the conceptual shape. Specific implementation choices are separate.

---

## 3. Signal source catalog

Each entry in the same format: what the signal looks like, the kind of action it should produce, the realistic dollar outcome on a representative trade, and the integration cost/latency reality.

### 3.1. SEC 8-K — Item 4.02 (Restatement)

**The signal:** Company files an 8-K disclosing Item 4.02 — "Non-Reliance on Previously Issued Financial Statements." Translation: their last earnings report was wrong. Peer-reviewed academic outcome: -8% on day 0, drifting to -15% over 30 days.

**The action:** Detected within 30 seconds of atom-feed publication. If any analyst holds a LONG → exit in after-hours immediately. If a short-capable analyst's universe includes the ticker → potential short setup with CATALYST horizon.

**The outcome:** $42 close → $34 open. 200-share LONG exit saves $1,500 vs an hourly price monitor that wouldn't catch it until 9:30am. Or a 100-share overnight short = +$800.

**Integration reality:** EDGAR atom feed `getcurrent?type=8-K&output=atom` is free, ~1-30s latency. sec-api.io WebSocket Stream API ($55/mo) cuts latency to ~300ms — buy it only when atom-feed lag is demonstrably breaking trades.

### 3.2. SEC 8-K — Item 5.02 (Officer Departure)

**The signal:** CEO/CFO resigns. "Effective immediately" + no named successor is the high-α slice. For high-flying growth names where the CEO is the brand: -10% to -20% gap.

**The action:** Read the filing text. "Effective immediately + no successor" → exit longs / consider shorts. "6-month transition + named successor" → market shrugs, skip.

**The outcome:** Filing at 8:13am ET, exit 300 shares at $58.50 by 8:16am, stock opens at $51. Saved $2,250 vs human-paced response.

**Integration reality:** Same EDGAR pipeline as 4.02.

### 3.3. SEC 8-K — Item 2.02 (Earnings + Guide)

**The signal:** Beat-and-raise combo (EPS beat >5% + revenue beat >5% + guidance raised). One of the highest-α event classes documented.

**The action:** Validate magnitude. If existing WATCHING thesis has an ENTER trigger on positive earnings → place trade in after-hours. If no thesis → dispatch thesis-writer to mint for tomorrow's daily run.

**The outcome:** $920 AH entry, $980 next-day open. +$3,000 overnight on 50 shares.

**Integration reality:** Same EDGAR pipeline.

### 3.4. SEC Form 4 — Cluster Insider Buy

**The signal:** 3+ insiders buy in a 30-day window. CEO/CFO + $500k+ aggregate is the high-α slice. Cohen-Malloy-Pomorski peer-reviewed research: ~7.4% 6-month outperformance in mid-caps.

**The action:** Detect the cluster pattern. Dispatch thesis-writer with TARGET horizon. ENTER trigger on next pullback to MA20.

**The outcome:** $48 entry on next pullback → $61 five months later. +27% on a 3% position = $810 on a $10k slice.

**Integration reality:** EDGAR Form 4 atom feed is free. OpenInsider has structured rollups. sec-api.io exposes parsed JSON via stream API. Single-insider purchases are noisy and should NOT auto-dispatch — the pattern is the signal, not the single fill.

### 3.5. SEC Schedule 13D — Activist Filing

**The signal:** Credible activist files 13D disclosing >5% stake + an open letter calling for changes. The single highest-α single-event class on record. Brav/Klein/Zur peer-reviewed research: ~10% 12-month excess returns following filings from credible filers.

**The action:** Match against a curated list of top-10 credible activists (Elliott, Pershing Square, Trian, Starboard, ValueAct, Engaged, Third Point, Carl Icahn, Jana, Engine No. 1). Match → dispatch thesis-writer with TARGET horizon, 12-month hold, -10% stop.

**The outcome:** $52 entry → $68 10 months later. +30% on a 5% position = $1,500 on a $10k slice.

**Integration reality:** EDGAR atom feed `type=SC 13D` is free. The "credible activist" filter is the value — filings from no-name LLCs are noise.

### 3.6. Congressional Trade — STOCK Act

**The signal:** Periodic Transaction Report disclosing a member's (or family's) trade. Statutory 45-day disclosure lag. Pelosi family documented 54% in 2024 vs SPX 25% — 29 percentage points of excess return.

**The action:** Filter for value — Pelosi (either one), Tuberville, Crenshaw, top-10 ranked. Purchases >$1M notional. Elite-member matches → dispatch thesis-writer with TARGET horizon, 3% sizing.

**The outcome:** $128 entry on disclosed NVDA position → $185 four months later. +44% in 4 months on a 3% position = $1,320 on a $10k slice.

**Integration reality:** Quiver Quantitative Hobbyist tier ($30/mo). Sub-hour polling is theater — the 45-day statutory lag dwarfs any pipeline-latency contribution. 2-hour cadence is fine.

### 3.7. Options Flow — Unusual Activity (UOA)

**The signal:** Single block trade with the high-α archetype: **sweep + size + OTM + short-dated**. Example: $2.4M block in $60 calls 25% OTM, 6 weeks to expiry, OI jumps 142 → 4,200. The buyer expects a material move in-window — usually a binary catalyst (FDA decision, M&A close, trial readout).

**The action:** Validate OI surge + check dated-catalyst calendar. If catalyst in-window → dispatch thesis-writer with CATALYST horizon. Position is in EQUITY, not options (use their signal, not their leverage).

**The outcome:** $48 equity entry. FDA approves 5 weeks later → $71. +48% in 5 weeks on a 4% position = $1,920 on a $10k slice.

**Integration reality:** Unusual Whales API tier is the only retail-priced JSON/WebSocket UOA API. Dashboard-only tools (Cheddar Flow, FlowAlgo, BlackBox) are disqualifying for automation.

### 3.8. Dark Pool — Block Print

**The signal:** Off-exchange (TRF) print >10% of average daily volume, off-NBBO, size >$5M. Single print = institutional positioning. **Multi-day pattern (5 days, 3+ large prints) = confirmed accumulation.**

**The action:** Track the pattern across days. Single print = note only. Confirmed 5-day pattern = dispatch thesis-writer with TARGET horizon.

**The outcome:** $33 entry after pattern confirmation → $41 four weeks later. +24% on 4% = $960 on a $10k slice.

**Integration reality:** Polygon.io Developer ($79/mo) gives raw consolidated tape including TRF prints; the "large block + off-NBBO" heuristic is DIY. Unusual Whales' dark-pool API has a documented 15-minute delay — too slow for tactical use.

### 3.9. News Headline — Real-time Wire

**The signal:** Headline pushed within ~200ms of press-release publication, ahead of CNBC chyron / X cycle / retail brokerage app pushes.

**The action:** Pre-grade with a fast LLM (Groq, Cerebras, Haiku) scoring relevance + catalyst-type, with 5 nearest-historical-headlines passed in-prompt as ground truth. Score thresholds drive routing — high-score on a thesis ticker fires tactical-run; high-score on a novel ticker dispatches thesis-writer.

**The outcome:** First-move (algo-trader speed) is gone in milliseconds — that's not the trade. The 5-day pattern-continuation move IS the trade an AI can take consistently. $58 entry → $69 four days later = +19%.

**Integration reality:** Benzinga Basic News API is free with real-time WebSocket + webhook delivery. The biggest "why aren't we doing this yet" item in the entire catalog.

### 3.10. Social — WSB Rank Velocity (ApeWisdom)

**The signal:** Ticker jumps from rank #47 to #4 on r/wallstreetbets in 24h, mention count +1422%. Combined with small float (<50M) + high SI (>15%) + already-moving price = meme-squeeze archetype.

**The action:** Validate float + SI thresholds. Mint LONG WATCHING with **TRADE horizon** (NOT TARGET — this is a surf, not a hold). ENTER trigger on pullback. Exit trigger on +25% gain OR 2-hour VWAP break.

**The outcome:** $17 pullback entry → $24 three days later, exit at VWAP break. +41% in a week on a 2% position = $820 on a $10k slice. **The exit discipline is the magic** — the meme-squeeze trade is the opposite of buy-and-hold.

**Integration reality:** ApeWisdom JSON API is free, no auth. Covers WSB + stocks + investing + pennystocks + 4chan /biz/.

### 3.11. Social — Grok / xAI as a Discovery Source

**The signal:** A Grok query returns rich, multi-author, multi-ticker output with native X data access. Example: "who was bullish on $MU in Sept 2024" surfaces specific handles, their setups, their archetypes, and lateral coverage across their other positions. Multi-handle convergence on the same ticker (technical + fundamentals + thematic archetypes all agreeing) is the rarest, highest-value variant.

**The action:** Discovery should be able to invoke this. The conversation surfaces tickers + author attribution + claims; existing tools — `dispatch_thesis_research`, `update_thesis`, `record_thesis` — turn the findings into action. Cross-archetype convergence is materially stronger than single-author mentions.

**The outcome:** Of ~25-30 distinct tickers surfaced per useful conversation, perhaps 2-5 are net-new candidates worth dispatching deep research on; ~5-10 are evidence touching existing coverage. Over a year this is the highest-frequency net-new-idea source available, at pennies per query.

**Integration reality:** xAI API exposes Grok with a Live Search parameter that searches across X, Web, and News. Pricing is per-token + per-source-result. The "early-caller" backward-lookup pattern that took custom Twitter scraping infrastructure 24 months ago is now a single prompt.

### 3.12. Screenshot Ingestion (User-initiated)

**The signal:** User screenshots an X post, Reddit comment, or article snippet they think is interesting. Vision model extracts (source, author handle, ticker, sentiment, claim, urgency).

**The action:** User eyeballs are the first-stage filter — they already decided this is worth a look. Treat the finding as high-prior: dispatch thesis-writer if it's a novel ticker, append REVIEWED audit if it touches an existing thesis.

**The outcome:** $42 entry from screenshot at 11:14am Wednesday → $51 six days later when the public catalyst lands. +21% in under a week, $630 on a $3k slice.

**Integration reality:** Claude Opus 4.7 vision handles arbitrary screenshot layouts (X post, Reddit thread, Substack snippet) with strict-JSON output. iOS Shortcut → POST → vision call → existing pipeline. The killer mobile-first surface.

### 3.13. Reflexive Vector Memory (Cross-cutting)

**The signal:** Every new candidate is embedded and matched against the embedding-space of past closed trades. Top-5 nearest historical setups weighted by sign-of-return tells you "this looks like setups that have worked / failed before."

**The action:** Influences sizing, stop-tightness, and entry-conviction on every new thesis. Doesn't gate, but informs.

**The outcome:** Pattern fails as predicted. -4% on 1.5% position instead of -14% on 4% position = $1,200 saved on a $100k book. Compound across 50 pattern-vetoes/year = $60k/year in losses avoided. This is the moat nobody else builds for a single-user agent.

**Integration reality:** Supabase pgvector + HNSW index, OpenAI text-embedding-3-large. Storage is free; embedding cost is ~$0.02/thesis. The hard part is the discipline of doing the embedding on every close.

### 3.14. Earnings Vocal-Tone Contradiction

**The signal:** Earnings beat + raise, stock opens +6%. But vocal-tone analyzer (Deepgram transcript + tone analysis) detected CFO hesitation + hedge phrases + pitch drop on margin questions vs. confidence on pipeline questions. Market narrative ≠ CFO's affect.

**The action:** Write a contradictory note. Skip the post-earnings momentum chase, OR enter reduced-size with tight stop.

**The outcome:** Stock fades +6% → -2% over 3 days as analysts dig into the same margin concerns. Saved $400 drawdown on a $5k position, OR caught the fade for +1% on the contrarian trade.

**Integration reality:** Deepgram for transcription + tone metadata, Claude for synthesis. Earnings calls are infrequent (1/quarter per ticker), so this is low-volume but high-uniqueness.

### 3.15. Prediction Market Disconnect

**The signal:** Polymarket "Will $TICKER announce M&A in 2026?" trading at 67%. Options market IV is normal (not pricing event risk). Disconnect = potential edge.

**The action:** Flag ticker-specific contracts with >20pp probability moves + IV disconnect. Size 1-2% position in equity or long-dated calls.

**The outcome:** Asymmetric — $640 upside vs $60 downside on a $2k slice. Single-bet, big-payoff archetype; less daily-flow value, more occasional-edge value.

**Integration reality:** Polymarket + Kalshi public APIs. Low frequency, modest signal.

### 3.16. FDA / Clinical Trial Readouts

**The signal:** PDUFA date hit, FDA approval/rejection, Phase 2/3 trial readout. Binary catalysts for biotech names.

**The action:** Forward calendar maintains awareness 24-72h before each date. Day-of decision → tactical-run for any held position; novel readout on universe-fit name → dispatch thesis-writer.

**The outcome:** Approvals routinely move biotech equity 30-100%; rejections 20-60% downside. Position sizing dominated by the binary risk — small starter positions with options overlay.

**Integration reality:** BioPharmaCatalyst calendar (paid), ClinicalTrials.gov (free, structured trial registry), FDA press releases. PDUFA dates are *known in advance* — the calendar is a forward-knowable input.

---

## 4. The empirical alpha hierarchy

Not all sources are equal. Rough ranking by documented per-event excess return in the academic literature, highest to lowest:

| Source | Documented α | Frequency |
|---|---|---|
| Schedule 13D from credible activist | ~10% / 12mo | Rare (single-digit per month firm-wide) |
| Cluster insider buying (CEO/CFO + 3+ insiders) | ~7.4% / 6mo | Uncommon (handful per week in mid-caps) |
| Single Pelosi-family disclosed purchase | ~5-10% / 6mo (period-dependent) | Sporadic |
| 8-K Item 4.02 (restatement, short) | ~-15% / 30d | Rare |
| 8-K Item 5.02 immediate (officer departure, short) | ~-10% / day 0 | Occasional |
| 8-K Item 2.02 beat-and-raise | ~5-15% / week | Frequent (earnings season) |
| Confirmed dark-pool accumulation pattern | ~5-10% / month | Uncommon |
| UOA + dated catalyst in-window | High variance; ~15-50% on hits | Frequent |
| Multi-handle Grok corroboration | High variance | Occasional |
| News headline post pre-grader (high score) | ~3-8% / 5d | Very frequent |
| Single-author fintwit mention | ~base rate | Constant |
| ApeWisdom rank velocity | High variance | Sporadic |

The pattern: **lower frequency + structured-data sources have stronger per-event alpha; higher-frequency unstructured sources have lower per-event alpha but cumulative value through volume + corroboration.**

---

## 5. What this catalog isn't

- Not an architecture. How any of this is ingested, what agent invokes it, how decisions are routed, what tables get written — that's a separate problem for a separate doc.
- Not a build plan. No phasing, no cost summary, no schema, no mode allowlists.
- Not a vendor evaluation. Vendor names appear only when there's a single obvious choice; otherwise the question "which provider" is its own diligence task.
- Not a substitute for the existing `docs/INTELLIGENCE.md` (which documents what's built today). This doc is forward-looking source coverage; that one is the live reference.

When the time comes to design the architecture for ingesting these, this catalog is the input.

---

## See also

- [`docs/VISION.md`](../VISION.md) — Pillar 1 (Discovery) is the success bar
- [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — the role split + the dispatchable thesis-writer that downstream tools rely on
- [`docs/INTELLIGENCE.md`](../INTELLIGENCE.md) — what discovery actually looks like in production today
- [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle (any future ingestion design has to respect this)
