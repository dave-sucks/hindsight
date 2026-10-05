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
import type { Condition, Direction, SettingDef, SettingValue, TriggerType, Watch, When } from "./types";
import type { VariableDef } from "./variables";
import type { LegacyPredicate } from "./legacy-types";

export interface ValueDef {
  /** "$" before the number. */
  prefix?: string;
  /** "%", "days" after it. */
  suffix?: string;
  placeholder: string;
  /** No number at all: the input holds only a variable chip (a filing). */
  none?: boolean;
  /** Whole numbers only (days, insiders). */
  integer?: boolean;
  min?: number;
  max?: number;
  /** A negative number means something (strength vs. the S&P). */
  allowNegative?: boolean;
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

type Kind = LegacyPredicate["kind"];

/** Until the cutover: how a measure reads the stored kinds, one reader per kind. A reader returns null for a predicate another measure owns. */
export type LegacyReaders = { [K in Kind]?: (p: Extract<LegacyPredicate, { kind: K }>) => When | null };

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
  atr14?: number | null;
}

/** What the trigger check loads for a condition beyond the live quote. */
export type Source = "snapshot" | "volume" | "earnings" | "filings";

export interface MeasureDef {
  id: Watch;
  type: TriggerType;
  /** The tab. */
  label: string;
  /** Two or three choices: the button group. */
  buttons?: readonly { is: Direction; label: string }[];
  /** One choice: said as a word inside the input ("Every", "At least", "Files"). */
  word?: string;
  value: ValueDef;
  variables?: VariablesDef;
  settings?: readonly SettingDef[];
  /** The actions it can take. All five unless listed. */
  actions?: readonly TriggerAction[];
  /** "Propose the sale right away" is offered: a sale nothing needs judging on. */
  direct?: (c: Condition) => boolean;
  /** A clock, not a condition: "Review every 30 days." It stands alone. */
  timed?: boolean;
  /** In a sentence, where the two halves don't read as English: "30 days after the buy". `words` is the value half in words. */
  says?: (c: Condition, words: string) => string;
  /**
   * A typed price level: a floor or a target. A buy on one is one rule
   * whichever way it is set (the price you'd start at); on a stock we don't
   * own, a sale on one sets the plan down and waits for the close; a review
   * reached before the buy says the plan is stale.
   */
  level?: (c: Condition) => boolean;
  /** The label a direct sale on it closes with: STOP for a protective give-back, TARGET for a favourable level. */
  closeReason?: (c: Condition, isLong: boolean) => "STOP" | "TARGET";
  /** Where it sits on the chart, when it has one price: a typed level, a % from our position. Absent or null: no line. */
  line?: (c: Condition, ctx: LineContext) => Line | null;
  /** The review clock: counted from the last review. The one schedule a watched stock opts into, and what "review due" reads. */
  clock?: boolean;
  /** Days between fires when the trigger names none. */
  cooldownDays: (c: Condition, action: string) => number;
  /** What the trigger check loads for it beyond the live quote. A variable or setting read off the snapshot adds it (./variables). */
  reads?: readonly Source[];
  /** Somewhere the stock is for weeks (below the 200-day), not a moment: a review on it asks at most weekly. */
  state?: (c: Condition) => boolean;
  /** For "any of" this measure's own conditions that is one rule: the condition whose cascade slot it takes. */
  groupSlot?: (cs: readonly Condition[]) => Condition | undefined;
  /** What a new condition on this tab starts as. */
  fresh: () => Condition;
  /** What's wrong beyond the number and the variable, in one sentence, or null. */
  check?: (c: Condition, ctx: CheckContext) => string | null;
  /** Until the cutover the server stores today's kinds: how this measure reads and writes them. */
  legacy: {
    from: LegacyReaders;
    to: (c: Condition) => LegacyPredicate | null;
    /** "Any of" several of these conditions, written as one kind (several filing events). */
    foldAny?: (cs: Condition[]) => LegacyPredicate | null;
  };
}

export const BELOW_ABOVE = [
  { is: "below", label: "Below" },
  { is: "above", label: "Above" },
] as const;

/** A condition with the settings that are set (an absent stored field stays absent). */
export function withSettings(c: Condition, settings: Record<string, SettingValue | undefined>): Condition {
  const set = Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)) as Record<string, SettingValue>;
  return Object.keys(set).length ? { ...c, settings: set } : c;
}
