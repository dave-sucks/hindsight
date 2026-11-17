/**
 * Trigger operations — the ONE way a thesis's trigger list changes once the
 * thesis exists (DAV-242).
 *
 * A trigger list is edited one trigger at a time: add a trigger, edit a
 * trigger by id, remove a trigger by id. The agent's `update_thesis`, the
 * principal's trigger popover and a buy fill all send ops through
 * `applyTriggerOps`; nothing hands a thesis a whole new list any more. Two consequences the old replace-all contract could never give:
 *
 *   - an edited trigger keeps its id (no reconciliation, no id re-adoption,
 *     no handoff); a changed condition or action clears when it fired, so it
 *     fires when it is true;
 *   - every op is its own line in the Activity feed — "Entry $183 → $190",
 *     "Removed: sell below $110" — because the ops ARE the change, not a
 *     diff of two lists guessed at afterwards.
 *
 * Rules run per op on the resulting list, and a refused op does not sink
 * the call: the caller gets every result back by id and the rest lands.
 *   - what a call deletes (a removal) applies before what it writes, so a
 *     removal and its replacement in one call is a
 *     replace; an edit of a trigger the same call deletes comes back by id,
 *     neither applied — say which;
 *   - one trigger per bucket (and one per price slot — one buy, one floor,
 *     one upside rule): adding into an occupied bucket EDITS the trigger
 *     that is there;
 *   - an agent's level / pct / days edit carries a rationale, so the
 *     sentence can never disagree with the number again;
 *   - a sale ("Sell if", EXIT) is for a stock we hold and "Stop watching
 *     if" (STOP_WATCHING) for one we don't: the other is refused with the
 *     fix, never converted (./condition/actions);
 *   - on a stock we own, an agent may only tighten a protective sell level
 *     (the ratchet, DAV-185) — the principal is exempt, as before;
 *   - after all ops the list is checked once (`checkLadder`): ordering
 *     everywhere. That one check replaces the argument-path gate and the
 *     derived-tuple gate. (The 2:1 floor it also ran went 2026-11-04.)
 *
 * Pure — no DB, no clock. Callers load, apply, persist, and write the
 * audit row.
 */

import type { ResolvedTrigger } from "./levels";
import type { Trigger, TriggerAction } from "./types";
import { defaultFireMode, fireModeOf, fireModeProblem, fireModeWords, trimPctOf, type FireMode } from "./fire-mode";
import { triggerSlot } from "./condition/slot";
import { samePredicate } from "./condition/stored";
import {
  actionProblem,
  conditionSentence,
  conditionsOf,
  isGroup,
  isLevel,
  levelOf,
  measureOf,
  settingDefs,
  waitsForClose,
  POSITION_ON_A_WATCH,
  readsThePosition,
  reviewClockDays,
  sentenceOf,
  shapeOf,
  type Condition,
} from "./condition";
import { applyTriggerDefaults } from "./defaults";
import { defaultNote } from "./note";
import { validateEnterTriggerRequired } from "./enter-guard";
import {
  levelSlotOf,
  moveNumberInText,
  predicateFor,
  rationaleFor,
  withBasisOf,
  type LevelSlot,
} from "./price-levels";
import {
  describeRatchetViolation,
  protectiveRatchetViolations,
} from "./ratchet";
import type { When } from "@/lib/agent/triggers/condition";

