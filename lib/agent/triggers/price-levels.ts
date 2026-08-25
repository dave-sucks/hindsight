/**
 * Price levels, read off the trigger list — the single place that answers
 * "what is this thesis's entry / floor / target?"
 *
 * > Design: docs/plans/LEVELS_AS_TRIGGERS.md (L1). Read the "Price Targets"
 * > section before changing anything here — this module IS that contract.
 *
 * ## There is no stop, target, or entry price
 *
 * There is a **price level, a side, and an action**. "Sell if it drops to
 * $256" is a downside level with EXIT. "Buy at $47" is a level with ENTER.
 * "$60 — probably take profit, maybe raise the target" is an upside level
 * with REVIEW. `Thesis.stopLoss` / `targetPrice` / `entryPrice` are the
 * pre-trigger app still sitting in the database; they become a cache
 * computed here and are never authored directly.
 *
 * ## Floor vs target is the SIDE, never the magnitude
 *
 * A trigger can't say "exit at 100" — every price predicate carries a
 * direction (`PRICE_BELOW` / `PRICE_ABOVE`). So:
 *
 *              floor (protective)      target (opportunity)
 *   LONG       EXIT + below            EXIT|REVIEW + above
 *   SHORT      EXIT + above            EXIT|REVIEW + below
 *
 * Two EXITs at $100 and $500 on a long are not "the low one is the stop" —
 * one is `below $100` and the other is `above $500`, and the trigger says
 * which is which. A floor ABOVE the current price is legal and just means
 * we're about to be stopped out.
 *
 * ## Why the effective floor is not always the hard stop
 *
 * SNOW showed "$256" on the card while its only real exit was a 3% trail
 * off the high. A trail IS a floor — it just moves. When a peak and entry
 * cost are supplied, position-scoped predicates are projected into the
 * price they currently sit at, so the card can show where we actually get
 * out rather than the highest number someone typed.
 *
 * The CACHED COLUMNS deliberately do NOT include that projection — see
 * `derivedColumns`. A projected trail moves with the peak, and
 * `Thesis.stopLoss` feeds prompts and the protective ratchet, which want a
 * stable number that means "the hard floor someone set."
 *
 * Pure module — no DB, no clock, no fetches.
 */

import type {
  Trigger,
  TriggerAction,
  TriggerPredicate,
} from "./types";
import type { ResolvedTrigger, TriggerLevel } from "./levels";

// ── Shape ──────────────────────────────────────────────────────────────

/** The three slots the Price Targets card renders. */
export type LevelSlot = "ENTRY" | "FLOOR" | "TARGET";

/**
 * Which way a level sits relative to the position's direction. UPSIDE is
 * where the trade makes money; DOWNSIDE is where it loses. Both are
 * direction-aware, so a SHORT's UPSIDE is a falling price.
 */
export type LevelSide = "UPSIDE" | "DOWNSIDE";

export interface PriceLevel {
  /** The card slot this fills, or null for an extra level (chart only). */
  slot: LevelSlot | null;
  /** The price this level sits at, in dollars. */
  price: number;
  side: LevelSide;
  action: TriggerAction;
  triggerId: string;
  /** Where the trigger is stored — THESIS beats ANALYST beats ACCOUNT. */
  storedAt: TriggerLevel;
  /** True when it comes from a level above this thesis (renders read-only). */
  inherited: boolean;
  /**
   * True when `price` was computed from a moving predicate (a trail off the
   * peak, a gain off entry cost) rather than typed as an absolute level.
   * Drives a distinct chart line — it moves, and it isn't in the cache.
   */
  projected: boolean;
  predicateKind: TriggerPredicate["kind"];
}

export interface CanonicalLevels {
  /** Where we'd buy (WATCHING) or what we paid (HOLDING). */
  entry: PriceLevel | null;
  /** The protective level that fires first — including a moving trail. */
  floor: PriceLevel | null;
  /** The furthest opportunity level — the destination the rail runs to. */
  target: PriceLevel | null;
  /** Every price level, ascending. The chart draws all of these. */
  all: PriceLevel[];
  /**
   * The level nearest the current price on each side — what happens next
   * if it keeps moving. Null when no current price was supplied.
   */
  next: { above: PriceLevel | null; below: PriceLevel | null };
}

