# Saving a thesis

**A save is a patch.** Every agent write to a [thesis](../concepts/theses.md) goes through one save (`saveThesis`), whichever tool asks for it (`write_note`, `edit_triggers`, `set_conviction`, `set_catalyst_date`, `stop_watching`, `watch_again`, and the Writer's `update_thesis`), and it changes only what is different from what is stored.

This page covers how a save lands, what each agent is allowed to change, and what happens when part of a save is refused.

## What a save does

When an agent saves, the first thing the tool does is throw away every value that equals what is already stored. An agent that reads a stock and sends the whole form back changes nothing, and the Activity line records only what moved.

**A level is a trigger.** A save has no price fields: the buy, the floor and any upside level are triggers, changed, added and removed by `edit_triggers` (`edit` by id, `add`, `remove` by id).

A field that can't be applied comes back by name in `refused_fields`, with the one thing to change. The rest of the call lands. A save is refused whole only when nothing in it can land:

- The thesis doesn't exist, or isn't yours.
- The thesis is finished (passed or retired). A sold stock is the exception: it may go back on watch or get a note.
- A stock with no view yet is saved without a `direction`. Code sends it to the [Writer](../agents/writer.md) instead, when its review clock or one of its triggers comes due.
- A stock with no view yet is committed without its triggers, or with triggers that don't check out.

A save with nothing left to change still counts as a review: it writes one "reviewed" line and moves the review clock.

## Your edit wins

If you set a field or a trigger by hand after a run started, the run can't change it. The field comes back refused: "You set this by hand at 9:41 ET; not changed." Your chat is exempt, because it is you.

## Each agent gets its own tools

Every job is its own tool, and an agent is given only the ones it may use, each with only the fields its job needs. A field that is offered gets filled, so a field an agent may not change is never offered.

| Who | Its thesis tools |
|---|---|
| The Writer | Its save, run in code (`update_thesis`, on no agent's list), then `edit_triggers` |
| Chat | `write_note`, `edit_triggers`, `set_conviction`, `set_catalyst_date`, `stop_watching`, `watch_again` |
| Morning run | The same six; its note carries the review's verdict |
| Trigger run | `write_note` (with the verdict), `edit_triggers` and `stop_watching` on its own stock: no conviction, no watch again |
| Portfolio Manager | `write_note` and `edit_triggers`: no status, no conviction |

The claim, the view and the write-up are the Writer's alone. A review's note carries its verdict (stronger, unchanged, weaker or broken), its one line, and the earlier line it answers; a wrong verdict word or line id comes back by name and the rest of the save lands. A test pins each caller's tools and fields, so a new field has to be placed on purpose.

## Triggers, one at a time

A trigger list is never replaced whole. An agent sends `edit_triggers` with `add`, `edit` (by id) or `remove` (by id); each op is an object carrying its reason (a trigger's or an edit's `rationale`, a removal's `reason`, kept on its Activity record). An add may name one of the stock's playbook triggers by its reference (W1, H2), and a price in an agent's own trigger may be a chart key (`{swingLow}`): code writes today's number from the chart before the save, and one it can't write comes back with why. That is the only way a trigger changes, besides the playbook's watch triggers the Writer's save writes. Each op is one line in Activity. A refused op comes back by id and the rest land; an add or edit that lands comes back as the trigger now reads, its sentence beside its reason (`saved`), so the agent sees "Add if below $406.88" next to its own "back through its old high". An edit keeps the trigger's id; one that changes its condition or action starts it fresh, so a true one fires at the next check. An agent's level change must carry a reason, so the sentence moves with the number. See [Triggers](../concepts/triggers.md).

## Floors only go up

On a stock we hold, no agent can lower or widen a protective level, remove it, or switch a floor from selling straight away to asking an agent first. An agent once lowered a floor it had raised hours earlier, with sale proposals still waiting. Chat is bound too. Only your edits on the thesis sheet skip the rule.

## When a save is refused

Every refusal is recorded. The agent reads it once, as the tool's answer with what to do instead; no later run is reminded of it. The homepage Activity shows refused trades for 30 days, and other refusals still open for 14 days, until the same tool lands on the same stock. A refusal of a single field isn't shown, since the rest of that call landed. A passed stock, or one no longer watched, takes no notes or edits, and its refusal says nothing more is owed. A sold stock still takes its one review: its refusal names the note that lets it go and `watch_again`.

An agent that sends the same refused call a third time is stopped, and the run closes as failed with the reason named; nothing more is said to it before then. Morning runs, [trigger](../agents/trigger-runs.md) runs and the other scheduled agents have this guard; the chat does not.

Status changes follow one table. An agent can drop a stock it watches (`stop_watching`, retired as dropped) or put a sold one back on watch (`watch_again`). It can't mark a stock held or sold: those follow the order.

<details>
<summary>Technical details</summary>

#### Patch
`dropUnchanged` in `saveThesis` (`lib/agent/tools/update-thesis.ts`) runs first; `refuseField` collects `refused_fields`. A seed's commitment is checked as sent. The schema has no level fields, so nothing but a `remove` in `edit_triggers` removes a trigger. The trigger run calls OpenAI's Responses API, which fills every field of a tool that sends no `strict`; the morning run calls Chat Completions, which doesn't.

#### Hand edits
`handEditsSince` reads `ThesisUpdate` rows since the run's start that `isYourEdit` marks. Skipped for `PRINCIPAL_CHAT`.

#### Doors
`schemaFor` in `lib/agent/define-tool.ts` builds each caller's schema. Each caller's tools and fields are pinned in `lib/agent/tools/thesis-doors.test.ts`.

#### Trigger ops
`applyTriggerOps` in `lib/agent/triggers/ops.ts`, shared with the thesis sheet and the buy's fill. Then one check of the result, `checkLadder`.

#### Ratchet
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts`, run by `ops.ts` when the actor is an agent and the status is `HOLDING`; on any other status, `watchLineViolations`: an agent's op that removes or loosens a Stop watching line is refused. An agent's save always sends `actor: "AGENT"`; the sheet sends `PRINCIPAL`.

#### Refusals
`GateRejection` in `prisma/schema.prisma`, written by `recordGateRejection` and closed by `resolveGateRejections` (`lib/agent/gate-rejections.ts`). Shown by `loadAttempts` in `lib/thesis/account-activity.server.ts`; recorded on the run by `recordOpenRefusalsEvent` (an `action_blocked` event no screen shows yet); a closed stock's refusal is `terminal_status` in `lib/agent/thesis-transitions.ts`. The repeat guard is `lib/agent/repeat-refusal.ts` (stop at 3), wired into `morning-research.ts`, `tactical-run.ts` and the agent runner (`lib/agent/engine/run.ts`).

#### Status table
`lib/agent/thesis-transitions.ts`: `checkStatusTransition`, `checkTerminateWithoutClose`, `checkWatchingOptOut`.
</details>
