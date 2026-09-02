# What the thesis pipeline actually does — 2026-09-02

Read-only audit. Every claim below was traced in the code and, where checkable,
verified against the live database. Nothing was changed.

---

## Executive summary

**The machinery is sound. The inputs to the agents are not.**

The trigger engine, the approval gate, the audit log, the resolver, the daily
run's work-list — these work. In the last 21 days the system evaluated triggers
every five minutes, fired 257 times, spawned 123 tactical runs, and put 11 buys
and 18 sells through the human gate. Nothing silently trades. The plumbing you
built is doing its job.

What is failing is one step: **the agent that writes the plan is asked to name
price levels using data that contains no price levels.**

The thesis writer's entire ground-truth block (`format-data-block.ts`) gives it
financials, earnings history, analyst ratings, insider trades, peers, filings and
news — and for price, exactly six numbers: today's price, today's range, the 52-week
high and low, RSI, and the *percentage* distance to the 20- and 50-day moving
averages. The moving-average dollar values are carried into the file and never
printed (`format-data-block.ts:35-36` — declared, never referenced again). There is
no price history, no prior swing high or low, no support or resistance.

Then it is told to produce "Entry: $X … Target: $Y (cite the level — breakout /
resistance / consensus PT) … Stop: $Z (cite the level — support / structural break)."
Asked for four structural levels and handed one reliable number, the model uses
that number. TOST buy $35.15 against a $35.16 tape; ISRG $401.23 against $401.29;
BMRN $64.67 against the $64.67 quoted in its own dispatch note. The prompt line
everyone is angry about (`build-synthesis-prompt.ts:236`) is not even on the live
path — it belongs to a V1 tool that the writer stopped calling in August. **The
instruction was the permission. The missing data is the reason.** Fixing the words
without giving the writer levels will produce the same theses with better prose.

Second, smaller, and already in flight: until roughly 40 minutes before this audit,
a buy level *below* the market was stored as a buy order *above* it. The dip-aware
entry logic added on 2026-08-28 (`defaults.ts:662`) was silently overwritten three
lines later by `predicateFor` (`price-levels.ts:492-502`), which hardcodes
`PRICE_ABOVE` for every long entry — and which also replaced the analyst's own
sentence explaining the level with generated breakout text. CRM's audit log shows
the whole sequence. PR #586 fixes it.

**Shortest path to trustworthy, in order:**

1. **Print the levels the writer already has.** `sma20`, `sma50`, and the 52-week
   high/low are in the pull result today. Add a "Price structure" block to the data
   block with real dollar values, plus recent swing highs/lows from the candles
   `get_stock_data` already fetches. This is a data-block change, not a new gate.
2. **Let the writer say "no entry yet."** Today a LONG must carry entry, target and
   stop or become a PASS. That is why a thesis whose dispatch note said *entry opens
   January 2027* came back with today's price as its buy level.
3. **Land #586**, and delete the now-duplicated entry-side logic in `defaults.ts`
   rather than leaving two places that decide the same thing.
4. Stop there. Do not add a gate. The last three items are all *inputs*.

---

## The map — what actually happens

### 1. Input — what the agent sees

**Writer path** (`run-thesis-writer.ts` → `pull-data.ts` → `format-data-block.ts`).
Seven parallel pulls, formatted into ten markdown sections
(`format-data-block.ts:544-562`): Snapshot, Company, Financials + forward estimates,
Earnings History, Analyst Coverage, Analyst Price Targets, Insider Activity, Peer
Comparison, Recent SEC Filings, Recent News (7 days). Plus up to four native web
searches (`run-thesis-writer.ts:85`).

The Snapshot is the only place price appears (`format-data-block.ts:210-244`):
current price + day range, 52-week range, market cap / volume / beta / P/E, then
`RSI(14)`, `vs SMA20: above (+1.9%)`, `vs SMA50: …`, `52w pos: 59%`,
`Vol: 1.2x average`, `Trend: bullish (SMA20 > SMA50)`.

