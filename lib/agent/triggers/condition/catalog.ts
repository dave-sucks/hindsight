/**
 * The catalog: every measure, one entry each, grouped into the five types of
 * the Add trigger menu.
 *
 *   type (the menu) → measure (the tab) → settings · buttons · value input
 *
 * The dialog, the popover, the words, the slot, the checks and the
 * translator read the entries (./measures); nothing else branches on a
 * measure. docs/plans/TRIGGER_TYPES.md §6.
 *
 * Pure and client-safe.
 */

import type { MeasureDef } from "./measure";
import { gap, rsi, strength, volume } from "./measures/indicator";
import { report, surprise } from "./measures/earnings";
import { filing, insiders } from "./measures/filing";
import { move, price } from "./measures/price";
import { fromDate, repeat } from "./measures/schedule";
import type { Condition, SettingDef, SettingValue, TriggerType, VariableId, Watch } from "./types";
import { variableDef } from "./variables";

export const MEASURES: Readonly<Record<Watch, MeasureDef>> = {
  price,
  move,
  volume,
  rsi,
  strength,
  gap,
  report,
  surprise,
  filing,
  insiders,
  repeat,
  from_date: fromDate,
};

export interface TypeDef {
  id: TriggerType;
  label: string;
  /** A new trigger of this type starts as a buy or a sale; the rest start as a review. */
  trades?: boolean;
  measures: readonly MeasureDef[];
}

const TYPES: readonly Omit<TypeDef, "measures">[] = [
  { id: "price", label: "Price", trades: true },
  { id: "indicator", label: "Indicator" },
  { id: "earnings", label: "Earnings" },
  { id: "filing", label: "Filing" },
  { id: "schedule", label: "Schedule" },
];

export const TRIGGER_TYPES: readonly TypeDef[] = TYPES.map((t) => ({
  ...t,
  measures: Object.values(MEASURES).filter((m) => m.type === t.id),
}));

export function typeDef(type: TriggerType): TypeDef {
  return TRIGGER_TYPES.find((t) => t.id === type)!;
}

export function measureOf(c: Condition): MeasureDef {
  return MEASURES[c.watch];
}

/** The settings a condition can carry: its measure's, then its variable's. */
export function settingDefs(c: Condition): readonly SettingDef[] {
  return [...(measureOf(c).settings ?? []), ...(c.variable ? (variableDef(c.variable).settings ?? []) : [])];
}

export function settingOf(c: Condition, key: string): SettingValue | undefined {
  return c.settings?.[key] ?? settingDefs(c).find((s) => s.key === key)?.default;
}

/** A setting changed in the form. The default is stored as nothing, the way an agent writes it. */
export function withSetting(c: Condition, key: string, v: SettingValue): Condition {
  const rest = Object.fromEntries(Object.entries(c.settings ?? {}).filter(([k]) => k !== key));
  const def = settingDefs(c).find((s) => s.key === key);
  const settings = def && v === def.default ? rest : { ...rest, [key]: v };
  return { ...c, settings: Object.keys(settings).length ? settings : undefined };
}

/** A new variable. Settings that belonged to the old one go with it. */
export function withVariable(c: Condition, id: VariableId | undefined): Condition {
  const old = c.variable ? (variableDef(c.variable).settings ?? []).map((s) => s.key) : [];
  const settings = Object.fromEntries(Object.entries(c.settings ?? {}).filter(([k]) => !old.includes(k)));
  return { ...c, variable: id, settings: Object.keys(settings).length ? settings : undefined };
}
