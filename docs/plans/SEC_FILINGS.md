# SEC filings — the second data type, the same shape as earnings

> **What this is.** The plan for SEC filings: what the data is, who sets
> triggers on it, how they fire, how the daily run, tactical runs, the
> writer and discovery read it, and where you see it in the app. The same
> shape as earnings (`docs/plans/MARKET_DATA.md` §0a).
>
> **Status:** proposal, written 2026-09-12. Nothing built. Four decisions for
> the principal at the end (§9). Two things here touch the agent rebuild's
> territory and need that session's agreement first (§7).

---

## 0. The whole thing in five lines

1. **A filing is an event with a code.** Every 8-K carries SEC item codes —
   a fixed government list: `5.02` is an officer leaving or joining, `1.01`
   a major agreement, `4.02` "don't rely on our past financials". That code
   is the event, and no news or AI is needed to classify it.
2. **The old filing trigger died because it keyed on the form, not the
   code.** "A 10-Q was filed" happens four times a year to every company
   and means nothing. It never fired (routing was dead) and the rebuild
   deleted it (DAV-247). This plan is a different kind, keyed on the code.
3. **Filings protect what you own more than they find new stocks.** A
   restatement or a sudden CFO departure on a holding is the thing you
   cannot afford to miss. Discovery gets a smaller role: activist stakes.
4. **Same defaults as earnings.** Every held and watched name gets a look
   when something serious is filed. It costs nothing until a company files.
5. **Insider buying is not in this plan.** The rebuild owns it
   (`INSIDER_CLUSTER`, its PR 10). This covers everything else in EDGAR.

---

## 1. What exists today

- **`get_sec_filings`** — an agent tool on the daily run, tactical, the
  writer, discovery and the chat. It lists a company's last eight filings
  by form and date. It does **not** return item codes, so an agent sees
  "8-K, Aug 26" and has no idea it was the CFO leaving.
- It downloads SEC's full ticker list (~1MB) on **every call** to find the
  company's number. Wasteful; the list changes a few times a year.
- Its contact address for SEC (`research@hindsight.app`) is not a real
  inbox. SEC's fair-access rules require a real one.
- **Zero filing triggers on the book.** The old `FILING` kind and its 12
  stored triggers were deleted on 2026-09-11.

---

## 2. The data — what EDGAR gives us, measured

Nothing is stored. EDGAR is the database, the same principle as earnings.

**Per company** (`data.sec.gov/submissions`) — every filing with its form,
filing date, acceptance time to the second, **8-K item codes**, a
description, and a link to the document. Micron, recent:

| Filed | Form | Codes | What it was |
|---|---|---|---|
| Aug 26 | 8-K | 5.02 | An officer change |
| Jun 25 | 10-Q | — | Quarterly report |
| Jun 24 | 8-K | 2.02 | Earnings results |
| Jun 9 | 8-K | 5.02 | An officer change |
| Apr 1 | 8-K | 8.01 | "Other events" |

**The whole market in one call** (EDGAR full-text search) — every 8-K,
13D, late-filing notice or offering across a date range, **with item codes
and tickers**, filterable to a list of companies. Measured: **381 8-Ks in
two days**; scoped to MU and NVDA over 45 days, **4** — including NVDA's
Aug 17 `1.01, 2.03` (a major agreement plus new debt). One call covers the
whole book, like the earnings calendar.

Volumes, whole market, last 45 days: **702** activist-stake filings
(`SCHEDULE 13D`), **227** late quarterly-report notices, **26** late
annual-report notices, **385** stock offerings (`424B5`).

Rate limit: 10 requests a second. One call per evaluator pass is nothing.

---

## 3. The event list — what matters, in three tiers

The item code tells you the **kind** of event, not whether it's good or bad
— a `5.02` can be a CEO quitting or a new board member. So a filing trigger
is always a **look**, never a trade. The tiers decide how urgent the look is.

### Red — something may be broken. Look today.

| Code / form | Plain name | Why it's red |
|---|---|---|
| 8-K `4.02` | Past financials can't be relied on | A restatement. The numbers the thesis stands on may be wrong. |
| 8-K `1.03` | Bankruptcy or receivership | |
| 8-K `3.01` | Delisting notice | |
| 8-K `4.01` | Auditor change | Rarely innocent, worst when near a `4.02`. |
| `NT 10-K` / `NT 10-Q` | Late annual / quarterly report | The company can't close its books on time. |

### Material — the story may have changed. Look at the next review.

