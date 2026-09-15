# Two build lanes, one QB — the contract

> Written 2026-09-14. Dave runs two build sessions at once and one QB session
> that reviews both. This file is how the two lanes divide the code, how a
> signal becomes something the agents and the trigger ladder can use, and
> which rules neither lane may break. Both lanes read it before their first
> PR, and again whenever they touch a file listed in §4.

---

## 1. The lanes

| | **Signals lane** | **Agents lane** |
|---|---|---|
| **Job** | Bring outside facts in — earnings, SEC filings, insider buying, movers, and later news — correctly, on time, and honestly labelled. | Make every agent trade like a disciplined professional — setups, entries, stops, targets, size, selling — and manage the book. |
| **Plan docs** | `docs/plans/MARKET_DATA.md`, `docs/plans/EARNINGS_AND_MOVERS.md`, `docs/plans/SIGNALS_REDESIGN.md` (news, parked) | `docs/plans/AGENT_REBUILD.md`, `docs/plans/TRADING_PLAYBOOK.md` |
| **Owns** | Vendor clients and data modules in `lib/market-data/` except the chart; the earnings calendar (`earnings-calendar.ts`, `lib/agent/triggers/earnings.ts`); insider buying (`insider-cluster.ts`); SEC EDGAR; the pull tools `get_earnings_calendar`, `get_earnings_data`, `get_sec_filings`, `get_market_movers`; the Earnings page and stock-page data tabs; the vendor probe | The chart (`price-structure.ts`, `indicator-snapshot.ts`, `quote-age.ts`); the setup catalog (`lib/agent/knowledge/setups.ts`); every agent prompt (writer, daily run, tactical run, discovery, chat); `record_thesis`, `update_thesis`, `place_trade`, `manage_position`; trigger ops (`ops.ts`); trigger kinds that read the app's own data (an event date off `Thesis.catalystDate`, days held) and the Add Trigger dialog's two-condition builder; plan-sanity flags; sizing; sell rules on analysts; the scorecard |
| **Never edits** | Agent prompts or `setups.ts` | Vendor clients or the earnings/filings/insider modules |

Anything outside both columns (UI polish, auth, P&L) is neither lane's —
file it and let Dave assign it.

## 2. How a signal reaches the agents — three doors, nothing else

A fact from the Signals lane is only useful when it lands through one of
these. There is no fourth path (no inbox, no routed "signal" rows, no
summary sentence stored for later — that was the machinery deleted in
September).

### Door 1 — a trigger kind (the ladder)

The Signals lane adds a condition the five-minute check can evaluate.