/** The cached column values, computed from absolute price triggers only. */
export interface DerivedColumns {
  entryPrice: number | null;
  targetPrice: number | null;
  stopLoss: number | null;
}

export interface LevelInputs {
  /** The RESOLVED trigger list — cascade already applied. */
  triggers: ResolvedTrigger[];
  direction: string | null;
  /** HOLDING flips entry from "the plan" to "what we paid". */
  status?: string | null;
  /** Position entry cost. Required to place entry on a held thesis. */
  avgCost?: number | null;
  /** Position high-water mark, for projecting a trail into a price. */
  peakPrice?: number | null;
  /** Live price, for the `next` above/below split. */
  currentPrice?: number | null;
}

// ── Reading levels off triggers ────────────────────────────────────────

const ABSOLUTE_PRICE_KINDS = new Set<TriggerPredicate["kind"]>([
  "PRICE_ABOVE",
  "PRICE_BELOW",
]);

/** Kinds that describe a price indirectly and need position state to place. */
const PROJECTED_PRICE_KINDS = new Set<TriggerPredicate["kind"]>([
  "TRAILING_FROM_HIGH",
  "GAIN_FROM_ENTRY",
]);

function isLongDirection(direction: string | null | undefined): boolean {
  return direction !== "SHORT";
}

/**
 * Which side of the trade a price predicate sits on, direction-aware.
 * Returns null for anything that isn't a price level.
 */
export function levelSide(
  predicate: TriggerPredicate,
  direction: string | null,
): LevelSide | null {
  const isLong = isLongDirection(direction);
  switch (predicate.kind) {
    case "PRICE_ABOVE":
      return isLong ? "UPSIDE" : "DOWNSIDE";
    case "PRICE_BELOW":
      return isLong ? "DOWNSIDE" : "UPSIDE";
    // A trail off the high is always a give-back — the losing side.
    case "TRAILING_FROM_HIGH":
      return "DOWNSIDE";
    case "GAIN_FROM_ENTRY":
      return predicate.direction === "UP" ? "UPSIDE" : "DOWNSIDE";
    default:
      return null;
  }
}

/**
 * The dollar price a predicate currently sits at, or null when it isn't a
 * price level or we lack the position state to place it.
 *
 * Absolute kinds read their own level. Projected kinds are computed from
 * the position: a trail sits at `peak × (1 − pct)` on a long, a gain
 * milestone at `avgCost × (1 + pct)`.
 */
export function predicatePrice(
  predicate: TriggerPredicate,
  ctx: { direction: string | null; avgCost?: number | null; peakPrice?: number | null },
): number | null {
  const isLong = isLongDirection(ctx.direction);
  switch (predicate.kind) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW":
      return predicate.level;
    case "TRAILING_FROM_HIGH": {
      const peak = ctx.peakPrice;
      if (peak == null || peak <= 0) return null;
      return isLong
        ? peak * (1 - predicate.pct / 100)
        : peak * (1 + predicate.pct / 100);
    }
    case "GAIN_FROM_ENTRY": {
      const avg = ctx.avgCost;
      if (avg == null || avg <= 0) return null;
      // UP = a gain milestone, DOWN = a drawdown. On a SHORT a gain is a
      // falling price, so both signs invert.
      const up = predicate.direction === "UP";
      const favourable = isLong ? up : !up;
      const magnitude = predicate.pct / 100;
      return favourable ? avg * (1 + magnitude) : avg * (1 - magnitude);
    }
    default:
      return null;
  }
}

/**
 * Read the canonical levels off a resolved trigger list.
 *
 * Slot assignment, all direction-aware:
 *   ENTRY  — the ENTER trigger. On a HOLDING thesis this is superseded by
 *            the actual fill price: once you own it, entry is a fact, not
 *            a plan, and showing yesterday's plan is how KLAC-shaped rows
 *            display a buy level nobody is waiting for any more.
 *   FLOOR  — the protective EXIT that fires FIRST. Among several, the
 *            tightest wins (highest on a long), because that's the one you
 *            actually hit. A projected trail competes on equal terms.
 *   TARGET — the FURTHEST opportunity level (EXIT or REVIEW). That's the
 *            destination the card's rail runs to; intermediate levels stay
 *            in `all` as chart ticks so tiered trims render properly.
 */