**What it is blind to:** any price series. `get_stock_data` computes `sma20` and
`sma50` as numbers (`get-stock-data.ts:164-165`) and they arrive in the data-block
input type (`format-data-block.ts:35-36`) — and are never rendered. So the writer
cannot cite "the 20-day at $130" even though the system knows it. No candles, no
prior highs/lows, no volume profile, no gap levels, no support/resistance.

**Daily-run path** is different and richer: `get_theses` returns each row with a
`resolved` envelope — live price, trigger state, actionability, ladder health, and
`planSanity` flags (`resolved-thesis.ts:310`, `plan-sanity.ts`). The daily run sees
the tape against the plan. The writer, which authors the plan, does not.

### 2. Opinion formation

Three doors exist. Only one is in use.

- **Discovery** (`system-prompts/discovery.ts`) is the designed one: triage → Pass-1
  research → a 4-dimension composite out of 10 (trend 0-3, relative strength 0-3,
  entry quality 0-2, catalyst freshness 0-2) → composite ≥ 4 dispatches a writer,
  capped at 5 per run (`discovery.ts:46`, hard-enforced at
  `dispatch-thesis-research.ts:190-221`); composite < 4 but researched becomes a PASS;
  dismissed in triage becomes nothing at all (`discovery.ts:407-421`).
- **Principal chat** (prompt inline in `modes.ts:653-780`).
- **Daily run**, which can dispatch a refresh but cannot add to the watchlist.

**In practice, every one of the 16 thesis-writer dispatches in the last three weeks
had a `PRINCIPAL_CHAT` parent** (verified in the DB). The Sunday cron is off by
choice; discovery is being run by hand through chat. So today "how interested" is
decided by you, in prose, and the discovery composite machinery is idle.

Interest is representable four ways: a full priced plan (WATCHING + LONG/SHORT),
a quiet watch (`direction: PASS` + `status: WATCHING` + REVIEW-only wakes,
`record-thesis.ts:1020-1160`), a terminal PASS, or nothing. The book right now:
26 WATCHING directional, 7 HOLDING, 171 PASSED, **1** quiet watch.

### 3. Handoff

`dispatch_thesis_research` takes five fields: `ticker`, `analyst_id`, `mode`,
`existing_thesis_id`, `reason` (`dispatch-thesis-research.ts:31-71`). That is the
entire bandwidth. `reason` lands in the writer's system prompt under
"WHY YOU WERE DISPATCHED" (`run-thesis-writer.ts:409-410`) at full length.

The `reason` strings in production are genuinely good — several hundred words with
catalysts, dates, composite scores and specific questions. But nothing structured
crosses: no conviction, no composite, no proposed entry, no "this is a pullback
setup". The writer then computes its own composite from scratch
(`decision.ts:56-64`) and its own conviction. **Two independent scorings of the
same name, the second unable to see the first except as prose, and nothing
afterwards compares the plan that came back to the plan that was asked for.**

Concrete loss, from the DB. BMRN's dispatch note says, twice: *"This is a WATCHING
thesis — entry window opens January 2027 … The thesis should be written as WATCHING
status with entry to be established in January 2027."* The thesis came back with
`entryPrice = 64.67` — the same number the note quotes as the current price — and a
`PRICE_ABOVE 64.67` buy trigger. The instruction was in the prompt and could not be
obeyed: the decision schema requires an entry price for any LONG
(`decision.ts:197-199`).

On refresh, the writer never changes direction or status by design
(`run-thesis-writer.ts:1181-1187`); a changed view becomes a `⚠` sentence appended
to the rationale. When the daily run drove the refresh it reads that back
(`wait_for_thesis_refresh`). When chat drove it, the warning is prose nobody is
routed to.

### 4. The other outcomes

- **Terminal PASS** — `direction: "PASS"`, no status. Lands `status = PASSED`,
  triggers rejected outright (`record-thesis.ts:1094-1114`). 171 rows. Excluded
  from `get_theses` by default (`get-theses.ts:84`); read only on an explicit
  historical lookup. Discovery is told a capacity-PASS is re-dispatchable
  (`discovery.ts:270-271`), but with discovery idle nothing sweeps them.