export type TriggerOp =
  | { op: "add"; trigger: Trigger }
  | {
      op: "edit";
      id: string;
      /** The new number, whatever the measure: a price, a %, a count of days. */
      value?: number;
      /** The old field the caller named (`level`, `pct`, `days`): the number must be that kind of number. */
      unit?: "level" | "pct" | "days";
      /** On a two-condition (AND / OR) trigger: which condition's number, 0-based. */
      part?: number;
      action?: TriggerAction;
      fireMode?: FireMode;
      /** An Auto-trim: the % it sells. */
      trimPct?: number;
      rationale?: string;
      /** A price level fires only on the 16:20 close pass; false = intraday. Absent = as it was. */
      close?: boolean;
    }
  | { op: "remove"; id: string }
  /**
   * Swap a trigger's condition, action and fire mode in one step (the trigger
   * dialog's Save). Kept in the same slot, it keeps its id and history (a
   * changed condition starts its fire state fresh); moved to another slot, it
   * is a new trigger with a new id.
   */
  | { op: "replace"; id: string; trigger: Trigger }
  /**
   * The buy fill's stop and upside level (the approved order's numbers, which
   * the Trade ticket and Edit & Approve can change): an edit of the slot's
   * trigger, or a new one. No agent tool sends it; agents edit triggers by id.
   */
  | {
      op: "level";
      slot: LevelSlot;
      price: number;
      /** Becomes the trigger's sentence. */
      rationale?: string;
      /** "close" = fires only on the day's close (a buy that wants the close to confirm). */
      basis?: "intraday" | "close";
    };

export interface TriggerOpResult {
  op: "add" | "edit" | "remove";
  id: string;
  ok: boolean;
  /** Plain-language line for the Activity feed and the tool result. */
  text: string;
  /** Why the op was refused. */
  reason?: string;
  /** The op asked for what the trigger already says: an agent's save drops it, a person is told. */
  unchanged?: true;
  /** The number a refused op asked for, so the save's record names what did not land. */
  to?: number;
}

export interface ApplyTriggerOpsInput {
  /** Thesis-stored triggers. */
  stored: Trigger[];
  /** The resolved analyst / account triggers above this thesis. */
  inherited?: ResolvedTrigger[];
  ops: TriggerOp[];
  direction: string | null;
  status: string | null;
  /**
   * Who is editing. The ratchet and the rationale rule apply to agents
   * only. SYSTEM is a buy fill: no gate, and a template
   * trigger keeps its DEFAULT stamp.
   */
  actor: "AGENT" | "PRINCIPAL" | "SYSTEM";
  /** An agent acting on the owner's word (the owner's chat): it may set Auto on a buy, add or trim. */
  ownersWord?: boolean;
  /** Live quote — decides which side a re-levelled buy trigger compares on. */
  currentPrice?: number | null;
  mintId: () => string;
}

export interface ApplyTriggerOpsOutput {
  triggers: Trigger[];
  results: TriggerOpResult[];
}

const SLOT_LABEL: Record<LevelSlot, string> = {
  ENTRY: "Buy",
  FLOOR: "Stop",
  TARGET: "Upside",
};

const money = (n: number) => `$${n % 1 === 0 ? n : n.toFixed(2)}`;

/** "Buy", "Stop", "Stop watching", "Upside", "Review cadence", or the condition in words. */
function nameOf(t: Trigger, direction: string | null): string {
  const slot = levelSlotOf(t, direction);
  if (t.action === "STOP_WATCHING") return "Stop watching";
  if (slot) return SLOT_LABEL[slot];
  const w = shapeOf(t.predicate);
  if (w && reviewClockDays(w) != null) return "Review cadence";
  return sentenceOf(t);
}

/** The trigger in words, as every surface says it: "Buy if above $183". */
export function describeTrigger(t: Trigger): string {
  return sentenceOf(t);
}

/** A note for a trigger the owner set without one: the trigger in words (note.ts). */
export function addedTriggerRationale(action: TriggerAction, predicate: When): string {
  return defaultNote(action, predicate);
}

/** How a condition's number reads and moves in a sentence: a price, a %, or days (the measure's own unit). */
function fieldOf(c: Condition): "level" | "pct" | "days" {
  const v = measureOf(c).value;
  return v.prefix === "$" ? "level" : v.suffix === "days" ? "days" : "pct";
}

/** A single condition's number, with how it reads; null for a group or a condition with none. */
function numberOf(p: unknown): { field: "level" | "pct" | "days"; value: number } | null {
  const w = shapeOf(p);
  return w && !isGroup(w) && w.value != null ? { field: fieldOf(w), value: w.value } : null;
}

