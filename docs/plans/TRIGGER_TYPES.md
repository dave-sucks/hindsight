# Triggers, rebuilt on one condition shape

> Written 2026-10-03, revised 2026-10-04 after review. The first draft gave
> each type its own form; this one uses one fixed shape for every condition.
> **Status: proposed, nothing built.** When PR 3 lands this replaces the "what
> a trigger can watch" parts of `docs/TRIGGERS.md` and
> `docs/plans/TRIGGER_MODEL.md`. The fire rules in
> `docs/plans/TRIGGER_LIFECYCLE.md` (who sets what, standing order vs.
> crossing, the cascade) do not change.

## 0. The answer

A trigger is one sentence: **when** a condition is true, **then** buy, add,
trim, sell or review.

Today the "when" half is **20 separate kinds** plus AND / OR. Each kind has
its own fields, its own sentence, its own dialog tab and its own case in a
dozen switch statements across 48 files.

It becomes **one shape, the same for every condition**:

> **[ type ] → [ tab ] → [ Below | Above ] [ value ]**

- **The type** (Price, Indicator, Earnings, Filing, Schedule) is picked on
  the sheet, before the dialog opens. It never changes inside the dialog.
- **The tabs** pick the measure: `$ Price | % Move`, `Volume | RSI | vs.
  S&P | Gap up`, `Report date | Result`, and so on.
- **The button group** is the direction: Below / Above, Before / After,
  Miss / Beat.
- **The value input** takes a number you type, or a **variable** inserted
  from a button inside the input, the way Notion inserts "Time triggered".
  For example, *52-week high* instead of $412.70, or *the buy* instead of a
  date. For a %, the variable is what the % is measured from.

No field appears or disappears.

What can be watched is **one catalog of measures**, and the five types are
its groups. Every one of today's 20 kinds is this shape with one catalog
entry (§3.5). Adding a new signal later means adding one catalog entry, with
no new form, no new kind and no new switch statement.

Four PRs, each merged on Dave's click:

1. **The new editor**, built on the shape and the catalog. It still saves
   the old kinds, so the visible mess is fixed first.
2. **The new trigger check** runs alongside the old one in production and
   logs every disagreement. Nothing it decides is acted on yet.
3. **The cutover.** Storage, every writer, the agents' tools and the prompts
   all move to the shape, and the 20 kinds are deleted.
4. **The cleanup.** The translator for old rows goes once none are left.

---

## 1. What is wrong today (measured on main and the production database, 2026-10-03)

**The dialog has eight tabs:** Price, Move, Gain, Trail, Agent Watch,
Earnings, Filing, Chart. "Chart" opens a menu of nine unrelated kinds,
insider buying among them. "Agent Watch" is the review schedule. The tabs are
wider than the dialog, so the selects and the Add button spill past its
right edge.

**Inside a tab, every choice reshapes the rest of the form**, so no two
triggers are built the same way.

**One idea is built nine ways.** "The price compared to a line" is
`PRICE_ABOVE` / `PRICE_BELOW`, `VS_SMA`, `NEW_HIGH` and `PCT_FROM_52W_HIGH`.
"The price moved X% from a point" is `PRICE_MOVE_PCT`, `GAIN_FROM_ENTRY`,
`TRAILING_FROM_HIGH` and `NEAR_SMA`. Earnings is four kinds. The review
schedule is one kind with three "counting from" modes bolted on.

**The kinds are wired in everywhere.** Kind names appear in 48 non-test files
(26 of them in `lib/agent/triggers/`) and 85 test files. A new kind has to be
added in about ten places: types, the server schema, the model schema, the
checker, the data-needs list, the sentence, the cascade key, the editable
parts, the dialog and the pill. `LANES.md` §2 lists them as its "ships whole"
checklist.

**There are four surfaces with four different looks:** the Add dialog, the
pill, the popover on a stock's own trigger, and the popover on an inherited
rule. "Review if below the 200-day" opens as a greyed text box, not as the
form that builds a price trigger.

**The agents pay for it.** The trigger union is about 19,100 characters
(~4,800 tokens) of tool definition. The writer's decision schema is about
45,000 characters and names `PRICE_MOVE_PCT` six times. On 2026-09-25 the
writer invented a kind that doesn't exist, and two runs' research was thrown
away (DAV-316).

**What's stored:**

| Where | Triggers | Notes |
|---|---|---|
| Live stocks (11 held, 33 watched) | 202 | all LONG or unset; no shorts |
| Analyst rules (3 seats) | 12 | |
| Account rules | 12 | |
| Retired and passed stocks | 683 | includes 16 of `REVIEW_DATE_HIT`, a kind deleted in August |

Six kinds have no live trigger at all: `NEW_HIGH`, `PCT_FROM_52W_HIGH`,
`GAP_UP`, `RSI`, `INSIDER_CLUSTER` and `OR`. They exist only in the setup
templates (`lib/agent/knowledge/setups.ts`), which use every kind.

