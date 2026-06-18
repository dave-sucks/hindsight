# Thesis Visualization — design + feasibility proposal

**Status:** proposal / for review. No code written. Filed 2026-06-15.
**Author:** design pass requested by principal.
**Scope:** (1) a reusable "thesis chart" that overlays the thesis story on a price
timeline, used on three surfaces; (2) a broader brainstorm on making the
WATCHING/HOLDING/PASSED/RETIRED states legible at a glance; (3) how the deleted
post-run brief (GAPS P1-23) folds into a portfolio-summary surface.

> **Inputs.** Grounded in three Perplexity Finance screenshots (Standouts board,
> My Watchlist, Watchlist Movers). What they actually show — and how each element
> maps to data we already have — is itemized in §7.0. We adapt, not copy.

---

## 0. TL;DR / recommendation

- **Build it. The annotated thesis chart is a good idea and a *small* lift** — the
  hard parts (candles pipeline, horizontal reference lines, range pills) already
  ship in [`StockPriceChart`](components/stocks/StockPriceChart.tsx) and
  [`trades/[id]/page.tsx`](app/(root)/trades/[id]/page.tsx). The new work is
  **vertical time-axis markers** (Recharts `ReferenceLine x=`) and a **props
  contract** so the same component renders on the sheet, the cards, and the trade
  page. No new charting library.
- **The one real data gap is cosmetic, not blocking:** we don't store the *price*
  at watchlist-add time. We don't need to — the marker sits on the **time** axis,
  and the price at that date is just a lookup into the candle series we already
  fetch. The *date* is derivable from `Thesis.createdAt` / the first
  `ThesisUpdate(type:"CREATED")`. See §3.
- **The card-list performance concern is real but solved by batching:** the
  dashboard already caps at **20 theses** ([`portfolio.actions.ts:438` `take:20`](lib/actions/portfolio.actions.ts)).
  Alpaca's Data API has a **multi-symbol bars endpoint** — 20 tickers collapse to
  **1–2 cached requests**, not 20 live hits. See §4.
- **Phase it.** Ship **Tier 1 (sparkline on cards + the existing gauge as
  fallback)** first — it's ~1 batched fetch + a tiny component and immediately
  makes the card list legible. **Tier 2 (full annotated chart on sheet + trade
  page)** is the reusable-component extraction. See §6.
- **Bigger picture:** the chart is necessary but *not sufficient* for "what's doing
  well / what I wish I'd bought / what I'm glad I passed on." That's a **scoreboard
  problem**, not a chart problem — §7 proposes a status-segmented card view and a
  Perplexity-style **portfolio summary** surface that is also the natural new home
  for the orphaned post-run brief (§8).

---

## 0.5 Locked card spec (decided with principal)

The thesis **card** gets a Perplexity-Standouts-style price chart. Decisions:

- **Layout:** existing card header (logo · name · ticker·exchange · price · %-pill)
  with the **chart below it**. **No right-side stats column** (Volume/Mkt Cap/P/E/Div) —
  just the chart.
- **Fixed window** for all cards — default **1 month** (one constant; not per-card
  dynamic). 1M shows a multi-week thesis arc and keeps target/stop on-range.
- **Horizontal lines on the card:** Entry / Target / Stop (the chart already supports
  these via `referenceLines`). On a 1M window they sit near price, so "tracking to
  target vs. stop" reads at a glance.
- **Vertical markers (started-watching / entry) live on the SHEET, not the card.**
  The card's fixed short window usually predates entry; the sheet loads the full
  lifespan range on open and shows the verticals there. Open the sheet for the
  "when did we start watching / enter" detail.
- **Feed filtered to WATCHING + HOLDING.** Terminal statuses (PASSED/RETIRED) show
  **no chart** — nothing to track. This also bounds how many charts render at once.
- **Fallback:** no candles for a ticker → render the [`PriceTargetsBlock`](components/domain/price-targets-block.tsx)
  gauge instead of a broken chart.
