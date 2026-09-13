/**
 * Price levels, read off the trigger list.
 *
 * > Design: docs/plans/LEVELS_AS_TRIGGERS.md
 *
 * There is no stop, target, or entry price. There is a **price level, a side,
 * and an action** — "sell if it drops to $256" is a downside level with EXIT,
 * "buy at $47" is a level with ENTER. `Thesis.stopLoss` / `targetPrice` /
 * `entryPrice` are the pre-trigger app still sitting in the database; they
 * become a cache computed here and are never authored directly.
 *
 * Four things leave this file:
 *
 *   canonicalLevels  read  — what the card, the chart and the columns show
 *   applyLevelArgs   write — a level change, as a trigger change
 *   levelLabelState  read  — what the card says for one slot
 *   isPlanLevel      read  — which triggers demotion removes
 *
 * Floor vs target is the SIDE, never the magnitude. A trigger can't say
 * "exit at 100" — every price predicate carries a direction:
 *
 *              floor (protective)      target (opportunity)
 *   LONG       EXIT + below            EXIT|REVIEW + above
 *   SHORT      EXIT + above            EXIT|REVIEW + below
 *
 * A floor ABOVE the current price is legal; it means we're about to be
 * stopped out.
 *
 * Pure — no DB, no clock, no fetches.
 */

import type { Trigger, TriggerAction, TriggerPredicate } from "./types";
import type { ResolvedTrigger, TriggerLevel } from "./levels";

// ── Shape ──────────────────────────────────────────────────────────────

/** The three slots the Price Targets card renders. */
export type LevelSlot = "ENTRY" | "FLOOR" | "TARGET";

export interface PriceLevel {
  slot: LevelSlot | null;
  /** Where this level sits, in dollars. */
  price: number;
  /** UPSIDE is where the trade makes money — direction-aware. */
  side: "UPSIDE" | "DOWNSIDE";
  action: TriggerAction;
  triggerId: string;
  storedAt: TriggerLevel;
  inherited: boolean;
  /**
   * The price moves: computed from a trail off the high or a gain off entry
   * cost rather than typed as a level. Drives a distinct chart line, and is
   * kept out of the cached columns.
   */
  projected: boolean;
  predicateKind: TriggerPredicate["kind"];
}

export interface CanonicalLevels {
  /** Where we would buy (watching) or what we paid (held). */
  entry: PriceLevel | null;
  /** The protective level that fires FIRST — may be a moving trail. */
  floor: PriceLevel | null;
  /** The furthest opportunity level — the destination. */
  target: PriceLevel | null;
  /** Every price level, ascending. The chart draws all of these. */
  all: PriceLevel[];
  /**
   * The cached column values. Absolute levels only: a trail moves with the
   * high, and `stopLoss` feeds prompts and the protective ratchet, which want
   * the stable typed number. The card shows the moving one; the cache stores
   * the typed one.
   */
  columns: {
    entryPrice: number | null;
    targetPrice: number | null;
    stopLoss: number | null;
  };
  /**
   * The floor sits at or above an upside level, so one of the two fires on
   * essentially every tick regardless of price.
   *
   * MU, live: EXIT below $935 and REVIEW above $934 — a $1 gap covering the
   * whole number line. Neither was written wrong. The agent set the review at
   * $934 on 8/18 when the floor was $814, then the floor was raised to $935
   * on 8/19 and crossed it. Nothing notices a raise passing another level, so
   * MU has generated a daily sell proposal ever since.
   *
   * Reported, not blocked: raising a floor is always legal (the ratchet only
   * cares about weakening), and the fix is to retire the spent checkpoint,
   * which is a judgment call.
   */
  contradiction: { floor: number; upside: number } | null;
}

export interface LevelInputs {
  /** The RESOLVED trigger list — cascade already applied. */
  triggers: ResolvedTrigger[];
  direction: string | null;
  /** HOLDING flips entry from "the plan" to "what we paid". */
  status?: string | null;
  avgCost?: number | null;
  /** Position high-water mark, for placing a trail at a real price. */
  peakPrice?: number | null;
}

const ABSOLUTE = new Set<TriggerPredicate["kind"]>(["PRICE_ABOVE", "PRICE_BELOW"]);
const PROJECTED = new Set<TriggerPredicate["kind"]>([
  "TRAILING_FROM_HIGH",
  "GAIN_FROM_ENTRY",
]);

