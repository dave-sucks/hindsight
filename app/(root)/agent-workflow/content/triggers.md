---
id: triggers
title: Triggers & the Game Plan
summary: Every thesis carries a ladder of triggers — if the price does X, do Y. The Trigger Evaluator watches them against live prices and fresh news, and when one hits it either stages a proposal for you to approve or wakes a [Tactical Run](agent:tactical) to decide. Nothing ever auto-trades or silently re-sets a level.
---

A **trigger** is a standing instruction attached to a thesis: a **condition** and an **action**. "If the stock closes above $115, enter." "If it gives back 8% from its high, propose an exit." "If it's up 10% from where we bought, wake up and re-check the plan." Each thesis carries a whole **ladder** of these — entry rungs, a floor, add rungs, trim rungs, damage rungs — so the analyst's plan keeps working between the times it's actually looking at the name.

The point is to **front-load the thinking.** The heavy analysis happens when the research is fresh — at write-time and at entry. After that, the triggers do the watching, every five minutes, all day, whether or not a run is happening. Strong triggers beat a strong daily cron.

## What you can trigger on — the full vocabulary

**Price levels**

- **Target Price** — fires when the last quote crosses a fixed dollar level, above or below. Used for entries, exits, and reviews.
- **Movement Amount** — fires when the stock is up or down X% **on the day** (versus the prior close). This is the "% alert."

**Gain and give-back (the protection rungs)**

- **Gain from entry** — fires when the position is up (or down) X% versus what we actually paid. Up is a *milestone* — "we're up 10%, come re-check the plan." Down is *loser attention* — "we're down 12% from entry, decide to hold or cut before the hard stop does it for us." This is cumulative, not one day's move.
- **Trailing from high** — fires when the stock gives back X% from the highest point it's reached since we bought it. This is the **mechanical ratchet**: it protects the gain on the way down with no memory or judgment required. As the stock makes new highs, the give-back level rises with it automatically.

**Events (from the news feed)**

- Earnings beats and misses, guidance changes, and SEC filings (8-Ks, insider forms). These are checked the instant a matching signal arrives, not on a timer.

**Housekeeping**

- Time elapsed since we bought (or since we started watching), and a scheduled review date.

You'll also see **AND / OR** rungs that combine conditions. The two you can add yourself from a thesis are Target Price and Movement Amount; the rest come pre-built by the analyst or by the system's defaults.

## Who sets which level — the authority model

Every level on the ladder is set by *someone*, and the rule is **most-specific wins.** There are three kinds of author:

1. **System defaults (the floor of floors).** Every holding carries a set of **standing protection minimums** for free, baked into the code: a **+10% checkpoint** (up 10% from entry → come re-check the plan), an **8% trail** (give back 8% from the high → propose an exit), and a **−12% loser review** (down 12% from entry → decide hold-or-cut), plus scale rungs at roughly ±7% days. These are the *minimum* protection every name gets. They are deliberately generic — the same for every analyst today.

2. **The analyst, with nuance.** This is the analyst's brain doing its job. It writes the **actual** levels — the floor tucked under the real breakout shelf, the trail width fitted to how volatile *this* name is, the add rung at the price where the setup confirms. It authors the full plan when the research is fresh, and it **re-earns every level on every review** and after every fire. An analyst-authored rung always beats the generic default.

3. **You.** From the thesis sheet you can set or edit any trigger — retune a stop or target, add a % alert, change how a rung fires. You can also retune levels while rejecting a proposal. Your edits beat everything, and they're fed back to the analyst as a directive it must honor, not overwrite.

*(A fourth author, per-analyst standing rules — "this analyst always trails 5%" — is coming but not live yet; today every analyst gets the same system minimums.)*

## What happens when a rung fires — three routes, zero surprises

This is the part worth internalizing: **a rung firing never changes a level by itself, and never auto-trades.** Firing does one of three things, and which one is decided per-rung ahead of time:

