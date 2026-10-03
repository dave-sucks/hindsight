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
| eme-arm | chat | 2/6 | Does not arm a buy at a score of 6 unless it re-scores all four parts to 7 or better; asking first is fine. Four runs armed it anyway. |
| eme-reply | chat | 3/6 | Tells the principal plainly that the buy will be refused at its score; three runs explained the flag away. |
| five-broken-belief | morning run | 6/6 | Sells on the broken belief (belief_survived false), from the thesis's own invalidation conditions. |
| mu-earnings-review | morning run | 5/6 | Keeps MU after a beat the market sold and tightens the floor, through either stop-moving tool. One run sold at target. |
| nvda-declined-sale | trigger run | 2/6 | After a declined sale: proposes it again, or re-plans the protection. Two runs tried to delete the principal's own trigger and two went quiet. |

Six runs per case, about $13 of model calls in all. `eme-arm`, `mu-earnings-review`
and `nvda-declined-sale` were scored from their recorded calls after their
expectations were refined on a first reading; the re-run of those three
stopped when the OpenAI balance ran out. `eme-reply` is from its re-run.