---

## 2. Where the shape comes from

| Pattern | Where it comes from | What it means here |
|---|---|---|
| **One grammar: When → Then** | Zapier, Attio workflows, Linear automations, iOS Shortcuts | A condition and an action. The action half is already right. |
| **One condition shape: what, which way, a value** | Composer (*indicator · greater or less than · a number or another indicator*), Notion filters (*property · operator · value*), TradingView alerts | Every condition has the same three fields. The value is a number, or for price, a number measured from another price. |
| **Measures are data, not code** | Notion property types, Zapier fields | Each thing you can watch is a catalog entry: its label, its unit, where its number comes from, its words, and the actions it allows. |
| **The form reads as a sentence** | Composer, Shortcuts | The dialog's parts read as the sentence: "% · Below · 25% from ⟨high since we bought⟩" is "down 25% from the high since we bought". The saved trigger reads the same everywhere. |
| **One editor, three modes** | Linear, Attio | Adding a trigger, editing one, and viewing an inherited rule all use the same form. An inherited rule shows read-only, with a link to where it's set. |
| **Show the number** | TradingView, broker stop tickets | The form shows what the line is today: "fires at $227.55; CEG $258.92". |
| **Definition apart from history** | Zapier (the zap vs. its task history) | What a trigger says is stored separately from when it last fired. |
| **Change the schema like a database** | Expand, migrate, contract; GitHub's Scientist (run new code alongside old and compare) | The old shape keeps being read while new writes use the new one. The new checker proves itself against the old one on live data before anything depends on it. |

---

## 3. The shape

### 3.1 The dialog's parts, the same for every type

```
Add trigger · Price                                      ✕
ACTION      [ Sell if ▾ ]
CONDITION   [ $ Price | % Move ]                          ← tabs
            [ Below | Above ]  [ $ 248.00           {x} ] ← button group · value input
            CEG is $258.92. 4.2% away.                    ← the line under it
            [ Any time in the day ▾ ]                     ← one setting, where the type has one
            + And also…
ON FIRE     [ Ask the analyst first ▾ ]
▸ More options
```

- **Tabs** pick the measure within the type.
- **The button group** is the direction. Its words fit the measure (Below /
  Above, Before / After, Miss / Beat), but it is always the same control in
  the same place.
- **The value input** takes a typed number, or a variable from the `{x}`
  button inside it. A chosen variable shows as a blue chip in the input, the
  way Notion shows "Time triggered", and its × puts the number back.
- **The line under it** says what the condition means today, in numbers.
- **One setting** sits under that for the types that have one: "any time in
  the day / only on the close", the RSI period, the vs. S&P window, the
  insider window, or where an earnings window starts counting. It is stored
  as the condition's `params` (§5).

### 3.2 Price

**$ Price tab:** `[ Below | Above ] [ $ number  or  ⟨variable⟩ ]`. The
variable replaces the number: *Below · ⟨200-day average⟩*, *Above ·
⟨20-day high⟩*.

**% Move tab:** `[ Below | Near | Above ] [ number % from ⟨variable⟩ ]`. The
variable is what the % is measured from: *Below · 25% from ⟨high since we
bought⟩* is a trailing stop, and *Below · 7% from ⟨yesterday's close⟩* is
down 7% today.

**Near** means within ± the number of the variable. It is the one extra
button the % tab needs: it keeps "within 2% of the 50-day" (the pullback
buy: one live trigger, four setup templates) and "within 5% of the 52-week
high".

**The variables** are yesterday's close · the close 5 or 20 days ago · our
entry · the high since we bought · the 20, 50, 150 or 200-day average · the
20-day high or low · the 52-week high or low. The menu shows each one's value
today.

Three checks show as a message under the input. None of them changes the
form.

- A % needs something to be measured from.
- Near needs a distance.
- The price can't rise above the high since we bought.

Our entry and the high since we bought are measured in the trade's
direction, as `GAIN_FROM_ENTRY` and `TRAILING_FROM_HIGH` are today. There are
no shorts on the book.

| Tab · buttons · value | Reads as |
|---|---|
| $ · Below · $248 | Sell when the price falls below $248 |
| % · Below · 25% from ⟨high since we bought⟩ | Sell when the price is down 25% from the high since we bought |
| $ · Below · ⟨200-day average⟩ | Review when the price falls below the 200-day average |
| % · Below · 7% from ⟨yesterday's close⟩ | Add when the price is down 7% today |
| % · Near · 2% of ⟨50-day average⟩ | Buy when the price is within 2% of the 50-day average |
| % · Above · 15% from ⟨our entry⟩ | Review when the price is up 15% from our entry |
| $ · Above · $183, only on the close | Buy when the price closes above $183 |
| $ · Above · ⟨20-day high⟩ | Buy when the price rises above the 20-day high |