export function canonicalLevels(input: LevelInputs): CanonicalLevels {
  const { triggers, direction, status, avgCost, peakPrice, currentPrice } = input;
  const isLong = isLongDirection(direction);
  const held = status === "HOLDING";

  const all: PriceLevel[] = [];
  for (const t of triggers) {
    const kind = t.predicate.kind;
    const isAbsolute = ABSOLUTE_PRICE_KINDS.has(kind);
    if (!isAbsolute && !PROJECTED_PRICE_KINDS.has(kind)) continue;

    const side = levelSide(t.predicate, direction);
    if (side == null) continue;
    const price = predicatePrice(t.predicate, { direction, avgCost, peakPrice });
    // A projected level with no position state can't be placed on a chart.
    // Dropping it is correct: it is genuinely not at a price right now.
    if (price == null || !Number.isFinite(price) || price <= 0) continue;

    all.push({
      slot: null, // assigned below
      price,
      side,
      action: t.action,
      triggerId: t.id,
      storedAt: t.level,
      inherited: t.inherited,
      projected: !isAbsolute,
      predicateKind: kind,
    });
  }

  all.sort((a, b) => a.price - b.price);

  // ── ENTRY ────────────────────────────────────────────────────────────
  // On a held thesis the fill price wins outright — see the docstring.
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
    const enters = all.filter((l) => l.action === "ENTER");
    // The cascade collapses above/below ENTER into one bucket, so there is
    // normally exactly one. If a legacy row carries several, take the one
    // nearest today's price — the level actually being waited on.
    entry = pickNearest(enters, currentPrice) ?? enters[0] ?? null;
    if (entry) entry = { ...entry, slot: "ENTRY" };
  }

  // ── FLOOR ────────────────────────────────────────────────────────────
  // Protective EXITs on the losing side. The tightest is the one that
  // fires first, so it is the real floor regardless of what else is set.
  const floors = all.filter((l) => l.side === "DOWNSIDE" && l.action === "EXIT");
  let floor = tightestFloor(floors, isLong);
  if (floor) floor = { ...floor, slot: "FLOOR" };

  // ── TARGET ───────────────────────────────────────────────────────────
  // Opportunity-side levels that represent a decision: sell here, or
  // reconsider here. ADD/TRIM levels are real chart lines but they aren't
  // the destination, so they don't claim the slot.
  const targets = all.filter(
    (l) =>
      l.side === "UPSIDE" &&
      (l.action === "EXIT" || l.action === "REVIEW") &&
      // A gain milestone off entry is a checkpoint, not a price target —
      // it belongs on the chart, not in the headline slot.
      !l.projected,
  );
  let target = furthestTarget(targets, isLong);
  if (target) target = { ...target, slot: "TARGET" };

  // Stamp the slots back onto `all` so a single pass can render both.
  const slotById = new Map<string, LevelSlot>();
  if (entry?.triggerId) slotById.set(entry.triggerId, "ENTRY");
  if (floor?.triggerId) slotById.set(floor.triggerId, "FLOOR");
  if (target?.triggerId) slotById.set(target.triggerId, "TARGET");
  const allWithSlots = all.map((l) => ({
    ...l,
    slot: slotById.get(l.triggerId) ?? null,
  }));

  return {
    entry,
    floor,
    target,
    all: allWithSlots,
    next: {
      above: nearestOnSide(allWithSlots, currentPrice, "above"),
      below: nearestOnSide(allWithSlots, currentPrice, "below"),
    },
  };
}

/**
 * The cached column values.
 *
 * Absolute price triggers ONLY — a projected trail moves with the peak, and
 * these columns feed prompts and the protective ratchet, which want "the
 * hard floor someone set" to be a stable number. The card shows the moving
 * one; the cache stores the typed one.
 *
 * `entryPrice` follows the same rule as the card: the fill price once held,
 * the ENTER trigger while watching.
 */
