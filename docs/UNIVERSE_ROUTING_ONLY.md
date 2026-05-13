# Universe is a routing-time concern, not a runtime concern

Captured 2026-05-13 after the INTC discovery run review surfaced the
contradictions in current universe enforcement.

## The principle

Universe (sectors, industries, themes, market-cap bounds) is a
**fence applied at exactly one point**: when a signal is being routed
to an analyst. After that, the analyst's inbox is the analyst's
inbox. Tools don't re-fence. Agents don't re-fence. `record_thesis`
doesn't fence. `place_trade` doesn't fence.

The mental model: **routing is the universe boundary**. Everything
downstream of routing trusts that the boundary already held.

## What this means by source

| Source of the signal | Universe applies? | Reason |
|---|---|---|
| **Analyst's own monitor** ("best car companies this year" search saved to this analyst) | **NO** | The analyst defined the monitor. Their explicit interest IS the fence. |
| **Manual watchlist add** (user clicked "add NVDA") | **NO** | Explicit intent. |
| **Manual ticker seed** (user added a ticker via builder/editor) | **NO** | Explicit intent. |
| **Cross-analyst signal** (another analyst's monitor produced output) | **YES** | Routing decides whether THIS analyst should care. |
| **Firm-wide aggregate** (top movers, earnings calendar) | **YES** | The whole point of firm aggregates is per-analyst routing. |
| **Email signal** (newsletter arriving in inbox) | **YES** | Router decides who gets it. |

## What this means by enforcement point

| Enforcement point today | Should keep? | Why |
|---|---|---|
| Signal-router fence (sectors/industries/themes/market-cap) | **Keep** | This IS the universe boundary. |
| Owner-bypass at routing (an analyst's own monitor signals route in unfenced) | **Add if missing** | Currently unclear if implemented. Verify and add if not. |
| `read_signals` returns whatever is in the analyst's `AnalystSignalRoute` inbox | **Keep** | Trusts routing's work. |
| `get_market_movers scope:"universe"` filtering at tool time | **Remove or simplify** | The tool can't actually fence by sector (FMP doesn't return sector). The `scope:"universe"` knob is a fiction. Either: drop the knob and always return `scope:"all"`, OR keep `scope:"universe"` as a thin "exclude already-covered tickers" filter (no sector pretending). |
| `get_earnings_calendar scope:"universe"` | **Same as movers** | Same fiction; same fix. |
| Discovery prompt teaching the agent its universe + asking it to re-filter | **Remove** | Reading universe info, narrating "this is out of scope" — all wasted agent work. Replace with: *"Here's your inbox. Research it. Mint theses."* |
| `record_thesis` universe rejection | **Already absent** | ✓ Verified no universe check. |
| `place_trade` universe rejection | **Already absent (only exclusionList)** | ✓ `exclusionList` stays (explicit user blocklist, not the fence). |

## Concrete changes for the followup PR

### Schema / data — no changes needed.

### Signal router (`lib/inngest/functions/signal-router.ts`)
- Add owner-bypass branch: if `signal.monitorId` exists and the monitor's `analystId` matches a candidate analyst, route to that analyst regardless of universe match. Mark `routeReasonCode = "OWNER_MONITOR"`.
- Keep existing fence logic for everything else (cross-analyst, firm-aggregate, email signals).

### Tools
- **`get_market_movers`**: drop `scope:"universe"` from the schema OR keep it as just-excludes-covered-tickers. The price-floor and extreme-move filters from PR #262 stay as garbage-noise reduction, regardless of scope.
- **`get_earnings_calendar`**: same. The 15-row visible-cap from PR #262 stays.
- Both tools should be reframed in their descriptions: *"Returns the firm-wide firehose. Universe fencing is upstream — if it's in your inbox, it's in scope."*

### Discovery system prompt (`lib/agent/system-prompts/discovery.ts`)
Delete:
- The `YOUR CONFIG` block's universe summary (sectors/industries/themes lines) — keep only direction bias, hold style, signal types, position sizing.
- The `WHAT'S ALREADY DONE FOR YOU — DO NOT RE-FILTER` block (no longer needed once the prompt doesn't tell the agent about the fence at all).
- The "Universe is shown here for CONTEXT" paragraph.

Replace with one sentence at the top of Step 1: *"Pull your inbox via read_signals. Everything that landed in the inbox is fair game — your universe was applied upstream when the signals were routed. You do not re-filter."*

### Daily-run system prompt (V2)
Same cuts. Daily run agent should also not re-fence.

### Builder/editor — `validate_universe_fence` (if it exists)
Pre-trade validation of "would this ticker route to this analyst" stays — it's literally simulating the router's work. That's fine.

## What this buys

1. **Cuts ~80 lines of prompt instructing the agent to do work it shouldn't do.** Less for the model to misinterpret.
2. **Eliminates the "agent over-filters because the tools didn't fence" failure mode** the INTC run showed (TDIC + BWEN considered then dismissed).
3. **Manual watchlist adds Just Work.** Analyst adds NVDA → NVDA signals route unfenced via the watchlist branch (already works) → daily run treats NVDA as fair game (already works) → place_trade has no universe gate (already works). No new code needed for this case.
4. **Owner-monitor scenario Just Works.** Analyst saves a "best car companies" monitor → router puts its outputs into this analyst's inbox unfenced (new branch needed) → discovery sees them in `read_signals` (already works) → mints theses (already works).
5. **Prompts shrink, agent behavior gets simpler, edge cases collapse.**

## What this doesn't change

- Routing-time fence still does real work for the bulk of signals (cross-analyst firehose, firm aggregates, email).
- `exclusionList` (explicit "never trade") stays as a hard block at `place_trade`.
- The `marketCapMin`/`marketCapMax` per-analyst config still drives routing fence, just not runtime gates.
- Cross-analyst overlap guard (DAY-only "don't duplicate another analyst's swing thesis") stays — that's a different concern, not universe.

## Sequencing

This is a separate PR from #262. Order:
1. Merge #262 (six bug fixes + 2 prompt tweaks). Verify discovery run produces 5+ theses tomorrow with current architecture.
2. Open a new PR implementing this doc. Touches signal-router (owner-bypass branch), two tools (drop scope:universe pretense), and the discovery + daily-run prompts (cut the fence-teaching).
3. Coordinate with the other session that's working on the ARCHIVED/PENDING thesis-status refactor — these are independent but both touch record_thesis. The refactor PR should land first or second depending on which is closer to ready; this one is loosely coupled.