| Code / form | Plain name |
|---|---|
| 8-K `5.02` | Officer or director leaving or joining |
| 8-K `1.01` / `1.02` | Major agreement signed or ended |
| 8-K `2.01` | Acquisition or sale completed |
| 8-K `2.05` | Restructuring or layoffs |
| 8-K `2.06` | Asset write-down |
| 8-K `3.02` | Shares sold privately (dilution) |
| `SCHEDULE 13D` | Someone took a 5%+ stake with intent to push |
| `424B5` / `S-3` | Stock offering (dilution) |

### Everything else — context only. Never wakes anyone.

`2.02` earnings results (the earnings calendar already owns that), `7.01`
and `8.01` press releases, `5.07` shareholder votes, `9.01` exhibits, and
the 10-Q and 10-K themselves (the earnings report covers them).

One exception: **biotech and catalyst analysts.** FDA decisions are usually
filed under `8.01` or `7.01`. For those analysts, those two codes are
material. That is the one legitimate analyst-level rule (§4).

The tier table lives **in code**, not in a prompt. The agents read the tier;
they don't memorize the codes.

---

## 4. Triggers — who sets them, and how they fire

### One new trigger kind

`SEC_EVENT { tier?: "RED" | "MATERIAL", items?: string[], forms?: string[] }`

- `tier` — "any red event" / "any material-or-red event". What the account
  rules use.
- `items` / `forms` — a specific event. What the writer uses when a filing
  **is** the thesis ("fires when the acquisition completes": `items: ["2.01"]`).

### Who sets them

| Level | What | Why |
|---|---|---|
| **Account** (default, every held and watched name) | `SEC_EVENT {tier: RED} → REVIEW`, urgent; `SEC_EVENT {tier: MATERIAL} → REVIEW` | A restatement or a CFO leaving on anything you own or watch deserves a look. It costs nothing until a company files. A wake, not a clock — the same reasoning as earnings. Overridable per name, deletable in settings. |
| **Analyst** (rare) | Biotech / catalyst seats: `SEC_EVENT {items: ["8.01","7.01"]} → REVIEW` | That's where FDA outcomes are filed. Other analysts would drown in press releases. |
| **Thesis** (the writer, only when the filing is the thesis) | A merger thesis: `items: ["2.01"]`. An activist thesis: `forms: ["SCHEDULE 13D"]`. A turnaround on new management: `items: ["5.02"]`. | Same rule as earnings: the account covers the basics, the writer authors one only when the event is what the thesis waits for. |

### How they fire

- The 5-minute evaluator makes **one** EDGAR call per pass for every
  company on the book, filed since yesterday, and matches the codes against
  each name's triggers — alongside the earnings calendar call it already
  makes. After-hours filings are caught at the next open.
- **One fire per filing, keyed on the filing's own ID** (its accession
  number), not on a cooldown. Earnings can use a cooldown because a company
  reports once a quarter; filings cluster — NVDA filed three 8-Ks in 17 days.
  A 7-day cooldown would swallow the second and third. The fired filing's ID
  is remembered next to the trigger's last-fired time (a one-field addition).
