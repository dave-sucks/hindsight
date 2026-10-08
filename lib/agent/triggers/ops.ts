/**
 * Trigger operations — the ONE way a thesis's trigger list changes once the
 * thesis exists (DAV-242).
 *
 * A trigger list is edited one trigger at a time: add a trigger, edit a
 * trigger by id, remove a trigger by id. The agent's `update_thesis`, the
 * principal's trigger popover, a buy fill and a plan set-down all send ops
 * through `applyTriggerOps`; nothing hands a thesis a whole new list any
 * more. Two consequences the old replace-all contract could never give:
 *
 *   - an edited trigger keeps its id, so its fired / cooldown state carries
 *     by construction (no reconciliation, no id re-adoption, no handoff);
 *   - every op is its own line in the Activity feed — "Entry $183 → $190",
 *     "Removed: sell below $110" — because the ops ARE the change, not a
 *     diff of two lists guessed at afterwards.
 *
 * Rules run per op on the resulting list, and a refused op does not sink
 * the call: the caller gets every result back by id and the rest lands.
 *   - what a call deletes (a removal, a level sent as null) applies before
 *     what it writes, so a removal and its replacement in one call is a
 *     replace; an edit of a trigger the same call deletes comes back by id,
 *     neither applied — say which;
 *   - one trigger per bucket (and one per plan slot — one buy level, one
 *     floor, one target): adding into an occupied bucket EDITS the trigger
 *     that is there;
 *   - an agent's level / pct / days edit carries a rationale, so the
 *     sentence can never disagree with the number again;
 *   - on a stock we own, an agent may only tighten a protective sell level
 *     (the ratchet, DAV-185) — the principal is exempt, as before;
 *   - after all ops the plan is checked once (`checkLadder`): ordering
 *     everywhere, 2:1 on a plan we don't own. That one check replaces the
 *     argument-path gate and the derived-tuple gate.
 *
 * Pure — no DB, no clock. Callers load, apply, persist, and write the
 * audit row.
 */

import type { ResolvedTrigger } from "./levels";
import type { Trigger, TriggerAction } from "./types";
import { isDirectEligiblePredicate } from "./types";
import { triggerBucket } from "./bucket";
import { samePredicate } from "./condition/stored";
import {
  conditionSentence,
  isGroup,
  isLevel,
  levelOf,
  measureOf,
  reviewClockDays,
  sentenceOf,
  shapeOf,
  type Condition,
} from "./condition";
import { applyTriggerCooldownDefaults } from "./defaults";
import { stampWrittenPrice } from "./written-price";
import { validateEnterTriggerRequired } from "./enter-guard";
import {
  canonicalLevels,
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
import { declineReplanAllows } from "@/lib/agent/declined-sale";
import { MIN_RISK_REWARD, validateThesisShape } from "@/lib/agent/thesis-shape";
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
      fireMode?: "TACTICAL" | "DIRECT";
      rationale?: string;
      cooldownDays?: number;
    }
  | { op: "remove"; id: string }
  /**
   * Swap a trigger's condition, action and fire mode in one step (the trigger
   * dialog's Save). Kept in the same slot, it keeps its id, history and
   * cooldown; moved to another slot, it is a new trigger with a new id.
   */
  | { op: "replace"; id: string; trigger: Trigger }
  /** A plan level as an op — resolves to add / edit / remove on the slot's trigger. */
  | {
      op: "level";
      slot: LevelSlot;
      price: number | null;
      /** Why the level is where it is ("under the base low, 1.8 ATR") — becomes the trigger's sentence. */
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
   * only. SYSTEM is a buy fill or a plan set-down: no gate, and a template
   * trigger keeps its DEFAULT stamp.
   */
  actor: "AGENT" | "PRINCIPAL" | "SYSTEM";
  /**
   * The principal declined or let expire a protective sale on this stock in
   * the last week, and the price is still past the line (DAV-315).
   *
   * This is the ONE case where an agent may move a protective floor DOWN.
   * The 2026-08-16 ruling — only humans lower a safety line — stands
   * everywhere else, and it stands here too in substance: the decline IS
   * the human act. The principal saw the sale, said no, and on IOT even
   * named the level he wanted ("raise the stop to around $40.50"). Without
   * this, the only legal answer to that instruction was to do nothing,
   * which is what happened for nine days.
   *
   * Scope is deliberately narrow: LOWERED only. Deleting the floor outright
   * (REMOVED) or turning off its automatic fire (FIREMODE_DEMOTED) is not
   * re-planning, and stays refused.
   */
  saleDeclined?: { floorPrice: number | null } | null;
  /** Live quote — decides which side a re-levelled buy trigger compares on. */
  currentPrice?: number | null;
  /** Stamped on buy triggers this call writes (./written-price). Defaults to `currentPrice`. */
  writtenPrice?: number | null;
  /** The write time stamped with it. Defaults to now. */
  now?: Date;
  mintId: () => string;
}

