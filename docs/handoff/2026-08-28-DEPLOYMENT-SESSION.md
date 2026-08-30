# Deployment session — get the idle money working (2026-08-28)

The principal's directive, verbatim in spirit: *"I need to be able to buy and
invest in any stock that has potential. My book and analyst coverage is too
narrow or has too many holes. I have way too much money just sitting there."*

This session's job: **deploy quality capital** through discovery and analyst
tuning. You may edit analyst configs, prep and trigger discovery, and propose
a new or replacement analyst. You are a portfolio/config session, **not an
engineering session** — no code changes, no schema changes, no Linear tickets.

## The numbers (verified against production, 2026-08-28 close)

- Equity ≈ **$91,250** · invested **$53,681 (58.8%)** · cash **$37,569**
- Slots: **7 of 15 filled** — PEAD 3/6, Catalyst 2/5, Compounder 3/4
- **The diagnosis: candidate-constrained, not seat-constrained.** Eight empty
  slots at the seats' position bands could absorb far more than the idle
  cash. What's thin is the pipeline feeding them: PEAD's bench holds only 4
  names, Compounder's bench failed its audit (10 of 13 names), and discovery
  has under-delivered for weeks (the entry-trigger bug that blocked all buys
  Aug 24–28 was fixed in #566 and is confirmed working — SMMT proposed 08-28).

## Read first

1. `docs/analyst-quality/2026-08-28-book-trust-audit.md` — the full book
   audit (PR #576 if not yet on main). Every position and watchlist name has
   a verdict: 11 KEEP · 6 RE-PRICE · 4 REFRESH RESEARCH · 1 DEMOTE-OR-DROP.
   Treat it as the ground truth this session starts from.
2. `docs/DISCOVERY_PLAYBOOK.md` — per-seat discovery method, including the
   Catalyst event-mix gate (2026-08-24: supplemental approvals over
   first-approval binaries; exclude single-asset names from binaries).
3. `docs/plans/ANALYST_LINEUP.md` — why the lineup looks like it does, and
   the standing ruling on the open 4th seat (2026-07-27): it must bring
   **offset idle periods** vs. the three existing seats, not another
   underreaction/lookback style.

## The work, in order — deploy through what exists before adding seats

1. **Feed PEAD (biggest gap: 3 empty slots, 4-name bench, freshest process).**
   Run `/discovery-prep` for PEAD, execute the searches, and trigger a manual
   discovery run. Overflow now has a real destination: strong-but-slotless
   candidates become soft watches (wake conditions, no clock) instead of
   permanent passes — shipped 08-28, the discovery prompt teaches it.
2. **Fill Catalyst's 3 empty slots from the calendar.** For dated-event
   trading the candidate universe IS the FDA/PDUFA calendar — enumerate the
   next 4–8 weeks of supplemental approvals / label expansions per the
   event-mix gate. Do NOT add another first-approval binary through the late-
   September window (IONS 9/22, MIRM 9/26, SRRK 9/30 already cluster there).
3. **Repair Compounder's bench instead of feeding it.** Its 1 free slot isn't
   the problem; its 13-name watchlist is. The audit lists the 6 re-prices and
   4 research refreshes by name; ASML is the demote candidate. Drive these
   through runs/editor — don't hand-edit theses yourself.
4. **Widen the fences deliberately, where the data says to.** Use
   `read_analyst_inbox_stats` (what's routing but unwatched) and
   `discover_signals_for_fence` (validate a proposed widening against 30d of
   real signals) in the editor chat before changing any universe field.
   "Any stock with potential" is the goal; the way there is wider, validated
   fences per seat — not fenceless seats. Also on the table, principal's open
   question from 08-28: the **$1B market-cap floor** has never prevented a
   loss on this book (IONS and MLTX were both inside it) while excluding
   candidates — recommend keep/lower/drop with whatever data you can pull.
5. **Only after 1–4: the seat question.** If quality candidates still exceed
   slot capacity, or whole regimes are uncovered (nothing on the book trades
   momentum/breakouts, ETFs, or macro), propose the 4th seat — through the
   builder, with the offset-idle-periods argument the 2026-07-27 ruling
   demands, seeded per archetype defaults. A REPLACEMENT proposal (retiring a
   seat) needs the outcome data to say the seat, not its bench, is the
   problem — the audit found all three seats' processes sound, so bring
   strong evidence or don't propose it.

## Standing rules (every session this week broke at least one — don't)

- Pending or expiring approval-queue proposals are the app WORKING. Never
  report them as findings; never re-raise them.
- Every buy/sell stays approval-gated. You propose; the principal clicks.
- Verify claims against the database before acting on them — including the
  numbers in this file.
- Plain language, product terms only: stocks, analysts, runs, triggers,
  theses, watchlist.
- No Linear tickets without the principal asking. If you find what looks
  like a code bug, write it in your handoff notes and move on.
- Config edits (fences, bands, feeds, prompts) go through the editor flow or
  are proposed to the principal explicitly — state before/after for every
  field you change.

## Context that saves you from re-diagnosing solved problems

- Levels are triggers now: every price on a thesis fires something. Watch
  floors take the plan down (not "sell"). Reviews run on per-stock clocks.
- The soft watch (wake-only, free) shipped 08-28; no analyst has used it
  yet — you may be the first, via discovery overflow.
- Zero buy proposals Aug 24–28 was a fixed bug (#566), not analyst timidity.
  Judge the seats on what they do from 08-28 forward.
- MU exit, PRAX trail, WST floor, SMMT buy are open PRINCIPAL decisions from
  the audit — reference them if relevant, don't re-litigate them.
