# Entry-trigger semantics — the ENTER rung is hardcoded to one strategy

> **For:** the session building analyst-level / account-level trigger defaults.
> **Status:** open. Diagnosed 2026-08-12 from production data on Secular Compounder
> (`AgentConfig.id = cmmqxola3000004lbj7c11bfn`, LIVE since 2026-08-11).
> **Self-contained** — you don't need the conversation that produced it.

---

## One-line summary

Every WATCHING thesis gets an auto-stamped ENTER rung of `PRICE_ABOVE(entryPrice)`. That is a
**breakout** semantic, hardcoded for all LONG theses regardless of analyst strategy. For a
dip-buying analyst it is backwards: it alerts only once the stock costs *more* than the analyst
said it would pay, and it can never fire when the stock is cheap.

---

## Where it comes from

`lib/agent/triggers/defaults.ts:471-503`, `watchingEntryTrigger()`:

```ts
if (direction === "LONG") {
  return {
    predicate: { kind: "PRICE_ABOVE", level: thesis.entryPrice },
    action: "ENTER",
    rationale: `Entry trigger — price broke above $${thesis.entryPrice}. Validate setup and consider INITIATE.`,
    cooldownDays,
  };
}
```

Stamped on every non-held thesis with an `entryPrice` (WATCHING and PROMOTED both use the
watching template). `entryPrice` means "where you'd buy / did buy" — see
`docs/plans/PRICE_LEVEL_SEMANTICS.md`. Note this line was already fixed once (2026-05-31, GAPS
P1-3: it used to read `targetPrice`, so the agent would buy at its own take-profit level). The
*column* got fixed; the *comparison direction* never got examined.

**Nobody chose the direction.** It isn't exposed as an analyst setting, an account rule, or a
prompt instruction. It is a code constant that silently encodes "this analyst buys breakouts."

---

## Why it's wrong for the Compounder

The `analystPrompt` describes a dip-buyer: *"I add on weakness when the thesis is intact,"*
scaled entry over 3–6 months, tolerate −15% drawdowns. So the analyst sets `entryPrice` as **the
price it wants to pay**. The trigger then fires only when price is *above* that — i.e. only when
the name is more expensive than the level it chose. The analyst declines, correctly, every time.

Two layers giving opposite instructions about the same event. See `docs/PRINCIPLES.md`
(three-layer principle).

---

## The evidence (production, 2026-08-12)

19 WATCHING theses. `entry` = `Thesis.entryPrice`; `price` = most recent
`ThesisUpdate.priceAtTime`.

### Trading ABOVE entry — ENTER fires repeatedly, analyst declines every time

| Ticker | Price | Entry | Gap | ThesisUpdate rows, 14d |
|---|---|---|---|---|
| PLTR | $171.04 | $128.47 | **+33.1%** | 27 |
| MSFT | $505.13 | $418.57 | +20.7% | 27 |
| NTNX | $55.04 | $47.12 | +16.8% | 0 |
| ABT | $111.87 | $96.00 | +16.5% | 5 |
| NOW | $127.54 | $110.00 | +15.9% | 26 |
| CRWD | $225.95 | $195.00 | +15.9% | 16 |
| GD | $373.16 | $340.00 | +9.8% | 0 |
| WST | $352.29 | $351.37 | +0.3% | 5 |
| VST | $148.02 | $147.85 | +0.1% | 0 |
| ISRG | $401.27 | $401.23 | +0.01% | 3 |

Sample rationales — the trigger validates and the analyst passes anyway:
- PLTR: *"Reviewed the fired ENTER trigger on $PLTR and I am still not entering."*
- NOW: *"Reviewed fired ENTER trigger on $NOW and passed on entry."*
- WST: *"Predicate validated: live quote still holds above the $351.37 entry level"* — no purchase.

### Trading BELOW entry — the ENTER path is structurally unreachable

| Ticker | Price | Entry | Gap | ThesisUpdate rows, 14d |
|---|---|---|---|---|
| KLAC | $180.33 | $262.00 | **−31.2%** | 4 |
| BWXT | $172.56 | $197.78 | −12.8% | 23 |
| TXN | $281.24 | $309.21 | −9.0% | 5 |
| NVDA | $196.51 | $215.33 | −8.7% | 0 |
| ETN | $361.83 | $391.39 | −7.6% | 1 |
| ASML | $1,799.38 | $1,930.00 | −6.8% | 10 |
| GEV | $927.21 | $950.00 | −2.4% | 0 |
| SYK | $342.70 | $348.15 | −1.6% | 7 |
| SNPS | $524.74 | $524.74 | 0.0% | 0 |