export interface ApplyTriggerOpsOutput {
  triggers: Trigger[];
  results: TriggerOpResult[];
}

const SLOT_LABEL: Record<LevelSlot, string> = {
  ENTRY: "Entry",
  FLOOR: "Stop",
  TARGET: "Target",
};

const money = (n: number) => `$${n % 1 === 0 ? n : n.toFixed(2)}`;

/** "Entry", "Stop", "Target", "Review cadence", or the condition in words. */
function nameOf(t: Trigger, direction: string | null, sells: boolean): string {
  const slot = levelSlotOf(t, direction);
  if (slot) return SLOT_LABEL[slot];
  const w = shapeOf(t.predicate);
  if (w && reviewClockDays(w) != null) return "Review cadence";
  return sentenceOf(t, sells);
}

/** The trigger in words, as every surface says it: "Buy if above $183". `sells` is false on a stock we don't own. */
export function describeTrigger(t: Trigger, sells = true): string {
  return sentenceOf(t, sells);
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

// moveNumberInText lives in ./price-levels now, so the level path (entry /
// target / stop columns written through applyLevelArgs) rewrites a moved
// sentence the same way an edit op does.

/** The trigger an add would collide with: same plan slot, else same bucket. */
function collision(
  stored: Trigger[],
  t: Trigger,
  direction: string | null,
): Trigger | undefined {
  const slot = levelSlotOf(t, direction);
  if (slot) return stored.find((s) => levelSlotOf(s, direction) === slot);
  const bucket = triggerBucket(t);
  return stored.find((s) => triggerBucket(s) === bucket);
}

const MAX_TRIGGERS = 20;

export function applyTriggerOps(input: ApplyTriggerOpsInput): ApplyTriggerOpsOutput {
  const { direction, status, actor, inherited = [], currentPrice, mintId } = input;
  const held = status === "HOLDING";
  const stamp = (t: Trigger): Trigger["source"] =>
    actor === "AGENT" ? "AGENT" : actor === "PRINCIPAL" ? "PRINCIPAL" : (t.source ?? "DEFAULT");
  let stored = input.stored;
  const results: TriggerOpResult[] = [];

  const inheritedByBucket = new Map(inherited.map((t) => [triggerBucket(t), t]));

  // What a call deletes applies before what it writes (VST 2026-09-28). A
  // call that removes a trigger and adds its replacement means "replace".
  // Applied in the order sent, the add landed on the trigger it replaces —
  // one per bucket made it an edit of that trigger — and the removal then
  // deleted both. Eight saves lost a trigger that way from 09-15 to 09-28,
  // HPE's and EME's new buys among them. A level sent as null removes the
  // slot's trigger, so it is a deletion too.
  const deletes = (o: TriggerOp) => o.op === "remove" || (o.op === "level" && o.price == null);
  const deleted = new Set<string>();
  for (const o of input.ops) {
    if (o.op === "remove") deleted.add(o.id);
    else if (o.op === "level" && o.price == null) {
      for (const t of input.stored) if (levelSlotOf(t, direction) === o.slot) deleted.add(t.id);
    }
  }
  // The one real contradiction: an edit, by id, of a trigger the same call
  // deletes. Neither is applied; it comes back by id.
  const contradicted = new Set(
    input.ops.flatMap((o) => ((o.op === "edit" || o.op === "replace") && deleted.has(o.id) ? [o.id] : [])),
  );

  const refuse = (op: TriggerOpResult["op"], id: string, text: string, reason: string, unchanged?: true) =>
    results.push({ op, id, ok: false, text, reason, ...(unchanged ? { unchanged } : {}) });

  /** The one gate an agent's edit runs on a stock we own. */
  const ratchetReason = (next: Trigger[]): string | null => {
    if (actor !== "AGENT" || !held) return null;
    let v = protectiveRatchetViolations({ direction, before: stored, after: next, inherited });
    // DAV-315: a declined sale unlocks re-drawing THAT floor, bounded.
    // `declineReplanAllows` is the whole policy — floor only, absolute level
    // only, no more than 15% below the line he declined. Everything it does
    // not explicitly allow stays refused.
    if (input.saleDeclined) {
      const declinedFloor = input.saleDeclined.floorPrice;
      v = v.filter(
        (x) =>
          !declineReplanAllows({
            reason: x.reason,
            afterPredicate: x.after?.predicate,
            declinedFloor,
            direction,
          }),
      );
    }
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
   * `meta.viaLevel`: the edit came from a plan-level argument (entry / target /
   * stop) rather than an explicit trigger edit — the sentence is moved with
   * the number, so no rationale is demanded. `meta.above`: the side the
   * caller wrote on an added price trigger, used when there is no tape to
   * read it from. `meta.close`: the caller says whether it waits for the close.
   */
  const doEdit = (
    op: Extract<TriggerOp, { op: "edit" }>,
    meta: {
      slotForText?: LevelSlot;
      viaLevel?: boolean;
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
    const name = slotForText ? SLOT_LABEL[slotForText] : nameOf(target, direction, held);

    if (wanted) {
      if (!current || (op.unit && op.unit !== current.field)) {
        const what = op.unit ? `no editable \`${op.unit}\`` : "no number to change";
        return refuse("edit", op.id, `Edit ${name}`, `This trigger has ${what} — it is ${conditionSentence(child ?? target.predicate)}.`);
      }
      if (!(wanted.value > 0) || !Number.isFinite(wanted.value)) {
        return refuse("edit", op.id, `Edit ${name}`, "The number must be positive.");
      }
      if (actor === "AGENT" && !meta.viaLevel && !op.rationale?.trim() && wanted.value !== current.value) {
        return refuse(
          "edit",
          op.id,
          `${name} ${fmtValue(wanted.field, current.value)} → ${fmtValue(wanted.field, wanted.value)}`,
          "A level change needs a rationale — the sentence moves with the number. Resend this edit with `rationale`.",
        );
      }
    }
    if (
      op.fireMode === "DIRECT" &&
      ((op.action ?? target.action) !== "EXIT" || !held || !isDirectEligiblePredicate(target.predicate))
    ) {
      return refuse(
        "edit",
        op.id,
        `Edit ${name}`,
        "Direct exit is only available on a price/trailing EXIT trigger of a held position — judgment-bearing exits (earnings, signals, etc.) must wake a tactical run.",
      );
    }

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
      predicate = group ? { ...group, conditions: group.conditions.map((c: When, i: number) => (i === op.part ? next : c)) } : next;
    }
    // ...unless the caller says when it fires.
    if (meta.close !== undefined && !isGroup(predicate) && isLevel(predicate)) {
      const { settings, ...plain } = predicate as Condition;
      const { close: _old, ...rest } = settings ?? {};
      void _old;
      const kept = meta.close ? { ...rest, close: true } : rest;
      predicate = Object.keys(kept).length ? { ...plain, settings: kept } : plain;
    }
    const action = op.action ?? target.action;
    let rationale = op.rationale?.trim() || target.rationale;
    const slot = levelSlotOf({ ...target, predicate, action }, direction);
    const level = levelOf(predicate);
    if (!op.rationale?.trim() && wanted && current && wanted.value !== current.value) {
      rationale =
        moveNumberInText(target.rationale, wanted.field, current.value, wanted.value) ??
        (slot && level ? rationaleFor(slot, wanted.value, direction, held, level.above) : target.rationale);
    } else if (actor === "SYSTEM" && slot && level && target.source === "DEFAULT") {
      // A buy fill re-reads a template floor / target for a stock we now own
      // ("the plan comes down" → "sell if the price drops to").
      rationale = rationaleFor(slot, level.value, direction, held, level.above);
    }
    const edited: Trigger = {
      ...target,
      predicate,
      action,
      rationale,
      ...(op.fireMode !== undefined ? { fireMode: op.fireMode } : {}),
      ...(op.cooldownDays !== undefined ? { cooldownDays: op.cooldownDays } : {}),
      source: stamp(target),
    };
    const next = stored.map((t) => (t.id === op.id ? edited : t));

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
    const onClose = (p: When) => levelOf(p)?.close === true;
    if (onClose(predicate) !== onClose(tw)) parts.push(`${name}: ${onClose(predicate) ? "fires on the close" : "fires intraday"}`);
    if (op.action && op.action !== target.action)
      parts.push(`${name}: ${target.action.toLowerCase()} → ${op.action.toLowerCase()}`);
    if (op.fireMode && op.fireMode !== (target.fireMode ?? "TACTICAL"))
      parts.push(`${name}: fires ${op.fireMode === "DIRECT" ? "automatically" : "via a tactical run"}`);
    if (op.cooldownDays !== undefined && op.cooldownDays !== target.cooldownDays)
      parts.push(`${name}: cooldown ${op.cooldownDays} days`);
    if (parts.length === 0 && rationale !== target.rationale)
      parts.push(`${name}: wording updated`);
    if (parts.length === 0) {
      return refuse("edit", op.id, `${name}: no change`, "Nothing to change — the trigger already has these values.", true);
    }
    const text = parts.join("; ");

    const blocked = ratchetReason(next);
    if (blocked) return refuse("edit", op.id, text, blocked);
    commit(next, { op: "edit", id: op.id, ok: true, text });
  };

  const doRemove = (id: string) => {
    const target = stored.find((t) => t.id === id);
    if (!target) return refuse("remove", id, `Remove trigger ${id}`, notStored(id));
    const text = `Removed: ${describeTrigger(target, held)}`;
    const next = stored.filter((t) => t.id !== id);
    const blocked = ratchetReason(next);
    if (blocked) return refuse("remove", id, text, blocked);
    commit(next, { op: "remove", id, ok: true, text });
  };

  const doAdd = (trigger: Trigger) => {
    const existing = collision(stored, trigger, direction);
    if (existing) {
      // One trigger per bucket: the add becomes an edit of the one that is
      // there, which keeps its id and with it its fired state.
      const n = numberOf(trigger.predicate);
      const typed = shapeOf(trigger.predicate);
      return doEdit(
        {
          op: "edit",
          id: existing.id,
          ...(n ? { value: n.value } : {}),
          action: trigger.action,
          rationale: trigger.rationale,
          ...(trigger.fireMode !== undefined ? { fireMode: trigger.fireMode } : {}),
          ...(trigger.cooldownDays !== undefined ? { cooldownDays: trigger.cooldownDays } : {}),
        },
        { above: typed ? levelOf(typed)?.above : undefined },
      );
    }
    const id = trigger.id || mintId();
    const text = `Added: ${describeTrigger(trigger, held)}`;
    const above = inheritedByBucket.get(triggerBucket(trigger));
    if (
      above &&
      samePredicate(above.predicate, trigger.predicate) &&
      (above.fireMode ?? "TACTICAL") === (trigger.fireMode ?? "TACTICAL")
    ) {
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
    const sameSlot = triggerBucket(target) === triggerBucket(trigger);
    const clash = sameSlot ? undefined : stored.find((s) => s.id !== id && triggerBucket(s) === triggerBucket(trigger));
    const text = `Changed: ${describeTrigger(target, held)} → ${describeTrigger(trigger, held)}`;
    if (clash) {
      return refuse("edit", id, text, `This stock already has "${describeTrigger(clash, held)}". Edit that one instead.`);
    }
    if (
      sameSlot &&
      samePredicate(target.predicate, trigger.predicate) &&
      target.action === trigger.action &&
      (target.fireMode ?? "TACTICAL") === (trigger.fireMode ?? "TACTICAL")
    ) {
      return refuse("edit", id, text, "Nothing to change — the trigger already says this.", true);
    }
    // The history belongs to the condition. Same slot: a new value for the
    // same rule keeps its id, its fire history, its cooldown and its
    // sentence (the number moved in it). Another slot: a different rule,
    // so a new id and a clean history (inherited rules keep theirs per stock
    // under the id, so a reused id would carry the old cooldown along).
    let replaced: Trigger;
    if (sameSlot) {
      const was = numberOf(target.predicate);
      const now = numberOf(trigger.predicate);
      const moved =
        was && now && was.field === now.field && was.value !== now.value
          ? moveNumberInText(target.rationale, was.field, was.value, now.value)
          : null;
      replaced = {
        ...target,
        predicate: trigger.predicate,
        action: trigger.action,
        fireMode: trigger.fireMode,
        rationale: moved ?? target.rationale,
        source: stamp(trigger),
      };
    } else {
      const { lastFiredAt: _f, firedFilings: _ff, firedReports: _fr, ...fresh } = trigger;
      void _f;
      void _ff;
      void _fr;
      replaced = { ...fresh, id: mintId(), source: stamp(trigger) };
    }
    const next = stored.map((t) => (t.id === id ? replaced : t));
    const blocked = ratchetReason(next);
    if (blocked) return refuse("edit", id, text, blocked);
    commit(next, { op: "edit", id: replaced.id, ok: true, text });
  };

  const doLevel = (
    slot: LevelSlot,
    price: number | null,
    extra: { rationale?: string; basis?: "intraday" | "close" } = {},
  ) => {
    // A buy level on a stock we own would re-arm a purchase (the 2026-05-19
    // shape: 35 of 36 buy tactical runs were on names already held).
    if (slot === "ENTRY" && held) {
      return refuse("edit", "", "Entry", "On a held stock the entry is the fill — it is not a plan level and cannot be edited.");
    }
    const occupants = stored.filter((t) => levelSlotOf(t, direction) === slot);
    if (price == null) {
      for (const t of occupants) if (!contradicted.has(t.id)) doRemove(t.id);
      return;
    }
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
        { slotForText: slot, viaLevel: true, close: extra.basis === undefined ? undefined : extra.basis === "close" },
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
      `Edit and remove: ${t ? describeTrigger(t, held) : `trigger ${id}`}`,
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
  return {
    triggers: changed
      ? stampWrittenPrice(
          input.stored,
          applyTriggerCooldownDefaults(stored),
          input.writtenPrice !== undefined ? input.writtenPrice : currentPrice,
          input.now ?? new Date(),
        )
      : stored,
    results,
  };
}

// ── The one check after all ops ─────────────────────────────────────────

export type LadderCheck =
  | { ok: true; columns: { entryPrice: number | null; targetPrice: number | null; stopLoss: number | null } }
  | { ok: false; error: "invalid_thesis_shape" | "missing_enter_trigger"; message: string };

/**
 * Derive the plan from the list and check it once: ordering everywhere, the
 * buy-trigger / sell-trigger rules of `validateEnterTriggerRequired`, and —
 * for an AGENT only — the 2:1 floor on a plan we don't own. The floor is a
 * rule for plans the agents write; the principal is exempt from it as from
 * the ratchet. Held: `entryPrice` is the fill.
 */
export function checkLadder(input: {
  triggers: Trigger[];
  inherited?: ResolvedTrigger[];
  direction: string | null;
  status: string | null;
  actor: ApplyTriggerOpsInput["actor"];
  /** The fill on a held name (position avgCost, else the stored entry). */
  entryPrice?: number | null;
  avgCost?: number | null;
}): LadderCheck {
  const { triggers, inherited = [], direction, status } = input;
  const held = status === "HOLDING";
  const columns = canonicalLevels({
    triggers: [
      ...triggers.map((t) => ({ ...t, level: "THESIS" as const, inherited: false })),
      ...inherited,
    ],
    direction,
    status,
    avgCost: input.avgCost,
  }).columns;

  if (direction === "LONG" || direction === "SHORT") {
    const shape = validateThesisShape({
      direction,
      entryPrice: held ? (input.entryPrice ?? columns.entryPrice) : columns.entryPrice,
      targetPrice: columns.targetPrice,
      stopLoss: columns.stopLoss,
      minRiskReward: held || input.actor !== "AGENT" ? undefined : MIN_RISK_REWARD,
      held,
    });
    if (!shape.ok) return { ok: false, error: "invalid_thesis_shape", message: shape.note };
  }
  const guard = validateEnterTriggerRequired({
    direction: direction as "LONG" | "SHORT" | "PASS" | null,
    status: (status ?? "WATCHING") as "WATCHING" | "HOLDING" | "PROMOTED" | "PASSED" | "RETIRED",
    triggers: [...triggers, ...inherited],
    targetPrice: columns.targetPrice,
  });
  if (!guard.ok) return { ok: false, error: "missing_enter_trigger", message: guard.note };
  return { ok: true, columns };
}

/** The accepted ops, as stored on the audit row — text and identity only. */
export function acceptedOps(results: TriggerOpResult[]): Array<{ op: string; id: string; text: string }> {
  return results.filter((r) => r.ok).map(({ op, id, text }) => ({ op, id, text }));
}