- **Sheet:** fetches candles **on open** (single symbol, 5-min cached), full range,
  with the vertical markers.

The visual chrome Perplexity uses — dotted-grid background, gradient area fill,
dashed reference line, green-above/red-below line color, axis labels — **already
exists** in [`StockPriceChart`](components/stocks/StockPriceChart.tsx). The card is
that chart + the existing header, minus the stats column.

---

## 1. What exists today (grounded)

| Piece | Where | Notes |
|---|---|---|
| Annotated price chart | [`components/stocks/StockPriceChart.tsx`](components/stocks/StockPriceChart.tsx) | **Recharts `AreaChart`**. Range pills 1W/1M/3M/1Y, gradient fill, up/down stroke color, `<Tooltip>`. Already takes `referenceLines[]` and draws **horizontal** dashed lines via `ReferenceLine y=`. Empty-state dotted card when `<2` points. |
| Reference lines for Entry/Target/Stop | [`trades/[id]/page.tsx:254-258`](app/(root)/trades/[id]/page.tsx) | `chartReferenceLines` = Entry (gray), Target (green), Stop (red), all dashed. Passed straight into `StockPriceChart`. |
| "Bought N shares at $X, now $Y" header | [`trades/[id]/page.tsx:382-407`](app/(root)/trades/[id]/page.tsx) | `buildTradeSentence()` — shared grammar (sheet / row / activity feed). Rendered as `children` *inside* the chart card. |
| Candle fetch | [`getStockCandles()` finnhub.actions.ts:306](lib/actions/finnhub.actions.ts) | Single-symbol. **Alpaca Data API**, `1Day` bars, IEX feed, `next:{revalidate:300}` (5-min ISR). Returns `StockCandle[] = {date,close,open,high,low,volume}`. |
| The gauge (low-fi sibling) | [`components/domain/price-targets-block.tsx`](components/domain/price-targets-block.tsx) | Stop · Entry · Current · Target on a single horizontal bar. Needs no candles. Just shipped (PR #423). This is the **degraded fallback** for the chart. |
| Thesis row | [`components/ui/thesis-row.tsx`](components/ui/thesis-row.tsx) | `ThesisRowData` already carries `entryPrice/targetPrice/stopLoss/createdAt/currentPrice/priceChange/status/position{openedAt,avgCost,...}`. Rendered on dashboard, stock page, analyst detail, ThesisCardRenderer. |
| Dashboard pick list | [`DashboardClient.tsx:565-604`](components/dashboard/DashboardClient.tsx) + [`portfolio.actions.ts:438`](lib/actions/portfolio.actions.ts) | `prisma.thesis.findMany({ orderBy:{updatedAt:desc}, take:20 })`. So the "card list" is **≤20 names**. |
| Full TradingView chart | `/stocks/[symbol]` (per CLAUDE.md) | TradingView Lightweight Charts. Heavier; not what we extend here. |

**Takeaway:** we are not building a chart from scratch. We are *componentizing and
annotating* an existing Recharts chart, and *feeding a card-list version of it from
a batched candle fetch*.

---

## 2. Feasibility verdict

**Verdict: yes, with one Tier-1/Tier-2 split.** Reasons:

- **Rendering** — Recharts already does horizontal lines. Vertical markers are the
  same primitive on the other axis: `<ReferenceLine x={dateStr} stroke=… label=…/>`.
  The marker's x-value must be a `date` string that exists in `data` (the candle
  array keyed by `date`), or Recharts won't place it — so markers **snap to the
  nearest trading day**, which is exactly what we want. Low risk.
- **Data** — entry, target, stop, review timestamps, and status-change timestamps
  are all in the DB today (§3). The only "missing" datum (watchlist-add *price*) is
  recoverable from the candle series; no new capture required for the chart.
- **Perf/API** — the only scary version is "N live Finnhub/Alpaca calls for a list of
  cards." Alpaca's multi-symbol endpoint + ISR caching + the existing `take:20` cap
  removes that (§4).
