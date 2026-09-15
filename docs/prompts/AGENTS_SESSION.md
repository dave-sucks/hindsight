# The Agents lane — kickoff brief

> Start with: *"Read `docs/prompts/AGENTS_SESSION.md` and follow it."*
> Written 2026-09-14 for a fresh session taking over the agent rebuild. The
> previous session built a lot of good plumbing and then drifted; you
> inherit the work, not its habits.

## 1. Your job

Make every agent in Hindsight trade like a disciplined professional:
recognise the setup, price the plan from the chart, size by risk, confirm a
fire by the setup's own rule, manage the book, sell by plan, and learn from
the scorecard. You own the judgment and the money path. A separate Signals
lane owns outside data (earnings, SEC filings, insider buying, movers). A QB
session reviews both lanes.

## 2. Read, in order

1. `CLAUDE.md`
2. Your memory index (`MEMORY.md`). The feedback entries are binding.
3. `docs/plans/LANES.md` — what you own, what you don't, how signals reach you, the laws.
4. `docs/plans/AGENT_REBUILD.md` §0–§5 and `docs/plans/TRADING_PLAYBOOK.md` Parts D–F.
5. `docs/prompts/QB_SESSION.md` §3 (settled rulings) and §4 (how your PRs are reviewed).
6. Linear project **Agent Rebuild**.

## 3. Where the rebuild stands (2026-09-14)

**Merged:** the chart and daily indicator snapshot; triggers that fire
(close-basis levels, volume, near/through moving averages, gaps, new highs,
real RSI) with the dead kinds deleted; the setup catalog (twelve patterns);
size by risk (`riskPct`, proposal lines for open risk and market regime);
the scorecard by setup; insider buying as input and trigger kind; the fixes
to all of the above; the buy-now flag deleted and a down-day buy level no
longer dead on arrival; price age decided in one place (buys wait on a
stale quote, research says so in words).

**Open:**
- **The writer** (`#644`): picks a setup and prices the plan from the chart. Review it against §5 before asking Dave to merge; after merge, re-dispatch DOCU, FIVE and HPE as the live proof.
- **Sell rules move to each analyst** (`#645`): deletes the horizon layer and its migration job. Seat style lives in analyst trigger rules; the account keeps only rules every analyst shares. One-off rule changes on live stocks go through the popover's own functions, never a custom job.

**Not built — in this order:**
1. **Live quotes from Alpaca.** Keep Finnhub for fundamentals, earnings and filings. Probe the feed with a mid-cap (SMMT), not a mega-cap. The trigger check gets first claim on the quote budget.
2. **The tactical run (PR 6).** Confirm a fire by its setup (a breakout needs a close and 1.5× volume; a pullback needs the level to hold; an earnings gap needs the gap to hold). One run when two sell triggers fire together. **After a buy, write the stock's own exit triggers from its setup** — the widening trail for volatile stocks, the eight-week hold for fast winners, "not working after N days", a beat that sells off. Selling is the thinnest part of the rebuild; this is where it becomes setup-specific.
3. **The daily run (PR 5).** A fired buy is a decision: buy, or set the plan down with a reason; raising the buy level above the price to avoid buying is flagged, never refused. Chased entries and stale buy levels flagged. Idle cash, open risk and the market regime are inputs to the decision.
4. **Discovery as screens, in chat (PR 9).** Numeric screens chat can run. **And chat's triage becomes setup-aware:** every candidate is named with its setup and the chart numbers behind it, using the same catalog the writer uses. Chat is Dave's discovery door; the weekly cron stays off.
5. **Analyst templates seed analyst trigger rules** from the setups that seat may run (after PR 5).

## 4. Dave's rulings you must not reopen

In `QB_SESSION.md` §3. The ones most often broken: no new refusals; no
buy-now path; one trigger change at a time; sell rules on analysts; the
vendor is the store; discovery is manual; plain words; never merge without
Dave's click.

## 5. Every PR

- The five-line message from `LANES.md` §3 law 7, sent to the QB.
- A test replayed from the real production case, shown failing on main.
- Name what it deletes. Prefer the smaller change that removes a concept over one that adds a second way to do the same thing.
- If it touches a shared file (`LANES.md` §4), check for an open Signals-lane PR first.
- Before saying "done," read your own diff for the failure shapes in `QB_SESSION.md` §4.

## 6. Talking to the Signals lane

If a setup needs a fact or a trigger kind that doesn't exist, file a ticket
in the Signals lane's project describing the condition and the setup that
needs it. Don't build vendor code. When the Signals lane ships a kind and
proposes a use, you decide and update the catalog and prompts.
