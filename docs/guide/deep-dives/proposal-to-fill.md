# From proposal to fill

**A trade is written down before it is sent.** Every buy starts as rows in our own record, waits for you if the account asks, and reaches the broker with a key that lets us find it again.

This page follows one buy from the agent's call to the fill.

## The call

An agent buys with `place_trade`. Before anything is written it checks:

1. The stock isn't on the analyst's exclusion list.
2. The thesis has a committed view and scores at or above the analyst's minimum.
3. The analyst has a free slot. A buy waiting for approval holds its slot, so a queue can't run past the cap.
4. The analyst holds none of the stock and has no buy waiting on it.
5. The live price hasn't already passed the target or the floor.

The agent doesn't pick the size. It's set by risk: the money at risk, divided by the distance to the floor, scaled by conviction and kept inside the analyst's band. One transaction then writes the position and an `Order` with a fresh idempotency key. The key is the broker's client order ID, so a lost reply can't lose the order.

## The gate

Next the order meets the [approval](../concepts/approvals.md) setting for its account: one switch for buys and one for sales, set separately for live and paper. Live is on by default, paper off. With the switch off, the order goes straight to the broker.

If it's on, the order becomes `AWAITING_APPROVAL` with a 24-hour expiry, the new position is held as pending, and you get a phone push at once and an email that waits up to 30 seconds for the research brief: why the stock moved, analyst ratings and targets, what X is saying and our own numbers, each fact with its source and date. The same brief shows on the proposal in the stock's sheet, and a brief that takes longer appears there when it lands. A sale sent without approval gets a brief too, on file. A live trade whose account can't be read is refused. A sale is staged the same way, already waiting. Only a close you make by hand skips the gate.

## Approving

Approving checks the order is still waiting and unexpired, then locks the position and re-measures, because the proposal may be hours old:

- **A buy or an add** can be approved at your quantity.
- **An add** is cut to the room left under the analyst's most-in-one-stock limit, and cancelled if the position has closed or there's no room.
- **A sale** sells the shares still held, is cancelled if none are left, and is refused if another sale of the position is under way.

Only one click can win. The order goes to the broker with the same key. A definite no (a 4xx) marks it rejected and cancels a pending buy. Anything unclear, like a timeout, leaves it `PENDING` for the next step.

## Matching to the broker

`reconcile-orders` runs every five minutes, 4 AM to 8 PM ET on weekdays. It finds each pending order by broker ID, or by the key if the ID was never saved. A fill sets the real price and share count. A key the broker has never seen is marked rejected.

`proposal-expiry` runs every thirty minutes in the same hours and lapses anything past its 24 hours. A lapse isn't a decline. A declined sale carries your note and the next run must answer it; a lapsed one is "not now".

## What it does to the thesis

The thesis moves when the broker accepts the order, not when the fill prints. With approval off, it moves when the fill is seen.

- **A buy** turns Watching into Holding. The buy trigger is removed, and the floor and target are set to the levels on the trade. The reconcile job then stamps the buy price with what was paid.
- **A sale** retires the thesis as sold. The exceptions are a sale at the target, or one where the agent attested the belief survived: those return to Watching with a one-day review.

When a protective trigger woke the run that sold, the sale is labelled stop or target, whatever the agent wrote. A wrong label would hide the sale from the rules that read it.

## Meanwhile

A sale waiting for you takes the stock off the agents' work list: it's yours to decide. A buy waiting for you keeps its plan, so an agent can't remove the buy trigger from under it.

<details>
<summary>Technical details</summary>

#### Checks
`lib/agent/tools/place-trade.ts`: `isExcluded`, the committed-direction guard, `minConfidence`, the `maxOpenPositions` count over `OPEN` and `PENDING_APPROVAL`, the duplicate-position check and the live-price guard. Sized by `sizeByRisk` in `lib/agent/position-sizing.ts`. The `Order` carries `idempotencyKey` (a UUID) and `intent: "OPEN"`.

#### Gate
`maybeAwaitApproval` and `approvalRequired` in `lib/proposals/maybe-await-approval.ts`; `ApprovalGateAccountUnresolvedError` on live. Switches: `requireApprovalBuysLive`, `requireApprovalSellsLive` (default true), `requireApprovalBuysPaper`, `requireApprovalSellsPaper` (default false) in `prisma/schema.prisma`. `PROPOSAL_TTL_MS` is 24 hours. Alerts: `lib/emails/proposal-pending.ts` (skipped when the analyst's `emailAlerts` is off) and `lib/notify/proposal-push.ts` (needs `NTFY_TOPIC`). The brief: `lib/research/brief.ts` (built by the `research-brief` Inngest function; the email waits in `proposal-pending-email`, `lib/inngest/functions/research-brief.ts`), stored in `ResearchBrief`, reused for two hours. Sales are staged in `closeOpenPosition` (`lib/actions/closeTrade.actions.ts`), where `source: "user"` skips the gate.

#### Approval
`approveProposal` in `lib/proposals/execute.ts`; locks from `lib/proposals/position-lock.ts` (`lockPositionSales`, `lockPositionBuys`, `cancelOrphanedSellProposals`). Errors are `ProposalExecutionError` codes such as `ALPACA_REJECTED`, `ALPACA_UNCERTAIN`, `SALE_UNDER_WAY`, `NO_ROOM_IN_POSITION`.

#### Reconcile and expiry
`lib/inngest/functions/reconcile-orders.ts` (`applyFillByIntent`, `restampThesisEntryOnFill`) and `lib/inngest/functions/proposal-expiry.ts`. Decline versus lapse: `lib/agent/declined-sale.ts` (`REJECTED` versus `EXPIRED`, seven-day window, protective sales only).

#### Thesis flips
`lib/proposals/thesis-flips.ts`: `promoteThesisOnApproval` and `armHeldLadderOnFill` for buys, `closeThesisOnApproval` and `closeThesisForPosition` for sales, `shouldRecycleToWatching` for the way back to Watching. On paper with approval off, `place_trade` calls `armHeldLadderOnFill` after the fill.

#### Labels
`enforceCloseReason` in `lib/agent/triggers/enforce-close-reason.ts`.

#### Work list
`hasPendingSaleProposal` in `lib/agent/needs-action.ts`; the waiting-buy rule is `buyWaiting` in `lib/agent/tools/update-thesis.ts`.
</details>
