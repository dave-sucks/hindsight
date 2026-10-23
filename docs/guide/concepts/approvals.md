# Approvals

**Analysts propose. You approve.** Every buy, sale, add and trim an analyst wants waits in your queue with its reason.

On the live account nothing reaches the broker until you say yes, and whatever you answer, the next run reads it.

<!-- asset: card approvals -->

## Where proposals come from

No agent places a trade by itself. A trade becomes a proposal the moment an agent decides on it:

- **A [trigger run](../agents/trigger-runs.md)**, after a buy, add, trim or sale [trigger](triggers.md) fires and the run confirms it.
- **A [morning run](../agents/morning-runs.md)**, answering a stock's [situation](situations.md): a sale signal, a buy level reached, a winner near its target.
- **An Auto trigger** (Auto-sell, Auto-trim, Auto-buy, Auto-add), with no agent at all.
- **[Chat](../agents/chat.md)**, when you ask for a trade.

A buy or an add is sized by risk inside the [analyst](analysts.md)'s band; no agent picks a size. Only chat may name one, at your word.

## What a proposal carries

It lands in your queue, your inbox and on your phone at the same moment, with the trade (the stock, the side, the shares and the price it expects), the reason in the analyst's words, what caused it (the trigger that fired or the run that decided it), and when it expires.

A sale made by a trigger set to Auto-sell names that trigger first ("Sell if below $41.42" fired, with no agent run), then the trigger's own reason, and Activity calls it an Auto-sell.

## What your answer does

- **Approve:** the order goes to the broker. Once the broker takes a buy, the [thesis](theses.md) turns from Watching to Holding and its sell side is armed; once it takes a sale, the thesis is retired as sold, or sent back to Watching after a sale at the target.
- **Approve at a different size:** your size is used, and the next run reads it as caution or conviction. If the position or the analyst's room has shrunk since, the order is cut to what's left.
- **Decline:** recorded on the stock and read by every run after it. A declined buy or add isn't proposed again unless something you named has changed. A declined sale is different: while the price stays past the line it's proposed again every day, because [floors only go up](triggers.md).
- **Let it expire:** after 24 hours a proposal lapses (one that runs out overnight is marked at the next market-day check). A lapse means "not now, ask me again", never a decline.

## Live and paper

Approval is a setting on each account, for buys and sales separately:

- **Live account:** on by default. Every trade waits for you.
- **Paper account:** off by default, so paper trades go straight to the broker and analysts can practise freely. Turn it on to review paper trades too.

Until it's approved, a proposal isn't a holding, and it isn't counted in your positions or your P&L.

A trade's whole path, from the agent's call through the gate, the broker and the fill: [From proposal to fill](../deep-dives/proposal-to-fill.md).

<details>
<summary>Technical details</summary>

#### The gate
`approvalRequired` in `lib/proposals/maybe-await-approval.ts` reads the account's four settings for every trade path. Buys and adds are staged by `maybeAwaitApproval` (`place_trade`, `manage_position`); a sale is staged by `closeOpenPosition` (`lib/actions/closeTrade.actions.ts`) under the position lock. A close you make by hand skips the gate.

#### Stored as
`Order` with status `AWAITING_APPROVAL` and an `expiresAt` 24 hours out; `proposal-expiry.ts` closes the stale ones.

#### Declines and lapses
`lib/agent/declined-sale.ts` counts a decline (REJECTED) and a lapse (EXPIRED) apart; the row's `heldThroughFloor` carries both.

#### On approval
`lib/proposals/execute.ts` flips the thesis as soon as the broker accepts the order, through `lib/proposals/thesis-flips.ts`: `promoteThesisOnApproval` turns WATCHING into HOLDING and arms the held plan; `closeThesisOnApproval` retires it as SOLD or, after a profit-take, sends it back to WATCHING. `reconcile-orders` later stamps the real fill price.

#### Alerts
An email (`lib/emails/proposal-pending.ts`) and a phone push through ntfy (`lib/notify/proposal-push.ts`).

#### Settings
`requireApprovalBuysLive` and `requireApprovalSellsLive` default on; the paper pair defaults off.

#### Agents
Approve and reject are never an agent's tools. A run can read the queue (`list_proposals`) but only you can answer it.
</details>
