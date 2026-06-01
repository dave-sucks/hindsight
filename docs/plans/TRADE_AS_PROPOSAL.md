# Hindsight — Trade-as-Proposal

> **Status (as of 2026-05-31):** Proposed. Step 1 (schema) starting now.
>
> **What this is:** the design that turns Hindsight from "agent auto-executes trades" into "agent proposes; user approves." Every agent-initiated buy or sell becomes an `Order(status=AWAITING_APPROVAL)` that waits on a one-click human decision before submitting to Alpaca. Manual UI actions and system auto-stops bypass the gate. The promotion flow is untouched.
>
> **The build path:** ~9.5 calendar days total. Backend + chat + email ships in the first ~5 days and is enough to re-enable the LIVE analyst; the remaining UI surfaces + the expiry cron + a small tech-debt cleanup follow.
>
> **Owner:** principal. **Audience:** future sessions picking this up cold.
>
> **Related docs:**
> - [`docs/THESIS_ARCHITECTURE.md`](../THESIS_ARCHITECTURE.md) — live thesis system reference; this plan is additive
> - [`docs/PRINCIPLES.md`](../PRINCIPLES.md) — three-layer principle; rejection-feedback bullet lives in the prompt layer
> - [`docs/plans/PROD_DEPLOYMENT_PLAN.md`](./PROD_DEPLOYMENT_PLAN.md) — PAPER↔LIVE environment split; this composes cleanly with it
> - [`docs/TEAM_ACCESS_PLAN.md`](../TEAM_ACCESS_PLAN.md) — Account model + memberships; the two new settings live on `Account`

---

## 0. Status table

| Phase | Title | Calendar | Status |
|---|---|---|---|
| **1** | Prisma schema delta + migration | 0.5 day | Not started |
| **2** | `place_trade` proposal branch | 0.5 day | Not started |
| **3** | `manage_position` add / partial_close / full_close branches | 0.5 day | Not started |
| **4** | `closeOpenPosition()` approval gate | 0.5 day | Not started |
| **5** | Approve + reject API routes | 1 day | Not started |
| **6** | Chat renderer (resurrect `TradeConfirmation`) | 1 day | Not started |
| **7** | Email on proposal-created | 0.5 day | Not started |
| **— ✅ LIVE re-enable possible —** | | | |
| **8** | /trades PROPOSED tab + mobile fixes | 2 days | Not started |
| **9** | Homepage activity feed surface | 1 day | Not started |
| **10** | Thesis sheet alert block | 0.5 day | Not started |
| **11** | Expiry cron + `ThesisUpdate` audit type | 1 day | Not started |
| **12** | Daily-run prompt — one rejection-handling bullet | 0.5 day | Not started |
| **13** | Delete `intraday-eod-flatten` cron | 0.5 day | Not started |

**Total:** ~9.5 calendar days for fully wired. After step 7, PEAD can be re-enabled LIVE with approval gates live.

---

## 1. Why this exists

Hindsight was designed as a fully-autonomous AI trading platform: 5 AI analysts, each running its own portfolio, each calling `place_trade` / `close_position` directly into Alpaca with no human in the loop. The principal recently promoted one analyst (PEAD Specialist) to LIVE and put real money in it (~$2k across MRVL + TSM).