- **Wake the analyst (Tactical Run).** Most rungs — entries, adds, trims, and judgment-heavy exits — spawn a focused [Tactical Run](agent:tactical). The analyst pulls fresh data, decides press / hold / take / pass, **re-ladders the plan for the new price**, and stages its decision as a proposal for you.
- **Batch to tomorrow morning (Review).** A rung marked *Review* — including the +10% checkpoint — doesn't wake anyone intraday. It writes an audit row and hands the name to the next [Daily Run](agent:agent), which folds it into the morning's re-underwrite. (Genuinely breaking news is the exception and can escalate immediately.)
- **Stage a mechanical proposal (Direct exit).** A price-based protective exit — a floor or a trail — can be marked to **skip the analyst** and stage the close proposal directly. This is cheaper for mechanical stops, where there's nothing to think about. It fires in about five minutes from the move.

In **every** one of these, the outcome is either a **proposal you approve** or the **analyst being summoned to decide** — then a proposal you approve. If your account requires approval for sells (it does, on the live book), even a "Direct exit" is *proposed*, never auto-sold. Firing summons judgment or stages a click. It never pulls the trigger for you.

## Re-laddering — why "up 10%" isn't the end of the story

The whole system is built to avoid one specific failure: **a level that never gets re-earned.** A floor set on the day we bought reflects that day's information forever, unless something forces an update. So the rule is that **every review and every fire leaves the ladder correct for the new price** — every add raises the floor under it, every checkpoint that fires gets replaced by the next milestone, stale rungs get retuned. The daily run is demoted from decision-maker to *auditor*: if a holding is up big but its floor still sits at the entry-day level, the morning run is structurally forbidden from saying "reviewed, no changes" — it has to fix the floor or explicitly say why not.

## A worked example — the way it should go

Say an analyst buys a name at **$74** and sets a floor at **$65** on day one.

1. Weeks later the stock is up 10% from our entry. The **+10% checkpoint fires** — a Review rung, so it doesn't wake anyone; it just flags the name for the next morning. *(The machine, keeping watch.)*
2. Next morning the [Daily Run](agent:agent) sees the flag, pulls fresh data, and decides the story is still good — so it **raises the floor from $65 to ~$78** (tucked under the breakout) and arms the next checkpoint at +20%. That's the analyst re-earning the level. *(Judgment.)*
3. Any morning it *hasn't* done that, the name shows up flagged as an **unprotected gain** and the run can't rubber-stamp past it. *(The machine forcing the conversation.)*
4. The stock keeps running to $86, and the **8% trail ratchets up with it** — no one has to remember to move it. *(The mechanical ratchet.)*
5. Then a bad day: the stock gives back its 8% and the **trail fires**, staging a close proposal that lands in your inbox with an email and a push. You approve, and we **bank the gain** instead of riding it all the way back down to the day-one $65. *(The machine, handing you the decision.)*

The old way — floor at $65, "reviewed, no changes" three mornings in a row, then a crash fires the *day-one* floor for a loss on a trade that had been up 17% — is exactly what re-laddering exists to prevent.

## Two paths, one job

The evaluator watches on two clocks. **Prices** get checked every five minutes during market hours (fresh quotes for every held and watched name, including each name's daily % change). **News** wakes it the instant the [Intelligence Pipeline](agent:intelligence) routes a matching signal — earnings, guidance, a filing. Either way the output is the same: an audit row, and either a staged proposal or a [Tactical Run](agent:tactical).

## Cooldowns — so one move doesn't nag you all day

Each rung has a cooldown so the same condition can't re-fire over and over in a short window. Protective stops can opt out so a real stop-hit always fires; everything else gets a sane default. (One consequence worth knowing: a protective exit has to be *tagged* correctly — a floor/trail close and a discretionary close are treated differently by the cooldown, so a mis-tag can wrongly mute a real re-alert.)

---

*For the full mechanics — which predicate fires on which path, the fire modes, the cooldown defaults — see the engineering references `docs/TRIGGERS.md` and `docs/plans/TRIGGER_LIFECYCLE.md`.*
