/**
 * Price levels, read off the trigger list.
 *
 * > Design: docs/plans/LEVELS_AS_TRIGGERS.md
 *
 * There is no stop, target, or entry price. There is a **price level, a side,
 * and an action** — "sell if it drops to $256" is a downside level with EXIT,
 * "buy at $47" is a level with ENTER. `Thesis.stopLoss` / `targetPrice` /
 * `entryPrice` are the pre-trigger app still sitting in the database; they
 * are a cache computed here and are never authored directly.
 *
 * What leaves this file:
 *
 *   canonicalLevels  read  — what the card, the chart and the columns show
 *   levelSlotOf      read  — which slot a price trigger sits in (a buy, the floor, an upside rule)
 *   levelLabelState  read  — what the card says for one slot
 *   isPlanLevel      read  — a buy, a sale, a Stop watching line or an upside review at a price
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

import { isLevel, levelOf, lineOf, shapeOf, type Condition } from "./condition";
import type { Trigger, TriggerAction } from "./types";
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

const isLong = (d: string | null | undefined) => d !== "SHORT";

/** A typed price level's number and side of the trade, or null when the trigger isn't one. */
function typedLevel(t: Pick<Trigger, "predicate">, direction: string | null) {
  const w = shapeOf(t.predicate);
  const level = w == null ? null : levelOf(w);
  return level ? { ...level, side: level.above === isLong(direction) ? ("UPSIDE" as const) : ("DOWNSIDE" as const) } : null;
}

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
    // A typed level, or a % from our position (./condition: each measure's `line`).
    const w = shapeOf(t.predicate);
    const line = w == null ? null : lineOf(w, { isLong: long, avgCost, peakPrice });
    // A projected level with no position state genuinely is not at a price.
    if (line?.price == null || !Number.isFinite(line.price) || line.price <= 0) continue;
    all.push({
      slot: null,
      price: line.price,
      side: line.side,
      action: t.action,
      triggerId: t.id,
      storedAt: t.level,
      inherited: t.inherited,
      projected: line.projected,
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
    };
  } else {
    const e = all.find((l) => l.action === "ENTER");
    entry = e ? { ...e, slot: "ENTRY" } : null;
  }

  // The line under the price that ends what we have: a sale on a holding, the end of a watch on a watch.
  const floors = all.filter((l) => l.side === "DOWNSIDE" && (l.action === "EXIT" || l.action === "STOP_WATCHING"));
  const floor = firstToFire(floors, long);
  // On a stock we only watch, a review with no buy behind it is a wake, not
  // the target (isPlanLevelOnList). "A buy" is an ENTER on the list, priced
  // or not: COGT's buy is a close above $36.95 on 1.5x volume, which has no
  // single entry price and still keeps its $43.35 target.
  const wakeOnly = !held && !triggers.some((t) => t.action === "ENTER");
  const target = furthest(
    all.filter(
      (l) =>
        l.side === "UPSIDE" &&
        (l.action === "EXIT" || (l.action === "REVIEW" && !wakeOnly)) &&
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

/**
 * Which slot an absolute price trigger occupies, if any: the buy (ENTER), the
 * floor (a downside EXIT on a holding, STOP_WATCHING on a watch) or the
 * upside rule (an upside EXIT or REVIEW). One
 * trigger per slot is the rule every write path keeps.
 */
export function levelSlotOf(t: Trigger, direction: string | null): LevelSlot | null {
  const level = typedLevel(t, direction);
  if (!level) return null;
  if (t.action === "ENTER") return "ENTRY";
  if (level.side === "DOWNSIDE") return t.action === "EXIT" || t.action === "STOP_WATCHING" ? "FLOOR" : null;
  return t.action === "EXIT" || t.action === "REVIEW" ? "TARGET" : null;
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

// ── Price lines ────────────────────────────────────────────────────────

/**
 * Is this trigger a buy, a sale or an upside review at a price? The half-buy
 * check (enter-guard.ts) reads it. Only absolute price levels qualify: a
 * review cadence, an earnings trigger or a percentage move is not one, and
 * neither is a DOWNSIDE review ("price dropped to support — better entry, or
 * thesis weakening?").
 */
export function isPlanLevel(t: Trigger, direction: string | null): boolean {
  const level = typedLevel(t, direction);
  if (!level) return false;
  if (t.action === "ENTER" || t.action === "EXIT" || t.action === "STOP_WATCHING") return true;
  if (t.action !== "REVIEW") return false;
  return level.side === "UPSIDE";
}

/**
 * The same, read against the list it sits in. On a stock we only watch, a
 * review at any price is a wake until there is a buy to reach it from (QB
 * ruling on DAV-335, 2026-09-29; the 2026-09-08 design: "if chat says 'look
 * again under $203', that price is the wake"). VST's "review at $146 instead
 * of the buy" was refused five times on 09-28. The buy, the floor and a sale
 * at a price always count.
 */
export function isPlanLevelOnList(
  t: Trigger,
  list: readonly Pick<Trigger, "action">[],
  direction: string | null,
): boolean {
  if (!isPlanLevel(t, direction)) return false;
  return t.action !== "REVIEW" || list.some((x) => x.action === "ENTER");
}

// ── Internals ──────────────────────────────────────────────────────────

/**
 * Which side of the tape a buy level sits on says which shape the analyst
 * meant: above the price is a breakout
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
 * A rebuilt level keeps "only on the close" from the one it replaces — the
 * number moved, not the rule about when it fires. Only a typed price level
 * has it; anything else passes through.
 */
export function withBasisOf(prior: unknown, next: Condition): Condition {
  const w = shapeOf(prior);
  if (!(w && levelOf(w)?.close) || !isLevel(next)) return next;
  return { ...next, settings: { ...next.settings, close: true } };
}

export function predicateFor(
  slot: LevelSlot,
  price: number,
  direction: string | null,
  currentPrice?: number | null,
): Condition {
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
    ? { watch: "price", is: "above", value: price }
    : { watch: "price", is: "below", value: price };
}

export function rationaleFor(
  slot: LevelSlot,
  price: number,
  direction: string | null,
  held: boolean,
  /** The level sits above the price (a breakout buy, a short's stop). */
  above: boolean,
): string {
  const long = isLong(direction);
  const p = `$${price.toFixed(2)}`;
  if (slot === "ENTRY") {
    if (long) {
      return above
        ? `I buy when it breaks above ${p}.`
        : `I buy when it comes back down to ${p}.`;
    }
    return !above
      ? `I short when it breaks below ${p}.`
      : `I short when it rallies to ${p}.`;
  }
  if (slot === "FLOOR") {
    // On a thesis we don't own, the floor is a Stop watching line (DAV-226).
    if (!held) {
      return long
        ? `Below ${p} the setup is wrong, so I stop watching it.`
        : `Above ${p} the setup is wrong, so I stop watching it.`;
    }
    return long
      ? `I sell at ${p}: below it, the reason I own this is wrong.`
      : `I cover at ${p}: above it, the reason I'm short is wrong.`;
  }
  return `At ${p}: when it gets there, I take profit, trim, or let it run.`;
}

/** Every note `rationaleFor` writes; a level set with no note of its own carries one (note.ts). */
export const levelNotes = (): string[] =>
  (["ENTRY", "FLOOR", "TARGET"] as const).flatMap((slot) =>
    ["LONG", "SHORT"].flatMap((d) => [true, false].flatMap((held) => [true, false].map((above) => rationaleFor(slot, 1, d, held, above)))),
  );

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

/**
 * Move the number in a trigger's sentence when its level moves and the
 * caller gave no new wording. MU's $969 floor kept saying "Exit below $935"
 * for two weeks; a sentence that names the old number is worse than none.
 * Returns null when the old number isn't in the text — callers fall back
 * to the template sentence for a price level and keep the text otherwise.
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
