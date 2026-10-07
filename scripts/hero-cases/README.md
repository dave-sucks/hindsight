# Scored cases

Real decisions cut from real runs, replayed against the real model and
scored by code. This is how a change to an agent's text, tools or read is
checked before it goes live (`docs/plans/AGENT_ARCHITECTURE.md`, step 2 and
Appendix D).

## Running

```
npx tsx --env-file=.env.local scripts/hero-case.ts --all --runs 6
npx tsx --env-file=.env.local scripts/hero-case.ts docu-trigger --runs 6
```

Each run gives the model one turn at the recorded decision point, with the
system prompt built by today's code and the tools described but never run.
Nothing is executed and nothing touches the database or the account. Six
runs per case, because one run of a model proves nothing. The script prints
each run's calls and a pass/fail with the reason, then a table.

If the shell carries an `ANTHROPIC_BASE_URL` for some other purpose, run with
`env -u ANTHROPIC_BASE_URL` so the chat and writer cases reach the API.

## Writing a case

```
npx tsx --env-file=.env.local scripts/hero-case-from-run.ts <runId> <TICKER> <case-name>
```

cuts the conversation of a real run just before the model's first decision
on that stock and writes `scripts/hero-cases/<case-name>.json`. Then fill in
`what`, `lookFor` and `expect` by hand, and check `promptArgs` against the
run's day (for a morning run the account is as it is today; for a trigger
run the stock's details are as they are today, and a trigger removed since
has to be put back). The principal's own words never go into a case file:
the repo is public, so paraphrase them.

`expect` names the decision the right answer makes:

- `call`: at least one of these calls is made (any one of the list);
- `never`: none of these calls is made;
- `text` / `neverText`: the turn's prose does / does not match a pattern.

A `where` names fields of the call's input by path (`edit_triggers.*.level`,
`scoring.$sum` for the sum of the score parts sent, `scoring.$count` for how
many) and what each must be: `"present"`, `"absent"`, a value, or
`{ lt, gt, regex }`.

## Baseline

Recorded on main at `625bc561` on 2026-10-02, before any text, tool or read
change in the plan. A later PR runs the same cases before and after its
change and reports both.

| Case | Agent | Pass | Looks for |
|---|---|---|---|
| bwxt-writer | writer | 5/6 | The score it submits, and whether it writes a buy while that score is under 7. One run did. |
| ceg-plan-stands | morning run | 3/6 | Says the plan stands on a held stock whose standing review fired. Three runs never reached CEG within four turns; none moved a level. |
| docu-chat | chat | 5/6 | Judges the DOCU buy by the dollars at risk, not the dollars in, and does not read light volume as weakness. |
| docu-trigger | trigger run | 2/6 | Re-prices the pullback buy to the bounce instead of passing or buying the dip. Waits for the pullback PR. |
| eme-arm | chat | 0/6 | Does not arm a buy at a score of 6 unless the same save re-scores the stock to 7 or better; asking first is fine. All six armed it with the trend part scored 0 or 1; none asked. |
| eme-reply | chat | 3/6 | Tells the principal plainly that the buy will be refused at its score; three runs explained the flag away. |
| five-broken-belief | morning run | 6/6 | Sells on the broken belief (belief_survived false), from the thesis's own invalidation conditions. |
| mu-earnings-review | morning run | 6/6 | Keeps MU after a beat the market sold and tightens the floor, through either stop-moving tool. |
| nvda-declined-sale | trigger run | 4/6 | After a declined sale: proposes it again, or re-plans the protection. Two runs saved a review and finished without doing either. |

Six runs per case, about $16 of model calls in all. The production runs share
the OpenAI key, so check the balance before a batch: a full baseline is about
a day of morning runs.

**Scores above are not comparable with scores from 2026-10-07 on.** Three
changes landed then; the first two change what a case sends, the third how a
trigger case is scored:

- The runner rebuilds the trigger run's kickoff with today's code
  (`tactical-kickoff.ts`). docu-trigger and nvda-declined-sale now read
  today's fire sentence ("Buy if below $67"), not the one recorded.
- Every case file holds its triggers in the one condition shape, on disk
  (a one-off conversion; the runner no longer translates them at load). The
  trigger and writer cases send the same bytes as before; the morning and
  chat cases' recorded stock rows now show their triggers in the condition
  shape instead of the old kinds. Triggers of kinds deleted from production
  were dropped from the recorded rows the same day (59, all in
  wst-buy-level-arrives, with those rows' trigger counts), because
  production holds none.
- A trigger case runs to the end of the run (complete_run, a turn with no
  call, or `maxTurns`, default 6), every call answered by a stub, and its
  `call` / `never` rules are scored over all of it. It used to stop at the
  first decision, so a run that proposed the sale and then deleted the
  trigger that fired passed. A trigger run now costs more per run, with the
  turns; each case's line states its tokens.

A trigger case's scores before the scoring change read only against each
other. A batch after that compares main and a branch, both run with this runner on
these files, in the same hour. Read docu-trigger's 2/6 and nvda-declined-sale's
4/6 above against nothing newer.

## Cases added 2026-10-06

Twelve runs each, four processes per version, in the same hour. "Before" is
main at `8fb21cb8` (before #765–#768); "merged" is `2157e708`.

| Case | Agent | Before | Merged | Looks for |
|---|---|---|---|---|
| now-needs-research | morning run | 0/12 | 0/12 | Opens NOW (get_theses on the ticker) to read its research before re-affirming it. Before, the text was in the opening read, so it never needed to ask; merged, the read carries only the date, and no run asked. |
| pbh-two-flags | morning run | — | 6/12 | Gives a stock nothing can wake (scored under the minimum) a way back or lets it go. Six runs archived it; six wrote a note and left it unable to wake. |
| wst-buy-level-arrives | morning run | — | 12/12 | Answers a buy reached on the morning read (buy, re-price or set down). All twelve bought it. |


## Cases added 2026-10-07

| Case | Agent | Main | Looks for |
|---|---|---|---|
| nvda-trailing-sale | trigger run | 6/6 | After the give-back sale fires on a held stock: proposes the sale (STOP, belief stated) or re-plans that same trigger, and does not delete it. All six proposed the sale. |

Main is `1b99a4ec` run with its own runner, which sends the recorded kickoff;
a branch with this runner rebuilds the kickoff from `promptArgs.stock`. The
runner stops at the first call that decides the stock, so a removal made in a
later call (what the 2026-09-14 run did after proposing the sale) is not seen.
