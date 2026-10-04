/**
 * The condition shape: one fixed shape for every trigger condition.
 *
 *   watch · is (the button) · value (what you type) or variable (what you insert)
 *
 * The dialog and the pill's popover are this shape on screen: the type is
 * picked from the Add trigger menu, the tabs pick the watch, the button group
 * is `is`, and the value input takes a typed number or a variable chip.
 * docs/plans/TRIGGER_TYPES.md §3 and §5.
 *
 * Pure and client-safe: types only.
 */

/** The five types in the Add trigger menu. */
export type TriggerType = "price" | "indicator" | "earnings" | "filing" | "schedule";

/** What a condition watches. The dialog's type and tab pick it. */
export type Watch =
  | "price"
  | "volume"
  | "rsi"
  | "strength"
  | "gap"
  | "report"
  | "surprise"
  | "filing"
  | "insiders"
  | "schedule";

/** The button group. Which ones a watch accepts lives in the catalog; a watch with one draws it as a word. */
export type Direction = "below" | "above" | "near" | "before" | "after" | "miss" | "beat" | "files" | "every";

/** A price a condition can be measured against instead of a typed number. */
export type PriceVariable =
  | "prev_close"
  | "close_5d"
  | "close_20d"
  | "entry"
  | "peak"
  | "sma20"
  | "sma50"
  | "sma150"
  | "sma200"
  | "high20"
  | "low20"
  | "high52"
  | "low52";

/** A date a day count is measured from. */
export type DateVariable = "buy" | "event";

/** What a filing condition waits for: any filing of a tier, one 8-K item ("item:5.02") or one form ("form:S-3"). */
export type FilingVariable = "tier:MATERIAL" | "tier:RED" | `item:${string}` | `form:${string}`;

export type VariableId = PriceVariable | DateVariable | FilingVariable;

/** A watch's own settings: the one setting above the input, and values only an agent writes. */
export interface Params {
  /** price, volume: read on the 16:20 close pass. */
  onClose?: boolean;
  /** rsi. */
  period?: 2 | 14;
  /** strength. */
  window?: "1M" | "3M" | "6M";
  /** gap: how many sessions back, and the volume multiple the gap day needed. */
  withinDays?: number;
  volume?: number;
  /** report, after: 0 counts from the report day, 1 from the day after. */
  fromDay?: number;
  /** insiders: the look-back window. */
  days?: number;
  /** price, % from the high since we bought: the trailing-stop options. */
  startOnceUpPct?: number;
  widenAtr?: number;
  /** price, % from our entry, above: the big-winner switch. */
  fastWinner?: { gainPct: number; withinDays?: number };
}

export interface Condition {
  watch: Watch;
  is: Direction;
  /** What you type. Absent when a variable stands in for it. */
  value?: number;
  /** What you insert: in place of the value, or what a % or a day count is measured from. */
  variable?: VariableId;
  /** price only: the $ / % tab. */
  unit?: "$" | "%";
  params?: Params;
}

export interface Group {
  match: "all" | "any";
  conditions: When[];
}

export type When = Condition | Group;

/**
 * A stored condition no current kind can read (REVIEW_DATE_HIT, deleted in
 * August). Kept verbatim so nothing is lost; it never fires.
 */
export interface Retired {
  retired: true;
  was: unknown;
}

export function isGroup(w: When | Retired): w is Group {
  return typeof w === "object" && w != null && "match" in w && Array.isArray((w as Group).conditions);
}

export function isRetired(w: When | Retired): w is Retired {
  return typeof w === "object" && w != null && (w as Retired).retired === true;
}

/** Every plain condition in a When, in order. */
export function conditionsOf(w: When): Condition[] {
  return isGroup(w) ? w.conditions.flatMap(conditionsOf) : [w];
}