function fmtValue(field: "level" | "pct" | "days", v: number): string {
  return field === "level" ? money(v) : field === "pct" ? `${v}%` : `${v} days`;
}

/** The trigger an add would collide with: same price slot, else same bucket. */
export function collision(
  stored: Trigger[],
  t: Trigger,
  direction: string | null,
): Trigger | undefined {
  const slot = levelSlotOf(t, direction);
  if (slot) return stored.find((s) => levelSlotOf(s, direction) === slot);
  const bucket = triggerSlot(t);
  return stored.find((s) => triggerSlot(s) === bucket);
}

const MAX_TRIGGERS = 20;

/** A trigger as new to fire: when it fired and when a close last found it false are cleared (firedFilings and firedReports stay: once per filing, once per report). */
function freshFire(t: Trigger): Trigger {
  const { lastFiredAt: _f, falseAtCloseAt: _c, ...rest } = t;
  void _f;
  void _c;
  return rest;
}

export function applyTriggerOps(input: ApplyTriggerOpsInput): ApplyTriggerOpsOutput {
  const { direction, status, actor, inherited = [], currentPrice, mintId } = input;
  // Only the mode an op sets is held to the owner's rule: an agent may move the level of an owner's Auto trigger.
  const setsMode = (action: string, mode: FireMode | undefined) => fireModeProblem(action, mode, { agent: actor === "AGENT" && !input.ownersWord });
  const held = status === "HOLDING";
  // A watch carries watch triggers: one that reads our position waits for the buy.
  const onAWatch = (p: unknown) => {
    const w = shapeOf(p);
    return !held && w != null && readsThePosition(w) ? POSITION_ON_A_WATCH : null;
  };
  const stamp = (t: Trigger): Trigger["source"] =>
    actor === "AGENT" ? "AGENT" : actor === "PRINCIPAL" ? "PRINCIPAL" : (t.source ?? "DEFAULT");
  let stored = input.stored;
  const results: TriggerOpResult[] = [];

  const inheritedByBucket = new Map(inherited.map((t) => [triggerSlot(t), t]));

  // What a call deletes applies before what it writes (VST 2026-09-28). A
  // call that removes a trigger and adds its replacement means "replace".
  // Applied in the order sent, the add landed on the trigger it replaces —
  // one per bucket made it an edit of that trigger — and the removal then
  // deleted both. Eight saves lost a trigger that way from 09-15 to 09-28,
  // HPE's and EME's new buys among them.
  const deletes = (o: TriggerOp) => o.op === "remove";
  const deleted = new Set(input.ops.flatMap((o) => (o.op === "remove" ? [o.id] : [])));
  // The one real contradiction: an edit, by id, of a trigger the same call
  // deletes. Neither is applied; it comes back by id.
  const contradicted = new Set(
    input.ops.flatMap((o) => ((o.op === "edit" || o.op === "replace") && deleted.has(o.id) ? [o.id] : [])),
  );

  const refuse = (op: TriggerOpResult["op"], id: string, text: string, reason: string, extra: Pick<TriggerOpResult, "unchanged" | "to"> = {}) =>
    results.push({ op, id, ok: false, text, reason, ...extra });

  /** The one gate an agent's edit runs on a stock we own. */
  const ratchetReason = (next: Trigger[]): string | null => {
    if (actor !== "AGENT" || !held) return null;
    const v = protectiveRatchetViolations({ direction, before: stored, after: next, inherited });
    return v.length ? v.map(describeRatchetViolation).join(" ") : null;
  };

  const commit = (next: Trigger[], result: TriggerOpResult) => {
    stored = next;
    results.push(result);
  };

  const notStored = (id: string): string => {
    const above = inherited.find((t) => t.id === id);
    return above
      ? `Trigger ${id} is set at the ${above.level.toLowerCase()} level, not on this stock. To override it here, add a trigger with your own value; to change it everywhere, edit it where it lives.`
      : `Trigger ${id} is not on this thesis.`;
  };

  /**
   * `meta.slotForText`: the slot a fill's level op names, for its line.
   * `meta.above`: the side the caller wrote on an added price trigger, used
   * when there is no tape to read it from. `meta.close`: the caller says
   * whether it waits for the close.
   */
  const doEdit = (
    op: Extract<TriggerOp, { op: "edit" }>,
    meta: {
      slotForText?: LevelSlot;
      above?: boolean;
      close?: boolean;
    } = {},
  ) => {
    const { slotForText } = meta;
    const target = stored.find((t) => t.id === op.id);
    if (!target) return refuse("edit", op.id, `Edit trigger ${op.id}`, notStored(op.id));

    // A two-condition trigger's number lives on one of its conditions.
    const tw = shapeOf(target.predicate);
    if (!tw) return refuse("edit", op.id, `Edit trigger ${op.id}`, "This trigger's condition was removed; delete it and add a new one.");
    const group = isGroup(tw) ? tw : null;
    const child = group && op.part != null ? group.conditions[op.part] : undefined;
    if (op.part != null && (!child || isGroup(child))) {
      return refuse("edit", op.id, `Edit trigger ${op.id}`, `This trigger has no condition ${op.part + 1}.`);
    }
    const subject = (child ?? (group ? null : tw)) as Condition | null;
    const current = subject?.value != null ? { field: fieldOf(subject), value: subject.value } : null;
    const wanted = op.value !== undefined && subject ? { field: fieldOf(subject), value: op.value } : op.value !== undefined ? { field: "pct" as const, value: op.value } : null;
    const name = slotForText ? SLOT_LABEL[slotForText] : nameOf(target, direction);

    const moves = !!(wanted && current && wanted.value !== current.value);
    if (wanted) {
      if (!current || (op.unit && op.unit !== current.field)) {
        const what = op.unit ? `no editable \`${op.unit}\`` : "no number to change";
        return refuse("edit", op.id, `Edit ${name}`, `This trigger has ${what} — it is ${conditionSentence(child ?? target.predicate)}.`);
      }
      if (!(wanted.value > 0) || !Number.isFinite(wanted.value)) {
        return refuse("edit", op.id, `Edit ${name}`, "The number must be positive.");
      }
      if (actor === "AGENT" && !op.rationale?.trim() && wanted.value !== current.value) {
        return refuse(
          "edit",
          op.id,
          `${name} ${fmtValue(wanted.field, current.value)} → ${fmtValue(wanted.field, wanted.value)}`,
          "A level change needs a rationale — the sentence moves with the number. Resend this edit with `rationale`.",
          { to: wanted.value },
        );
      }
    }
    const wrongAction = op.action ? actionProblem(op.action, { held }) : null;
    if (wrongAction) return refuse("edit", op.id, `Edit ${name}`, wrongAction);
    // A new action with no mode named takes that action's default, as the dialog does.
    const fireMode = op.fireMode ?? (op.action && op.action !== target.action ? defaultFireMode(op.action) : undefined);
    const modeProblem = fireModeProblem(op.action ?? target.action, fireMode ?? target.fireMode) ?? setsMode(op.action ?? target.action, fireMode);
    if (modeProblem) return refuse("edit", op.id, `Edit ${name}`, modeProblem);

    let predicate: When = tw;
    if (subject && wanted) {
      let next: Condition = {
        ...subject,
        value: wanted.value,
      };
      const slot = !group ? levelSlotOf(target, direction) : null;
      if (wanted && slot && isLevel(subject)) {
        // A buy level's side comes from the tape when there is one (a level
        // under the price is a pullback, over it a breakout); otherwise from
        // the side the caller wrote, else the side it already had.
        const tapeKnown = currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0;
        const sided = tapeKnown || meta.above === undefined ? predicateFor(slot, wanted.value, direction, currentPrice) : { ...next, is: meta.above ? ("above" as const) : ("below" as const) };
        next = slot === "ENTRY" && !tapeKnown && meta.above === undefined ? { ...sided, is: subject.is } : sided;
        // Moving the number never changes when it fires (DAV-247 review).
        next = withBasisOf(subject, next);
      }
      predicate = group ? { ...group, conditions: group.conditions.map((c, i) => (i === op.part ? next : c)) } : next;
    }
    // ...unless the caller says when it fires: the edit's own `close`, or
    // the fill level's basis. It applies to a typed price or an average only.
    const close = op.close ?? meta.close;
    // The close setting goes where the save takes it: a typed price or an average (the measure's own rule).
    const closeFits = (c: Condition) => settingDefs(c).some((d) => d.key === "close") && measureOf(c).fits({ ...c, settings: { ...c.settings, close: true } });
    const closeNotApplied = close !== undefined && (isGroup(predicate) || !closeFits(predicate as Condition));
    if (close !== undefined && !closeNotApplied) {
      const { settings, ...plain } = predicate as Condition;
      const { close: _old, ...rest } = settings ?? {};
      void _old;
      const kept = close ? { ...rest, close: true } : rest;
      predicate = Object.keys(kept).length ? { ...plain, settings: kept } : plain;
    }
    const action = op.action ?? target.action;
    const watchProblem = onAWatch(predicate);
    if (watchProblem) return refuse("edit", op.id, `Edit ${name}`, watchProblem);
    let rationale = op.rationale?.trim() || target.rationale;
    const slot = levelSlotOf({ ...target, predicate, action }, direction);
    const level = levelOf(predicate);
    if (!op.rationale?.trim() && wanted && current && wanted.value !== current.value) {
      rationale =
        moveNumberInText(target.rationale, wanted.field, current.value, wanted.value) ??
        (slot && level ? rationaleFor(slot, wanted.value, direction, held, level.above) : target.rationale);
    } else if (actor === "SYSTEM" && slot && level && target.source === "DEFAULT") {
      // A buy fill re-reads a template level for a stock we now own.
      rationale = rationaleFor(slot, level.value, direction, held, level.above);
    }
    const edited: Trigger = {
      ...target,
      predicate,
      action,
      rationale,
      ...(fireMode !== undefined ? { fireMode } : {}),
      ...(op.trimPct !== undefined ? { trimPct: op.trimPct } : {}),
      source: stamp(target),
    };
    // A changed condition or action is a new trigger to fire: it fires when it is true.
    const changed = !samePredicate(target.predicate, predicate) || action !== target.action;
    const next = stored.map((t) => (t.id === op.id ? (changed ? freshFire(edited) : edited) : t));

    const parts: string[] = [];
    if (wanted && current && wanted.value !== current.value) {
      let line = `${name} ${fmtValue(wanted.field, current.value)} → ${fmtValue(wanted.field, wanted.value)}`;
      if (held && target.action === "EXIT" && levelSlotOf(target, direction) === "FLOOR") {
        const long = direction !== "SHORT";
        line += (long ? wanted.value > current.value : wanted.value < current.value)
          ? " (tightened)"
          : " (loosened)";
      }
      parts.push(line);
    }
    const onClose = (p: When) => waitsForClose(p);
    if (onClose(predicate) !== onClose(tw)) parts.push(`${name}: ${onClose(predicate) ? "fires on the close" : "fires intraday"}`);
    if (op.action && op.action !== target.action)
      parts.push(`${name}: ${target.action.toLowerCase()} → ${op.action.toLowerCase()}`);
    if (fireMode && fireMode !== fireModeOf(target)) parts.push(`${name}: ${fireModeWords({ action, fireMode })}`);
    if (op.trimPct !== undefined && op.trimPct !== trimPctOf(target)) parts.push(`${name}: size ${trimPctOf(target)}% → ${op.trimPct}%`);
    if (parts.length === 0 && rationale !== target.rationale)
      parts.push(`${name}: wording updated`);
    // Said, not dropped: "on the close" means nothing to a trigger that isn't
    // a price level. Alone, it comes back by id with the reason (a no-op the
    // save would drop unseen); with other changes, it rides on their line.
    const notOnClose = `${name}: on the close is for a typed price or an average, so its timing is as it was`;
    if (parts.length === 0) {
      if (closeNotApplied) return refuse("edit", op.id, `${name}: timing as it was`, `${notOnClose}.`);
      return refuse("edit", op.id, `${name}: no change`, "Nothing to change — the trigger already has these values.", { unchanged: true });
    }
    if (closeNotApplied) parts.push(notOnClose);
    const text = parts.join("; ");

    const blocked = ratchetReason(next);
    if (blocked) return refuse("edit", op.id, text, blocked, moves ? { to: wanted!.value } : {});
    commit(next, { op: "edit", id: op.id, ok: true, text });
  };

  const doRemove = (id: string) => {
    const target = stored.find((t) => t.id === id);
    if (!target) return refuse("remove", id, `Remove trigger ${id}`, notStored(id));
    const text = `Removed: ${describeTrigger(target)}`;
    const next = stored.filter((t) => t.id !== id);
    const blocked = ratchetReason(next);
    if (blocked) return refuse("remove", id, text, blocked);
    commit(next, { op: "remove", id, ok: true, text });
  };

  const doAdd = (trigger: Trigger) => {
    const wrongAction = actionProblem(trigger.action, { held }) ?? onAWatch(trigger.predicate);
    if (wrongAction) return refuse("add", trigger.id || mintId(), `Added: ${describeTrigger(trigger)}`, wrongAction);
    const existing = collision(stored, trigger, direction);
    if (existing) {
      // One trigger per bucket: the add becomes an edit of the one that is
      // there, which keeps its id and with it its fired state.
      const n = numberOf(trigger.predicate);
      const typed = shapeOf(trigger.predicate);
      // The add's "only on the close" comes with it: dropped here, an on-close
      // buy sent onto the buy already there stayed intraday (VST 09-28).
      const close = typed && !isGroup(typed) && typed.settings?.close !== undefined ? typed.settings.close === true : undefined;
      return doEdit(
        {
          op: "edit",
          id: existing.id,
          ...(n ? { value: n.value } : {}),
          action: trigger.action,
          rationale: trigger.rationale,
          ...(trigger.fireMode !== undefined ? { fireMode: trigger.fireMode } : {}),
          ...(trigger.trimPct !== undefined ? { trimPct: trigger.trimPct } : {}),
          ...(close !== undefined ? { close } : {}),
        },
        { above: typed ? levelOf(typed)?.above : undefined },
      );
    }
    const id = trigger.id || mintId();
    const text = `Added: ${describeTrigger(trigger)}`;
    const modeProblem = setsMode(trigger.action, trigger.fireMode);
    if (modeProblem) return refuse("add", id, text, modeProblem);
    const above = inheritedByBucket.get(triggerSlot(trigger));
    if (above && samePredicate(above.predicate, trigger.predicate) && fireModeOf(above) === fireModeOf(trigger)) {
      return refuse(
        "add",
        id,
        text,
        `Already in force from the ${above.level.toLowerCase()} rule — add a different value to override it on this stock.`,
      );
    }
    if (stored.length >= MAX_TRIGGERS) {
      return refuse("add", id, text, `A thesis carries at most ${MAX_TRIGGERS} triggers.`);
    }
    const next = [...stored, { ...trigger, id, source: stamp(trigger) }];
    const blocked = ratchetReason(next);
    if (blocked) return refuse("add", id, text, blocked);
    commit(next, { op: "add", id, ok: true, text });
  };

  const doReplace = (id: string, trigger: Trigger) => {
    const target = stored.find((t) => t.id === id);
    if (!target) return refuse("edit", id, `Change trigger ${id}`, notStored(id));
    const sameSlot = triggerSlot(target) === triggerSlot(trigger);
    const clash = sameSlot ? undefined : stored.find((s) => s.id !== id && triggerSlot(s) === triggerSlot(trigger));
    const text = `Changed: ${describeTrigger(target)} → ${describeTrigger(trigger)}`;
    const wrongAction = actionProblem(trigger.action, { held }) ?? onAWatch(trigger.predicate);
    if (wrongAction) return refuse("edit", id, text, wrongAction);
    const modeProblem = setsMode(trigger.action, trigger.fireMode);
    if (modeProblem) return refuse("edit", id, text, modeProblem);
    if (clash) {
      return refuse("edit", id, text, `This stock already has "${describeTrigger(clash)}". Edit that one instead.`);
    }
    if (
      sameSlot &&
      samePredicate(target.predicate, trigger.predicate) &&
      target.action === trigger.action &&
      fireModeOf(target) === fireModeOf(trigger) &&
      trimPctOf(target) === trimPctOf(trigger)
    ) {
      return refuse("edit", id, text, "Nothing to change — the trigger already says this.", { unchanged: true });
    }
    // The history belongs to the condition. Same slot: a new value for the
    // same rule keeps its id (a changed condition starts its fire state
    // fresh, below). Another slot: a different rule, so a new id and a clean
    // history (inherited rules keep theirs per stock under the id).
    let replaced: Trigger;
    if (sameSlot) {
      const was = numberOf(target.predicate);
      const now = numberOf(trigger.predicate);
      const moved =
        was && now && was.field === now.field && was.value !== now.value
          ? moveNumberInText(target.rationale, was.field, was.value, now.value)
          : null;
      // A new number takes the reason sent with it (MU 10-13: the $1,005 reason stayed on a $1,060 floor).
      // None sent: the owner's reads as the trigger in words; an agent's keeps the number moved in the old one.
      const numbers = (p: When) => conditionsOf(p).map((c) => c.value).join();
      const renumbered = numbers(target.predicate) !== numbers(trigger.predicate);
      const sent = trigger.rationale?.trim() || (actor === "PRINCIPAL" ? addedTriggerRationale(trigger.action, trigger.predicate) : "");
      replaced = {
        ...target,
        predicate: trigger.predicate,
        action: trigger.action,
        fireMode: trigger.fireMode,
        trimPct: trigger.trimPct,
        rationale: (renumbered && sent) || (moved ?? target.rationale),
        source: stamp(trigger),
      };
      // A changed condition or action is a new trigger to fire: it fires when it is true.
      if (!samePredicate(target.predicate, trigger.predicate) || target.action !== trigger.action) replaced = freshFire(replaced);
    } else {
      const { lastFiredAt: _f, firedFilings: _ff, firedReports: _fr, ...fresh } = trigger;
      void _f;
      void _ff;
      void _fr;
      // A playbook's trigger edited into another kind is still the playbook's: the fill takes it off with the rest.
      replaced = { ...fresh, id: mintId(), source: stamp(trigger), ...(target.playbook ? { playbook: target.playbook } : {}) };
    }
    const next = stored.map((t) => (t.id === id ? replaced : t));
    const blocked = ratchetReason(next);
    if (blocked) return refuse("edit", id, text, blocked);
    commit(next, { op: "edit", id: replaced.id, ok: true, text });
  };

  const doLevel = (
    slot: LevelSlot,
    price: number,
    extra: { rationale?: string; basis?: "intraday" | "close" } = {},
  ) => {
    // A buy level on a stock we own would re-arm a purchase (the 2026-05-19
    // shape: 35 of 36 buy tactical runs were on names already held).
    if (slot === "ENTRY" && held) {
      return refuse("edit", "", "Entry", "On a held stock the entry is the fill — it is not a trigger and cannot be edited.");
    }
    const occupants = stored.filter((t) => levelSlotOf(t, direction) === slot);
    if (!(price > 0) || !Number.isFinite(price)) {
      return refuse("edit", "", SLOT_LABEL[slot], `${SLOT_LABEL[slot].toLowerCase()} must be a positive number.`);
    }
    if (occupants.length > 0) {
      // The canonical one — the floor you hit first, the furthest target.
      const long = direction !== "SHORT";
      const keep = occupants.reduce((best, t) => {
        const a = numberOf(t.predicate)?.value ?? 0;
        const b = numberOf(best.predicate)?.value ?? 0;
        return (long ? a > b : a < b) ? t : best;
      });
      return doEdit(
        { op: "edit", id: keep.id, value: price, ...(extra.rationale?.trim() ? { rationale: extra.rationale.trim() } : {}) },
        { slotForText: slot, close: extra.basis === undefined ? undefined : extra.basis === "close" },
      );
    }
    const sided = predicateFor(slot, price, direction, currentPrice);
    const predicate: Condition = extra.basis === "close" ? { ...sided, settings: { close: true } } : sided;
    const directional = direction === "LONG" || direction === "SHORT";
    const action: TriggerAction =
      slot === "ENTRY" ? (directional ? "ENTER" : "REVIEW") : slot === "FLOOR" ? "EXIT" : "REVIEW";
    const id = mintId();
    const text = `${SLOT_LABEL[slot]} set: ${money(price)}`;
    const fresh: Trigger = {
      id,
      predicate,
      action,
      rationale: extra.rationale?.trim() || rationaleFor(slot, price, direction, held, predicate.is === "above"),
    };
    const next = [...stored, { ...fresh, source: stamp(fresh) }];
    const blocked = ratchetReason(next);
    if (blocked) return refuse("add", id, text, blocked);
    commit(next, { op: "add", id, ok: true, text });
  };

  for (const id of contradicted) {
    const t = input.stored.find((s) => s.id === id);
    refuse(
      "edit",
      id,
      `Edit and remove: ${t ? describeTrigger(t) : `trigger ${id}`}`,
      "Edited and removed in the same call — say which: send the edit or the removal, not both.",
    );
  }

  for (const op of [...input.ops.filter(deletes), ...input.ops.filter((o) => !deletes(o))]) {
    switch (op.op) {
      case "add":
        doAdd(op.trigger);
        break;
      case "edit":
        if (!contradicted.has(op.id)) doEdit(op);
        break;
      case "remove":
        if (!contradicted.has(op.id)) doRemove(op.id);
        break;
      case "replace":
        if (!contradicted.has(op.id)) doReplace(op.id, op.trigger);
        break;
      case "level":
        doLevel(op.slot, op.price, { rationale: op.rationale, basis: op.basis });
        break;
    }
  }

  const changed = results.some((r) => r.ok);
  return { triggers: changed ? applyTriggerDefaults(stored) : stored, results };
}

