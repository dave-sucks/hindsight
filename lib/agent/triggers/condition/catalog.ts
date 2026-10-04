/**
 * The catalog: how each type fills the one condition layout.
 *
 *   type (the Add trigger menu) → tab → setting → button group · value input
 *
 * Every tab is the same fields: what it watches, its buttons, the value input
 * (a typed number, a variable chip from the {x} button, or both) and at most
 * one setting. The dialog and the pill's popover draw from this; nothing in
 * the UI switches on a type. A tab with one button draws it as a word in the
 * input ("Every 30 days"). docs/plans/TRIGGER_TYPES.md §3.
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
  key: "onClose" | "window" | "days";
  label: string;
  options: { value: string; label: string }[];
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
  tabs: TabDef[];
}

const BELOW_ABOVE: ButtonDef[] = [
  { is: "below", label: "Below" },
  { is: "above", label: "Above" },
];
const AT_LEAST: ButtonDef[] = [{ is: "above", label: "At least" }];

export const TRIGGER_TYPES: readonly TypeDef[] = [
  {
    id: "price",
    label: "Price",
    tabs: [
      {
        id: "$",
        label: "$ Price",
        watch: "price",
        unit: "$",
        buttons: BELOW_ABOVE,
        value: { prefix: "$", placeholder: "0.00", min: 0 },
        variables: { mode: "replace", options: PRICE_VARIABLES, title: "Use a price instead" },
        setting: {
          key: "onClose",
          label: "When it is checked",
          options: [
            { value: "false", label: "Any time in the day" },
            { value: "true", label: "Only on the close" },
          ],
        },
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
        variables: { mode: "from", options: PRICE_VARIABLES, title: "Measured from", word: (c) => (c.is === "near" ? "of" : "from") },
        matches: (c) => c.watch === "price" && c.unit === "%",
        fresh: () => ({ watch: "price", unit: "%", is: "below", variable: "prev_close" }),
      },
    ],
  },
  {
    id: "indicator",
    label: "Indicator",
    tabs: [
      {
        id: "volume",
        label: "Volume",
        watch: "volume",
        buttons: AT_LEAST,
        value: { suffix: "× normal volume", placeholder: "2", min: 0 },
        matches: (c) => c.watch === "volume",
        fresh: () => ({ watch: "volume", is: "above" }),
      },
      {
        id: "rsi",
        label: "RSI",
        watch: "rsi",
        buttons: BELOW_ABOVE,
        value: { placeholder: "30", min: 0, max: 100 },
        matches: (c) => c.watch === "rsi",
        fresh: () => ({ watch: "rsi", is: "below" }),
      },
      {
        id: "strength",
        label: "vs. S&P",
        watch: "strength",
        buttons: AT_LEAST,
        value: { suffix: "points ahead", placeholder: "0", allowNegative: true },
        setting: {
          key: "window",
          label: "Measured over",
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
        buttons: AT_LEAST,
        value: { suffix: "% on 3× volume", placeholder: "4", min: 0 },
        matches: (c) => c.watch === "gap",
        fresh: () => ({ watch: "gap", is: "above", params: { volume: 3, withinDays: 3 } }),
      },
    ],
  },
  {
    id: "earnings",
    label: "Earnings",
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
    tabs: [
      {
        id: "sec",
        label: "SEC filing",
        watch: "filing",
        buttons: [{ is: "files", label: "Files" }],
        value: { none: true, placeholder: "Choose a filing" },
        variables: { mode: "replace", options: FILING_VARIABLES, title: "Choose a filing" },
        matches: (c) => c.watch === "filing",
        fresh: () => ({ watch: "filing", is: "files", variable: "tier:MATERIAL" }),
      },
      {
        id: "insiders",
        label: "Insider buying",
        watch: "insiders",
        buttons: AT_LEAST,
        value: { suffix: "insiders", placeholder: "3", integer: true, min: 1 },
        setting: {
          key: "days",
          label: "Look-back",
          options: [
            { value: "30", label: "In the last 30 days" },
            { value: "90", label: "In the last 90 days" },
          ],
        },
        matches: (c) => c.watch === "insiders",
        fresh: () => ({ watch: "insiders", is: "above", params: { days: 30 } }),
      },
    ],
  },
  {
    id: "schedule",
    label: "Schedule",
    tabs: [
      {
        id: "repeat",
        label: "Repeat",
        watch: "schedule",
        buttons: [{ is: "every", label: "Every" }],
        value: { suffix: "days", placeholder: "30", integer: true, min: 1 },
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

/** A setting's current value, as its select stores it. */
export function settingValue(c: Condition, key: SettingDef["key"]): string {
  const p = c.params ?? {};
  if (key === "onClose") return String(p.onClose === true);
  if (key === "window") return p.window ?? "3M";
  return String(p.days ?? 30);
}

export function withSetting(c: Condition, key: SettingDef["key"], v: string): Condition {
  const params: Params = { ...(c.params ?? {}) };
  if (key === "onClose") {
    if (v === "true") params.onClose = true;
    else delete params.onClose;
  } else if (key === "window") params.window = v as Params["window"];
  else params.days = Number(v);
  return { ...c, params };
}
