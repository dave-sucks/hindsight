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
Nothing is executed and nothing touches the database or the account, except
the reads a case names to run (below), which only read. Six
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
- `text` / `neverText`: the turn's prose does / does not match a pattern;
- `read`: a read the case ran for real (below) returned every one of the
  `has` paths, not empty (`data.positions.*.stopLoss`).

A `where` names fields of the call's input by path (`edit_triggers.*.level`,
`scoring.$sum` for the sum of the score parts sent, `scoring.$count` for how
many) and what each must be: `"present"`, `"absent"`, a value, or
`{ lt, gt, regex }`.

## A case that runs a read

A case may list read-only tools under `execute` (only `get_portfolio_context`,
`get_theses`, `list_proposals`, `get_market_context` and `get_stock_data`).
When the model calls one, it runs for real, as the owner of the case's
`source.runId`, on the account as it is today, and the model reads its
real reply; every other call still gets the stub. The turn repeats until the
model answers without a call, up to `maxTurns`. It is how a case checks what
a read returns, not only that it was made.

For a chat with no analyst selected, give `-` for the ticker:
`hero-case-from-run.ts <runId> - <case-name>` cuts before the model's first
turn.

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

## Cases added 2026-10-06

Twelve runs each, four processes per version, in the same hour. "Before" is
main at `8fb21cb8` (before #765–#768); "merged" is `2157e708`.

| Case | Agent | Before | Merged | Looks for |
|---|---|---|---|---|
| now-needs-research | morning run | 0/12 | 0/12 | Opens NOW (get_theses on the ticker) to read its research before re-affirming it. Before, the text was in the opening read, so it never needed to ask; merged, the read carries only the date, and no run asked. |
| pbh-two-flags | morning run | — | 6/12 | Gives a stock nothing can wake (scored under the minimum) a way back or lets it go. Six runs archived it; six wrote a note and left it unable to wake. |
| wst-buy-level-arrives | morning run | — | 12/12 | Answers a buy reached on the morning read (buy, re-price or set down). All twelve bought it. |