export function derivedColumns(input: LevelInputs): DerivedColumns {
  // Re-read with the projection inputs withheld so nothing moving can leak
  // into the cache, whatever the caller passed.
  const levels = canonicalLevels({
    ...input,
    peakPrice: null,
    avgCost: input.status === "HOLDING" ? input.avgCost : null,
  });
  return {
    entryPrice: levels.entry?.price ?? null,
    targetPrice: levels.target?.price ?? null,
    stopLoss: levels.floor && !levels.floor.projected ? levels.floor.price : null,
  };
}

// ── Writing a level back as a trigger ──────────────────────────────────

/**
 * The predicate that expresses "this slot, at this price", for this
 * direction. The inverse of `levelSide`.
 *
 * ENTRY is direction-only: a long enters on a break UP through the level, a
 * short on a break DOWN. (Buy-the-dip is a legitimate want and is NOT
 * handled by flipping this — it's an ENTER trigger at the account or
 * analyst level. See docs/plans/ENTRY_TRIGGER_SEMANTICS.md; do not rebuild
 * it as a setting, that was removed 2026-08-16.)
 */
export function predicateForSlot(
  slot: LevelSlot,
  price: number,
  direction: string | null,
): Extract<TriggerPredicate, { kind: "PRICE_ABOVE" | "PRICE_BELOW" }> {
  const isLong = isLongDirection(direction);
  const above = { kind: "PRICE_ABOVE" as const, level: price };
  const below = { kind: "PRICE_BELOW" as const, level: price };
  switch (slot) {
    case "ENTRY":
      return isLong ? above : below;
    case "FLOOR":
      return isLong ? below : above;
    case "TARGET":
      return isLong ? above : below;
  }
}

/**
 * The default action for a slot.
 *
 * TARGET is REVIEW, not EXIT (principal ruling 2026-08-24). A floor is
 * protective and should act on its own; a target is an opportunity and
 * should wake a decision. Auto-selling at the target re-introduces the
 * capped-winner problem the trigger ladder exists to fix, and the trailing
 * give-back already protects the downside while the decision waits. An
 * explicit `EXIT + above` remains authorable per name — this only decides
 * what gets minted by default.
 */
export function defaultActionForSlot(slot: LevelSlot): TriggerAction {
  switch (slot) {
    case "ENTRY":
      return "ENTER";
    case "FLOOR":
      return "EXIT";
    case "TARGET":
      return "REVIEW";
  }
}

/** Prose for a minted level, in product language — no jargon. */
export function rationaleForSlot(
  slot: LevelSlot,
  price: number,
  direction: string | null,
): string {
  const isLong = isLongDirection(direction);
  const p = `$${price.toFixed(2)}`;
  switch (slot) {
    case "ENTRY":
      return isLong
        ? `Buy level — start the position when the price breaks above ${p}.`
        : `Short entry — start the position when the price breaks below ${p}.`;
    case "FLOOR":
      return isLong
        ? `Floor — sell if the price drops to ${p}. Below this the plan is wrong.`
        : `Floor — cover if the price rises to ${p}. Above this the plan is wrong.`;
    case "TARGET":
      return `Target ${p} — the move we're playing for. Decide here: take it, trim it, or raise the target.`;
  }
}

export interface SetLevelResult {
  /** The trigger list to store, with the level applied. */
  triggers: Trigger[];
  /** True when an existing trigger's price was changed rather than added. */
  edited: boolean;
}

/**
 * Apply a level change to a THESIS-stored trigger list.
 *
 * Editing the price of an existing trigger in the slot is preferred over
 * adding one, so the trigger keeps its id — and with it its cooldown
 * history and `source` stamp. Passing `price: null` removes the slot's
 * trigger, which is how a plan gets set down (see L5 / DAV-209).
 *
 * `inherited` is the resolved ladder from the levels ABOVE this thesis. A
 * slot whose only trigger is inherited gets a new thesis-level trigger that
 * overrides it — we never mutate a shared trigger from here.
 */