const isLong = (d: string | null | undefined) => d !== "SHORT";

// ── Read ───────────────────────────────────────────────────────────────

/**
 * Read the canonical levels off a resolved trigger list.
 *
 *   ENTRY  — the ENTER trigger; on a held thesis the actual fill instead.
 *            Once you own it, entry is a fact, not a plan.
 *   FLOOR  — the protective EXIT that fires FIRST. Among several the tightest
 *            wins, because that is the one you hit. A trail competes on equal
 *            terms: SNOW showed "$256" while its only real exit was a
 *            give-back off the high.
 *   TARGET — the FURTHEST opportunity level. Intermediate levels stay in
 *            `all` so tiered trims render as their own chart lines.
 */
export function canonicalLevels(input: LevelInputs): CanonicalLevels {
  const { triggers, direction, status, avgCost, peakPrice } = input;
  const long = isLong(direction);

  const all: PriceLevel[] = [];
  for (const t of triggers) {
    const kind = t.predicate.kind;
    const absolute = ABSOLUTE.has(kind);
    if (!absolute && !PROJECTED.has(kind)) continue;
    const side = levelSide(t.predicate, direction);
    if (side == null) continue;
    const price = predicatePrice(t.predicate, { direction, avgCost, peakPrice });
    // A projected level with no position state genuinely is not at a price.
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    all.push({
      slot: null,
      price,
      side,
      action: t.action,
      triggerId: t.id,
      storedAt: t.level,
      inherited: t.inherited,
      projected: !absolute,
      predicateKind: kind,
    });
  }
  all.sort((a, b) => a.price - b.price);

  const held = status === "HOLDING";
  let entry: PriceLevel | null = null;
  if (held && avgCost != null && avgCost > 0) {
    entry = {
      slot: "ENTRY",
      price: avgCost,
      side: "UPSIDE",
      action: "ENTER",
      triggerId: "",
      storedAt: "THESIS",
      inherited: false,
      projected: false,
      predicateKind: "PRICE_ABOVE",
    };
  } else {
    const e = all.find((l) => l.action === "ENTER");
    entry = e ? { ...e, slot: "ENTRY" } : null;
  }

  const floors = all.filter((l) => l.side === "DOWNSIDE" && l.action === "EXIT");
  const floor = firstToFire(floors, long);
  const target = furthest(
    all.filter(
      (l) =>
        l.side === "UPSIDE" &&
        (l.action === "EXIT" || l.action === "REVIEW") &&
        // A gain milestone off entry is a checkpoint, not a destination.
        !l.projected,
    ),
    long,
  );

  const slotById = new Map<string, LevelSlot>();
  if (entry?.triggerId) slotById.set(entry.triggerId, "ENTRY");
  if (floor) slotById.set(floor.triggerId, "FLOOR");
  if (target) slotById.set(target.triggerId, "TARGET");

  return {
    entry,
    floor: floor ? { ...floor, slot: "FLOOR" } : null,
    target: target ? { ...target, slot: "TARGET" } : null,
    all: all.map((l) => ({ ...l, slot: slotById.get(l.triggerId) ?? null })),
    contradiction: contradictionBetween(floor, all, long),
    columns: {
      entryPrice: entry?.price ?? null,
      targetPrice: target?.price ?? null,
      // Typed floors only — see CanonicalLevels.columns.
      stopLoss:
        firstToFire(floors.filter((l) => !l.projected), long)?.price ?? null,
    },
  };
}

// ── Write ──────────────────────────────────────────────────────────────

/**
 * Apply level changes by writing TRIGGERS, then recompute the columns from
 * the result. The single write path behind `stop_loss` / `target_price` /
 * `entry_price` on every tool.
 *
 * Two properties this exists for:
 *
 *  1. A level change IS a trigger change. SNOW happened because the agent
 *     raised `stop_loss` to $256 and no trigger was written.
 *  2. The columns are recomputed from the FINAL list, so a level that is
 *     removed nulls its column with it instead of lingering as a number
 *     nothing enforces.
 *
 * Used where a thesis is being minted (record_thesis) or a position's stop
 * and target are synced (manage_position). Once a thesis exists, its
 * triggers change through ops — `lib/agent/triggers/ops.ts`.
 *
 * `undefined` leaves a slot alone; `null` clears it.
 */
