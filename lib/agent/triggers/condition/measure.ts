/**
 * What a measure's catalog entry holds. One entry per measure (./measures);
 * the dialog, the pill, the popover, the slot, the checks and the translator
 * all read it. Its words are its form's words: the button labels, the
 * input's prefix and suffix, and the variables' names. Adding a measure is one entry and a test.
 * docs/plans/TRIGGER_TYPES.md §6.
 *
 * Pure and client-safe.
 */

import type { TriggerAction, TriggerPredicate } from "../types";
import type { Condition, Direction, SettingDef, SettingValue, TriggerType, Watch, When } from "./types";
import type { VariableDef } from "./variables";

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

type Kind = TriggerPredicate["kind"];

/** Until the cutover: how a measure reads the stored kinds, one reader per kind. A reader returns null for a predicate another measure owns. */
export type LegacyReaders = { [K in Kind]?: (p: Extract<TriggerPredicate, { kind: K }>) => When | null };

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
  /**
   * A typed price level: a floor or a target. A buy on one is one rule
   * whichever way it is set (the price you'd start at); on a stock we don't
   * own, a sale on one sets the plan down and waits for the close; a review
   * reached before the buy says the plan is stale.
   */
  level?: (c: Condition) => boolean;
  /** The label a direct sale on it closes with: STOP for a protective give-back, TARGET for a favourable level. */
  closeReason?: (c: Condition, isLong: boolean) => "STOP" | "TARGET";
  /** Days between fires when the trigger names none. */
  cooldownDays: (c: Condition, action: string) => number;
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
    to: (c: Condition) => TriggerPredicate | null;
    /** "Any of" several of these conditions, written as one kind (several filing events). */
    foldAny?: (cs: Condition[]) => TriggerPredicate | null;
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