- **Effort estimate** — Tier 1 ≈ 1 new server fetch (batched) + a ~60-line
  `Sparkline` + wiring into `ThesisRow`. Tier 2 ≈ extract `StockPriceChart` into a
  `ThesisChart` wrapper that computes markers from a thesis + position, plus the
  fallback-to-gauge branch. Both are component-level, no schema migration required
  for the **minimum** version.

**Where it could go wrong (call these out before building):**
- Recharts vertical `ReferenceLine` needs the x-value to be a present category;
  off-series dates silently don't render. Mitigation: snap to nearest candle date.
- Label collision when watchlist-add and entry are days apart on a 1Y range but
  pixels apart on screen. Mitigation: only show the markers relevant to the current
  range; collapse to one "▸ added / ● entered" combined label when within N px.
- `getStockCandles` returns `[]` on missing Alpaca creds or thin ADRs/small-caps
  (documented FMP/Finnhub gaps). Mitigation: **degrade to the gauge** (§6.4), never
  show a broken chart.

---

## 3. Data availability + the gaps

What each marker/line needs and whether we have it:

| Visual element | Field(s) | Status |
|---|---|---|
| **Horizontal: target line** | `Thesis.targetPrice` (or `Position.targetPrice`) | ✅ Available. Null on unresearched watches (`direction=null`) → omit the line. |
| **Horizontal: stop line** | `Thesis.stopLoss` / `Position.stopLoss` | ✅ Available; same null caveat. |
| **Horizontal: entry line** | `Position.avgCost` (filled) or `Thesis.entryPrice` (planned) | ✅ Available. `avgCost` is the *real* fill; `entryPrice` is the *planned* entry. Show actual when a position exists, planned otherwise. |
| **Vertical: entry marker** | `Position.openedAt` ([schema.prisma:54](prisma/schema.prisma)) | ✅ Available for entered names. |
| **Vertical: "added to watchlist"** | `Thesis.createdAt` **or** first `ThesisUpdate{type:"CREATED"}.timestamp` | ⚠️ **Derivable, with a caveat** (below). |
| **Vertical: review / status-change marks** (optional) | `ThesisUpdate{type:"REVIEWED"\|"STATUS_CHANGED"\|"TRIGGER_FIRED"}.timestamp` | ✅ Available; rich. Use sparingly (clutter). |
| **Price at any marker date** | lookup `close` in the candle series at/near that date | ✅ No storage needed — the chart already has the candles. |
| **"Current" point** | implied by where the line ends + live quote header | ✅ Available (`livePrice`/`currentPrice` at [trades/[id]/page.tsx:209-211](app/(root)/trades/[id]/page.tsx)). |

### The watchlist-add gap, precisely

The principal flagged "price/date when first added to watchlist." Breaking it down:

- **Date — we have it, with a caveat.** `Thesis.createdAt` is when the row was
  created. For a WATCHING seed (`direction=null`, `status=WATCHING`) that *is* the
  add-to-watchlist moment. **Caveat:** a thesis can also be born already-researched
  (discovery mints a directional WATCHING thesis in one shot), so `createdAt` =
  "first covered," which may or may not be a distinct "watch-then-research"
  transition. The cleaner signal is the **first `ThesisUpdate` row** (`type:"CREATED"`),
  and — once it exists — a `STATUS_CHANGED → WATCHING` transition. For the chart's
  purposes `createdAt` is good enough; if we want "watched, *then* later entered" as
  two distinct marks we already have both (`createdAt` and `Position.openedAt`).
- **Price — we do not store it, and we don't need to.** The marker lives on the
  **time axis**; its vertical position is just the candle close on that date, which
  we read from the series we already fetched. Persisting a price would only matter if
  we wanted "added at $X" text *without* loading candles (e.g., the gauge fallback).
  If that proves desirable later, the cheap capture is a `priceAtTime` on the
  `CREATED` ThesisUpdate row — **`ThesisUpdate.priceAtTime` already exists**
  ([schema.prisma](prisma/schema.prisma)) and is populated on many update paths.
  **Recommendation: don't add a column. Backfill-derive from candles; opportunistically
  read `ThesisUpdate.priceAtTime` when present.**