export function applyLevelArgs(args: {
  /** Thesis-stored triggers. */
  stored: Trigger[];
  /** The resolved analyst/account levels above this thesis. */
  inherited?: ResolvedTrigger[];
  levels: { entry?: number | null; target?: number | null; floor?: number | null };
  direction: string | null;
  status?: string | null;
  avgCost?: number | null;
  /** The live quote, read only by the ENTRY slot — see `predicateFor`. */
  currentPrice?: number | null;
  source?: Trigger["source"];
  mintId: () => string;
}): { triggers: Trigger[]; columns: CanonicalLevels["columns"] } {
  const { stored, inherited, levels, direction, status, avgCost,
    currentPrice, source, mintId } = args;
  let triggers = stored;

  for (const [slot, price] of [
    ["ENTRY", levels.entry],
    ["FLOOR", levels.floor],
    ["TARGET", levels.target],
  ] as Array<[LevelSlot, number | null | undefined]>) {
    if (price === undefined) continue;
    // On a held thesis `entryPrice` is the fill, not a plan. Minting a buy
    // trigger for it re-arms a purchase on a name we already own — the
    // 2026-05-19 bug where 35 of 36 ENTER tacticals fired on held tickers.
    if (slot === "ENTRY" && status === "HOLDING") continue;
    triggers = setLevel(
      slot,
      price,
      direction,
      triggers,
      mintId,
      source,
      status === "HOLDING",
      currentPrice,
    );
  }

  return {
    triggers,
    columns: canonicalLevels({
      triggers: [
        ...triggers.map((t) => ({
          ...t,
          level: "THESIS" as const,
          inherited: false,
        })),
        ...(inherited ?? []),
      ],
      direction,
      status,
      avgCost,
    }).columns,
  };
}

/** A committed bullish/bearish view. Null / PASS / legacy PENDING are not. */
function isDirectional(direction: string | null): boolean {
  return direction === "LONG" || direction === "SHORT";
}

/**
 * Which plan slot an absolute price trigger occupies, if any: the buy level
 * (ENTER), the floor (a downside EXIT) or the target (an upside EXIT or
 * REVIEW). One trigger per slot is the rule every write path keeps.
 */
export function levelSlotOf(t: Trigger, direction: string | null): LevelSlot | null {
  if (!ABSOLUTE.has(t.predicate.kind)) return null;
  if (t.action === "ENTER") return "ENTRY";
  const side = levelSide(t.predicate, direction);
  if (side === "DOWNSIDE") return t.action === "EXIT" ? "FLOOR" : null;
  return t.action === "EXIT" || t.action === "REVIEW" ? "TARGET" : null;
}

/**
 * Set or clear one slot. Editing an existing trigger in the slot is preferred
 * over adding, so it keeps its id and with it its cooldown history and
 * `source` stamp. A duplicate behind it is dropped — a second trigger in the
 * same slot is the hazard where the level you set is not the level that fires.
 */