- **Ships whole in one PR:** the predicate in `lib/agent/triggers/types.ts`
  and `schema.ts`; evaluation in `evaluate.ts` (and the evaluator's data
  load); a plain sentence in `format.ts`; add/edit support in the existing
  trigger popover (`editable.ts`, `AddTriggerDialog`); tests including one
  replayed from a real production case. A kind that can't fire today is
  not merged (that's how three dead kinds sat on 119 theses until deleted).
- **Reads the vendor live or the morning snapshot.** Nothing is stored
  except the fire itself.
- **A fire writes one Activity line with the numbers in it** ("Reported
  after close: EPS $2.22 vs $2.14 est, beat 3.8%").
- **Signal kinds never trade by themselves.** They wake a tactical run or
  batch to the next review; the no-agent close path is refused for them.
- **Age travels with the data.** If the source failed or is stale, the
  fire does not happen and the evaluator logs why; an agent-facing result
  says so in words.

Live today: `EARNINGS_BEAT`, `EARNINGS_MISS`, `EARNINGS_WITHIN`,
`EARNINGS_SINCE`, `INSIDER_CLUSTER`. The old `FILING`, `GUIDANCE_CHANGE`
and `SIGNAL_TYPE` kinds were deleted because nothing could fire them; SEC
filings come back only as a new kind that does.

### Door 2 — a data field (what an agent reads)

The Signals lane adds a fact to the data an agent already receives: the
writer's data block, `get_stock_data`, `get_earnings_data`, or the morning
snapshot. Rules: the field carries its date or age; an empty or failed
source is named in words, never shown as zero or "ok"; the tool row shows
the same line the model receives.

### Door 3 — a setup that uses it (judgment)

Only the Agents lane decides how a signal changes a decision: which setups
in `setups.ts` use a kind or a field, what an agent does when it fires, and
the prompt text that teaches it. The Signals lane **proposes** by filing a
ticket to the Agents lane: *"`X` is live and fires on real data (proof
link). Proposed use: setup D4's entry, a review on held names."* The Agents
lane accepts, edits the catalog and prompts, and says so on the ticket.

**Worked examples of the ladder knowing the signals**

| Situation | Written as | Door | Owner of the kind | Owner of the use |
|---|---|---|---|---|
| Post-earnings drift entry | `AND[EARNINGS_SINCE 1..3, PRICE_ABOVE gap-day low]` | 1 + 3 | Signals | Agents (D4) |
| Heads-up before a print on a held name | `EARNINGS_WITHIN 3` → review | 1 + 3 | Signals | Agents (held review) |
| A beat the market sold | `AND[EARNINGS_BEAT, PRICE_MOVE_PCT DOWN ≥ 3]` → review | 1 + 3 | Signals + Agents | Agents |
| Insiders buying into a base | `INSIDER_CLUSTER` + a chart entry | 1 + 3 | Signals | Agents (D9) |
| A dilutive offering on a held name | a filing kind for S-3 / 424B → review | 1 + 3 | Signals (to build) | Agents |
| "Reported 3 days ago, beat on both lines, held the gap" as a discovery list | a screen over the calendar + the chart | 2 + 3 | Signals (calendar), Agents (chart) | Agents (chat triage) |

## 3. Laws for both lanes

1. **The vendor is the store.** Store what the system did, not what the vendor said.
2. **Every price and fact carries its age.** Stale or failed is said in words. Buys wait on a stale quote; sells do not.
3. **No new refusals.** Judgment goes in a proposal line or a visible flag.
4. **Triggers change one at a time** through `lib/agent/triggers/ops.ts`. One change = one Activity line.
5. **A buy trigger needs a full plan at 2:1.** Buying now is an entry at or near the current price — there is no buy-now flag.
6. **Every fix PR carries a test replayed from the real production input, shown failing on main.**
7. **The five-line PR message** (net delta and the deletion it names; the acceptance proof; "no new refusal"; "rebased onto main, not stacked"; for prompt changes the exact paragraph removed and added).
8. **Column drops are two PRs. No stacked PRs. Nothing merges without Dave's click.**
9. **The quote budget is shared.** One Finnhub key, about 60 calls a minute, used by the trigger check, writers, chat and reviews. The trigger check has first claim. A new job states its calls per run in the PR; nothing burns the production key during market hours for a review. Live quotes are moving to Alpaca.
10. **Discovery is manual by design.** Chat is the door; don't restart the weekly cron.
11. **Plain words** in anything Dave reads: stocks, analysts, runs, triggers, theses, review cadence. No "rungs," "tiers," "soft watch," "clock."
12. **No ticket ids in docs PR titles or bodies.**

## 4. Files both lanes touch — take care

`lib/agent/triggers/types.ts`, `schema.ts`, `evaluate.ts`, `format.ts`,
`editable.ts`, `lib/inngest/functions/trigger-evaluator.ts`,
`lib/market-data/indicator-snapshot.ts`, `lib/agent/modes.ts` (tool lists),
`app/api/inngest/route.ts`.

- Before opening a PR that touches one, check whether the other lane has an
  open PR touching it. If so, say so in the PR message.
- Whoever merges second rebases onto main immediately and reruns the full suite.
- When both lanes have open PRs on these files, the QB merges the set in order
  on a scratch branch, runs type-check and tests on the tip, and gives Dave
  the order.
- A new Inngest function needs an Inngest re-sync after deploy (Dave's click).

## 5. How the two lanes talk

- **Through Linear, not through Dave.** A request from one lane to the other
  is a ticket in the other lane's project with the proof attached.
- **Through the QB.** Each lane sends its five-line message to the QB for
  every PR. The QB keeps the one "in flight" table in
  `docs/prompts/QB_SESSION.md` §7 current for both lanes.
- **Dave decides** anything that changes money, a trading rule, or the scope
  of a lane.