**Net:** no schema migration is required to ship the chart. One *optional* follow-up
(ensure the `CREATED` ThesisUpdate always sets `priceAtTime`) makes the gauge
fallback show "added at $X" without a candle fetch.

---

## 4. API / caching / pagination plan

The single-symbol path is fine for the **sheet** and **trade page** (one ticker,
already cached 5 min). The **card list** is where naïve fetching would be N calls.

### 4.1 Batch the candle fetch (the key move)

Alpaca's Data API exposes a **multi-symbol** bars endpoint:

```
GET https://data.alpaca.markets/v2/stocks/bars
    ?symbols=NVDA,AMD,AVGO,…&timeframe=1Day&start=…&end=…&limit=1000&feed=iex
→ { bars: { NVDA:[…], AMD:[…], … }, next_page_token }
```

This is a sibling of the single-symbol endpoint `getStockCandles` already calls
([finnhub.actions.ts:322](lib/actions/finnhub.actions.ts)). Add a
`getStockCandlesBatch(symbols: string[], days)` that hits it once and returns
`Record<symbol, StockCandle[]>`.

- **Card list = 1 request** for ≤20 symbols on a short (sparkline) window.
- **Pagination:** the `limit=1000` is **total bars across all symbols per page**.
  Sparkline window (≤90 days × 20 symbols ≈ 1,800 bars) = ~2 pages via
  `next_page_token`. Full 1Y (252 × 20 ≈ 5,040) = ~6 pages — which is why the **card
  list uses the short window** and the **full 1Y only loads on the sheet/trade page**
  (one symbol, one page). Loop `next_page_token` until exhausted; cap at a safety
  limit (e.g. 8 pages) and degrade gracefully.

### 4.2 Caching

- Keep the existing **ISR `next:{revalidate:300}`** on the batch fetch — daily bars
  don't move intraday in a way the card list needs more than every 5 min.
- The fetch is a **server action / RSC** (the dashboard and sheet already fetch
  server-side), so candles never hit the client as N requests; the client gets
  pre-shaped sparkline data in the payload.
- Optional second layer: a tiny **per-(symbol, day-bucket) memo** keyed by
  `symbol:YYYY-MM-DD:window` so two surfaces rendering the same name in one request
  don't double-fetch. `react`'s `cache()` (already imported in finnhub.actions.ts)
  covers the within-request dedup for free.

### 4.3 Pagination / limiting the card list itself

- The dashboard is already bounded at **`take:20`**. Keep the chart work behind that
  bound — **never** fetch candles for an unbounded list.
- If the theses tab ever grows beyond 20 (analyst detail, a future "all theses"
  page), paginate the *list* first (cursor on `updatedAt`), then batch-fetch candles
  only for the visible page. Sparklines for off-screen cards can lazy-load via an
  intersection observer if needed — but at 20 names that's premature.

**Summary:** batched endpoint + ISR + the existing `take:20` cap turns "N live hits"
into "1–2 cached server requests per render." This is not a perf risk.

---

## 5. Reusable component design

One component, three surfaces, graceful degradation.

### 5.1 The component

```
components/domain/thesis-chart.tsx   (new)
  ThesisChart(props)         // full annotated chart (Tier 2)
components/ui/sparkline.tsx          (new)
  Sparkline(props)           // tiny inline trend (Tier 1)
```

`ThesisChart` is a thin wrapper over the existing `StockPriceChart` that **computes
markers/lines from thesis+position** and chooses chart-vs-gauge fallback. It does
*not* fork the Recharts config — it feeds `StockPriceChart`.

### 5.2 Props (single contract for all three surfaces)

