# Thesis Sheet Cleanup — handoff

**Goal (operator's words):** "A normal sheet. A sheet that renders the fields.
From the same database. At the same time. And only shows stuff that's
conditional when it makes sense, with minimal complexity and logic and
statements and duplicate code."

This doc is the grounded map for a fresh session to do that. Everything below
was read out of the code on 2026-06-02, not from memory.

Component: `components/agent/sheets/ThesisSheet.tsx` (`ThesisSheetBody`).

---

## 1. Where the data lives

A thesis sheet is assembled from **three tables**, joined by different keys:

- **`Thesis`** — the durable analysis object. Keyed by `id`.
- **`Position`** — the trade. Joined by `(accountId, analystId = thesis.researchRun.agentConfigId, symbol = ticker, status)`. **Not** a FK on Thesis — it's a soft join through the analyst + ticker. A thesis can have 0 or 1 relevant position.
- **`Order`** — the pending proposal. `Position.orders` where `status = 'AWAITING_APPROVAL'`, newest first. 0 or 1 relevant.

There is **no single "thesis view" query.** The sheet stitches these client-side.

---

## 2. Thesis fields — always vs conditional

### Always present (schema non-null or always written)
`id`, `researchRunId`, `userId`, `accountId`, `ticker`, `source`
(`AGENT|MANUAL`), `direction` (`LONG|SHORT|PASS|PENDING`), `holdDuration`,
`modelUsed`, `status` (`ThesisStatus`), `triggers` (`@default("[]")`),
`keyAssumptions`/`invalidationConds`/`sourceSignalIds` (`@default([])`),
`createdAt`, `updatedAt`.

### Conditional (nullable — set by a specific flow)
| Field | Set when |
|---|---|
| `entryPrice`, `targetPrice`, `stopLoss` | a trade plan is recorded; null on early/PASS |
| `sector` | optional metadata |
| `horizon` (`CATALYST|TARGET|TRADE|COMPOUNDER`) | durable theses; null on legacy / PENDING seeds |
| `catalystDate` | `horizon=CATALYST` only |
| `maxHoldDays` | `horizon=TRADE` only |
| `nextReviewAt` | housekeeping schedule |
| `coreBelief` | the durable claim; null until the V2 writer runs |
| `targetSizePct`, `scalingPlan` | position-sizing plan; conditional |
| `closedAt`, `closeReason` | **`status=CLOSED` only** |
| `invalidatedAt`, `invalidReason` | **`status=INVALIDATED` only** |
| `scoring` (4-dim composite) | directional theses post-scoring; null on PASS/PENDING/legacy |
| `conviction`, `convictionRationale` | LONG/SHORT via Layer-1 gate; null on PASS/PENDING/legacy |
| `variantView` | required only when `conviction ∈ {STRONG, HIGH}` |
| 9 narrative sections (`snapshot`, `recentCatalysts`, `fundamentals`, `latestEarnings`, `catalystsAndEvents`, `bullCase`, `bearCase`, `analystConsensus`, `insiderTechnical`) | V2 writer; PASS theses usually only `snapshot`+`bearCase`; legacy rows have only the 3 retyped sections |
| `researchData`, `researchUpdatedAt` | V2 research artifact + staleness gate |
| `sourceKind`, `sourceRationale` | provenance; null on legacy |
| `parentThesisId` | only when this thesis superseded a prior one |
| `promotedAt`, `paperTenureDays`, `paperRealizedPnl`, `paperReviewCount` | **only after a PAPER→LIVE promotion** |
| `fullResearch`, `revalidationTriggers`, `thoughtTrace` | **legacy** — superseded; kept for migration/audit |

### `(direction, status)` legal pairs
See `docs/THESIS_ARCHITECTURE.md` for the canonical state machine. The sheet
only needs: `status ∈ {ACTIVE, WATCHING, CLOSED, INVALIDATED, ARCHIVED}` and
`direction ∈ {LONG, SHORT, PASS, PENDING}`.

---

## 3. Position / Order fields the sheet uses

**Position** (always when a position exists): `quantity`, `avgCost`,
`openedAt`, `status` (`PENDING_APPROVAL|OPEN|CLOSED|CANCELLED`), `direction`.
**Closed-only:** `closePrice`, `closedAt`, `closeReason`, `realizedPnl`,
`outcome`. **Pending buy:** `status=PENDING_APPROVAL`, `avgCost = args.entry_price`
(the intended entry, set by `place_trade`).

**Order (pending proposal)** — present only when an `AWAITING_APPROVAL` order
hangs off the position: `id` (→ orderId), `intent` (`OPEN|ADD|CLOSE|PARTIAL_CLOSE`),
`quantity`, `expiresAt`, `rationale`.

---

## 4. The actual problem: a 4–5 way fetch fan-out landing at different times

This is the root of every flash/duplicate/"loads at different times" bug. The
sheet does **not** load "from the same database at the same time." It fires:

| # | Source | Sets | Provides | Timing |
|---|---|---|---|---|
| 0 | `initialState` prop (optional) | `state` | a pre-fetched `/triggers` payload | sync, often absent |
| 1 | `GET /api/theses/[id]/triggers` | `state` | **all Thesis fields** + `position` (+`pendingProposal`) + `scoring` + `resolved` envelope. Internally runs 2 more queries: supersession SQL **+ a Finnhub quote** | async, ~main payload |
| 2 | `GET /api/theses/[id]/quote` | `quote` | `currentPrice`, `dayChange`, `dayChangePct`, `positionPnl` (unrealized). **A SECOND Finnhub call** | async, separate |
| 3 | `GET /api/theses/[id]/analyst-coverage` | `coverage` | consensus buy/hold/sell + price targets (fresh FMP/Finnhub) | async, separate |
| 4 | `GET /api/theses/[id]/updates?limit=50` (inside `ThesisTimelineSection`, self-fetch) | its own `updates` | the activity-log rows | async, lazy |

`ThesisTriggersSection` also *can* self-fetch (it has an `internalData` fallback)
but is currently fed `data={state}`, so it doesn't add a 6th call today.

### Symptoms this fan-out causes
- **Flashes / swaps.** `liveStatus = state?.status ?? status` resolves to the
  *prop* status on first paint and the *fetched* status later. Anything gated on
  a field that arrives in a different payload than the field that gates it will
  flash. (The CLOSED "Position closed" banner flash was exactly this:
  `liveStatus==="CLOSED"` instantly, `position` only after call #1.)
- **Tri-state ternaries everywhere.** Almost every block is
  `state?.X ? <real/> : stateLoading ? <Skeleton/> : null` because each field
  lands at an unknown time. ~6 separate skeletons.
- **Redundant live-quote calls.** #1 fetches a Finnhub quote for `resolved`;
  #2 fetches another for `positionPnl`/day-change. Overlapping data, two calls.
- **Two homes for one state (the recurring class of bug).** `TerminalStatusAlert`
  and `TradeBlock` both rendered the CLOSED state from two payloads
  (#1.position vs #1.closeReason) — fixed 2026-06-02 by making the banner
  CLOSED-blind, but the *pattern* (decide which of two components owns a state)
  keeps reappearing.

### Defensive-normalization debt (orthogonal, but adds logic noise)
- `scoring` is read from top-level `scoring` **or** legacy `fullResearch.scoring`.
- The 9 narrative sections accept **camelCase or snake_case** keys **and**
  string-or-object value shapes (`ResearchSectionsAccordion` normalizes both, or
  the sheet crashes — see the comment block at ~line 902).

---

## 5. Render order today (top → bottom)

`StatusPill` + `ConvictionBadge` → `TerminalStatusAlert` (now INVALIDATED/ARCHIVED
only) → stock identity + live price → **`TradeBlock`** (the one trade state:
pending-buy / holding / closed / pending-sell — all in one container now) →
`coreBelief` headline → `ThesisTriggersSection` → snapshot → Scoring (4-dim) →
`PriceTargetsBlock` → `TradeStructureBlock` (target/stop/horizon live here) →
`VariantViewBlock` → Key Assumptions → Invalidation Conditions →
`ResearchSectionsAccordion` → `ThesisTimelineSection` (activity log).

---

## 6. Target architecture

1. **One server-resolved view model.** Build a single endpoint (or a server
   component) that does all three joins server-side and returns a fully-resolved
   object: thesis fields + position + pendingProposal + live price + pnl
   (+ coverage if cheap). One Finnhub call, reused. The client renders it in
   one pass.
2. **Render a field iff it's present.** One consistent rule (`value != null →
   show`). No tri-state skeleton ternaries scattered per block — if you must show
   loading, one top-level skeleton for the whole sheet while the single fetch is
   in flight.
3. **One source of `status`.** Never `prop ?? fetched`. The view model is the
   only truth → no flash.
4. **One component per state.** Already true for the trade state (`TradeBlock`).
   Audit the rest for the "two homes" pattern.
5. **Kill the redundant quote call.** `/triggers` already fetches a quote; fold
   `positionPnl`/day-change into the same payload.
6. **The activity timeline (`/updates`) is the ONE acceptable async island** —
   it's a large, genuinely independent log. Keep it lazy; everything else should
   arrive together.

### Explicitly do NOT
- Do **not** add a 6th renderer (see CLAUDE.md "Never invent per-tool renderers").
- Do **not** "hide" a duplicate component to fix a flash — remove the duplication
  at the source (the lesson from the CLOSED banner).
- Do **not** keep `prop ?? fetched` status derivation.

---

## 7. Already shipped on branch `claude/thesis-sheet-proposal-prompt` (PR #373)
- `TradeBlock` collapsed to ONE container + 4 slots; all states (pending-buy,
  pending-sell/add/trim, holding, closed) render through identical JSX.
- `TerminalStatusAlert` no longer handles CLOSED (returns null for it); only
  INVALIDATED/ARCHIVED. The "Position closed" title string is gone.
- `/triggers` route returns closed-position data (`closePrice`, `realizedPnl`,
  `realizedPnlPct`, `closeReason`) so the closed state renders in `TradeBlock`.

This PR fixed the *symptoms* for the closed state. Section 4–6 above is the
*structural* cleanup that hasn't been done.