export function setLevel(args: {
  slot: LevelSlot;
  price: number | null;
  direction: string | null;
  stored: Trigger[];
  inherited?: ResolvedTrigger[];
  /** Stamped on a newly-minted trigger. */
  source?: Trigger["source"];
  /** Supplies the id for a newly-minted trigger (kept injectable for tests). */
  mintId: () => string;
  rationale?: string;
}): SetLevelResult {
  const { slot, price, direction, stored, source, mintId } = args;
  const action = defaultActionForSlot(slot);
  const side = slot === "FLOOR" ? "DOWNSIDE" : "UPSIDE";

  const occupies = (t: Trigger): boolean => {
    if (!ABSOLUTE_PRICE_KINDS.has(t.predicate.kind)) return false;
    if (slot === "ENTRY") return t.action === "ENTER";
    if (levelSide(t.predicate, direction) !== side) return false;
    if (t.action === "ENTER") return false;
    return slot === "FLOOR"
      ? t.action === "EXIT"
      : t.action === "EXIT" || t.action === "REVIEW";
  };

  const matches = stored.filter(occupies);

  if (price == null) {
    return { triggers: stored.filter((t) => !occupies(t)), edited: matches.length > 0 };
  }

  if (matches.length > 0) {
    // Edit the one the slot resolves to, and drop any duplicate behind it —
    // a second trigger in the same slot is the KLAC-shaped hazard where the
    // level you set isn't the level that fires.
    const keep = slot === "FLOOR"
      ? tightestOf(matches, direction)
      : slot === "TARGET"
        ? furthestOf(matches, direction)
        : matches[0];
    return {
      triggers: stored
        .filter((t) => !occupies(t) || t.id === keep.id)
        .map((t) =>
          t.id === keep.id
            ? { ...t, predicate: predicateForSlot(slot, price, direction) }
            : t,
        ),
      edited: true,
    };
  }

  return {
    triggers: [
      ...stored,
      {
        id: mintId(),
        predicate: predicateForSlot(slot, price, direction),
        action,
        rationale: args.rationale ?? rationaleForSlot(slot, price, direction),
        ...(source ? { source } : {}),
      },
    ],
    edited: false,
  };
}

// ── Internals ──────────────────────────────────────────────────────────

/**
 * The floor that fires first. On a long, floors sit below the price and the
 * HIGHEST is hit first; on a short they sit above and the LOWEST is.
 */
function tightestFloor(levels: PriceLevel[], isLong: boolean): PriceLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((best, l) =>
    (isLong ? l.price > best.price : l.price < best.price) ? l : best,
  );
}

/** The destination — furthest in the winning direction. */
function furthestTarget(levels: PriceLevel[], isLong: boolean): PriceLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((best, l) =>
    (isLong ? l.price > best.price : l.price < best.price) ? l : best,
  );
}

function tightestOf(triggers: Trigger[], direction: string | null): Trigger {
  const isLong = isLongDirection(direction);
  return triggers.reduce((best, t) => {
    const a = priceOf(t);
    const b = priceOf(best);
    if (a == null) return best;
    if (b == null) return t;
    return (isLong ? a > b : a < b) ? t : best;
  });
}

function furthestOf(triggers: Trigger[], direction: string | null): Trigger {
  const isLong = isLongDirection(direction);
  return triggers.reduce((best, t) => {
    const a = priceOf(t);
    const b = priceOf(best);
    if (a == null) return best;
    if (b == null) return t;
    return (isLong ? a > b : a < b) ? t : best;
  });
}

function priceOf(t: Trigger): number | null {
  return t.predicate.kind === "PRICE_ABOVE" || t.predicate.kind === "PRICE_BELOW"
    ? t.predicate.level
    : null;
}

function pickNearest(levels: PriceLevel[], price: number | null | undefined) {
  if (levels.length === 0 || price == null) return null;
  return levels.reduce((best, l) =>
    Math.abs(l.price - price) < Math.abs(best.price - price) ? l : best,
  );
}

function nearestOnSide(
  levels: PriceLevel[],
  price: number | null | undefined,
  side: "above" | "below",
): PriceLevel | null {
  if (price == null) return null;
  const candidates = levels.filter((l) =>
    side === "above" ? l.price > price : l.price < price,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, l) =>
    Math.abs(l.price - price) < Math.abs(best.price - price) ? l : best,
  );
}