```ts
type ThesisChartProps = {
  ticker: string;
  candles: StockCandle[];          // pre-fetched server-side; [] => gauge fallback
  // story inputs (all optional → drives degradation)
  direction: 'LONG' | 'SHORT' | null;
  entryPrice: number | null;       // planned (Thesis.entryPrice)
  avgCost: number | null;          // actual fill (Position.avgCost) — wins if present
  targetPrice: number | null;
  stopLoss: number | null;
  current: number | null;          // live quote
  addedAt?: string | null;         // Thesis.createdAt — vertical "added" marker
  enteredAt?: string | null;       // Position.openedAt — vertical "entered" marker
  events?: Array<{ date: string; kind: 'REVIEWED'|'TRIGGER'|'STATUS'; label?: string }>;
  variant: 'full' | 'compact';     // full = sheet/trade page; compact = card
};
```

- **Horizontal lines** built from `{entryPrice|avgCost, targetPrice, stopLoss}` —
  identical to today's `chartReferenceLines`, just centralized.
- **Vertical markers** from `addedAt` / `enteredAt` / `events`, snapped to nearest
  candle date.
- `variant:'compact'` hides axis labels, range pills, and the event marks (only
  add/entry), and shrinks to a sparkline-with-target band.

### 5.3 The three surfaces

| Surface | Variant | Source of props | Notes |
|---|---|---|---|
| **Thesis sheet** ([`ThesisSheet.tsx`](components/agent/sheets/ThesisSheet.tsx)) | `full` | `sheetState` / `/triggers` already loaded; add a candles fetch on open (single symbol, cached) | Sits where `PriceTargetsBlock` is now, or above it. Full markers + ranges. |
| **Thesis cards / list** ([`thesis-row.tsx`](components/ui/thesis-row.tsx)) | `compact` (Sparkline) | `ThesisRowData` already has entry/target/stop/createdAt/currentPrice; add `candles` from the **batched** fetch | The Tier-1 win. ≤20 names, 1 batched fetch. |
| **Trade detail / stock overview** ([`trades/[id]/page.tsx`](app/(root)/trades/[id]/page.tsx)) | `full` | the page already fetches `candles` + builds `chartReferenceLines` | Replace the inline `referenceLines` with `ThesisChart`, gaining the vertical add/entry markers it lacks today. |

### 5.4 Degradation ladder (explicit)

1. **Full data + candles** → annotated `ThesisChart` (lines + add/entry markers).
2. **Candles present, no entry yet** (WATCHING) → chart with target/stop lines +
   "added" marker only; no entry line. "Watchlist-only" framing.
3. **No candles** (thin ticker / no Alpaca creds / `[]`) → **fall back to
   [`PriceTargetsBlock`](components/domain/price-targets-block.tsx)** gauge. Same
   entry/target/stop/current story, no time axis. This is why the gauge stays.
4. **No target/stop either** (bare watch, `direction=null`) → sparkline + last price
   only, or the row's existing text. Never render an empty chart frame.

The component picks the rung; callers just pass what they have.

---

## 6. Phasing

### Tier 1 — cheap, high-leverage (recommended start)
- `getStockCandlesBatch()` + a **`Sparkline`** on each `ThesisRow` (compact variant),
  with a small **target/stop band** tint behind it so "tracking to target" reads at a
  glance. Fallback: the gauge / existing row when candles are `[]`.
- **Why first:** one batched fetch, no schema change, and it directly attacks the
  "I can't tell what's doing well at a glance" complaint on the card list.

