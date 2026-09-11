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
import type { Trigger, TriggerAction, TriggerPredicate } from "./types";
import { isDirectEligiblePredicate } from "./types";
import { triggerBucket } from "./bucket";
import { predicateSentence } from "./format";
import { applyTriggerCooldownDefaults } from "./defaults";
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
import { MIN_RISK_REWARD, validateThesisShape } from "@/lib/agent/thesis-shape";

export type TriggerOp =
  | { op: "add"; trigger: Trigger }
  | {
      op: "edit";
      id: string;
      level?: number;
      pct?: number;
      days?: number;
      action?: TriggerAction;
      fireMode?: "TACTICAL" | "DIRECT";
      rationale?: string;
      cooldownDays?: number;
    }
  | { op: "remove"; id: string }
  /** A plan level as an op — resolves to add / edit / remove on the slot's trigger. */
  | { op: "level"; slot: LevelSlot; price: number | null };

export interface TriggerOpResult {
  op: "add" | "edit" | "remove";
  id: string;
  ok: boolean;
  /** Plain-language line for the Activity feed and the tool result. */
  text: string;
  /** Why the op was refused. */
  reason?: string;
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
  /** Live quote — decides which side a re-levelled buy trigger compares on. */
  currentPrice?: number | null;
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

/** "Entry", "Stop", "Target", "Review cadence", or the predicate sentence. */
function nameOf(t: Trigger, direction: string | null): string {
  const slot = levelSlotOf(t, direction);
  if (slot) return SLOT_LABEL[slot];
  if (t.predicate.kind === "REVIEW_CADENCE") return "Review cadence";
  return predicateSentence(t.predicate);
}

/** "buy above $183", "sell below $110", "review every 14 days", or "<sentence> → <action>". */
export function describeTrigger(t: Trigger, direction: string | null): string {
  const p = t.predicate;
  const slot = levelSlotOf(t, direction);
  if (slot && (p.kind === "PRICE_ABOVE" || p.kind === "PRICE_BELOW")) {
    const verb = slot === "ENTRY" ? "buy" : slot === "FLOOR" ? "sell" : "review";
    return `${verb} ${p.kind === "PRICE_ABOVE" ? "above" : "below"} ${money(p.level)}`;
  }
  if (p.kind === "REVIEW_CADENCE") return `review every ${p.days} days`;
  return `${predicateSentence(p)} → ${t.action.toLowerCase()}`;
}

/** The editable number on a predicate, as (field, value). */
function numberOf(p: TriggerPredicate): { field: "level" | "pct" | "days"; value: number } | null {
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return { field: "level", value: p.level };
    case "PRICE_MOVE_PCT":
    case "GAIN_FROM_ENTRY":
    case "TRAILING_FROM_HIGH":
      return { field: "pct", value: p.pct };
    case "REVIEW_CADENCE":
    case "EARNINGS_WITHIN":
      return { field: "days", value: p.days };
    default:
      return null;
  }
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