- **Quiet watch** — `direction: "PASS"` + `status: "WATCHING"`. Must carry ≥1 wake
  trigger and they must all be REVIEW-action (`record-thesis.ts:1118-1145`). Since
  2026-09-01 it may also carry price levels; those become REVIEW wakes, not a buy
  (`price-levels.ts:350-362`). Costs no review attention. One row exists.
- **Demotion** — a floor breaking on something we don't own resolves to `DEMOTE`
  and strips the plan levels inline, no agent run (`trigger-evaluator.ts:714-751`).
  AMAT and HWM are sitting in that state now: WATCHING, LONG, all three price
  columns null.

### 5. The thesis writer's entry logic

`submit_thesis` (`decision.ts:29-94`) is the whole decision surface. For LONG/SHORT
it requires entry, target, stop, correct ordering, **R/R ≥ 2:1**
(`decision.ts:212`), a core belief, ≥2 assumptions, ≥2 invalidation conditions,
four scoring dimensions, a conviction tier, a rationale, and a size.

Then persistence rebuilds the ladder in four passes:

1. `defaultTriggersForHorizon(...)` mints the horizon template
   (`record-thesis.ts:1216`), including the dip-vs-breakout entry side computed
   from a live quote fetched for that purpose (`record-thesis.ts:1170-1184`,
   `defaults.ts:662-745`).
2. `mergeTriggers` overlays anything the model supplied.
3. **`applyLevelArgs` re-derives every level as a trigger** (`record-thesis.ts:1244`;
   `update-thesis.ts:1336`) — and `predicateFor` (`price-levels.ts:492-502`) returns
   `PRICE_ABOVE` for every long entry, overwriting step 1, and `rationaleFor`
   (`price-levels.ts:512-515`) overwrites the rationale with *"Buy level — start the
   position when the price breaks above $X."*
4. `validateEnterTriggerRequired` refuses a directional WATCHING row with no ENTER
   rung (`enter-guard.ts:196-223`).