### Tier 2 — full annotated `ThesisChart`
- Extract the marker/line computation into `ThesisChart(variant:'full')`; wire it
  into the sheet and the trade/stock page (the trade page *gains* vertical add/entry
  markers it doesn't have today).
- **Why second:** more surface area (sheet fetch, label-collision handling), but
  reuses Tier-1's batch fetch and the existing Recharts chart.

### Tier 3 — optional polish (only if validated by use)
- Event marks (reviews / trigger fires) from `ThesisUpdate`, behind a toggle.
- Optional `ThesisUpdate.priceAtTime` capture on `CREATED` so the gauge fallback can
  print "added at $X" without candles.

**Recommendation: ship Tier 1, live with it for a week, then Tier 2.** Tier 1 is
where the legibility payoff is highest per line of code.

---

## 7. Broader: making WATCHING / HOLDING / PASSED / RETIRED legible

The chart answers "*how is this one name tracking?*" It does **not** answer the
portfolio-level questions the principal actually asked:

> what's doing well · what I'm WATCHING that I wish I'd bought · what I PASSED on that
> I'm glad I avoided vs. regret · what I'm HOLDING and how it's tracking to target.

Those are **scoreboard** questions. Three concrete directions (not mutually
exclusive — 7A is the floor, 7B/7C are the ceiling).

### 7.0 — What the screenshots actually show (and where our data already fits)

| Perplexity element (observed) | Detail | Our analogue / data |
|---|---|---|
| **Standouts cards** (shot 1) | logo · name · ticker·exchange, big price, red/green %-pill, **mini intraday line with a dashed "Prev close" reference line + callout**, right stats column (Volume/Mkt Cap/P/E/Div Yield), and a **per-card catalyst paragraph** | Maps to **7B**. The dashed "Prev close" line is *exactly* our entry/target/stop reference-line pattern on a small chart — confirms the compact `Sparkline` should carry ≥1 reference line. The catalyst paragraph = our latest `ThesisUpdate.summary` / `Thesis.snapshot`. |
| **Narrative market summary** (shot 2, top) | prose with **bolded tickers + inline %-pills**, "62 sources", "Updated 14 seconds ago" | This is the **Portfolio Summary / post-run brief** home (§8). We already generate narrative; the durable-state read-model produces this, with a sources count + freshness stamp. |
| **Watchlist table** (shot 2) | sortable columns **Price · 1D · 5D · 1M · 6M**, colored % per cell, logo+name+ticker rows | Maps to **7A**, but calendar-window. We can render the same table *and* offer thesis-anchored columns (since-added / since-entry). See 7A. |
| **Compare chart** (shot 3) | **normalized % multi-series**, range pills 1D…MAX + Compare, per-series legend rows (color border, logo, price, $Δ, %-pill, ✕) | Maps to **7C** almost verbatim. |
| **"Notable Price Movement" timeline** (shot 3) | **dated vertical entries** (Jun 15 / Jun 12), each = price + %-at-close/after-hours + **narrative paragraph + "10 sources"** | **New insight — near-free for us.** This is a 1:1 render of **`ThesisUpdate` rows**: `timestamp`, `priceAtTime`, `summary`/`rationale`, `signalIds` (→ source count). See 7D. |

The takeaway: every Perplexity element has a backing field in our model already. The
two highest-value, lowest-cost adaptations are **7A** (table/scoreboard) and **7D**
(the ThesisUpdate timeline) — 7D wasn't in the original brief but the screenshot makes
it obvious and it's mostly a render of data we persist on every run.

### The three+one directions

### Direction 7A — Status-segmented card view with a "regret/relief" column (smallest)
Group the existing rows by the new taxonomy and add **one computed column per
status** that encodes the judgment the principal wants:

| Status | The question | Computed signal (data we have) |
|---|---|---|
| **HOLDING** | tracking to target? | % of the way from entry→target (the gauge math), + unrealized P&L. Sort by distance-to-target. |
| **WATCHING** | wish I'd bought? | **"shadow return"** = % move since `Thesis.createdAt` (candle lookup). Green = "it ran without you" (FOMO), red = "glad you waited." |
| **PASSED** | glad / regret? | same shadow return since the PASS timestamp (`ThesisUpdate`). Green-up = regret (it ran), red-down = relief (you dodged it). |
| **RETIRED** | was it right? | realized P&L (if it was held → SOLD) or shadow return since `retiredReason`-stamped exit. |

- **Adapts the Perplexity 1D/5D/1M/6M % columns** → but anchored to *our* dates
  (added / passed / entered), which is more meaningful than calendar windows for a
  thesis tracker. Could offer both.
- Pure presentation + a shadow-return helper over candles. No schema change.
- **Tradeoff:** still a list; doesn't give the "market narrative" feel.

### Direction 7B — "Standouts" board (Perplexity-style, adapt the mini-chart cards)
A top strip of **a few auto-selected cards** with Tier-1 sparklines — the analyst's
*notable movers*, chosen by us, not alphabetical:
- "Biggest regret" (best WATCHING/PASSED shadow return), "Best dodge" (worst PASSED
  move avoided), "On deck" (WATCHING closest to entry trigger), "Tracking well"
  (HOLDING nearest target), "At risk" (HOLDING nearest stop).
- Each is a Tier-1 `Sparkline` card + one sentence. This is the direct analogue of
  Perplexity "Standouts," but the selection logic is *thesis-aware*.
- **Tradeoff:** needs a small ranking function and editorial choices about which 4–6
  buckets to show; risks feeling busy if every status competes for the strip.

### Direction 7C — Watchlist-movers comparison chart (adapt the multi-line compare)
One **multi-series chart** that overlays several WATCHING/HOLDING names normalized to
% from their add/entry date — the "compare my names on one timeline" view.
- Good for "of everything I'm watching, what's running?" in a single glance.
- Reuses the candle batch; normalization is `(close/closeAtAnchor - 1)`.
- **Tradeoff:** >5–6 series gets unreadable; needs series selection/legend. Best as a
  *secondary* tab, not the default.

### Direction 7D — "Notable movement" timeline on the sheet (new, from shot 3 — nearly free)
Perplexity's dated "Notable Price Movement" feed is, for us, just a chronological
render of **`ThesisUpdate`** for one thesis:
- Each row already has `timestamp`, `priceAtTime`, `summary` (the headline line),
  `rationale` (the expanded paragraph), and `signalIds` (→ a "N sources" chip). The
  schema comment on `ThesisUpdate.summary` literally says *"feeds the timeline list
  view"* — this view was anticipated.
- Drop it into the **ThesisSheet** under the chart: the price chart shows *where* the
  thesis went; the timeline shows *what we said and when* (REVIEWED / TRIGGER_FIRED /
  STATUS_CHANGED / CLOSED), each anchored to the price at that moment.
- Pairs with Tier-2 vertical markers: a marker on the chart = an entry in the timeline.
- **Tradeoff:** almost none — it's a list render of existing rows. The only judgment
  is which `type`s to show by default (probably hide bare REVIEWED-no-change rows
  behind a "show all" toggle to avoid noise).

**Recommendation for §7:** do **7A** as part of Tier 1 (mostly the same sparkline + a
shadow-return helper; highest-signal change) and **7D** alongside Tier 2 (it rides on
the same sheet work and is nearly free), then **7B** as the marquee once Tier-1
sparklines exist. Treat **7C** as an optional power-user tab.

> **Taxonomy hygiene:** all of the above must read the **new** statuses
> (HOLDING/PASSED/RETIRED + `retiredReason`) — not the legacy ACTIVE/ARCHIVED/`direction=PASS`
> paths the migration is retiring (GAPS P1-24, the in-flight B-series PRs). The
> "Pass lives on `direction`, surfaces disagree" bug (P1-24) is exactly the kind of
> thing a status-segmented view will surface loudly, so build on the post-B
> taxonomy.

---

## 8. Folding in the post-run brief (GAPS P1-23) → a Portfolio Summary surface

[GAPS P1-23](docs/GAPS.md) flags that the post-run `AnalystBriefing` no longer fits
the 3-agent (daily / tactical / discovery) model: it's written only after the daily
run, read only by the next daily run, reads only the last 1, and is blind to tactical
+ discovery activity.

**The connection:** §7's "market narrative + standouts" surface is the natural new
home for that content. Rather than a per-run standup buried in the daily prompt, a
**Portfolio Summary** surface (dashboard header or its own panel) renders:

- A **Perplexity-style narrative paragraph** — "Today: 3 holdings tracking to target,
  AMD hit its stop, 2 watchlist names you flagged last week are up 8%+, discovery
  added SMCI." Generated from the *durable state* (theses + positions + ThesisUpdate),
  **not** a per-agent memory blob — so it's inherently fed by tactical + discovery
  activity, which is the exact P1-23 complaint.
- The **Standouts board** (7B) underneath it.
- The **status-segmented scoreboard** (7A) as the detail view.

This reframes P1-23 from "fix the briefing's plumbing" to "the briefing was a
*read-model over durable state*; render it as one." Two options:

- **8-i (recommended): kill the stored briefing as run-to-run memory; derive the
  summary on read.** The narrative becomes a server-computed view over
  Thesis/Position/ThesisUpdate (which already span all three run types). Solves
  P1-23's "blind to tactical/discovery" *and* "reads only the last 1" in one move,
  because there's no stored blob to be stale.
- **8-ii: keep a stored briefing but make it a rolling, all-run-type digest** (ingest
  tactical + discovery, read last N). More faithful to the original design, but keeps
  the staleness/coupling that P1-23 is unhappy about.

**Recommendation:** 8-i. The chart/scoreboard work *is* the read-model; the briefing
becomes a narration of it. This is a separate doc/PR from the chart, but they should
be designed together because they share the candle/shadow-return data layer.

> Flagged, not assumed: §8 changes agent-memory behavior and touches a real-money
> trading loop. It needs its own design sign-off (and a check that nothing else
> depends on `AnalystBriefing` as durable memory) before any code. This doc only
> argues the *shape*.

---

## 9. Recommended path (sequenced)

1. **Tier 1 + 7A** — `getStockCandlesBatch()`, `Sparkline` on `ThesisRow`, shadow-return
   helper, status-segmented grouping with the regret/relief column. *(no migration)*
2. **Tier 2 + 7D** — extract `ThesisChart(full)`; wire into the sheet and the
   trade/stock page (trade page gains add/entry vertical markers). Add the **7D
   ThesisUpdate timeline** under the chart on the sheet (a render of existing rows).
   Gauge stays as the no-candle fallback. *(no migration)*
3. **7B Standouts board** on the dashboard, reusing Tier-1 sparklines + the ranking fn.
4. **Portfolio Summary / P1-23 (8-i)** — separate design sign-off; derive narrative
   from durable state. Optional `ThesisUpdate.priceAtTime`-on-CREATE capture lands
   here if we want candle-free "added at $X".
5. **7C compare chart** — optional power-user tab, only if 7A/7B leave a gap.

## 10. Open questions for the principal

1. **Watchlist-add semantics:** is "added" = `Thesis.createdAt` good enough, or do you
   want the distinct "watched, *then* researched/entered" two-mark story (we can do
   both — `createdAt` + `openedAt` — but it's more visual clutter)?
2. **Shadow-return anchor for PASSED:** measure regret/relief from the PASS timestamp
   (when you decided) — agreed? Or from thesis `createdAt`?
3. **Default range** for the card sparkline — fixed short window (e.g. 1M) or
   anchored to "since added"? The latter is more meaningful but variable-width.
4. **Standouts buckets (7B):** which 4–6 do you actually want on the marquee? (regret
   / best-dodge / on-deck / tracking-well / at-risk / biggest-mover…)
5. **P1-23:** OK to treat the briefing as a derived read-model (8-i) rather than
   stored memory? That's the higher-leverage but more opinionated call.

---

*No feature code accompanies this doc. File paths and fields above were read from the
current tree (2026-06-15) — `StockPriceChart.tsx`, `trades/[id]/page.tsx`,
`finnhub.actions.ts`, `thesis-row.tsx`, `portfolio.actions.ts`, `prisma/schema.prisma`,
`docs/GAPS.md` — so the feasibility call is grounded, not hand-wavy.*
