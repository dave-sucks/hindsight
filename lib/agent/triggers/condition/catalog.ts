/**
 * The catalog: how each type fills the one dialog.
 *
 *   type (picked on the sheet) → tabs → button group · value input → one setting
 *
 * Every tab names its watch, its buttons, what the value input takes (a typed
 * number, a variable from the {x} button, or both), and the one setting under
 * it. The dialog renders from this; nothing else in the UI switches on a
 * type. docs/plans/TRIGGER_TYPES.md §3.
 *
 * Pure and client-safe.
 */

import type { Condition, Direction, Params, TriggerType, Watch } from "./types";
import type { VariableDef } from "./variables";
import { DATE_VARIABLES, FILING_VARIABLES, PRICE_VARIABLES } from "./variables";

export interface ButtonDef {
  is: Direction;
  label: string;
}

export interface ValueDef {
  /** "$" before the number. */
  prefix?: string;
  /** "%", "× a normal day", "days" after it. */
  suffix?: string;
  placeholder: string;
  /** No number at all: the input holds only a variable or its placeholder (a filing). */
  none?: boolean;
  /** Whole numbers only (days, insiders). */
  integer?: boolean;
  min?: number;
  max?: number;
  /** A negative number means something (strength vs. the S&P). */
  allowNegative?: boolean;
  /** A unit picker inside the input ("every 2 weeks"): writes params.every. */
  unitPicker?: boolean;
}

export interface VariablesDef {
  /** "replace": the variable stands in for the number. "from": the number is measured from it. */
  mode: "replace" | "from";
  options: readonly VariableDef[];
  /** The menu's title. */
  title: string;
  /** The word between the number and the chip ("from", "of"). */
  word?: (c: Condition) => string;
}

export interface SettingDef {
  key: keyof Params;
  options: { value: string; label: string }[];
  /** Shown only when it applies (the report window's start, on After). */
  when?: (c: Condition) => boolean;
}

export interface TabDef {
  id: string;
  label: string;
  watch: Watch;
  unit?: "$" | "%";
  buttons: ButtonDef[];
  value: ValueDef;
  variables?: VariablesDef;
  setting?: SettingDef;
  /** Does a stored condition belong to this tab? */
  matches: (c: Condition) => boolean;
  /** A new condition on this tab, before you type anything. */
  fresh: () => Condition;
}

export interface TypeDef {
  id: TriggerType;
  label: string;
  /** One line under the button, and in the dialog's title. */
  blurb: string;
  tabs: TabDef[];
}

const BELOW_ABOVE: ButtonDef[] = [
  { is: "below", label: "Below" },
  { is: "above", label: "Above" },
];

const ON_CLOSE: SettingDef = {
  key: "onClose",
  options: [
    { value: "false", label: "Any time in the day" },
    { value: "true", label: "Only on the close" },
  ],
};

