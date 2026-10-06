/**
 * The condition shape: one fixed shape for every trigger condition.
 *
 *   watch (the measure) · is (its button) · value (what you type) or variable (what you insert) · settings
 *
 * Everything about a measure (its tab, buttons, input, settings, words,
 * slot, the actions it can take, and how it reads a row stored as a kind)
 * lives on its catalog entry in ./measures. Nothing else branches on a
 * measure. docs/plans/TRIGGER_TYPES.md §3, §5 and §6.
 *
 * Pure and client-safe: types only.
 */

/** The five types in the Add trigger menu. Each groups some measures. */
export type TriggerType = "price" | "indicator" | "earnings" | "filing" | "schedule";

/** The measures: one catalog entry each (./measures). */
export type Watch =
  | "price"
  | "move"
  | "volume"
  | "rsi"
  | "strength"
  | "gap"
  | "report"
  | "surprise"
  | "filing"
  | "insiders"
  | "repeat"
  | "from_date";

/** A measure's buttons. A measure with one choice has no buttons and no `is`: its input says the word. */
export type Direction = "below" | "above" | "near" | "before" | "after" | "miss" | "beat";

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

export type SettingValue = number | boolean | string;

/** A condition's settings. Which keys it may carry is declared on its measure and its variable. */
export type Settings = Readonly<Record<string, SettingValue>>;

/** One setting, declared on the measure (the RSI's length) or the variable (the trailing options on the high since we bought). */
export interface SettingDef {
  key: string;
  /** The select above the input. A setting with no options is one only an agent writes; the form carries it unchanged. */
  options?: readonly { value: SettingValue; label: string }[];
  /** The select's name, for screen readers. */
  label?: string;
  default?: SettingValue;
  /** Part of the rule's identity: a 14-day and a 2-day RSI rule are two rules, not one at two values. */
  identity?: boolean;
  /** Raising it, or turning it on, protects less: on a sale it counts as loosening the stop. */
  looser?: boolean;
  /** When set, the check reads the daily indicator snapshot for it (the trail's daily range). */
  snapshot?: boolean;
  /** Added to the sentence when set: ", once it has been up 20%". */
  words?: (v: SettingValue, s: Settings) => string;
}

export interface Condition {
  watch: Watch;
  is?: Direction;
  /** What you type. Absent when a variable stands in for it. */
  value?: number;
  /** What you insert: in place of the value, or what a % or a day count is measured from. */
  variable?: VariableId;
  settings?: Settings;
}

export interface Group {
  match: "all" | "any";
  conditions: When[];
}

export type When = Condition | Group;

/**
 * A stored condition no current kind can read (old review-date, deleted in
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