- **Red on a stock you hold spawns a tactical run the same day.** Everything
  else — red on a watch, any material event — goes into the next morning's
  review batch at no extra AI cost. (Today every review waits for the
  morning. This is the one exception, and it's decision 2.)
- The activity row carries the event in plain words and a link:
  *"Filed 8-K — officer leaving or joining (5.02), Aug 26. [document]"*

---

## 5. How every agent reads it

The item code names the **class** of event. The direction is in the
document. So the first move is always the same: **read it**
(`get_sec_filings` returns the link). Then:

| Event | Held stock | Watched stock |
|---|---|---|
| **Past financials unreliable** (`4.02`) | The numbers under the thesis may be false. Exit, unless the restatement is clearly small and the story doesn't rest on the restated line. Say which. | Set the plan down until the corrected numbers are filed. |
| **Bankruptcy / delisting notice** | Exit. | Stop watching. |
| **Late report** (`NT 10-K/Q`) | Find the stated reason. Tighten the floor. Don't add until it's filed. | Don't buy until it's filed. |
| **Auditor change** | Read why. Alongside a `4.02`, treat as a red flag. | Note it; don't buy on it. |
| **Officer leaving** (`5.02`) | Who and why. A planned succession is noise; a sudden CFO exit is a warning — tighten the floor and read the next filings closely. | Same read. A new CEO can *be* a thesis. |
| **Acquisition** (`1.01`, `2.01`) | Buyer or target? **A target's price is capped at the deal price** — move the target to it, consider selling. A buyer: does the deal fit the thesis, and how is it paid for? | Target: the upside is mostly gone. Buyer: re-read. |
| **Restructuring / write-down** (`2.05`, `2.06`) | Read against the thesis's assumptions. A write-down of the thing the thesis is about breaks it. | Same. |
| **Dilution** (`3.02`, `424B5`, `S-3`) | New shares usually push the price down short-term. Don't add into it. Check the use of proceeds. | Don't buy into the offering; wait for it to price. |
| **Activist stake** (`SCHEDULE 13D`) | Usually supportive. Read the stated intent. | A candidate for a thesis. |

**Where each agent gets this:**

- **Daily run** — the table above in the fired-trigger branch, next to the
  earnings playbook, plus one context line: *"Filings on your book since the
  last run: MU officer change (Aug 26)."*
- **Tactical run** — the red rows, since those are the ones that spawn it.
- **Writer** — the event kinds exist and fire; the account covers the
  basics; when a thesis should author its own `SEC_EVENT`.
- **Your chat** — "what did MU file recently?" and "anything serious filed
  on my book this month?" both work through `get_sec_filings`.

---

## 6. Discovery

**Honest scope: filings are a weaker way to find stocks than earnings.**
Most filings are routine, and the strongest filing-based buy signal —
insiders buying with their own money — is the rebuild's `INSIDER_CLUSTER`.

What filings add to discovery:

- **Activist stakes** (`SCHEDULE 13D`) — someone put real money behind a
  plan to change the company. In the chat: *"discovery off this month's
  activist stakes"* → `get_sec_filings(scope: "universe", forms:
  ["SCHEDULE 13D"], days: 30)`.
- **Spin-offs** (`Form 10-12B`) — a known pattern, small volume.
- **A red-flag filter.** Before the writer is dispatched on any candidate,
  a red event in the last 90 days is shown — so discovery doesn't mint a
  thesis on a company that just told SEC its books are wrong.

---

## 7. Coordination with the agent rebuild

- **The trigger vocabulary is theirs.** The rebuild's law is "delete dead
  kinds" — a kind that cannot fire. `SEC_EVENT` fires straight off EDGAR, so
  it meets that law's own condition, but it adds to a table that session
  maintains. **Needs their agreement on the name and shape before code.**
- **Insider buying stays theirs** (`INSIDER_CLUSTER`, PR 10, off Finnhub).
  This plan doesn't touch Form 4.
- **Discovery pool structure is theirs.** The red-flag filter in §6 is an
  input they'd consume, not a change to their pool.

---

## 8. Where you see it

No new page in V1.

| Surface | What |
|---|---|
| **Stock page → Filings tab** | The company's filings, newest first, in the app's row style: date, form, the event in plain words, a tier label on red and material events, a link to the document. |
| **Thesis sheet** | One line under Earnings: *"Filings · Aug 26 officer change"*, red and material events from the last 30 days. Nothing when there are none. |
| **Activity feed** | A fired filing trigger, with the event and the link. |
| **Trigger pills** | `[ sec filing ][ red ]` or `[ sec filing ][ 2.01 acquisition ]`, in the existing add dialog and popover. |
| **Daily run** | The "filings on your book since the last run" line. |

Later, if you want it: the `/earnings` page becomes a calendar with an
Earnings | Filings toggle.

---

## 9. Scope, and what needs you

| Piece | When |
|---|---|
| Shared EDGAR reader: item codes, the tier table in code, daily-cached company list, one whole-book call | **V1** |
| `get_sec_filings` returns codes, plain names, tier, link; adds whole-market mode | **V1** |
| `SEC_EVENT` trigger, fired-filing ID remembered, fires on the evaluator | **V1** |
| Account rules: red and material on every held and watched name | **V1** |
| Red on a held stock spawns a same-day tactical | **V1** |
| The playbook in the daily run, tactical and writer; the week line; chat guidance | **V1** |
| Stock Filings tab, sheet line, activity row, pills | **V1** |
| Biotech/catalyst analyst rule for `8.01` / `7.01` | V1, if those seats are live |
| Red-flag filter before dispatching the writer | **V1** — small |
| Activist-stake discovery in the chat | **V1** — rides the tool |
| Calendar page with a Filings toggle | Later |
| Spin-off discovery | Later |
| Insider buying | **Not this plan** — rebuild PR 10 |
| Filings as buy triggers | **Not doing** — a code says what happened, not which way |

Size: about the earnings trigger work. Smaller on the page side (a tab, not
a page), larger on the playbook.

### Decisions for the principal

1. **Account default** — red and material filings wake a review on every
   held and watched name. *(Recommended: yes, same reasoning as earnings.)*
2. **Red on a holding spawns a tactical run the same day**, instead of
   waiting for the morning. *(Recommended: yes. A restatement at 2 PM
   shouldn't wait 18 hours.)*
3. **The biotech/catalyst analyst rule** for `8.01` / `7.01`. *(Recommended:
   yes, only on those seats.)*
4. **A real contact email** for SEC's User-Agent requirement. Which address?