**Precision note:** these names are not entirely silent — the watching template's stop-as-REVIEW
rung does fire on pullbacks (BWXT's 23 rows are that: *"Pullback to $185 — between SMA20 and the
$168 invalidation floor"*). But the **ENTER** action — the only one that leads to a purchase —
cannot fire while price sits below `entryPrice`. A dip-buying analyst's best setups can produce
discussion but never an entry.

**Net result: 19 watchlist theses, ~200 ThesisUpdate rows in 14 days, zero entries.**

---

## Fix 1 — make entry direction an analyst-level default

Two values, one choice per analyst:

| Mode | LONG predicate | For |
|---|---|---|
| **Buy the dip** (`ENTER_ON_DIP`) | `PRICE_BELOW(entryPrice)` (at-or-below) | Secular Compounder, any value/accumulation seat |
| **Buy confirmation** (`ENTER_ON_BREAKOUT`) | `PRICE_ABOVE(entryPrice)` — today's behaviour | Momentum/breakout seats |

Keep `ENTER_ON_BREAKOUT` as the app default so nothing changes for existing seats without an
explicit opt-in. SHORT mirrors (dip-buyer shorts on a rally into the level).

This is the analyst-scoped default the operator asked for. It fits the existing
app-default → account → analyst → thesis precedence ladder; the caveat is that the account-rules
panel can only express things that mean the same on every name, and this is a *mode*, not a
level — so it belongs on the analyst, not in the percentage-rung list.

**Immediate effect if switched on for Compounder:** the eight below-entry names (KLAC, BWXT, TXN,
NVDA, ETN, ASML, GEV, SYK) become live entry candidates; the ten above-entry names stop firing.

---

## Fix 2 — fire on the crossing, not the state

`PRICE_ABOVE` / `PRICE_BELOW` are evaluated as **states**, not events
(`lib/agent/triggers/evaluate.ts`). Once a name trades above its entry level the predicate is
permanently true, so the rung re-fires every cooldown indefinitely. That is PLTR's 27 fires and
MSFT's 27 in 14 days — nagging the analyst daily to reconsider an entry it already declined.

Fire once when price **crosses** the level; re-arm only after it crosses back. This needs a small
amount of per-trigger state (last-side) alongside the existing `lastFiredAt`. It also fixes the
same class of noise on any other state-shaped predicate.

Worth checking whether this alone accounts for a meaningful slice of tactical-run spend — the
cost audit in `docs/plans/legacy/OPENAI_COST_REDUCTION.md` flags "tactical refire storms" as an
open item and this looks like one of the mechanisms.

---

## Fix 3 — entry prices must be re-set on review (the bigger one)

A dip-entry rule is only as good as the level it compares against, and these levels are stale:

- **PLTR** `entryPrice` $128.47, now $171.04. Set months ago, never revised. As a dip level it is
  fiction — a −25% move just to become relevant.
- **MSFT** $418.57 vs $505.13. Same.
- **KLAC** $262 vs $180.33 — the opposite failure. A 31% gap below the stated buy price is not a
  small dip. It is either an exceptional entry or a broken thesis, and **nothing has ever forced
  that call.** The daily run has reviewed this name and left the level untouched.

So: the daily run reviews these theses constantly and never updates `entryPrice`. Proposal —
whenever a review runs on a WATCHING thesis, the agent must either reaffirm the level or re-set
it, and a price **materially** below `entryPrice` (suggest ≥10%) must produce an explicit
decision — enter, re-level, or invalidate — never silence.

This is the difference between an entry price being a live decision and a number someone typed in
June.

---

## Suggested sequencing

1. **Fix 2** first — it is strategy-neutral, cannot make anything worse, and removes the noise
   that makes everything else hard to read.
2. **Fix 1** — the analyst-level mode, shipped with `ENTER_ON_BREAKOUT` as the default and
   Compounder opted into `ENTER_ON_DIP`.
3. **Fix 3** — needs prompt work plus a gate; scope it separately.

---

## Don't break

- `watchingEntryTrigger` also serves **PROMOTED** theses (post-promotion, awaiting first live
  re-entry). Changing entry direction changes how a promoted seat re-enters with real money.
  Secular Compounder is LIVE as of 2026-08-11 with CEG and CRWD in exactly that state.
- The merge rule in `defaults.ts` is "defaults fill gaps; an agent-authored rung wins on the same
  `(predicate.kind, action)` key." Switching the predicate kind from `PRICE_ABOVE` to
  `PRICE_BELOW` **changes that dedup key** — verify an agent-authored entry rung still overrides
  the default cleanly rather than stacking a second, contradictory ENTER.
- Existing theses keep the rungs they were minted with. Decide explicitly whether to backfill the
  19 live Compounder theses or let them age out; leaving them means the fix has no effect on
  today's watchlist.
- Read `CLAUDE.md` → "RECURRING BUGS" and `docs/PRINCIPLES.md` before moving any rule between
  layers.

---

## Verification queries

```sql
-- entry vs last-seen price for one analyst's watchlist
select t.ticker, t."entryPrice",
       (select tu."priceAtTime" from "ThesisUpdate" tu
         where tu."thesisId" = t.id and tu."priceAtTime" is not null
         order by tu.timestamp desc limit 1) as last_price
  from "Thesis" t join "ResearchRun" r on r.id = t."researchRunId"
 where r."agentConfigId" = 'cmmqxola3000004lbj7c11bfn' and t.status = 'WATCHING';

-- fired-and-declined volume
select t.ticker, count(*)
  from "ThesisUpdate" tu join "Thesis" t on t.id = tu."thesisId"
  join "ResearchRun" r on r.id = t."researchRunId"
 where r."agentConfigId" = 'cmmqxola3000004lbj7c11bfn'
   and tu.timestamp > now() - interval '14 days'
 group by 1 order by 2 desc;
```

Supabase MCP, project `zomxxtqiszpkqrjrqqat`. **SELECT only — this is the production database.**