// ── The one check after all ops ─────────────────────────────────────────

export type LadderCheck =
  | { ok: true }
  | { ok: false; error: "missing_enter_trigger"; message: string };

/**
 * The one check after all ops: the buy-trigger / sell-trigger rules of
 * `validateEnterTriggerRequired`. No order of a buy, floor and upside line
 * (gone 2026-11-16) and no reward/risk (gone 2026-11-04): a stock has
 * triggers and nothing else, and place_trade refuses a sale past the price.
 */
export function checkLadder(input: {
  triggers: Trigger[];
  inherited?: ResolvedTrigger[];
  direction: string | null;
  status: string | null;
  actor: ApplyTriggerOpsInput["actor"];
}): LadderCheck {
  const { triggers, inherited = [], direction, status } = input;
  const guard = validateEnterTriggerRequired({
    direction: direction as "LONG" | "SHORT" | "PASS" | null,
    status: (status ?? "WATCHING") as "WATCHING" | "HOLDING" | "PROMOTED" | "PASSED" | "RETIRED",
    triggers: [...triggers, ...inherited],
  });
  if (!guard.ok) return { ok: false, error: "missing_enter_trigger", message: guard.note };
  return { ok: true };
}

/** The accepted ops, as stored on the audit row — text and identity only. */
export function acceptedOps(results: TriggerOpResult[]): Array<{ op: string; id: string; text: string }> {
  return results.filter((r) => r.ok).map(({ op, id, text }) => ({ op, id, text }));
}