**The trailing-stop options** ("start once up X%", "widen to N× the daily
range") and the gain option ("not for a fast big winner") stay under More
options. They are settings on the trigger and leave the condition alone.

### 3.3 The other four types fill the same parts

| Type | Tabs | Buttons | Value: type it, or insert a variable | The one setting |
|---|---|---|---|---|
| Indicator | Volume · RSI · vs. S&P · Gap up | Below · Above (Gap up: At least) | × a normal day · the RSI level 0–100 · points vs. the S&P · the gap in % (on 3× volume) | Volume: any time / on the close · RSI: 14-day / 2-day · vs. S&P: over 1 / 3 / 6 months |
| Earnings | Report date · Result | Before · After / Miss · Beat | days from the report · the surprise in % vs. the estimate (0 = any) | Report date, After: counted from the report day / the day after |
| Filing | SEC filing · Insider buying | Material · Red flag / At least | any filing, or a variable for one event (⟨8-K 5.02⟩ an officer leaves, ⟨S-3⟩ new shares, ⟨13D⟩ an activist; the menu lists every item and form in `lib/market-data/sec-events.ts`) · how many insiders | Insiders: in the last 30 / 90 days |
| Schedule | Repeat · From a date | Every / After · Before | Repeat: N days, weeks or months · From a date: N days from ⟨the buy⟩ or ⟨the event date⟩ | Repeat counts from the last review. From a date asks again every N days while it stays true (today's behaviour), and the line under the input says so. |

**What the indicators are, in plain words:**

- **Volume** is how much stock traded today against a normal day; 1.5 means
  half again as much, which is used to confirm a breakout.
- **RSI** is a 0–100 gauge of how hard the stock has moved lately: under 30
  it has sold off hard, over 70 it has run up hard.
- **vs. S&P** is how much better or worse the stock did than the S&P 500
  over the window, in percentage points.
- **Gap up** means it opened well above the previous close on heavy volume,
  usually on news.

"After · N days" on the report date means the N days after it. Where the
count starts is the tab's one setting: **the report day** (the live review
counts days 0–2) or **the day after** (the earnings-drift setup's buy
window). That covers every stored `EARNINGS_SINCE`, so no window needs a
second condition.

### 3.4 Combining conditions

**And also…** adds a condition. With two or more, the form offers **Match
all / Match any**. Groups can nest one level, because the setup templates
need it ("a breakout on volume, or a pullback to the average").

"And also…" first offers the five type buttons, then adds that type's parts
under the first condition. The type picked there is the second condition's
own, so "earnings beat **and** down 3% today" is an Earnings condition plus a
Price condition. A range, such as a price band, is two conditions joined
this way.

### 3.5 Every kind today, in the new shape

Live counts are the triggers on live stocks plus analyst and account rules.
Conditions inside an AND are counted on their own.

| Kind today | Type · tab · button · value | Live | In setup templates |
|---|---|---|---|
| `PRICE_ABOVE` | Price · $ · Above · a number | 40 | 7 |
| `PRICE_BELOW` | Price · $ · Below · a number | 45 | 1 |
| `VS_SMA` | Price · $ · Below/Above · ⟨an average⟩ | 4 | 3 |
| `NEW_HIGH` | Price · $ · Above · ⟨20-day high⟩ / ⟨52-week high⟩ | 0 | 1 |
| `PRICE_MOVE_PCT` (1D / 5D / 20D) | Price · % · Below/Above · from ⟨yesterday's close⟩ / ⟨5 days ago⟩ / ⟨20 days ago⟩ | 15 | |
| `GAIN_FROM_ENTRY` | Price · % · Below/Above · from ⟨our entry⟩ | 12 | |
| `TRAILING_FROM_HIGH` | Price · % · Below · from ⟨high since we bought⟩ | 5 | |
| `NEAR_SMA` | Price · % · Near · ⟨an average⟩ | 1 | 4 |
| `PCT_FROM_52W_HIGH` | Price · % · Near · ⟨52-week high⟩ ¹ | 0 | 1 |
| `VOLUME_RATIO` | Indicator · Volume · Above | 2 | 4 |
| `RSI` | Indicator · RSI · Below/Above | 0 | 2 |
| `RS_VS_SPY` | Indicator · vs. S&P · Above | 2 | 1 |
| `GAP_UP` | Indicator · Gap up · At least | 0 | 2 |
| `EARNINGS_WITHIN` | Earnings · Report date · Before | 10 | 1 |
| `EARNINGS_SINCE` | Earnings · Report date · After · N days, counted from the report day or the day after | 1 | 2 |
| `EARNINGS_BEAT` / `EARNINGS_MISS` | Earnings · Result · Beat / Miss | 22 / 16 | |
| `SEC_EVENT` | Filing · SEC filing · Material / Red flag · any, or ⟨one event⟩. A rule naming several events (the Catalyst seat's 8.01 + 7.01 wake) becomes Match any of one-event conditions | 3 | |
| `INSIDER_CLUSTER` | Filing · Insider buying · At least | 0 | |
| `REVIEW_CADENCE` (3 modes) | Schedule · Repeat · Every N; or From a date · After / Before · from ⟨the buy⟩ / ⟨the event date⟩ | 55 | |
| `AND` / `OR` | And also… · Match all / Match any | 7 / 0 | many |
| `REVIEW_DATE_HIT` (deleted in Aug) | kept verbatim as a retired condition that never fires; 16 rows, all on retired stocks | 0 | |

¹ Today this also counts any price *above* the old 52-week high. Under Near,
a price more than X% above it is not "within". No live trigger uses it, and
the parity test (§9) covers that range explicitly.

---

## 4. The "then" half: actions and options

**Actions:** the UI says Buy · Add · Trim · Sell · Review. The stored values
(`ENTER` / `ADD` / `TRIM` / `EXIT` / `REVIEW`) don't change. Setting down a
watched plan stays as it is today: decided at fire time, never written by
anyone. No stored trigger uses `MOVE_STOP`; PR 3 deletes it once a check
confirms nothing writes it.

**Options**, behind "More options":

- **How it runs:** *Ask the analyst* (the default), or *Propose the sale
  right away*. The second is for sells at a typed price, or a % from ⟨a
  prior close⟩, ⟨our entry⟩ or ⟨high since we bought⟩: exactly today's
  eligible set. The old label was "Automatically Exit", but it was always a
  proposal you approve.
- **At most once every N days.** The field shows the default, which comes
  from the catalog entry and the action. It is tested per action, because a
  default keyed only by kind once reached buys it was never meant for (#719).
- **The trailing-stop and gain options** (§3.2).
- **Note for the analyst** (stored as `rationale`).

**When it fires** is shown, not set. It follows from the action, exactly as
today:

- A buy fires once, when the price crosses (DAV-229).
- A sell, trim, add or review asks every day its condition stays true.
- A watched stock's floor is read on the close (DAV-337).

The form says which of these applies, in one line.

**Which actions each group allows.** Today this rule is split across
`conditionForcesReview`, `isDirectEligiblePredicate` and the schema checks.
It becomes one table, read from the catalog:

| | Buy | Add | Trim | Sell | Review | Propose right away |
|---|---|---|---|---|---|---|
| Price | ✓ | ✓ | ✓ | ✓ | ✓ | sells: $ at a typed price, or % from ⟨a prior close⟩, ⟨our entry⟩ or ⟨high since we bought⟩ |
| Indicator | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Earnings | only in "match all" with a price | | | | ✓ | |
| Filing | | | | | ✓ | |
| Schedule: days since the last review | | | | | ✓ | |
| Schedule: from a date (the buy, the event date) | | | ✓ | ✓ | ✓ | |

PR 1 checks each cell against today's code and the stored rows. Any cell
that differs from what the code allows today is listed in the PR rather than
quietly changed.

---

## 5. The schema

```ts
// lib/agent/triggers/condition.ts
type Condition = {
  watch: Watch;            // the dialog's type + tab pick it
  is: Direction;           // the button group
  value?: number;          // what you type
  variable?: VariableId;   // what you insert: in place of the value (a $ price, one filing event),
                           // or what a % or a day count is measured from
  unit?: "$" | "%";        // price only: the $ / % tab
  params?: Params;         // the watch's own settings: the one setting under the input, and More options
};
type Group = { match: "all" | "any"; conditions: (Condition | Group)[] };   // nests one level

type Watch = "price" | "volume" | "rsi" | "strength" | "gap" | "report" | "surprise"
  | "filing" | "insiders" | "schedule";

type Direction = "below" | "above" | "near" | "before" | "after" | "miss" | "beat"
  | "material" | "red_flag" | "at_least" | "every";

type VariableId =
  | "prev_close" | "close_5d" | "close_20d" | "entry" | "peak"
  | "sma20" | "sma50" | "sma150" | "sma200" | "high20" | "low20" | "high52" | "low52"   // prices
  | "buy" | "event"                                                                     // dates
  | FilingEventId;   // every 8-K item and form in lib/market-data/sec-events.ts, e.g. "5.02", "S-3"

type Params = {
  onClose?: boolean;                 // price, volume: read on the 16:20 close pass
  period?: 2 | 14;                   // rsi
  window?: "1M" | "3M" | "6M";       // strength
  withinDays?: number; volume?: number;   // gap (playbook defaults: 3 days, 3×)
  fromDay?: 0 | 1;                   // report, after: count from the report day or the day after
  days?: 30 | 90;                    // insiders
  every?: "days" | "weeks" | "months";    // schedule, repeat: the unit the number is in
  startOnceUpPct?: number; widenAtr?: number;          // price, % from the high: the trailing-stop options
  fastWinner?: { gainPct: number; withinDays?: number }; // price, % from entry, above: the big-winner switch
};
```

**That is the whole condition type.** It has no union of kinds, and a reader
never switches on a shape. Every condition is a watch, a direction, and a
value or a variable, which is exactly what the dialog shows. Which
directions, variables and params each watch accepts lives in the catalog,
not in the type. Windows and periods are params, not part of the watch's
name, so adding "RSI, 5-day" is one allowed value and not a new watch.

**The trigger keeps its field names** (`id`, `predicate`, `action`,
`rationale`, `cooldownDays`, `fireMode`, `source`). Only what goes inside
`predicate` changes. Old predicates have a `kind` field and new ones have
`watch` (or `match` for a group), so a reader can tell them apart without a
version number.

**Fire history moves off the definition.** `lastFiredAt`, `firedFilings`
and `firedReports` join `rearmedAt` in `Thesis.triggerState[id]`, at every
level. Inherited rules already keep their history there, so `levels.ts`
handles two cases today; after the move it handles one. An edit can then
never wipe a trigger's history. `writtenPrice` and `writtenAt` stay on the
buy, because they are part of what the buy means.

**What the agents are sent** is the same object: one flat set of fields with
enums, and no union at all. Today's trigger union is ~19,100 characters; this
should be a small fraction of that. It may also fit Anthropic's strict-mode
limits, which the current schema fails. PR 3 measures both rather than
assuming them.

---

## 6. One catalog, one checker

```ts
// lib/agent/triggers/condition/catalog.ts: one entry per watch. Client-safe (no node imports).
interface WatchDef {
  watch: Watch;
  type: "price" | "indicator" | "earnings" | "filing" | "schedule";   // the sheet's five buttons
  tabs: Tab[];                    // each tab: its label, its buttons, its value input, its one setting
  params: ZodType<Params>;        // which params this watch accepts, with defaults
  needs(c: Condition): DataNeeds; // quote, position, chart snapshot, today's volume, calendar, filings
  read(c: Condition, ctx: EvaluationContext): Reading | null;   // the number now and the line it's held to
  words(c: Condition, r?: Reading): { sentence: string; pill: [string, string?]; line?: string };
  slot(c: Condition, action: TriggerAction): string;            // cascade identity, never the typed value
  actions(c: Condition): ActionRule;                            // the §4 table
  cooldownDays(c: Condition, action: TriggerAction): number;    // today's defaults, per variable and action
  readsPrice(c: Condition): boolean;                            // can a buy cross it
}
// lib/agent/triggers/condition/variables.ts: one entry per variable: its label, its menu
// group, and how the resolver reads its number. Shared by every watch that offers it.
```

**There is one checker for everything.** Read the number, then compare it in
the direction the button says. For price the line comes first: the
variable's number from the resolver, or the typed price, then ± the value in
% for the % tab. `read` returns both the number and the line, so the same
values reach the dialog's line, the Activity line and the agent's fire
payload.

**The cascade slot is `watch + is + variable`, never the typed value,**
plus the params that change what is watched (the RSI period and the vs. S&P
window, not the insider window or the gap's days). That gives the same
equivalence classes as today's `predicateKey`, which PR 1 proves over every
stored trigger. It covers three special cases:

- A fixed-price buy above and a fixed-price buy below share one slot, as
  today.
- A material filing rule and a red-flag rule share one slot, as today.
- "$248" and "$256" are the same floor, and a stock's own trailing stop still
  overrides its analyst's.

These consumers switch on kind today and will read the catalog instead:
`evaluate.ts`, `format.ts`, `bucket.ts`, `editable.ts`, `indicator-needs.ts`,
the "needs" helpers in `trigger-evaluator.ts`, `live-evaluate.ts`,
`chart-context.ts`, the cooldown defaults in `defaults.ts` and
`state-cooldown.ts`, `isDirectEligiblePredicate` and
`protectiveExitCloseReason` in `types.ts`, `ratchet.ts`, `price-levels.ts`,
`rearm.ts`, `demote.ts`, `frozen-copy.ts`, `schema.ts`, `model-schema.ts`,
`dialog-condition.ts`, and `predicateKindValue` / `predicateDescription` in
`ThesisTriggersSection.tsx`.

**Where the variables' numbers come from.** The checker, the dialog's line
and the sheet all use this one resolver. It generalises `predicatePrice` in
`price-levels.ts`, which already does this for fixed prices, the trail and
the gain.

| Variable | Number | From | Missing when |
|---|---|---|---|
| our entry | `Position.avgCost` | the position | not held |
| the high since we bought | `Position.peakPrice` (trail options applied by `trail.ts`) | the price monitor | not held |
| yesterday's close | the quote's prior close | the live quote | no quote |
| the close 5 / 20 days ago | `closes[n − 5]` / `closes[n − 20]` | the 06:30 chart snapshot | no snapshot |
| an average | `sma[days]` | the snapshot | no snapshot |
| 20-day / 52-week high, low | `high20` / `high52w` / `low20` / `low52w` | the snapshot | no snapshot |
| the buy · the event date | `Position.openedAt` · `Thesis.catalystDate` | the position · the thesis | not held · no date |

All of these numbers are in the snapshot, on the position or on the thesis
today. A missing number means the condition is false: a missed fire, never a
crash.

### 6.1 How every fire rule carries over

I checked each rule against today's code (`shouldFire`, `defaults.ts`,
`ratchet.ts`, `price-levels.ts`, `bucket.ts` and the evaluator). None of them
is keyed on anything the new shape loses.

| Rule today | Where it lives | In the new shape | Same? |
|---|---|---|---|
| A buy fires on the crossing: true now, false at the prior close. A buy written after the close crosses from its written price. | `shouldFire`, `written-price.ts` | The same code. "Can it cross" becomes `readsPrice` on the catalog (price and RSI). | Same, with one exception: a buy on a % from ⟨yesterday's close⟩ written mid-day now waits for a crossing like every other price buy. No live trigger is affected. |
| Sells, trims, adds and reviews are standing orders; declining one means "not today". | `shouldFire` (by action) | Unchanged | Same |
| Buys and adds never fire on a stale quote; sells do. | `shouldFire` (by action) | Unchanged | Same |
| Cooldown defaults by kind and action; a 7-day floor on a review of a state (below the 200-day, near the 52-week high); 0 allowed only on a sell. | `defaults.ts`, `state-cooldown.ts` | `cooldownDays` on each catalog entry, by variable and action, with the same floor | Same. The parity grid covers every cell of today's table. |
| Once per report (the heads-up), once per filing | `firedReports`, `firedFilings` | The same fields, moved into `triggerState` | Same |
| A buy passed because the price slipped back is not used up | `rearm.ts` | The same rule, on a fixed-price buy | Same |
| "Only on the close" waits for the 16:20 pass | `basis` on fixed prices | `params.onClose` on price and volume | Same, and now also available on a % move |
| A watched stock's floor is read on the close, never on an intraday dip | `watchedFloorOnClose` | The same rule, on a fixed-price sell | Same |
| A sell on a stock we don't own sets the plan down, and so does a target reached before we bought | `effectiveTriggerAction` | The same rule, keyed on a fixed-price condition | Same |
| Propose the sale right away, with no analyst | `isDirectEligiblePredicate` | Catalog: price, $ at a typed price, or % from a prior close, our entry or the high | Same set |
| A protective sale is labelled stop or target | `protectiveExitCloseReason` | The same rule, by side and variable | Same |
| Agents may tighten a protective level, never lower, widen or remove one | `ratchet.ts` | The same comparison, within a slot. Swapping the variable is a different slot, so it counts as removing the old protection. | Same, and stricter on a variable swap, which no kind could express |
| One trigger per slot; the stock beats the analyst, which beats the account | `bucket.ts`, `levels.ts` | `slot` on the catalog | The same classes, proven over the real book |
| Plan levels: the buy, the floor (the tightest of a fixed price, the trail and a loss from entry), the target | `price-levels.ts` | The same slots; the floor's price comes from the resolver | Same. Letting an average count as the floor is a one-line change, left for later. |
| Two protective fires start one run | `co-fire.ts` | Unchanged (by action) | Same |
| A stock stops carrying a copy of its analyst's rule | `frozen-copy.ts` | Compares the new shape | Same |
| The fire arrives with its numbers | `chart-context.ts`, `format.ts` | `read` + `words`: one source for the dialog's line, the Activity line and the agent's fire payload | Same numbers, from one place |

### 6.2 Scale

- **Checking stays cheap.** It is pure arithmetic over numbers fetched once
  per pass. Today that is 44 stocks with about 10 triggers each after
  inheritance; at ten times that, it is still a few thousand comparisons
  every five minutes.
- **Data calls don't change.** `needs` is collected per pass, then batched:
  one quote call for the book, one snapshot read, one calendar call, and
  EDGAR only for stocks with a filing condition. The quote-budget rules in
  LANES §3.9 stay as they are.
- **Growth is additive.** A new measure is one catalog entry, a new variable
  is one entry in the variable list, and a new window is one allowed param
  value. None of them adds a form, a kind, a switch statement or a model
  union.

---

## 7. The editor

```
On the sheet, under the trigger rows:
  ADD TRIGGER  [ $ Price ] [ ∿ Indicator ] [ ◷ Earnings ] [ ▤ Filing ] [ ↻ Schedule ]
                    ↓ pressing Price opens:
┌ Add trigger · Price ─────────────────────────────────────── ✕ ┐
│  ACTION      [ Sell if                                    ▾ ] │
│  CONDITION   [      $ Price      |       % Move           ]   │
│              [ Below | Near | Above ] [ 25 % from ⟨High since we bought⟩ × {x} ]
│              High since we bought $303.40, so it fires at $227.55.          │
│              CEG is $258.92. 12.1% away.                                    │
│              [ Any time in the day                        ▾ ] │
│              + And also…                                      │
│  ON FIRE     [ Ask the analyst first                      ▾ ] │
│  ▸ More options                                               │
│ ───────────────────────────────────────────────────────────── │
│  Sell when the price is down 25% from the high since we bought.
│                                          [ Cancel ]  [ Add ]  │
└───────────────────────────────────────────────────────────────┘

Every other type fills the same parts:
  Schedule · From a date [ After | Before ]  [ 60 days from ⟨The buy⟩ × {x} ]
  Indicator · RSI      [ Below | Above ]   [ 30 on 0–100 ]        [ 14-day RSI ▾ ]
  Filing · SEC filing  [ Material | Red flag ] [ Any filing {x} ]  or [ ⟨8-K 5.02⟩ × {x} ]
```

- **The type is picked on the sheet**, from the five buttons under "Add
  trigger", and it shows in the dialog's title. It never changes inside the
  dialog. "And also…" offers the same five buttons for the second
  condition.
- **The variable button `{x}` sits inside the value input.** It opens a
  short menu grouped by kind (recent closes, our position, averages, highs
  and lows; or dates; or filing events), each with today's value. The chosen
  variable shows as a blue chip in the input; its × removes it.
- **Clicking a pill opens the same form.** A stock's own trigger opens it
  editable, with Save and Delete. An analyst or account rule opens it
  read-only, with "Set on Secular Compounder — edit in analyst settings".
  The analyst and account settings pages use the same pills and the same
  form.
- **Pills read as the sentence**, split into label and value by the catalog:
  "down from the high · 25%", "below the 200-day", "every · 30 days",
  "before earnings · 5 days", "earnings beat", "SEC filing · material". The
  rows keep "Buy if / Add if / Trim if / Sell if / Review if". Dashed borders
  still mean inherited.
- **The line under the input.** In PR 1 it is the condition's sentence. In
  PR 2 the sheet's `/triggers` payload gains the variables' numbers from the
  resolver the checker uses, and the line shows them ("fires at $227.55; CEG
  $258.92"). Showing the number is what stops a 25% trail being typed as 2.5.
- **ShadCN components as they are:** Dialog, Tabs, ButtonGroup, Select,
  InputGroup (the value input, with the `{x}` button as an addon), Popover
  with Command (the variable menu), Badge (the chip; it needs one new
  `variable` variant, which is Dave's call), Collapsible and Button. Layout uses wrapper divs, with no custom classes on ShadCN
  components (CLAUDE.md). There is an empty state for a stock with no
  triggers, a loading state on save, and an inline message naming what is
  missing.

---

## 8. The agents

- **Tools.** `update_thesis` keeps its add / edit / remove operations by id;
  the trigger inside them is the new shape. An edit becomes `{ id, value?,
  variable?, action?, fire_mode?, rationale?, cooldown_days? }`: one number
  or one variable, the same for every trigger. Today it is `level`, `pct` or
  `days` depending on the kind. `entry_price`, `target_price` and
  `stop_loss` still write the fixed-price buy, target and floor, as today. The writer's `submit_thesis` uses
  the same object. The PR reports the tool-definition size before and after,
  from `prompt-size.test.ts`.
- **Old kinds are translated, never refused.** A model that still sends
  `{ kind: "PRICE_BELOW", level: 248 }` has it translated, with a note on the
  row. This matches the rule from #713 that a refusal is never dropped.
- **What agents read.** `get_theses`, the tactical fire payload and the run's
  book show each trigger as its sentence plus its id (for edits). That is the
  same sentence Dave sees on the pill.
- **Prompts.** `system-prompt.ts` and four files in `lib/agent/knowledge/`
  name kinds. The PR lists the exact paragraphs removed and added (LANES law
  7).
- **Setup templates.** `setups.ts` is rewritten in the shape. Its
  placeholders (`{pivot}`, `{gapDayLow}`, …) stay as they are.

---

## 9. Migration and safety

**The translator.** `fromLegacy` is pure and covers every kind, including
`REVIEW_DATE_HIT`. `toLegacy` exists for PR 1's adapter and for the
emergency down-script; it returns null for rows only the new shape can
express.

**Proof over the real book**, in PR 1:

- Every stored trigger (885 on stocks, 24 rules) translates.
- Every live trigger turns into the new shape and back unchanged. The one
  exception is the filing rule naming two events, which comes back as Match
  any of two one-event rules; the parity grid shows it fires the same.
- **Cascade slots are preserved:** two triggers share a slot before the
  change if and only if they share one after.
- The PR body carries a table of every live trigger's sentence, before and
  after.

**Checker parity:**

- **In CI:** every live trigger and every setup template is checked by the
  old and new checkers over a grid of cases: prices either side of its line
  and exactly on it, held and not held, with and without the chart snapshot,
  intraday and on the close, and dates either side of the report or event.
  Both checkers must agree on every case.
- **In production (PR 2):** the new checker runs on every five-minute pass
  and the 16:20 close pass. Any disagreement is logged with the trigger and
  the numbers. The cutover waits for at least three trading days with zero
  disagreements.

**The cutover (PR 3):**

- Reads accept both shapes; writes produce only the new one.
- A backfill script rewrites stored rows. Its dry run prints counts per
  catalog entry and every changed row; the real run is Dave's click.
- A down-script turns new rows back into old ones, if a rollback is ever
  needed.
- Inngest events still carrying old trigger JSON are read through the
  translator.

**History is not rewritten.** Activity lines are stored as sentences when
they're written (`ops.ts`), so old ones read as they always did. PR 3 checks
whether any history view rebuilds a sentence from stored JSON; if one does,
it reads through the translator until PR 4.

---

## 10. The PRs

| PR | What | Proof Dave sees | Behaviour change |
|---|---|---|---|
| **1. The editor** | The condition shape, the catalog, its words and slots, the action table, `fromLegacy` / `toLegacy` (`lib/agent/triggers/condition/`); the type buttons on the sheet; one dialog for add, edit and an inherited rule's read-only view; pills drawn from the same words; the analyst and account settings on the same dialog. It saves today's kinds through `toLegacy`, so storage and the checker are untouched. Editing in place is one new `replace` op on the shared write path (same slot keeps the id and history; another slot is a new trigger). The add paths' kind lists move to `lib/agent/triggers/addable.ts` so the dialog offers exactly what the server accepts, and the report window (`EARNINGS_SINCE`) becomes addable by hand. Options only the new shape can express are held back with a message. Deletes `dialog-condition.ts`, the eight-tab form and the old popover. The variables' numbers for the line under the input arrive with the checker in PR 2. | The round-trip and slot tests over every stored trigger (487 distinct conditions behind 909 triggers); the replace-op tests; the full suite; a production build. | The dialog and pills only |
| **2. Alongside** | One checker over the catalog, plus a comparison on every pass that logs any disagreement. | The CI parity grid; three or more trading days of production logs with zero disagreements. | None (logging only) |
| **3. Cutover** | Storage moves to the shape (dual read, then the backfill); every writer (`ops.ts`, `thesis-edit.ts`, the seeders, `setup-exits.ts`, `defaults.ts`, `setups.ts`); the new checker decides; fire history moves into `triggerState`; the agents' schemas and prompts; the new options shown; `MOVE_STOP` deleted; docs updated (`TRIGGERS.md`, `TRIGGER_MODEL.md`, `CLAUDE.md`, the `LANES.md` §2 checklist). The 20 kind names are deleted from all code except the translator. | A grep showing the kind names only in `condition/legacy.ts` and its tests; tool size before and after; the backfill dry-run diff; replay tests passing; a check after the backfill showing zero old rows. | Same fires; new options available |
| **4. Cleanup** | After a week with zero old rows: the translator's read path and the comparison code go. | A grep showing zero kind names. | None |

Each PR follows the repo's rules: rebased onto main and never stacked; the
five-line message; a test replayed from the real production input; merged
only on Dave's click.

**Lanes.** This crosses both lanes' columns and every shared file in
`LANES.md` §4. One owner runs it end to end. While PR 2 or PR 3 is open,
neither lane opens a PR on `lib/agent/triggers/` without saying so in its
message. After PR 3, the §2 "ships whole" checklist shrinks to: one catalog
entry (its label, unit, where its number comes from and its words) plus a
test.

---

## 11. Deliberately not in this plan

- **Adding on a schedule** ("add every week"). The shape can already say it;
  allowing it is one cell in the §4 table and a trading-rule call. It's not
  in this work.
- **A one-off calendar date** ("review on Nov 14"). The thesis's event date
  covers that today.
- **A backtest preview** ("would have fired 4 times in 90 days"). It comes
  after the live line.
- **News conditions.** These are parked; see `SIGNALS_REDESIGN.md`.
- **Renaming stored action values.** The UI says Buy and Sell; storage keeps
  `ENTER` and `EXIT`.

---

## 12. Decisions for Dave

1. **This dialog.** The type is picked on the sheet; inside are tabs, a
   button group, and one value input that takes a number or a variable chip.
   The five types are Price, Indicator, Earnings, Filing and Schedule.
   *Recommended as shown in the mock.*
2. **Editor first** (PR 1 is the visible fix and puts no money at risk) or
   the backend first. *Recommended: editor first.*
3. **The free new options** that fall out of the shape: any variable on
   either side (below ⟨our entry⟩, above ⟨52-week low⟩), a % off ⟨52-week
   high⟩, a % stretched above or below an average, "only on the close" for
   a % move or volume, and a review every N weeks or months. Each is the same
   math on numbers the checker already has. *Recommended: turn them on in
   PR 3.*
