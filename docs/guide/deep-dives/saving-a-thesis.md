# Saving a thesis

**A save is a patch.** Every agent write to a [thesis](../concepts/theses.md) goes through one tool, `update_thesis`, and it changes only what is different from what is stored.

This page covers how a save lands, what each agent is allowed to change, and what happens when part of a save is refused.

## What a save does

When an agent saves, the first thing the tool does is throw away every value that equals what is already stored. An agent that reads a stock and sends the whole form back changes nothing, and the Activity line records only what moved. Before this, an echoed entry price was read as a change and one run was refused eleven times.

A field that can't be applied comes back by name in `refused_fields`, with the one thing to change. The rest of the call lands. A save is refused whole only when nothing in it can land:

- The thesis doesn't exist, or isn't yours.
- The thesis is finished (passed or retired). A sold stock is the exception: it may go back on watch or get a note.
- A stock with no view yet is saved without a `direction`. A morning run sends it to the [Writer](../agents/writer.md) instead.
- A stock with no view yet is saved with a plan that doesn't check out.

A save with nothing left to change still counts as a review: it writes one "reviewed" line and moves the review clock.

## Your edit wins

If you set a field or a trigger by hand after a run started, the run can't change it. The field comes back refused: "You set this by hand at 9:41 ET; not changed." Your chat is exempt, because it is you.

## Each agent gets its own fields

The tool is built per agent, so an agent is never offered a field it may not change. A field that is offered gets filled.

- **Writer, 35 fields:** everything. It alone writes the research sections, the score and the variant view.
- **Chat, 21:** the claim, the view, the plan, the verdict and the note.
- **Morning run, 18:** the plan, the verdict and the note. No claim, no direction.
- **Trigger run, 11:** the note, the triggers and the three price levels. No verdict, no status change.

The fields fall in five groups: write-up, claim, plan, verdict and note. A test pins the counts, so a new field has to be placed on purpose.

## Triggers, one at a time

A trigger list is never replaced whole. An agent sends `add_triggers`, `edit_triggers` (by id) or `remove_trigger_ids`, and `entry_price`, `target_price` and `stop_loss` are the same edit on the buy, target and floor trigger. Each op is one line in Activity. A refused op comes back by id and the rest land. Because an edit keeps the trigger's id, its cooldown and fire history stay with it. An agent's level change must carry a reason, so the sentence moves with the number. See [Triggers](../concepts/triggers.md).

## Floors only go up

On a stock we hold, no agent can lower or widen a protective level, remove it, or switch a sale from proposing right away to asking an agent first. The floor itself always sells automatically, and every save writes it that way. An agent once lowered a floor it had raised hours earlier, with sale proposals still waiting. Chat is bound too. Only your edits on the thesis sheet skip the rule.

## When a save is refused

Every refusal is recorded. Anything still open when a run ends goes back to the run to fix, appears in Activity, and opens the next [morning run](../agents/morning-runs.md) as "Blocked last time". It closes when the same tool lands on the same stock. A refusal of a single field isn't carried over, since the rest of that call landed.

An agent that sends the same refused call again gets a nudge on the second refusal. On the third, the run stops and closes as failed with the reason named. Morning and [trigger](../agents/trigger-runs.md) runs share this guard.

Status changes follow one table. An agent can retire a stock as invalidated or dropped, or put a sold one back on watch. It can't mark a stock held or sold: those follow the order.

<details>
<summary>Technical details</summary>

#### Patch
`dropUnchanged` in `lib/agent/tools/update-thesis.ts` runs first; `refuseField` collects `refused_fields`. A seed's commitment is checked as sent.

#### Hand edits
`handEditsSince` reads `ThesisUpdate` rows since the run's start that `isYourEdit` marks. Skipped for `PRINCIPAL_CHAT`.

#### Doors
`schemaFor` in `lib/agent/define-tool.ts` builds each caller's schema. Counts (35 / 21 / 18 / 11) and the five groups are pinned in `lib/agent/tools/update-thesis-doors.test.ts`.

#### Trigger ops
`applyTriggerOps` in `lib/agent/triggers/ops.ts`, shared with the thesis sheet and the buy's fill. Then one plan check, `checkLadder`.

#### Ratchet
`protectiveRatchetViolations` in `lib/agent/triggers/ratchet.ts`, run by `ops.ts` when the actor is an agent and the status is `HOLDING`. `update_thesis` always sends `actor: "AGENT"`; the sheet sends `PRINCIPAL`.

#### Refusals
`GateRejection` in `prisma/schema.prisma`, written by `recordGateRejection` and closed by `resolveGateRejections` (`lib/agent/gate-rejections.ts`). Carried forward by `lib/agent/refusal-carryover.ts`. The repeat guard is `lib/agent/repeat-refusal.ts` (nudge at 2, stop at 3), wired into `morning-research.ts` and `tactical-run.ts`.

#### Status table
`lib/agent/thesis-transitions.ts`: `checkStatusTransition`, `checkTerminateWithoutClose`, `checkWatchingOptOut`.
</details>
