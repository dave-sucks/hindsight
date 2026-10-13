# Approvals

**Analysts propose. You approve.** Every buy, sale, add and trim an analyst wants waits in your queue with its reason.

Nothing reaches the broker until you say yes. Whatever you answer, the next run reads it.

<!-- asset: card approvals -->

## Where proposals come from

No agent trades on its own. A trade becomes a proposal at the moment an agent decides on it:

- **A [trigger run](trigger-runs.md)**, after a buy, add, trim or sale [trigger](triggers.md) fires and the run confirms it.
- **A [morning run](morning-runs.md)**, answering a stock's [situation](situations.md): a sale signal, a buy level reached, a winner near its target.
- **A floor set to sell straight away,** with no agent at all.
- **[Chat](chat.md)**, when you ask for a trade. Chat can name a size, and it's used as given.

The buy or add is sized by risk inside the [analyst](analysts.md)'s band; no agent picks a size.

## How a trade reaches you

<!-- asset: proposal -->

It lands in your queue, your inbox and on your phone at the same moment, carrying:

- **The trade:** the stock, buy or sell, the shares and the price it expects.
- **The reason:** in the analyst's words: the call, the stock and the price, then why.
- **What caused it:** the trigger that fired, or the run that decided it.
- **The clock:** when it expires if you don't answer.

## What your answer does

- **Approve:** the order goes to the broker. A buy that fills turns the [thesis](theses.md) from Watching to Holding and arms its sell side. A sale that fills retires the thesis as sold, and it gets one look back in the next two weeks.
- **Approve at a different size:** your size is used, and read by the next run as caution or conviction.
- **Decline:** recorded on the stock and read by every run after it. A declined buy or add isn't proposed again unless something you named has changed.
- **Let it expire:** after 24 hours a proposal lapses. A lapse means "not now, ask me again", never a decline.

## Sales keep asking

A floor is protection, so a sale doesn't go away because you didn't take it. While the price stays past the line, the sale is proposed again every day, with that day's reasons and the recent low offered as a level for the line. The analyst can also tighten the line or sell part of the position.

What no agent can do is lower the floor. Only you move a floor down on a stock we hold, on the thesis sheet. An agent that thinks the line is wrong says so in its note and names the level.

## Live and paper

- **Live account:** buys and sales need your approval, on unless you change it.
- **Paper account:** off by default, so analysts can practise freely. Turn it on to review every paper trade too.

Until it's approved, a proposal isn't a holding, and it isn't counted in your positions or your P&L.

<details>
<summary>Technical details</summary>

#### The gate
`maybeAwaitApproval` in `lib/proposals/maybe-await-approval.ts`, called by every trade path before anything reaches Alpaca.

#### Stored as
`Order` with status `AWAITING_APPROVAL` and an `expiresAt` 24 hours out; `proposal-expiry.ts` closes the stale ones.

#### Declines and lapses
`lib/agent/declined-sale.ts` counts a decline (REJECTED) and a lapse (EXPIRED) apart; the row's `heldThroughFloor` carries both.

#### On approval
`lib/proposals/thesis-flips.ts`: a filled buy turns WATCHING into HOLDING and arms the held plan; an approved sale retires the thesis as SOLD.

#### Alerts
An email (`lib/emails/proposal-pending.ts`) and a phone push through ntfy (`lib/notify/proposal-push.ts`).

#### Settings
`requireApprovalBuysLive` and `requireApprovalSellsLive` default on; the paper pair defaults off.

#### Agents
Approve and reject are never an agent's tools. A run can read the queue (`list_proposals`) but only you can answer it.
</details>
