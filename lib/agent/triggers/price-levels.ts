/**
 * Price triggers: the typed price a trigger watches, and its slot.
 *
 * There is no stop, target, or entry price. There is a **price level, a side,
 * and an action**: "sell if it drops to $256" is a downside level with EXIT,
 * "buy at $47" is a level with ENTER. A stock has triggers and nothing else;
 * nothing here sums them into a buy, a floor or a target.
 *
 * What leaves this file:
 *
 *   levelSlotOf      read  — which slot a price trigger sits in, for the one-per-slot rule
 *   typedPriceOf     read  — the price a trigger watches, when it watches a typed price
 *   priceLines       read  — one line per price trigger, labelled with its sentence (the chart)
 *   isPlanLevel      read  — a buy, a sale, a Stop watching line or an upside review at a price
 *
 * The slot is the SIDE, never the magnitude. A trigger can't say "exit at
 * 100" — every price predicate carries a direction:
 *
 *              under the price         over the price
 *   LONG       EXIT|STOP_WATCHING      EXIT|REVIEW + above
 *   SHORT      … + above               … + below
 *
 * Pure — no DB, no clock, no fetches.
 */

import { isLevel, levelOf, sentenceOf, shapeOf, type Condition } from "./condition";
import type { Trigger, TriggerAction } from "./types";

// ── Shape ──────────────────────────────────────────────────────────────

/** The slots the one-per-slot rule keeps: a buy, the line under the price, an upside rule. */
export type LevelSlot = "ENTRY" | "FLOOR" | "TARGET";

const isLong = (d: string | null | undefined) => d !== "SHORT";

/** A typed price level's number and side of the trade, or null when the trigger isn't one. */
function typedLevel(t: Pick<Trigger, "predicate">, direction: string | null) {
  const w = shapeOf(t.predicate);
  const level = w == null ? null : levelOf(w);
  return level ? { ...level, side: level.above === isLong(direction) ? ("UPSIDE" as const) : ("DOWNSIDE" as const) } : null;
}

/** The price a trigger watches, when it watches a typed price; null for a chart condition, a move, a clock. */
export function typedPriceOf(t: Pick<Trigger, "predicate">): number | null {
  const w = shapeOf(t.predicate);
  const v = w == null ? null : levelOf(w)?.value;
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/** One chart line: a trigger at a typed price, said as its own sentence. */
export interface PriceLine {
  triggerId: string;
  action: TriggerAction;
  price: number;
  /** The trigger's sentence: "Buy if above $51.94 · only on the close". */
  says: string;
}

/** One line per trigger at a typed price, ascending. A percentage rule is not a line; it is in the trigger list. */
export function priceLines(triggers: readonly Pick<Trigger, "id" | "action" | "predicate" | "trimPct">[]): PriceLine[] {
  return triggers
    .flatMap((t) => {
      const price = typedPriceOf(t);
      return price == null ? [] : [{ triggerId: t.id, action: t.action, price, says: sentenceOf(t) }];
    })
    .sort((a, b) => a.price - b.price);
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
