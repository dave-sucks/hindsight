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
 *  2. A wholesale trigger replace cannot leave a stale column: the columns
 *     are recomputed from the FINAL list, so resending a ladder without the
 *     floor nulls `stopLoss` too. Whether that drop is ALLOWED is the ratchet
 *     gate's job — run it on this output.
 *
 * `undefined` leaves a slot alone; `null` clears it.
 */
export function applyLevelArgs(args: {
  /** Thesis-stored triggers, post wholesale-replace if one happened. */
  stored: Trigger[];
  /** The resolved analyst/account levels above this thesis. */
  inherited?: ResolvedTrigger[];
  levels: { entry?: number | null; target?: number | null; floor?: number | null };
  direction: string | null;
  status?: string | null;
  avgCost?: number | null;
  source?: Trigger["source"];
  mintId: () => string;
}): { triggers: Trigger[]; columns: CanonicalLevels["columns"] } {
  const { stored, inherited, levels, direction, status, avgCost, source, mintId } =
    args;
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
    triggers = setLevel(slot, price, direction, triggers, mintId, source);
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
): Trigger[] {
  const side = slot === "FLOOR" ? "DOWNSIDE" : "UPSIDE";
  const occupies = (t: Trigger): boolean => {
    if (!ABSOLUTE.has(t.predicate.kind)) return false;
    if (slot === "ENTRY") return t.action === "ENTER";
    if (t.action === "ENTER") return false;
    if (levelSide(t.predicate, direction) !== side) return false;
    return slot === "FLOOR"
      ? t.action === "EXIT"
      : t.action === "EXIT" || t.action === "REVIEW";
  };

  if (price == null) return stored.filter((t) => !occupies(t));

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
    return stored
      .filter((t) => !occupies(t) || t.id === keep.id)
      .map((t) =>
        t.id === keep.id
          ? { ...t, predicate: predicateFor(slot, price, direction) }
          : t,
      );
  }

  return [
    ...stored,
    {
      id: mintId(),
      predicate: predicateFor(slot, price, direction),
      // A target is REVIEW, not EXIT (ruling 2026-08-24): a floor is
      // protective and acts on its own; a target is an opportunity and wakes
      // a decision. Auto-selling at the target re-creates the capped-winner
      // problem the ladder exists to fix, and the trail already protects the
      // downside while the decision waits.
      action: slot === "ENTRY" ? "ENTER" : slot === "FLOOR" ? "EXIT" : "REVIEW",
      rationale: rationaleFor(slot, price, direction),
      ...(source ? { source } : {}),
    },
  ];
}

// ── Display ────────────────────────────────────────────────────────────

/**
 * What the card says for one slot. Three states, and the third is the point:
 * a cached column with no trigger behind it is decoration, and rendering it
 * as plain "Stop $256" is the lie SNOW told on a live position for months.
 */
export type LevelLabelState =
  | { kind: "live"; price: number; moving: boolean }
  | { kind: "decorative"; price: number }
  | { kind: "none" };

export function levelLabelState(
  level: { price: number; projected: boolean } | null | undefined,
  storedColumn: number | null | undefined,
): LevelLabelState {
  if (level) return { kind: "live", price: level.price, moving: level.projected };
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
 * ENTRY is direction-only: a long enters on a break UP, a short on a break
 * DOWN. Buy-the-dip is a legitimate want and is NOT this — it is an ENTER
 * trigger at the account or analyst level. See ENTRY_TRIGGER_SEMANTICS.md;
 * do not rebuild it as a setting, that was removed 2026-08-16.
 */
function predicateFor(
  slot: LevelSlot,
  price: number,
  direction: string | null,
): Extract<TriggerPredicate, { kind: "PRICE_ABOVE" | "PRICE_BELOW" }> {
  const long = isLong(direction);
  const wantsAbove = slot === "FLOOR" ? !long : long;
  return wantsAbove
    ? { kind: "PRICE_ABOVE", level: price }
    : { kind: "PRICE_BELOW", level: price };
}

function rationaleFor(
  slot: LevelSlot,
  price: number,
  direction: string | null,
): string {
  const long = isLong(direction);
  const p = `$${price.toFixed(2)}`;
  if (slot === "ENTRY") {
    return long
      ? `Buy level — start the position when the price breaks above ${p}.`
      : `Short entry — start the position when the price breaks below ${p}.`;
  }
  if (slot === "FLOOR") {
    return long
      ? `Floor — sell if the price drops to ${p}. Below this the plan is wrong.`
      : `Floor — cover if the price rises to ${p}. Above this the plan is wrong.`;
  }
  return `Target ${p} — decide here: take it, trim it, or raise the target.`;
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