function setLevel(
  slot: LevelSlot,
  price: number | null,
  direction: string | null,
  stored: Trigger[],
  mintId: () => string,
  source?: Trigger["source"],
  held: boolean = true,
  currentPrice?: number | null,
): Trigger[] {
  const occupies = (t: Trigger): boolean => levelSlotOf(t, direction) === slot;

  if (price == null) return stored.filter((t) => !occupies(t));

  const fresh = predicateFor(slot, price, direction, currentPrice);

  const matches = stored.filter(occupies);
  if (matches.length > 0) {
    const long = isLong(direction);
    // Floor: keep the tightest. Target: keep the furthest. Same comparison
    // either way — the level deepest in that slot's direction.
    const keep =
      slot === "ENTRY"
        ? matches[0]
        : matches.reduce((best, t) => {
            const a = priceOf(t);
            const b = priceOf(best);
            if (a == null || b == null) return best;
            return (long ? a > b : a < b) ? t : best;
          });
    // Moving the number never changes WHEN it fires: a "closes above $X"
    // level stays a close-basis level (DAV-247 review — the rebuild used to
    // drop `basis`, turning a close confirmation into an intraday poke).
    const predicate = withBasisOf(keep.predicate, fresh);
    return stored
      .filter((t) => !occupies(t) || t.id === keep.id)
      .map((t) => {
        if (t.id !== keep.id) return t;
        // The sentence moves with the number. A side flip makes the old
        // wording a lie ("broke above $130" on a level the price now comes
        // back DOWN to) → template sentence. A same-side move keeps the
        // author's words with the number swapped ("Exit below $935" on a
        // $969 floor sat on MU for two weeks); when the old number isn't in
        // the text, the template sentence. Unchanged number → untouched.
        const before = priceOf(t);
        const rationale =
          t.predicate.kind !== predicate.kind
            ? rationaleFor(slot, price, direction, held, predicate.kind)
            : before != null && before !== price
              ? (moveNumberInText(t.rationale, "level", before, price) ??
                rationaleFor(slot, price, direction, held, predicate.kind))
              : t.rationale;
        return { ...t, predicate, rationale };
      });
  }

  return [
    ...stored,
    {
      id: mintId(),
      predicate: fresh,
      // A target is REVIEW, not EXIT (ruling 2026-08-24): a floor is
      // protective and acts on its own; a target is an opportunity and wakes
      // a decision. Auto-selling at the target re-creates the capped-winner
      // problem the ladder exists to fix, and the trail already protects the
      // downside while the decision waits.
      //
      // ENTRY is a BUY only when there is a view to buy on (2026-09-01).
      // With direction null — an unresearched seed, or a quiet watch that
      // researched the name and declined — there is no committed thesis, no
      // target and no stop, so an armed ENTER would let the evaluator
      // propose a purchase off a row that says "we are not buying this."
      // The level is still worth keeping; it just wakes a decision instead
      // of placing an order. A later commitment (update_thesis with a
      // direction) re-derives it as a real ENTER.
      action:
        slot === "ENTRY"
          ? isDirectional(direction)
            ? "ENTER"
            : "REVIEW"
          : slot === "FLOOR"
            ? "EXIT"
            : "REVIEW",
      rationale: rationaleFor(slot, price, direction, held, fresh.kind),
      ...(source ? { source } : {}),
    },
  ];
}

// ── Display ────────────────────────────────────────────────────────────

/**
 * What the card says for one slot.
 *
 * Three states. The third is the headline point — a cached column with no
 * trigger behind it is decoration, and rendering it as plain "Stop $256" is
 * the lie SNOW told on a live position for months.
 *
 * `does` is the quieter half of the same idea. A floor is always a sell, but
 * a target may be a sell OR a review, and the card used to render both as
 * "Target $1150". That tells you the level is real without telling you what
 * reaching it does — a smaller version of the same problem. So the label
 * carries the verb.
 */
export type LevelLabelState =
  | { kind: "live"; price: number; moving: boolean; does: "sells" | "asks" }
  | { kind: "decorative"; price: number }
  | { kind: "none" };

export function levelLabelState(
  level:
    | { price: number; projected: boolean; action?: string }
    | null
    | undefined,
  storedColumn: number | null | undefined,
): LevelLabelState {
  if (level) {
    return {
      kind: "live",
      price: level.price,
      moving: level.projected,
      // Anything that isn't an outright sell wakes a decision instead —
      // REVIEW batches to the next morning run, TRIM/ADD propose a size
      // change. From the card's point of view they all ask rather than act.
      does: level.action === "EXIT" ? "sells" : "asks",
    };
  }
  if (storedColumn != null) return { kind: "decorative", price: storedColumn };
  return { kind: "none" };
}

// ── Demotion ───────────────────────────────────────────────────────────

/**
 * Is this trigger part of the priced plan — the buy level, the floor, or the
 * target? Those are what demotion removes.
 *
 * Only absolute price levels qualify. A review cadence, an earnings trigger
 * or a percentage move is not a plan level and survives: the whole point is
 * that the item keeps being watched. A DOWNSIDE review ("price dropped to
 * support — better entry, or thesis weakening?") is a watching instruction
 * rather than a plan level, so it stays too.
 */
export function isPlanLevel(t: Trigger, direction: string | null): boolean {
  if (!ABSOLUTE.has(t.predicate.kind)) return false;
  if (t.action === "ENTER" || t.action === "EXIT") return true;
  if (t.action !== "REVIEW") return false;
  return levelSide(t.predicate, direction) === "UPSIDE";
}

// ── Internals ──────────────────────────────────────────────────────────