export const TRIGGER_TYPES: readonly TypeDef[] = [
  {
    id: "price",
    label: "Price",
    blurb: "A price or a % move, fixed or measured from another price",
    tabs: [
      {
        id: "$",
        label: "$ Price",
        watch: "price",
        unit: "$",
        buttons: BELOW_ABOVE,
        value: { prefix: "$", placeholder: "0.00", min: 0 },
        variables: { mode: "replace", options: PRICE_VARIABLES, title: "Use a price instead" },
        setting: ON_CLOSE,
        matches: (c) => c.watch === "price" && c.unit !== "%",
        fresh: () => ({ watch: "price", unit: "$", is: "below" }),
      },
      {
        id: "%",
        label: "% Move",
        watch: "price",
        unit: "%",
        buttons: [
          { is: "below", label: "Below" },
          { is: "near", label: "Near" },
          { is: "above", label: "Above" },
        ],
        value: { suffix: "%", placeholder: "0", min: 0 },
        variables: {
          mode: "from",
          options: PRICE_VARIABLES,
          title: "Measured from",
          word: (c) => (c.is === "near" ? "of" : "from"),
        },
        setting: ON_CLOSE,
        matches: (c) => c.watch === "price" && c.unit === "%",
        fresh: () => ({ watch: "price", unit: "%", is: "below", variable: "prev_close" }),
      },
    ],
  },
  {
    id: "indicator",
    label: "Indicator",
    blurb: "Volume, RSI, strength vs. the S&P, a gap up",
    tabs: [
      {
        id: "volume",
        label: "Volume",
        watch: "volume",
        buttons: BELOW_ABOVE,
        value: { suffix: "× a normal day", placeholder: "1.5", min: 0 },
        setting: ON_CLOSE,
        matches: (c) => c.watch === "volume",
        fresh: () => ({ watch: "volume", is: "above" }),
      },
      {
        id: "rsi",
        label: "RSI",
        watch: "rsi",
        buttons: BELOW_ABOVE,
        value: { suffix: "on 0–100", placeholder: "30", min: 0, max: 100 },
        setting: {
          key: "period",
          options: [
            { value: "14", label: "14-day RSI" },
            { value: "2", label: "2-day RSI" },
          ],
        },
        matches: (c) => c.watch === "rsi",
        fresh: () => ({ watch: "rsi", is: "below", params: { period: 14 } }),
      },
      {
        id: "strength",
        label: "vs. S&P",
        watch: "strength",
        buttons: BELOW_ABOVE,
        value: { suffix: "points", placeholder: "0", allowNegative: true },
        setting: {
          key: "window",
          options: [
            { value: "1M", label: "Over 1 month" },
            { value: "3M", label: "Over 3 months" },
            { value: "6M", label: "Over 6 months" },
          ],
        },
        matches: (c) => c.watch === "strength",
        fresh: () => ({ watch: "strength", is: "above", params: { window: "3M" } }),
      },
      {
        id: "gap",
        label: "Gap up",
        watch: "gap",
        buttons: [{ is: "above", label: "At least" }],
        value: { suffix: "% on 3× volume", placeholder: "4", min: 0 },
        matches: (c) => c.watch === "gap",
        fresh: () => ({ watch: "gap", is: "above", params: { volume: 3, withinDays: 3 } }),
      },
    ],
  },
  {
    id: "earnings",
    label: "Earnings",
    blurb: "Before or after the report, a beat or a miss",
    tabs: [
      {
        id: "report",
        label: "Report date",
        watch: "report",
        buttons: [
          { is: "before", label: "Before" },
          { is: "after", label: "After" },
        ],
        value: { suffix: "days", placeholder: "3", integer: true, min: 0 },
        setting: {
          key: "fromDay",
          options: [
            { value: "0", label: "Counted from the report day" },
            { value: "1", label: "Counted from the day after" },
          ],
          when: (c) => c.is === "after",
        },
        matches: (c) => c.watch === "report",
        fresh: () => ({ watch: "report", is: "before" }),
      },
      {
        id: "result",
        label: "Result",
        watch: "surprise",
        buttons: [
          { is: "miss", label: "Miss" },
          { is: "beat", label: "Beat" },
        ],
        value: { suffix: "% vs. the estimate", placeholder: "0", min: 0 },
        matches: (c) => c.watch === "surprise",
        fresh: () => ({ watch: "surprise", is: "beat", value: 0 }),
      },
    ],
  },
  {
    id: "filing",
    label: "Filing",
    blurb: "SEC filings and insider buying",
    tabs: [
      {
        id: "sec",
        label: "SEC filing",
        watch: "filing",
        buttons: [
          { is: "material", label: "Material" },
          { is: "red_flag", label: "Red flag" },
        ],
        value: { none: true, placeholder: "Any filing" },
        variables: { mode: "replace", options: FILING_VARIABLES, title: "One event instead" },
        matches: (c) => c.watch === "filing",
        fresh: () => ({ watch: "filing", is: "material" }),
      },
      {
        id: "insiders",
        label: "Insider buying",
        watch: "insiders",
        buttons: [{ is: "at_least", label: "At least" }],
        value: { suffix: "insiders", placeholder: "3", integer: true, min: 1 },
        setting: {
          key: "days",
          options: [
            { value: "30", label: "In the last 30 days" },
            { value: "90", label: "In the last 90 days" },
          ],
        },
        matches: (c) => c.watch === "insiders",
        fresh: () => ({ watch: "insiders", is: "at_least", params: { days: 30 } }),
      },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    blurb: "Every N days, or N days from the buy or the event date",
    tabs: [
      {
        id: "repeat",
        label: "Repeat",
        watch: "schedule",
        buttons: [{ is: "every", label: "Every" }],
        value: { placeholder: "30", integer: true, min: 1, unitPicker: true },
        matches: (c) => c.watch === "schedule" && c.is === "every",
        fresh: () => ({ watch: "schedule", is: "every" }),
      },
      {
        id: "from-date",
        label: "From a date",
        watch: "schedule",
        buttons: [
          { is: "after", label: "After" },
          { is: "before", label: "Before" },
        ],
        value: { suffix: "days", placeholder: "60", integer: true, min: 1 },
        variables: { mode: "from", options: DATE_VARIABLES, title: "Counted from", word: () => "from" },
        matches: (c) => c.watch === "schedule" && c.is !== "every",
        fresh: () => ({ watch: "schedule", is: "after", variable: "buy" }),
      },
    ],
  },
];

export function typeDef(type: TriggerType): TypeDef {
  return TRIGGER_TYPES.find((t) => t.id === type)!;
}

const TYPE_OF_WATCH: Record<Watch, TriggerType> = {
  price: "price",
  volume: "indicator",
  rsi: "indicator",
  strength: "indicator",
  gap: "indicator",
  report: "earnings",
  surprise: "earnings",
  filing: "filing",
  insiders: "filing",
  schedule: "schedule",
};

export function typeOfCondition(c: Condition): TriggerType {
  return TYPE_OF_WATCH[c.watch];
}

export function tabOfCondition(c: Condition): TabDef {
  const type = typeDef(typeOfCondition(c));
  return type.tabs.find((t) => t.matches(c)) ?? type.tabs[0];
}
