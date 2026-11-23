/**
 * What a measure's catalog entry holds. One entry per measure (./measures);
 * the dialog, the pill, the popover, the slot, the checks and the translator
 * all read it. Its words are its form's words: the button labels, the
 * input's prefix and suffix, and the variables' names. Adding a measure is one entry and a test.
 * docs/plans/TRIGGER_TYPES.md §6.
 *
 * Pure and client-safe.
 */

import type { TriggerAction } from "../types";
import type { Condition, Direction, Range, SettingDef, TriggerType, Watch } from "./types";
import type { VariableDef } from "./variables";

export interface ValueDef {
  /** "$" before the number. */
  prefix?: string;
  /** "%", "days" after it. */
  suffix?: string;
  placeholder: string;
  /** No number at all: the input holds only a variable chip (a filing). */
  none?: boolean;
  /** Where the number may sit (./range). The form, the save and the agents' schema all read it. */
  range?: Range;
  /** Where it sits instead for one button or one variable; the first that matches wins. */
  ranges?: readonly { is?: Direction; variables?: readonly string[]; range: Range }[];
  /** What the line under the input says while the number is missing. */
  missing?: string;
  /** How 0 reads ("any amount" for a beat of 0%). */
  zero?: string;
}

export interface VariablesDef {
  /** "replace": the variable stands in for the number. "from": the number is measured from it. */
  mode: "replace" | "from";
  options: readonly VariableDef[];
  /** The {x} menu's title. */
  title: string;
  /** The word between the number and the chip ("from", "of"). */
  word?: (c: Condition) => string;
  /** Set when a variable is required: what the line under the input says until there is one. */
  required?: string;
  /** The usual one, left off a pill: a % move is from yesterday's close unless the pill says otherwise. */
  usual?: string;
}

export interface CheckContext {
  /** Where the trigger is stored. */
  level: "THESIS" | "ANALYST" | "ACCOUNT";
  /** We own the stock (a thesis at HOLDING). Ignored at the analyst and account levels. */
  held: boolean;
}

/** A condition in words: the direction and the value, the same two halves as the form ("below" · "$248"). */
export interface PillPart {
  label: string;
  value?: string;
}

/** Where a condition sits on the chart: its price now (null until it has one), which side of the trade, and whether the price moves. */
export interface Line {
  price: number | null;
  side: "UPSIDE" | "DOWNSIDE";
  /** It moves with the position: a give-back off the high, a gain off our entry. */
  projected: boolean;
}

export interface LineContext {
  isLong: boolean;
  avgCost?: number | null;
  peakPrice?: number | null;
}

/** What the trigger check loads for a condition beyond the live quote. */
export type Source = "snapshot" | "volume" | "earnings" | "filings" | "street" | "notes";

export interface MeasureDef {
  id: Watch;
  type: TriggerType;
  /** The tab. */
  label: string;
  /**
   * Two or three choices: the button group. `means` is what each fires on, in
   * plain words: the agents' tools describe `is` with it, and the guide prints it.
   */
  buttons?: readonly { is: Direction; label: string; means: string }[];
  /** One choice: the form's first place holds it alone ("Above", "Every", "Files"). */
  word?: string;
  value: ValueDef;
  variables?: VariablesDef;
  settings?: readonly SettingDef[];
  /**
   * About the market, not one stock: only the account's own triggers carry it
   * (Account.marketTriggers, lib/agent/triggers/market.ts). No stock's dialog
   * and no agent's tool offers it, and a save of it on a stock is refused.
   */
  account?: boolean;
  /** The actions it can take. All five unless listed. */
  actions?: readonly TriggerAction[];
  /** A clock, not a condition: "Review every 30 days." It stands alone, unless it is a window. */
  timed?: boolean;
  /**
   * A schedule that is a window (a date count before the event): inside an "and" it bounds the
   * others, so it may join one, says "within", reads only the stock's own date and leaves the
   * actions to the others ("Buy if … and within 70 days before the event date").
   */
  window?: (c: Condition) => boolean;
  /** Counts from the buy: like a move from our buy price, it reads our position and means nothing on a watch. */
  fromTheBuy?: (c: Condition) => boolean;
  /** In a sentence, where the two halves don't read as English: "30 days after the buy". `words` is the value half in words. */
  says?: (c: Condition, words: string) => string;
  /**
   * A typed price level. A buy on one is one rule whichever way it is set
   * (the price you'd start at); on a stock we don't own, a sale on one stops
   * watching it and waits for the close.
   */
  level?: (c: Condition) => boolean;
  /** The label a sale on it closes with: STOP for a protective give-back, TARGET for a favourable level; null when the analyst labels it. */
  closeReason?: (c: Condition, isLong: boolean) => "STOP" | "TARGET" | null;
  /** Which way the price went when it holds: true up, false down; absent or null, neither (volume, a date). Labels an Auto-sell with no close label of its own. */
  rises?: (c: Condition) => boolean | null;
  /** Where it sits on the chart, when it has one price: a typed level, a % from our position. Absent or null: no line. */
  line?: (c: Condition, ctx: LineContext) => Line | null;
  /** The review clock: counted from the last review. The one schedule a watched stock opts into, and what "review due" reads. */
  clock?: boolean;
  /** What the trigger check loads for it beyond the live quote. A variable or setting read off the snapshot adds it (./variables). */
  reads?: readonly Source[];
  /** What a new condition on this tab starts as. */
  fresh: () => Condition;
  /** What's wrong beyond the number and the variable, in one sentence, or null. */
  check?: (c: Condition, ctx: CheckContext) => string | null;
  /**
   * Whether the condition says something this measure can check: a button it
   * has, a variable it reads with that button, a number where it needs one.
   * The {x} menu offers only the variables that fit.
   */
  fits: (c: Condition) => boolean;
  /** Said when a condition doesn't `fit`: what the measure takes. */
  shape: string;
  /**
   * A fact about the numbers beyond their ranges, in one sentence, or null
   * ("can't end on day 2 before it starts on day 3"). Every number's range is
   * data (`value.range`, a setting's `range`); this is the rest.
   */
  rule?: (c: Condition) => string | null;
}

/** What `is` means for a measure: each button and what it fires on ("above fires once …"). */
export function directionWords(m: Pick<MeasureDef, "buttons">): string | null {
  return m.buttons?.length ? `${m.buttons.map((b) => `${b.is} fires once ${b.means}`).join("; ")}.` : null;
}