**Expressive range, as built (pre-#586):**

| A human analyst would say | Can the system say it? |
|---|---|
| Buy it now, at market | No. Step 3 always mints a standing buy condition from `entry_price`. The writer prompt tells it to "omit the ENTER trigger" for buy-now (`run-thesis-writer.ts:363`) — that instruction cannot be honoured. |
| Buy the breakout above $X | Yes. The only shape that worked. |
| Buy the pullback to $X | **No** until PR #586. Authored correctly, stored inverted. |
| Buy after the catalyst prints | Only as a date/price proxy. Earnings/filing/news predicates cannot fire (routing paused, known). |
| Scale in a third here, a third at $X | Written, never read. See below. |
| No entry level yet — I'll price it later | No. Entry is mandatory for a directional view. |
| Buy in a band, $198–$206 | No. One level, one side. |

### 6. The living plan

Trigger evaluator runs every 5 minutes while the market is open
(`trigger-evaluator.ts:554-560`), on HOLDING + WATCHING, caps at 200 tickers,
resolves the thesis / analyst / account ladder, then per fire:

- **DEMOTE** → inline, strips the plan, no run (`:725`).
- **REVIEW** → writes a `TRIGGER_FIRED` audit row and defers to the next daily run
  (`:758-770`). Never spawns.
- **ENTER / EXIT** → spawns a tactical run, deduped by a same-day snooze on the
  same trigger id (`tactical-run.ts:388-410`).

Everything reaching Alpaca goes through the approval gate. Working as designed.

**Where a name can still fall through:**
- A writer refresh that concludes PASS on a WATCHING row leaves a `⚠` in prose with
  no `needsAction` kind behind it (`needs-action.ts:90-180` lists six kinds; there
  is none for "the researcher changed their mind").
- A floor sitting at or above an upside level makes one of the two true on every
  tick. The code detects it and deliberately does not block it
  (`price-levels.ts:79-93`). MU has fired 44 times in 30 days on exactly this.
- A buy level equal to the tape fires every cooldown forever and is never *wrong*
  enough to flag. `planSanity` catches entries >15% away (`plan-sanity.ts:51`) and,
  until PR #586, nothing at all at 0% away.

---

## What's broken — ranked

**1. The writer is asked for price structure and given none.**
`format-data-block.ts:210-244` renders six price facts and no series;
`format-data-block.ts:35-36` carries `sma20`/`sma50` and never prints them. The
synthesis instruction asks for entry/target/stop each "citing the level — breakout /
resistance / support / structural break". The model cannot cite what it was not
shown, so it anchors on the one number it trusts: today's price. This is the root
cause of the entry bug, it is not addressed by PR #586, and it also degrades targets
and stops (a stop "at support" chosen without support data is a guess).

**2. A buy level below the market was stored as a buy order above it — and the
analyst's words were overwritten.** `predicateFor` (`price-levels.ts:492-502`)
hardcodes `PRICE_ABOVE` for long entries and runs last; the dip-aware builder added
by #566 on 2026-08-28 (`defaults.ts:662-745`) is dead code on both write paths.
CRM's audit trail is the proof: minted 08-30 with an ENTER rung whose rationale read
*"Pullback to SMA20 resets extension and opens the PEAD drift entry"* and whose
predicate was `PRICE_ABOVE 203`; on 08-31 a routine ladder resend replaced that
rationale with *"Buy level — start the position when the price breaks above
$203.00"*; it then fired "Price above $203 — consider entry" on 08-31 and again on
09-01, each time producing prose instead of a correction. **In flight: PR #586 fixes
this.**

**3. There is no way to hold a view without pricing it.** `decision.ts:197-199`
makes entry, target and stop mandatory for LONG/SHORT. The alternatives are a
terminal PASS or a quiet watch with no direction. So "I'm bullish, the catalyst is
in February, I'll set the entry closer to the date" — which is what BMRN's dispatch
note asked for in plain English — is unwritable, and the writer resolved it by
pricing the entry at today's quote.

**4. Opinion is handed off as one free-text string.**
`dispatch-thesis-research.ts:31-71`. Nothing structured survives from the agent (or
person) that formed the view to the agent that writes the plan, the writer re-scores
from scratch (`decision.ts:56-64`), and no gate or review compares the returned plan
to the request. Every BMRN-class failure is invisible because there is nothing to
compare against.

**5. The 2:1 R/R floor exists on one of three write paths.** Enforced inside the
writer loop (`decision.ts:212`). `record_thesis` and `update_thesis` only *describe*
it (`record-thesis.ts:189`, `:231`) — there is no arithmetic check in either. Every
mint in the last two weeks came through principal chat calling `record_thesis`
directly. PLTR is stored WATCHING/LONG with entry $190, target $190, stop $110 — a
plan with zero reward and 42% risk, which no gate objected to.

---

## What's needlessly complicated — ranked

**1. Two thesis prompts; the famous one is not live.**
`build-synthesis-prompt.ts` (341 lines, home of `- Entry: $X (the current price
reference from the data block)` at line 236) drives `write_thesis_research`, the V1
meta-tool. The V2 writer stopped calling it in August (`run-thesis-writer.ts:6-19`,
`write-thesis-research.ts:1-14`) but the tool is still registered in the catalog
(`tools/index.ts:191`), so the dead prompt is still reachable and still reads as
authoritative. Everyone who has gone looking for "the writer prompt" this week found
the wrong file.

**2. The entry side is decided in two places.** After #586 lands there will be a
quote-aware side inference in `defaults.ts:662-745` *and* one in
`price-levels.ts:492-502`, with the second still overwriting the first. One should
be deleted.

**3. Four layers between "buy at $203" and a stored row.** Horizon template → merge
→ derive-on-write → shape guard, ~10,000 lines across `lib/agent/triggers/`. Each
layer was a correct answer to a real incident; together they make it genuinely hard
to predict what a given `record_thesis` call will store, which is how #566 could be
neutralised for five days without anyone noticing.

**4. Instructions the agents read that describe a system that no longer exists.**
All live prompt text:
- `modes.ts:678` tells principal chat the thesis statuses are
  `ACTIVE / WATCHING / INVALIDATED / CLOSED / SUPERSEDED`. That taxonomy was replaced
  in June.
- `modes.ts:764` (and again at `:873`) tells it to add a watchlist seed with `direction='PENDING'`.
  `record-thesis.ts:68` accepts only `LONG | SHORT | PASS`; that call cannot succeed.
- `enter-guard.ts:216`, the message the model gets when its ladder has no ENTER rung,
  says *"target_price is required … that's the level the ENTER trigger fires on."*
  That is the exact bug fixed on 2026-05-31; the repair instruction still teaches it.
  The same message names `PRICE_ABOVE for LONG` as the only entry shape.
- `record-thesis.ts:770-775` states `max_hold_days` is REQUIRED for TRADE horizon.
  There is no such gate, and `decision.ts:187` records that the field was removed.

**5. `scalingPlan` — a structured column nothing reads.** Authored via
`record_thesis` / `update_thesis` (`record-thesis.ts:322-334`), stored on 69 theses,
selected into the tactical run's thesis object (`tactical-run.ts:268`, `:675`),
declared in the tactical prompt's input type (`intraday-tactical.ts:33`) — and never
rendered into any prompt, never validated, never connected to `place_trade`. Scaling
in is writable and inert.

---

## What a human analyst can do that this system cannot

1. **Say "I'd start buying around $203, on the way down."** Fixed in flight (#586);
   it was impossible for the entire life of the product before this week.
2. **Say "buy it now"** without simultaneously creating a standing buy condition. The
   writer prompt describes the shape (`run-thesis-writer.ts:363`); persistence mints
   the trigger anyway.
3. **Hold a view without a price.** "I like it, entry to be set in January." Not
   expressible for a directional thesis.
4. **Buy in a range.** One level, one side, one comparison. No band, no two-sided
   entry ("above $210 on volume, or back at $195").
5. **Scale in.** Writable as `scalingPlan`, read by nothing.
6. **Say "buy the day after the print, whatever it opens at."** Event predicates
   cannot fire (routing paused — known and ticketed); the workaround the prompt
   offers is a price or time proxy, which is not the same instruction.
7. **Change its mind on a refresh.** The writer is structurally forbidden from moving
   direction or status; it can only leave a warning sentence.
8. **Retire a spent level.** When a raised floor passes a stale checkpoint, both stay
   and one fires forever. The code names this (MU, 44 fires) and declines to act on it.

---

## What I could not determine

- **How much of the entry-at-current-price pattern is the missing data vs the model's
  habit.** I can show the writer has no structural levels and that its entries land on
  the tape. I cannot prove it would place them well if given moving averages and swing
  highs. That is a one-run experiment, not a code question.
- **Whether the `⚠ writer changed its mind` flag has ever been missed in production.**
  It has no `needsAction` kind, so it should be droppable, but I found no case in the
  audit log where it was written and then ignored. The hole is structural; I did not
  observe it.
- **Why several WATCHING rows carry `GAIN_FROM_ENTRY` fires** ("Up 10% from entry" on
  HPE and PRAX, both WATCHING). The evaluator returns false for that predicate without
  an open position (`trigger-evaluator.ts:681-685`), so the likeliest explanation is
  that they were HOLDING when they fired and were demoted later — but I did not
  reconstruct the status history to confirm it.
- **The health of the 171 PASSED rows.** They are excluded from the default thesis
  read and nothing sweeps them while discovery is manual. Whether that pile contains
  live ideas is a judgement call about the names, not something the code can answer.
- **Whether the proposal decline rate is a quality signal.** In 30 days: 18 exits
  filled, 19 rejected, 23 expired. That is the approval gate working as designed and I
  am not reporting it as a defect — but the ratio is a real input into whether exit
  proposals are being written at the right levels, and reading it needs the names, not
  the code.

---

### Notes on scope

Deliberately not re-reported as discoveries, per the brief: paused signal routing
(~99 of 294 triggers on predicates that cannot fire), the disabled Sunday discovery
cron, pending/expiring approval-queue proposals, and the existence of
`plan-sanity.ts`. Each is noted above only where it shapes the trace.

PR #586 (`fix: an entry price is a price we have not reached`) was open while this
audit was written and is the fix for finding #2. It changes prompt wording, threads a
live quote into `predicateFor`, and adds an `ENTRY_AT_PRICE` plan-sanity flag. It does
not add price structure to the writer's data block, which is finding #1.
