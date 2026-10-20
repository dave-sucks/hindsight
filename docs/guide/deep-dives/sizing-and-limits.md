# Sizing and limits

**A trade is sized by what it can lose.** The size comes from the distance to the floor, not from a number an agent likes, so a tight, honest floor earns a bigger position.

This page covers how a buy is sized, who can change the size, and the limits around it.

## The formula

Each buy risks a share of the account. By default that is 1% of equity, set per analyst. Three things scale it:

- **Conviction:** low 0.5, medium 0.75, high 1, strong 1.25.
- **An all-or-nothing event:** half, for a bet into a dated event like a trial readout.
- **A cautious market:** half. See below.

The shares are that risk divided by the distance from the entry to the floor. With $100,000, 1%, high conviction, a $50 entry and a $45 floor, the buy risks $1,000 over $5 a share: 200 shares, $10,000.

Then the analyst's dollar limits clamp it: never under its smallest trade, never over its largest. The proposal says which limit moved it and what the risk alone had asked for. If there is no usable floor or no equity reading, the buy is sized from the analyst's band by conviction (the largest trade for strong or high, the smallest otherwise), and the proposal says why. An add risks half the shares a new buy would get.

## Who picks the size

No agent. Inside a run, `place_trade` and `manage_position` have no size field at all, so there is nothing to fill in wrongly. Only your own chat may name a dollar amount. It is honored as given, with a line when it sits outside the analyst's band: "Sized by you: $12,000 — above the analyst's largest trade ($10,000)."

The one limit that still binds you is the most in one stock. An add that would take a position past it is refused, whoever asks. A rule-sized add is trimmed to the room left.

## The market

We read the market from SPY's last close against its 50-day and 200-day averages, with a 1% buffer so a close that barely crosses a line doesn't flip the reading.

- **Cautious:** SPY is more than 1% under its 50-day. New buys are half size.
- **Risk-off:** SPY is more than 1% under its 200-day. Sizing does not change.
- **Risk-on:** otherwise.

The market is an input, never a gate. Every buy proposal carries a line with the reading, and risk-off tells the agent that new buys fit only event trades and mean-reversion. Nothing refuses a buy because of it.

## Slots

Each analyst holds at most a set number of stocks, 5 by default. A buy awaiting your approval already holds its slot, so counting only open positions would say there is room when the tool would refuse the buy. When an analyst is full, `place_trade` refuses a new buy until one closes. The refusal writes a line in Activity, and the stock enters the "buy blocked, full" [situation](../concepts/situations.md). There the agent weighs the stock against the weakest holding and names which one it would replace. Replacing a holding is your decision.

## Account-wide lines

Two numbers watch the whole account. Open risk is what we'd lose if every floor hit at once, capped at 6% of equity. An industry holds at most two names, because three semiconductor stocks are one bet. Neither refuses anything. Each buy proposal states where the account would stand, such as "over the 6% limit", so you see it when you approve. Stocks with no floor aren't counted, and are named. See [Approvals](../concepts/approvals.md).

<details>
<summary>Technical details</summary>

#### Sizing
`sizeByRisk` in `lib/agent/position-sizing.ts`: `DEFAULT_RISK_PCT` 1, `CONVICTION_RISK_MULTIPLIER`, `BINARY_RISK_MULTIPLIER` 0.5 (`lib/agent/knowledge/setups.ts`), `CAUTION_SIZE_MULTIPLIER` 0.5, `ADD_RISK_FRACTION` 0.5. Limits come from `positionBand` and `positionTotalCap` (`maxPositionTotal`, 0 means twice the largest trade).

#### Callers
`place-trade.ts` and `manage-position.ts` build their schema with `schemaFor`, which drops `notional` and `add_notional` unless the run mode is `PRINCIPAL_CHAT`. `sizedByPrincipalLine` words the out-of-band note.

#### Regime
`computeRegime` in `lib/agent/regime.ts`, from the daily `TickerIndicators` snapshot; `REGIME_BUFFER_PCT` is 1.

#### Slots
`maxOpenPositions` on `AgentConfig` (default 5). `place_trade` counts `OPEN` and `PENDING_APPROVAL` positions. `lib/agent/capacity.ts` holds `isFull` and `buyBlockedByFull`; `recordBuyBlockedByFull` writes the Activity line; `BUY_BLOCKED_FULL` is in `lib/agent/situations.ts`.

#### Account lines
`openRisk`, `heatLine` and `industryLine` in `lib/agent/portfolio-risk.ts`, with `PORTFOLIO_HEAT_PCT` and `MAX_NAMES_PER_INDUSTRY`. `place_trade` appends them to the proposal's sizing notes.
</details>