/** Which side of the trade a price predicate sits on. Null if not a level. */
function levelSide(
  p: TriggerPredicate,
  direction: string | null,
): "UPSIDE" | "DOWNSIDE" | null {
  const long = isLong(direction);
  switch (p.kind) {
    case "PRICE_ABOVE":
      return long ? "UPSIDE" : "DOWNSIDE";
    case "PRICE_BELOW":
      return long ? "DOWNSIDE" : "UPSIDE";
    case "TRAILING_FROM_HIGH":
      return "DOWNSIDE"; // a give-back is always the losing side
    case "GAIN_FROM_ENTRY":
      return p.direction === "UP" ? "UPSIDE" : "DOWNSIDE";
    default:
      return null;
  }
}

/** The dollar price a predicate currently sits at, or null. */
function predicatePrice(
  p: TriggerPredicate,
  ctx: {
    direction: string | null;
    avgCost?: number | null;
    peakPrice?: number | null;
  },
): number | null {
  const long = isLong(ctx.direction);
  switch (p.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return p.level;
    case "TRAILING_FROM_HIGH": {
      const peak = ctx.peakPrice;
      if (peak == null || peak <= 0) return null;
      return long ? peak * (1 - p.pct / 100) : peak * (1 + p.pct / 100);
    }
    case "GAIN_FROM_ENTRY": {
      const avg = ctx.avgCost;
      if (avg == null || avg <= 0) return null;
      const up = p.direction === "UP";
      const favourable = long ? up : !up;
      return favourable ? avg * (1 + p.pct / 100) : avg * (1 - p.pct / 100);
    }
    default:
      return null;
  }
}

/**
 * A buy level is a price we have NOT reached, and which side of the tape it
 * sits on says which shape the analyst meant: above the price is a breakout
 * they want confirmed first, below it a pullback they want to pay. One rule
 * for both directions — a short entry above the tape is a rally to sell
 * into, below it a breakdown. No quote (or a level sitting exactly ON the
 * price) keeps the direction default, as every caller had before.
 *
 * Buy-the-dip is NOT a per-analyst setting: a setting whose entire output is
 * a trigger restates what the trigger already says, invisibly. It was built
 * and removed 2026-08-16 — see ENTRY_TRIGGER_SEMANTICS.md, don't rebuild it.
 */
/**
 * A rebuilt level predicate keeps the `basis` of the one it replaces — the
 * number moved, not the rule about when it fires. Only a price level has a
 * basis; anything else passes through.
 */
export function withBasisOf<P extends TriggerPredicate>(prior: TriggerPredicate, next: P): P {
  const basis =
    (prior.kind === "PRICE_ABOVE" || prior.kind === "PRICE_BELOW") ? prior.basis : undefined;
  if (basis == null || (next.kind !== "PRICE_ABOVE" && next.kind !== "PRICE_BELOW")) return next;
  return { ...next, basis } as P;
}

export function predicateFor(
  slot: LevelSlot,
  price: number,
  direction: string | null,
  currentPrice?: number | null,
): Extract<TriggerPredicate, { kind: "PRICE_ABOVE" | "PRICE_BELOW" }> {
  const long = isLong(direction);
  const readsTheTape =
    slot === "ENTRY" &&
    currentPrice != null &&
    Number.isFinite(currentPrice) &&
    currentPrice > 0 &&
    price !== currentPrice;
  const wantsAbove = readsTheTape
    ? price > currentPrice
    : slot === "FLOOR"
      ? !long
      : long;
  return wantsAbove
    ? { kind: "PRICE_ABOVE", level: price }
    : { kind: "PRICE_BELOW", level: price };
}

export function rationaleFor(
  slot: LevelSlot,
  price: number,
  direction: string | null,
  held: boolean,
  kind: "PRICE_ABOVE" | "PRICE_BELOW",
): string {
  const long = isLong(direction);
  const p = `$${price.toFixed(2)}`;
  if (slot === "ENTRY") {
    if (long) {
      return kind === "PRICE_ABOVE"
        ? `Buy level — start the position when the price breaks above ${p}.`
        : `Buy level — start the position when the price comes back down to ${p}.`;
    }
    return kind === "PRICE_BELOW"
      ? `Short entry — start the position when the price breaks below ${p}.`
      : `Short entry — start the position when the price rallies to ${p}.`;
  }
  if (slot === "FLOOR") {
    // On a thesis we don't own, "sell" is meaningless — a floor break
    // resolves to DEMOTE (effectiveTriggerAction) and takes the plan down.
    // Write the wording that matches what actually happens (DAV-226).
    if (!held) {
      return long
        ? `Floor — below ${p} the setup is wrong, so the plan comes down rather than waiting to be bought.`
        : `Floor — above ${p} the setup is wrong, so the plan comes down rather than waiting to be entered.`;
    }
    return long
      ? `Floor — sell if the price drops to ${p}. Below this the plan is wrong.`
      : `Floor — cover if the price rises to ${p}. Above this the plan is wrong.`;
  }
  return `Target ${p} — decide here: take it, trim it, or raise the target.`;
}

