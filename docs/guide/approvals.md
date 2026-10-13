# Approvals

**Analysts propose. You approve.** Every buy, sale, add and trim an analyst wants waits in your queue with its reason.

Nothing fills until you say yes.

<!-- asset: proposal -->

## How a trade reaches you

No agent trades on its own. When a [morning run](morning-runs.md), a [trigger run](trigger-runs.md) or [chat](chat.md) decides to buy or sell, the order stops at a gate and becomes a proposal. It lands in your queue, your inbox and on your phone at the same moment, and nothing reaches the broker until you approve it.

## What a proposal carries

- **The trade:** the stock, buy or sell, the shares and the price it expects.
- **The reason:** in the analyst's words: the call, the stock and the price, then why.
- **What caused it:** the trigger that fired, or the run that decided it.
- **The clock:** when it expires if you don't answer.

## A day to decide

A proposal expires after 24 hours. Until then it isn't a holding and isn't counted in your positions or your P&L. A sale whose line is still crossed asks again the next day, so a floor is never quietly forgotten.

## Your answer counts

A decline is recorded and read by every run after it. Asking again takes new reasons, said plainly. Agents can read the queue with `list_proposals`, but approving and declining are never their tools: that click is always yours.

## Live and paper

- **Live account:** buys and sales need your approval, on unless you change it.
- **Paper account:** off by default, so analysts can practise freely. Turn it on to review every paper trade too.

<details>
<summary>Technical details</summary>

#### The gate
`maybeAwaitApproval` in `lib/proposals/maybe-await-approval.ts`, called by every trade path before anything reaches Alpaca.

#### Stored as
`Order` with status `AWAITING_APPROVAL` and an `expiresAt` 24 hours out; `proposal-expiry.ts` closes the stale ones.

#### Alerts
An email (`lib/emails/proposal-pending.ts`) and a phone push through ntfy (`lib/notify/proposal-push.ts`).

#### Settings
`requireApprovalBuysLive` and `requireApprovalSellsLive` default on; the paper pair defaults off.

#### Agents
Approve and reject are never an agent's tools. A run can read the queue (`list_proposals`) but only you can answer it.
</details>