The principal's spouse just took a new job that requires the principal to disclose every stock trade BEFORE it is placed. Fully-autonomous execution is no longer compatible with the principal's life. The LIVE analyst is currently paused (`AgentConfig.enabled = false`, PR #359). Existing positions stay open and stop-managed; no new entries can fire.

This plan is the pivot: every position the agent wants to open, close, add to, or trim becomes a **proposal** awaiting human approval. The agent still does the research, writes the thesis, scores conviction — the final "submit order to Alpaca" step waits on a one-click human decision. Arguably a better product. Sequoia partners don't auto-execute their analysts' picks; they read the memo and hit approve.

---

## 2. The mental model

**Four agent verbs map to existing tools** (no consolidation needed):

| Verb | Tool today | Risk direction |
|---|---|---|
| Buy (open new) | `place_trade` | Increases exposure |
| Add (increase) | `manage_position(action='add_to_position')` | Increases exposure |
| Close (full exit) | `close_position` | Decreases exposure |
| Shorten (partial exit) | `manage_position(action='partial_close' / 'full_close')` | Decreases exposure |

**Two Account-level toggles:**

- `Account.requireApprovalForBuys` — gates Buy + Add
- `Account.requireApprovalForSells` — gates Close + Shorten

Defaults: both `false`. The single user (Dave) sets both `true` on his Account once the rollout is live. The toggles are independent — Dave can require approval for buys only, sells only, both, or neither.

**Manual actions bypass the gate.** Clicking a buy/sell button in the UI IS the approval; you don't approve your own click. Implementation: the gate only fires when the calling source is `"agent"`. Future manual-trade APIs call the same downstream helpers with `source="user"`.

**System actions also bypass the gate.** The `price-monitor` trailing-stop cron auto-closes at `source="price_monitor"`. The user already approved the stop at trade-entry time; making the auto-close wait for live approval defeats the safety mechanic.

**Promotion is untouched.** `promote-analyst` PAPER↔LIVE has its own manual flow that closes positions on demote. Out of scope here.

---

## 3. What is NOT changing

| Out of scope | Why |
|---|---|
| Per-analyst approval flag | Account-level is simpler and more correct. You'd never want some analysts gated and others not in the same account. |
| Multi-tenant approval workflows | Single approver, single user product. |
| Compliance / disclosure UI | The principal's disclosure to the spouse's compliance team is a separate human workflow. |
| Multi-proposal coordination ("approve A auto-rejects B") | Phase 4+ if it becomes necessary. |
| Manual buy/sell UI | Designed-for (approval-bypass-on-manual is real), but the UI is its own workstream. |
| Alpaca-native stop-limit orders | `price-monitor` polling stays; native stops is a separate architectural change. File for later. |
| `promote-analyst` flow | Already manual, sells positions on demote, untouched. |
| `reconcile-orders` cron | Load-bearing defensive infra for the DB-first pattern. Don't delete. |
| `manage_position` update_targets / move_stop_to_breakeven / set_trailing_stop | DB-only updates to Position fields; no Alpaca call. Auto-execute always. |
| `cancelPosition` | Manual button to cancel a pending Alpaca entry order. User-initiated, no gate. |

---

## 4. Data model

Three schema changes. **No new entity.**

### 4.1 `Account` — two boolean settings

```prisma
model Account {
  // ... existing fields
  requireApprovalForBuys  Boolean @default(false)
  requireApprovalForSells Boolean @default(false)
}
```

Why on `Account` and not `User`: every Position already scopes to `accountId`; the multi-tenant model exists; settings should follow the same scope so a future EDITOR / VIEWER membership inherits the same gates.

### 4.2 `Order` — new status + 3 new fields

```prisma
model Order {
  // ... existing fields
  status            String     // adds "AWAITING_APPROVAL", "EXPIRED" to existing { PENDING, FILLED, CANCELLED, REJECTED }
  expiresAt         DateTime?  // set at proposal time to now + Account.proposalExpiryHours (default 24h)
  rejectionMessage  String?    // optional user message on reject
  rationale         String?    // agent's "why" — shown in the approval UI
}
```

The existing `intent` field already encodes our four verbs (`OPEN` / `ADD` / `CLOSE` / `PARTIAL_CLOSE`). No new enum needed.

### 4.3 `Position` — new transient status

```prisma
model Position {
  // ... existing fields
  status String  // adds "PENDING_APPROVAL" to existing { OPEN, CLOSED, CANCELLED }
}
```

A new Buy proposal creates `Position(status='PENDING_APPROVAL', quantity=proposed_qty, avgCost=proposed_entry_price)` so the Position carries the trade parameters (symbol, direction, targets, stops) from proposal time. On approve → `OPEN` and `avgCost` updates to the real Alpaca fill price. On reject / expire → `CANCELLED`. Close proposals do NOT change Position.status — the Position stays `OPEN` until the close fills.

**Heartbeat impact:** the `sync-heartbeat` cron's "staleDbNotInAlpaca" check must filter out `PENDING_APPROVAL` positions; they don't exist at Alpaca yet by design.

**`get_portfolio_context` impact:** filter `PENDING_APPROVAL` out of the "open positions" the agent sees. Surface them in a separate "awaiting your approval" list so the agent doesn't try to manage what isn't real yet.

**Query-site sweep:** grep `status: "OPEN"` across the codebase and update each site to either include `PENDING_APPROVAL` (rare — only the agent's "awaiting" view) or exclude it explicitly (most sites — portfolio summary, price-monitor, /trades Open tab). Expect 5-8 sites.

### 4.4 Migration mechanics

- New `String` columns, no Prisma enums (matches existing convention — see `Order.status`, `Position.status` today).
- Default `false` on the two `Account` booleans. Default `null` on the three new `Order` fields.
- No backfill needed. Existing Orders and Positions don't change.
- Single Prisma migration named `add_trade_proposal_state`.

---

## 5. Code changes — the seven files

### 5.1 `place_trade` (Buy / new entry) — `lib/agent/tools/place-trade.ts`

After all Layer-1 gates pass (currently at lines 98-408), branch on the Account setting:

- **OFF (today's behavior):** create Position(OPEN) + Order(PENDING), submit Alpaca. Unchanged.
- **ON (new):** create Position(PENDING_APPROVAL) + Order(AWAITING_APPROVAL, expiresAt = now+24h, rationale = the agent's argument). Skip Alpaca. Return tool result with `ui:"trade-proposal"` payload.

The cleanest refactor extracts the post-gate / pre-Alpaca section of the existing function into a `submitTradeToAlpaca(orderId)` helper that the approve handler also calls — avoid duplicating ~200 lines.

### 5.2 `manage_position add_to_position` (Add) — `lib/agent/tools/manage-position.ts:541-776`

Same shape. Branch on `Account.requireApprovalForBuys` (it is risk-increasing).

**Tag-along fix:** this path currently bypasses every `place_trade` Layer-1 gate (PR #359's `enabled=false` check included — that's the live gap surfaced by Phase 1 discovery). Add the gate checks here too while we're modifying the file. List below in §13.

### 5.3 `close_position` tool — `lib/agent/tools/close-position.ts`

The tool calls `closeOpenPosition(source="agent")`. The gate lives in the helper (§5.5 below). The tool itself does not change.

### 5.4 `manage_position partial_close / full_close` (Shorten / Close) — `lib/agent/tools/manage-position.ts:204-538`

Branch on `Account.requireApprovalForSells`. Create `Order(AWAITING_APPROVAL, intent='CLOSE' or 'PARTIAL_CLOSE')`. Position stays OPEN.

### 5.5 `closeOpenPosition()` shared helper — `lib/actions/closeTrade.actions.ts:105`

```ts
export async function closeOpenPosition(
  positionId: string,
  reason: "TARGET" | "STOP" | "TIME" | "MANUAL",
  alpacaCreds?: AlpacaCredentials | null,
  source: CloseSource = "agent",
  auditReason?: string,
  runId?: string,
): Promise<ClosedPositionResult> {
  const position = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
  if (position.status !== "OPEN") {
    throw new Error(`Position ${positionId} is not OPEN (status: ${position.status})`);
  }

  // ── NEW: approval gate (agent only)
  if (source === "agent") {
    const account = await prisma.account.findFirstOrThrow({
      where: { /* via position.accountId */ },
      select: { requireApprovalForSells: true },
    });
    if (account.requireApprovalForSells) {
      const proposalOrder = await createProposalCloseOrder(position, reason, runId);
      await sendProposalEmail(proposalOrder);
      return { /* ProposalPendingResult — caller's tool envelope renders "awaiting" */ };
    }
  }

  // ── EXISTING: the full close path runs unchanged for user / price_monitor / approved agent
  // ... lines 121-453 unchanged
}
```

`source="user"` and `source="price_monitor"` skip the gate entirely. Surgical.

### 5.6 Approve API route — `app/api/proposals/[orderId]/approve/route.ts` (new)

1. **Auth check** — calling user must own the Account that owns the Order's Position.
2. **State check** — `Order.status === 'AWAITING_APPROVAL'` and `Order.expiresAt > now()`.
3. **Re-run minimal gates** — price-freshness (quote may be stale), slot count, Alpaca buying power. On violation: return the violation reason; do NOT flip the Order; user can re-request from the agent.
4. **Dispatch on intent:**
   - `intent='OPEN'`: flip Position to `OPEN`, then call `submitTradeToAlpaca(orderId)` (the helper extracted from `place_trade`).
   - `intent='ADD'`: call `submitAddToAlpaca(orderId)`.
   - `intent='CLOSE'` / `intent='PARTIAL_CLOSE'`: call the existing post-gate close flow from `closeOpenPosition`.
5. **Status transitions:** Order `AWAITING_APPROVAL → PENDING`. The existing post-submit polling code expects `PENDING` and runs unchanged from there.
6. **Write audit:** `ThesisUpdate(type='PROPOSAL_APPROVED', fieldChanges={ proposalOrderId, approvedAt }, rationale=null)`.
7. Return success.

### 5.7 Reject API route — `app/api/proposals/[orderId]/reject/route.ts` (new)

1. Auth + state checks as above.
2. Update `Order(status='REJECTED', rejectionMessage = body.message ?? null)`.
3. If `intent='OPEN'`: also `Position(status='CANCELLED')`.
4. Write `ThesisUpdate(type='PROPOSAL_REJECTED', fieldChanges={ proposalOrderId, rejectedAt, proposalSnapshot }, rationale = body.message ?? "[REJECTED:USER] No reason provided.")`.
5. Return success.

The agent reads the rejection on its next run via `get_theses(include_history: true)` — same mechanism the prompt already uses for PASS theses.

### 5.8 Expiry cron — `lib/inngest/functions/proposal-expiry.ts` (new)

Runs every 30 min Mon-Fri 4 AM-8 PM ET (mirrors `reconcile-orders` cadence). For each `Order(status='AWAITING_APPROVAL', expiresAt < now())`:
- Update `Order(status='EXPIRED')`.
- If `intent='OPEN'`: also `Position(status='CANCELLED')`.
- Write `ThesisUpdate(type='PROPOSAL_EXPIRED')`.

The agent reads expired proposals via thesis history and can choose to re-propose if the setup still holds.

---

## 6. UI surfaces — four surfaces, zero new renderers

### 6.1 Chat (live agent + replay) — `components/agent/AgentChat.tsx`

The four tools' result envelopes return `ui:"trade-proposal"` with payload `{ orderId, direction, symbol, qty, notional, entryPrice, targetPrice, stopLoss, rationale, expiresAt }`.

**Resurrect the unused `TradeConfirmation` component** at `components/domain/trade-confirmation.tsx`. It already has `onConfirm` / `onCancel` props and "Awaiting fill" UX wired. Wire it into `ToolUIRenderer` as a new row kind:

```ts
type ToolUIItem = 
  | { kind: "ticker", ticker, tag?, text, actionIcon? }
  | { kind: "generic", text }
  | { kind: "proposal", payload: ProposalPayload, orderId: string };  // NEW
```

The renderer dispatches `kind="proposal"` to `<TradeConfirmation>`. **No new renderer file.** The 5-renderer trading constraint holds.

### 6.2 Homepage activity feed — `components/dashboard/DashboardClient.tsx:395-452`

The current `ActivityRow` shows trades with a hover-revealed kebab. Add a `PROPOSED` activity state with **always-visible** approve/reject buttons replacing the P&L slot. The kebab is hover-only today which is unusable on phone — fix to always-visible while we're touching it.

### 6.3 /trades table — `components/trades/TradesPage.tsx`

Add a `PROPOSED` tab. Same row design as existing trades. Approve/reject buttons inline (not in a hover-revealed kebab). **Fix the sticky-right hover-only kebab and the `hidden lg:block` invisibility on the homepage** — the page is unusable on phone today.

### 6.4 Thesis sheet — `components/agent/sheets/ThesisSheet.tsx`

When the thesis has an associated `Order(AWAITING_APPROVAL)`, surface an "Awaiting Approval" alert block at the top — analogous to the existing `TerminalStatusAlert`. Approve / reject inline.

### 6.5 Email notification

On `Order → AWAITING_APPROVAL`, send an email via the existing `sendEmail` from `lib/email.ts`. New template at `lib/emails/proposal-pending.ts`:

> **PEAD Specialist wants to BUY 100 SMTC**
>
> Target $32 · Stop $28 · Expires in 24h
>
> "EPS beat 9.2%, gross margin expanding..."
>
> [Review and approve in app]

V1 = email only. Push / SMS deferred.

### 6.6 No dedicated /proposals page

Inline buttons everywhere the user already looks (chat, homepage activity, /trades, thesis sheet) matches Hindsight's "surface in existing surfaces" pattern. A dedicated /proposals page is redundant for a single-user product.

---

## 7. End-to-end approval flow — worked example

Scenario: PEAD analyst proposes a Buy on `$SMTC`, 100 shares, target $32, stop $28.

1. **8:05 AM** — Agent calls `place_trade({direction: "LONG", symbol: "SMTC", qty: 100, target: 32, stop: 28, rationale: "EPS beat 9.2%, gross margin expanding..."})`.
2. **8:05 AM** — `place_trade` runs Layer-1 gates → all pass. `account.requireApprovalForBuys === true`. Creates:
   - `Position(id=p_xyz, status='PENDING_APPROVAL', symbol='SMTC', direction='LONG', quantity=100, avgCost=30.10, targetPrice=32, stopLoss=28)`
   - `Order(positionId=p_xyz, intent='OPEN', status='AWAITING_APPROVAL', expiresAt=2026-06-01T08:05Z, rationale="EPS beat 9.2%, gross margin expanding...")`
3. **8:05 AM** — Tool returns `ui:"trade-proposal"`. Chat renders the resurrected `TradeConfirmation` card with Approve / Reject buttons.
4. **8:05 AM** — Email sent to Dave: "PEAD wants to buy 100 SMTC. Target $32, stop $28. Approve in app."
5. **9:47 AM** — Dave opens the app on his phone, sees the proposal in the homepage activity feed, taps Approve.
6. **9:47 AM** — `POST /api/proposals/<orderId>/approve`:
   - Re-runs price-freshness gate. SMTC quote: $30.45 (was $30.10 at proposal). Within tolerance. OK.
   - Re-runs slot count + buying power. OK.
   - Updates `Position(status='OPEN')` + Order(status='PENDING').
   - Submits Alpaca market order with `client_order_id = order.idempotencyKey`.
   - The existing post-submit polling code kicks in.
7. **9:47:08 AM** — Alpaca fills at $30.43. `Order → FILLED`, `Position.avgCost = 30.43`, `PositionEvent(type='OPENED')`, `ThesisUpdate(type='STATUS_CHANGED', from='WATCHING', to='ACTIVE')`. Trade-opened email sent.

Total wall-clock from proposal to fill: 1h 42min.

---

## 8. Rejection & expiry — how the agent learns

### 8.1 The rejection signal

When Dave rejects, the optional message lands on `Order.rejectionMessage`. A `ThesisUpdate(type='PROPOSAL_REJECTED', rationale=message)` row is written.

On the agent's next run, `get_theses(include_history: true)` surfaces the audit row in the thesis's recent updates — same mechanism that already surfaces PASS thesis history. The agent reads the `rationale` verbatim ("Don't want concentration in semis this week.") and adapts.

### 8.2 The prompt update — one bullet

Added to the daily-run system prompt around the existing thesis-review block:

> If a thesis's history shows a recent `PROPOSAL_REJECTED` entry with a user rationale, treat the user's wording as a hard signal. Do not re-propose unless the stated reason has materially changed (e.g., "not this week" doesn't survive a week; "never this name" survives indefinitely).

### 8.3 No `Thesis.proposalCooldownUntil` field

Considered: a hard-cooldown date that gates re-proposal. **Rejected** because catalyst horizons decay in hours (PEAD) while compounder horizons decay in months; one field cannot capture that variance. The user's rejection wording naturally encodes the right cooldown. The prompt + history-read pattern is already load-bearing for PASS theses and works.

If this proves insufficient in practice (the agent repeatedly proposes rejected setups), a cooldown field is a future addition. Ship the simpler version first.

### 8.4 Expiry

After 24h with no decision, the cron flips `Order → EXPIRED`. For buy proposals, the `Position(PENDING_APPROVAL) → CANCELLED`. A `ThesisUpdate(type='PROPOSAL_EXPIRED')` is written. The agent reads this on its next run and may re-propose if the setup still holds.

---

## 9. Anti-pattern check — three-layer principle

| Behavior | Layer | Notes |
|---|---|---|
| "When toggle is ON, agent's trade tools propose instead of execute" | Layer 2 (tool) | Right place. Each of the 4 tool paths branches internally. No prompt instruction needed. |
| "Manual UI actions bypass the gate" | Layer 2 (tool) | The `source` parameter in `closeOpenPosition` and the absence of an agent caller in the manual API routes do this naturally. |
| "Agent learns from `PROPOSAL_REJECTED` in thesis history" | Layer 2 (audit row) + Layer 3 (one prompt bullet) | The audit row is durable; the prompt bullet tells the agent how to weight it. Both required. |
| "Proposal expires after 24h" | Layer 2 (Inngest cron) | Cron flips status. NOT in the prompt. |
| "Proposal UI surfaces approve/reject buttons" | Layer 2 (tool result envelope) + Layer 3 (renderer dispatch) | New row-kind in the existing `ToolUIRenderer`. **No new renderer.** |

No layer violations. No prompt text trying to do tool work; no tool trying to do UI work.

---

## 10. Build order

| # | Step | Files | Est |
|---|---|---|---|
| 1 | Prisma schema delta + migration | `prisma/schema.prisma` | 0.5 day |
| 2 | `place_trade` proposal branch + extract `submitTradeToAlpaca` helper | `lib/agent/tools/place-trade.ts` | 0.5 day |
| 3 | `manage_position` add / partial_close / full_close branches | `lib/agent/tools/manage-position.ts` | 0.5 day |
| 4 | `closeOpenPosition()` approval gate | `lib/actions/closeTrade.actions.ts` | 0.5 day |
| 5 | Approve + reject API routes | `app/api/proposals/[orderId]/approve/route.ts`, `app/api/proposals/[orderId]/reject/route.ts` | 1 day |
| 6 | Chat renderer (resurrect `TradeConfirmation`, wire into `ToolUIRenderer`) | `components/agent/renderers/ToolUIRenderer.tsx`, `components/domain/trade-confirmation.tsx` | 1 day |
| 7 | Email on proposal-created | `lib/emails/proposal-pending.ts` (new), wired from §5.5 + §5.1 + §5.2 + §5.4 | 0.5 day |
| **— ✅ LIVE re-enable possible —** | | | |
| 8 | /trades PROPOSED tab + mobile fixes | `components/trades/TradesPage.tsx` | 2 days |
| 9 | Homepage activity feed surface + mobile fixes | `components/dashboard/DashboardClient.tsx` | 1 day |
| 10 | Thesis sheet alert | `components/agent/sheets/ThesisSheet.tsx` | 0.5 day |
| 11 | Expiry cron + `ThesisUpdate` audit type values | `lib/inngest/functions/proposal-expiry.ts` (new), `lib/agent/thesis-updates.ts` | 1 day |
| 12 | Daily-run prompt — one rejection-handling bullet | `lib/agent/system-prompt.ts` | 0.5 day |
| 13 | Delete `intraday-eod-flatten` cron + close PR #359 gap on `add_to_position` | `lib/inngest/functions/intraday-eod-flatten.ts`, Inngest registrations | 0.5 day |

**Total:** ~9.5 calendar days. Steps 1-7 land safe ground to re-enable PEAD LIVE. Steps 8-13 are polish + audit-trail completeness + the tag-along bugs surfaced by discovery.

---

## 11. Out-of-scope follow-ups

File for future plans, not in this one:

- **Push notifications / SMS** for proposal-created. Email-only V1 may not be timely for short-window catalysts.
- **Alpaca-native stop-limit orders.** Today the `price-monitor` cron polls every 1 min and auto-closes when a stop fires. Pushing stops natively to Alpaca would remove the cron and improve reliability under partial Hindsight outages.
- **Multi-proposal coordination.** If two analysts both propose buying the same name on the same day, approving one should auto-pass the other. Phase 4+.
- **Manual buy/sell/add/reduce UI.** The proposal architecture is designed for it; the UI itself is a separate workstream.
- **Tech-debt sweep PR** — dead components (`TradeCard`, `ActivityFeed`), ShadCN custom-class violations, hover-only mobile bugs on non-trade surfaces, stale CLAUDE.md renderer count (says 5, actually 7). Should ship as its own PR after this plan; not bundled.
- **`Account.proposalExpiryHours`** as a configurable field if 24h proves wrong in practice.

---

## 12. Implementation notes

- **String columns, no Prisma enums** for new statuses — matches existing convention (see `Order.status`, `Position.status` today).
- **Query-site sweep:** grep `status: "OPEN"` across the codebase and update each site to either include `PENDING_APPROVAL` (rare — only the agent's "awaiting" view) or exclude it explicitly. Expected sites: `get_portfolio_context`, `sync-heartbeat`, `price-monitor`, `/trades` Open tab, dashboard portfolio summary, accuracy-scorer, weekly-digest. Walk all of them in step 2.
- **The approve handler's re-run-gates step uses the SAME helper functions `place_trade` uses today (DRY).** If they aren't already separable, extract them into `lib/agent/trade-gates.ts` during step 2.
- **The Alpaca submit on approve uses the SAME `idempotencyKey`** already stored on the Order from proposal time. `reconcile-orders` works unchanged.
- **Account resolution:** the API routes resolve the user's `accountId` via `getOwnerUserId` / `AccountMembership` lookup — same pattern as `closeTrade.actions.ts:15`.
- **Heartbeat carve-out:** `sync-heartbeat`'s `staleDbNotInAlpaca` invariant check must exclude `Position.status='PENDING_APPROVAL'` — those don't exist at Alpaca yet by design.

---

## 13. Tag-along bugs to fix during this work

Surfaced by Phase 1 discovery; small enough to ride this plan:

| Bug | File | Fix |
|---|---|---|
| `manage_position.add_to_position` bypasses every `place_trade` gate including PR #359's `enabled=false` | `lib/agent/tools/manage-position.ts:541-776` | Add gate calls in step 3 |
| Homepage trade row kebab is hover-only — unusable on phone | `components/dashboard/DashboardClient.tsx:1233-1299` | Step 9 — always-visible |
| Homepage right column is `hidden lg:block` — invisible on phone | `components/dashboard/DashboardClient.tsx` | Step 9 — show on mobile |
| /trades sticky-right kebab is hover-only AND requires horizontal scroll | `components/trades/TradesPage.tsx:448` | Step 8 — restructure for mobile |
| CLAUDE.md says renderer surface is 5 files; actually 7 (2 podcast renderers) | `CLAUDE.md` | One-line edit in step 6 |