/**
 * A floor that has been raised past an upside level. Returns the pair when
 * the two overlap so that something fires no matter where price sits.
 */
function contradictionBetween(
  floor: PriceLevel | null,
  all: PriceLevel[],
  long: boolean,
): { floor: number; upside: number } | null {
  if (!floor) return null;
  for (const l of all) {
    if (l.side !== "UPSIDE" || l.triggerId === floor.triggerId) continue;
    const overlaps = long ? floor.price >= l.price : floor.price <= l.price;
    if (overlaps) return { floor: floor.price, upside: l.price };
  }
  return null;
}

/** The floor you hit first: highest on a long, lowest on a short. */
function firstToFire(levels: PriceLevel[], long: boolean): PriceLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((best, l) =>
    (long ? l.price > best.price : l.price < best.price) ? l : best,
  );
}

/** The destination: furthest in the winning direction. */
function furthest(levels: PriceLevel[], long: boolean): PriceLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((best, l) =>
    (long ? l.price > best.price : l.price < best.price) ? l : best,
  );
}

function priceOf(t: Trigger): number | null {
  return t.predicate.kind === "PRICE_ABOVE" || t.predicate.kind === "PRICE_BELOW"
    ? t.predicate.level
    : null;
}

/**
 * Move the number in a trigger's sentence when its level moves and the
 * caller gave no new wording. MU's $969 floor kept saying "Exit below $935"
 * for two weeks; a sentence that names the old number is worse than none.
 * Returns null when the old number isn't in the text — callers fall back
 * to the template sentence for a plan level and keep the text otherwise.
 * Shared by the level path (applyLevelArgs) and the edit-op path (ops.ts).
 */
export function moveNumberInText(
  text: string,
  field: "level" | "pct" | "days",
  from: number,
  to: number,
): string | null {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const plain = field === "level" ? (to % 1 === 0 ? String(to) : to.toFixed(2)) : String(to);
  // Each way the old number may be written, paired with the new number in
  // the same style — "$935.00" stays two-decimal, "$1,580" keeps its comma.
  const numForms: Array<{ from: string; to: string }> = [
    { from: String(from), to: plain },
    { from: from.toFixed(2), to: field === "level" ? to.toFixed(2) : String(to) },
    { from: from.toLocaleString("en-US"), to: field === "level" ? to.toLocaleString("en-US") : String(to) },
  ];

  // The number as the field writes it — "$50", "8%", "30 days" — is tried
  // FIRST, so a level of 50 in "Buy above $50, a reclaim of the 50d" moves
  // the price and leaves the moving average alone. Only when no unit form
  // is present does a bare number count, and then never one glued to a
  // letter or a hyphen (50d, 50-day, 200DMA) or to more digits (150.5).
  const unitForms: Array<{ re: RegExp; repl: string }> =
    field === "level"
      ? numForms.map((n) => ({ re: new RegExp(`\\$${escape(n.from)}(?![\\d])(?!\\.\\d)`, "g"), repl: `$${n.to}` }))
      : field === "pct"
        ? numForms.map((n) => ({ re: new RegExp(`(?<![\\d.])${escape(n.from)}%`, "g"), repl: `${n.to}%` }))
        : numForms.flatMap((n) => [
            { re: new RegExp(`(?<![\\d.])${escape(n.from)}( days?)\\b`, "g"), repl: `${n.to}$1` },
            { re: new RegExp(`(?<![\\d.])${escape(n.from)}(-day|d)\\b`, "g"), repl: `${n.to}$1` },
          ]);
  for (const { re, repl } of unitForms) {
    if (re.test(text)) return text.replace(re, repl);
  }
  for (const n of numForms) {
    const re = new RegExp(`(?<![\\d.$])${escape(n.from)}(?![\\w-])(?!\\.\\d)`, "g");
    if (re.test(text)) return text.replace(re, n.to);
  }
  return null;
}