  const refuse = (op: TriggerOpResult["op"], id: string, text: string, reason: string) =>
    results.push({ op, id, ok: false, text, reason });

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
   * `meta.viaLevel`: the edit came from a plan-level argument (entry / target /
   * stop) rather than an explicit trigger edit — the sentence is moved with
   * the number, so no rationale is demanded. `meta.kind`: the side the
   * caller wrote on an added price trigger, used when there is no tape to
   * read it from.
   */
  const doEdit = (
    op: Extract<TriggerOp, { op: "edit" }>,
    meta: { slotForText?: LevelSlot; viaLevel?: boolean; kind?: "PRICE_ABOVE" | "PRICE_BELOW" } = {},
  ) => {
    const { slotForText } = meta;
    const target = stored.find((t) => t.id === op.id);
    if (!target) return refuse("edit", op.id, `Edit trigger ${op.id}`, notStored(op.id));

    const current = numberOf(target.predicate);
    const wanted =
      op.level !== undefined
        ? ({ field: "level", value: op.level } as const)
        : op.pct !== undefined
          ? ({ field: "pct", value: op.pct } as const)
          : op.days !== undefined
            ? ({ field: "days", value: op.days } as const)
            : null;
    const name = slotForText ? SLOT_LABEL[slotForText] : nameOf(target, direction);

    if (wanted) {
      if (!current || current.field !== wanted.field) {
        return refuse(
          "edit",
          op.id,
          `Edit ${name}`,
          `This trigger has no editable \`${wanted.field}\` — it is ${predicateSentence(target.predicate)}.`,
        );
      }
      if (!(wanted.value > 0) || !Number.isFinite(wanted.value)) {
        return refuse("edit", op.id, `Edit ${name}`, `${wanted.field} must be a positive number.`);
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
      ((op.action ?? target.action) !== "EXIT" || !held || !isDirectEligiblePredicate(target.predicate.kind))
    ) {
      return refuse(
        "edit",
        op.id,
        `Edit ${name}`,
        "Direct exit is only available on a price/trailing EXIT trigger of a held position — judgment-bearing exits (earnings, signals, etc.) must wake a tactical run.",
      );
    }

    let predicate = target.predicate;
    if (wanted && current) {
      const slot = levelSlotOf(target, direction);
      // A buy level's side comes from the tape when there is one (a level
      // under the price is a pullback, over it a breakout); otherwise from
      // the side the caller wrote, else the side it already had.
      const tapeKnown = currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0;
      predicate =
        wanted.field === "level" && slot
          ? tapeKnown || !meta.kind
            ? predicateFor(slot, wanted.value, direction, currentPrice)
            : { kind: meta.kind, level: wanted.value }
          : ({ ...predicate, [wanted.field]: wanted.value } as TriggerPredicate);
      if (wanted.field === "level" && slot === "ENTRY" && !tapeKnown && !meta.kind) {
        predicate = { kind: target.predicate.kind as "PRICE_ABOVE" | "PRICE_BELOW", level: wanted.value };
      }
      // Moving the number never changes when it fires (DAV-247 review).
      if (wanted.field === "level") predicate = withBasisOf(target.predicate, predicate);
    }
    const action = op.action ?? target.action;
    let rationale = op.rationale?.trim() || target.rationale;
    const slot = levelSlotOf({ ...target, predicate, action }, direction);
    const isPriceLevel = predicate.kind === "PRICE_ABOVE" || predicate.kind === "PRICE_BELOW";
    if (!op.rationale?.trim() && wanted && current && wanted.value !== current.value) {
      rationale =
        moveNumberInText(target.rationale, wanted.field, current.value, wanted.value) ??
        (slot && isPriceLevel
          ? rationaleFor(slot, wanted.value, direction, held, predicate.kind as "PRICE_ABOVE" | "PRICE_BELOW")
          : target.rationale);
    } else if (actor === "SYSTEM" && slot && isPriceLevel && target.source === "DEFAULT") {
      // A buy fill re-reads a template floor / target for a stock we now own
      // ("the plan comes down" → "sell if the price drops to").
      rationale = rationaleFor(slot, (predicate as { level: number }).level, direction, held, predicate.kind as "PRICE_ABOVE" | "PRICE_BELOW");
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
    if (op.action && op.action !== target.action)
      parts.push(`${name}: ${target.action.toLowerCase()} → ${op.action.toLowerCase()}`);
    if (op.fireMode && op.fireMode !== (target.fireMode ?? "TACTICAL"))
      parts.push(`${name}: fires ${op.fireMode === "DIRECT" ? "automatically" : "via a tactical run"}`);
    if (op.cooldownDays !== undefined && op.cooldownDays !== target.cooldownDays)
      parts.push(`${name}: cooldown ${op.cooldownDays} days`);
    if (parts.length === 0 && rationale !== target.rationale)
      parts.push(`${name}: wording updated`);
    if (parts.length === 0) {
      return refuse("edit", op.id, `${name}: no change`, "Nothing to change — the trigger already has these values.");
    }
    const text = parts.join("; ");

    const blocked = ratchetReason(next);
    if (blocked) return refuse("edit", op.id, text, blocked);
    commit(next, { op: "edit", id: op.id, ok: true, text });
  };

  const doRemove = (id: string) => {
    const target = stored.find((t) => t.id === id);
    if (!target) return refuse("remove", id, `Remove trigger ${id}`, notStored(id));
    const text = `Removed: ${describeTrigger(target, direction)}`;
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
      const k = trigger.predicate.kind;
      return doEdit(
        {
          op: "edit",
          id: existing.id,
          ...(n ? { [n.field]: n.value } : {}),
          action: trigger.action,
          rationale: trigger.rationale,
          ...(trigger.fireMode !== undefined ? { fireMode: trigger.fireMode } : {}),
          ...(trigger.cooldownDays !== undefined ? { cooldownDays: trigger.cooldownDays } : {}),
        },
        { kind: k === "PRICE_ABOVE" || k === "PRICE_BELOW" ? k : undefined },
      );
    }
    const id = trigger.id || mintId();
    const text = `Added: ${describeTrigger(trigger, direction)}`;
    const above = inheritedByBucket.get(triggerBucket(trigger));
    if (
      above &&
      JSON.stringify(above.predicate) === JSON.stringify(trigger.predicate) &&
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

  const doLevel = (slot: LevelSlot, price: number | null) => {
    // A buy level on a stock we own would re-arm a purchase (the 2026-05-19
    // shape: 35 of 36 buy tactical runs were on names already held).
    if (slot === "ENTRY" && held) {
      return refuse("edit", "", "Entry", "On a held stock the entry is the fill — it is not a plan level and cannot be edited.");
    }
    const occupants = stored.filter((t) => levelSlotOf(t, direction) === slot);
    if (price == null) {
      if (occupants.length === 0) return;
      for (const t of occupants) doRemove(t.id);
      return;
    }
    if (!(price > 0) || !Number.isFinite(price)) {
      return refuse("edit", "", SLOT_LABEL[slot], `${SLOT_LABEL[slot].toLowerCase()} must be a positive number.`);
    }
    if (occupants.length > 0) {
      // The canonical one — the floor you hit first, the furthest target.
      const long = direction !== "SHORT";
      const keep = occupants.reduce((best, t) => {
        const a = (t.predicate as { level?: number }).level ?? 0;
        const b = (best.predicate as { level?: number }).level ?? 0;
        return (long ? a > b : a < b) ? t : best;
      });
      return doEdit({ op: "edit", id: keep.id, level: price }, { slotForText: slot, viaLevel: true });
    }
    const predicate = predicateFor(slot, price, direction, currentPrice);
    const directional = direction === "LONG" || direction === "SHORT";
    const action: TriggerAction =
      slot === "ENTRY" ? (directional ? "ENTER" : "REVIEW") : slot === "FLOOR" ? "EXIT" : "REVIEW";
    const id = mintId();
    const text = `${SLOT_LABEL[slot]} set: ${money(price)}`;
    const fresh: Trigger = { id, predicate, action, rationale: rationaleFor(slot, price, direction, held, predicate.kind) };
    const next = [...stored, { ...fresh, source: stamp(fresh) }];
    const blocked = ratchetReason(next);
    if (blocked) return refuse("add", id, text, blocked);
    commit(next, { op: "add", id, ok: true, text });
  };

  for (const op of input.ops) {
    switch (op.op) {
      case "add":
        doAdd(op.trigger);
        break;
      case "edit":
        doEdit(op);
        break;
      case "remove":
        doRemove(op.id);
        break;
      case "level":
        doLevel(op.slot, op.price);
        break;
    }
  }

  return {
    triggers: results.some((r) => r.ok) ? applyTriggerCooldownDefaults(stored) : stored,
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
