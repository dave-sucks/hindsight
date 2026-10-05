/** Indicator: volume, RSI, strength vs. the S&P, a gap up. docs/plans/TRIGGER_TYPES.md §3.3. */

import type { TriggerPredicate } from "../../types";
import { BELOW_ABOVE, withSettings, type MeasureDef } from "../measure";
import type { Condition } from "../types";
import { num } from "../words";

const window = (c: Condition) => (typeof c.settings?.window === "string" ? c.settings.window : "3M");

export const volume: MeasureDef = {
  id: "volume",
  reads: ["snapshot", "volume"],
  type: "indicator",
  label: "Volume",
  word: "At least",
  value: { suffix: "× normal volume", placeholder: "2", min: 0 },
  cooldownDays: () => 1,
  fresh: () => ({ watch: "volume" }),
  legacy: {
    from: { VOLUME_RATIO: (p) => ({ watch: "volume", value: p.min }) },
    to: (c): TriggerPredicate | null => (c.value != null ? { kind: "VOLUME_RATIO", min: c.value } : null),
  },
};

export const rsi: MeasureDef = {
  id: "rsi",
  reads: ["snapshot"],
  type: "indicator",
  label: "RSI",
  buttons: BELOW_ABOVE,
  value: { prefix: "RSI", placeholder: "30", min: 0, max: 100 },
  settings: [
    {
      key: "period",
      label: "RSI length",
      default: 14,
      identity: true,
      options: [
        { value: 14, label: "14-day RSI" },
        { value: 2, label: "2-day RSI" },
      ],
    },
  ],
  cooldownDays: () => 1,
  fresh: () => ({ watch: "rsi", is: "below" }),
  legacy: {
    from: {
      RSI: (p) => withSettings({ watch: "rsi", is: p.direction === "ABOVE" ? "above" : "below", value: p.threshold }, { period: p.period }),
    },
    to: (c): TriggerPredicate | null => {
      if (c.value == null || (c.is !== "above" && c.is !== "below")) return null;
      const period = num(c.settings?.period);
      return { kind: "RSI", ...(period === 2 || period === 14 ? { period } : {}), threshold: c.value, direction: c.is === "above" ? "ABOVE" : "BELOW" };
    },
  },
};

export const strength: MeasureDef = {
  id: "strength",
  reads: ["snapshot"],
  type: "indicator",
  label: "vs. S&P",
  word: "At least",
  value: { suffix: "points ahead of the S&P", placeholder: "0", allowNegative: true },
  settings: [
    {
      key: "window",
      label: "Measured over",
      default: "3M",
      identity: true,
      options: [
        { value: "1M", label: "Over 1 month" },
        { value: "3M", label: "Over 3 months" },
        { value: "6M", label: "Over 6 months" },
      ],
    },
  ],
  // A daily number that stays true for weeks: once a week.
  cooldownDays: () => 7,
  state: () => true,
  fresh: () => ({ watch: "strength", settings: { window: "3M" } }),
  legacy: {
    from: { RS_VS_SPY: (p) => ({ watch: "strength", value: p.min, settings: { window: p.window } }) },
    to: (c): TriggerPredicate | null => {
      const w = window(c);
      if (c.value == null || (w !== "1M" && w !== "3M" && w !== "6M")) return null;
      return { kind: "RS_VS_SPY", window: w, min: c.value };
    },
  },
};

export const gap: MeasureDef = {
  id: "gap",
  reads: ["snapshot", "volume"],
  type: "indicator",
  label: "Gap up",
  word: "At least",
  value: { suffix: "% gap up", placeholder: "4", min: 0 },
  // An agent's choices; a gap added here needs 3× volume within 3 days.
  settings: [
    { key: "volume", default: 3 },
    { key: "withinDays", default: 1 },
  ],
  // A gap stays "within the last N sessions" for N days: one fire per gap.
  cooldownDays: (c) => Math.max(1, num(c.settings?.withinDays) ?? 1),
  fresh: () => ({ watch: "gap", settings: { volume: 3, withinDays: 3 } }),
  legacy: {
    from: { GAP_UP: (p) => withSettings({ watch: "gap", value: p.minPct }, { volume: p.minVolRatio, withinDays: p.withinDays }) },
    to: (c): TriggerPredicate | null => {
      if (c.value == null) return null;
      const within = num(c.settings?.withinDays);
      return { kind: "GAP_UP", minPct: c.value, minVolRatio: num(c.settings?.volume) ?? 3, ...(within != null ? { withinDays: within } : {}) };
    },
  },
};
