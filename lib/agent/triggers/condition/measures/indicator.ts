/** Indicator: volume, RSI, strength vs. the S&P, a gap up. docs/plans/TRIGGER_TYPES.md §3.3. */

import type { TriggerPredicate } from "../../types";
import { BELOW_ABOVE, withSettings, type MeasureDef } from "../measure";
import type { Condition } from "../types";
import { days, num, pct } from "../words";

const WINDOW_WORDS: Readonly<Record<string, string>> = { "1M": "1 month", "3M": "3 months", "6M": "6 months" };
const rsiLength = (c: Condition) => num(c.settings?.period) ?? 14;
const window = (c: Condition) => (typeof c.settings?.window === "string" ? c.settings.window : "3M");

export const volume: MeasureDef = {
  id: "volume",
  type: "indicator",
  label: "Volume",
  word: "At least",
  value: { suffix: "× normal volume", placeholder: "2", min: 0 },
  fresh: () => ({ watch: "volume" }),
  sentence: (c) => `volume is at least ${c.value ?? 0}× a normal day`,
  pill: (c) => ({ label: "volume at least", value: `${c.value ?? 0}×` }),
  legacy: {
    from: { VOLUME_RATIO: (p) => ({ watch: "volume", value: p.min }) },
    to: (c): TriggerPredicate | null => (c.value != null ? { kind: "VOLUME_RATIO", min: c.value } : null),
  },
};

export const rsi: MeasureDef = {
  id: "rsi",
  type: "indicator",
  label: "RSI",
  buttons: BELOW_ABOVE,
  value: { placeholder: "30", min: 0, max: 100 },
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
  fresh: () => ({ watch: "rsi", is: "below" }),
  sentence: (c) => `the ${rsiLength(c)}-day RSI is ${c.is === "above" ? "above" : "below"} ${c.value ?? 0}`,
  pill: (c) => ({ label: `RSI ${rsiLength(c)} ${c.is === "above" ? "above" : "below"}`, value: String(c.value ?? 0) }),
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
  type: "indicator",
  label: "vs. S&P",
  word: "At least",
  value: { suffix: "points ahead", placeholder: "0", allowNegative: true },
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
  fresh: () => ({ watch: "strength", settings: { window: "3M" } }),
  sentence: (c) => {
    const v = c.value ?? 0;
    const w = WINDOW_WORDS[window(c)];
    if (v === 0) return `it is beating the S&P over ${w}`;
    return v > 0 ? `it is beating the S&P by more than ${v} points over ${w}` : `it is no more than ${-v} points behind the S&P over ${w}`;
  },
  pill: (c) => ({ label: `vs. S&P ${window(c)} above`, value: `${c.value ?? 0} pts` }),
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
  type: "indicator",
  label: "Gap up",
  word: "At least",
  value: { suffix: "%", placeholder: "4", min: 0 },
  // An agent's choices; a gap added here needs 3× volume within 3 days.
  settings: [
    { key: "volume", default: 3 },
    { key: "withinDays", default: 1 },
  ],
  fresh: () => ({ watch: "gap", settings: { volume: 3, withinDays: 3 } }),
  sentence: (c) =>
    `it gapped up ${pct(c.value ?? 0)} or more on ${num(c.settings?.volume) ?? 3}× volume in the last ${days(num(c.settings?.withinDays) ?? 1)}`,
  pill: (c) => ({ label: "gap up", value: `${pct(c.value ?? 0)}+` }),
  legacy: {
    from: { GAP_UP: (p) => withSettings({ watch: "gap", value: p.minPct }, { volume: p.minVolRatio, withinDays: p.withinDays }) },
    to: (c): TriggerPredicate | null => {
      if (c.value == null) return null;
      const within = num(c.settings?.withinDays);
      return { kind: "GAP_UP", minPct: c.value, minVolRatio: num(c.settings?.volume) ?? 3, ...(within != null ? { withinDays: within } : {}) };
    },
  },
};
