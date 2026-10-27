/** Indicator: volume, RSI, strength vs. the S&P, a gap up. docs/plans/TRIGGER_TYPES.md §3.3. */


import { BELOW_ABOVE, type MeasureDef } from "../measure";
import type { Condition } from "../types";

const window = (c: Condition) => (typeof c.settings?.window === "string" ? c.settings.window : "3M");

export const volume: MeasureDef = {
  id: "volume",
  reads: ["snapshot", "volume"],
  type: "indicator",
  label: "Volume",
  word: "At least",
  value: { suffix: "× normal volume", placeholder: "2", range: { what: "Volume", unit: "×", over: 0, max: 50 } },
  cooldownDays: () => 1,
  fresh: () => ({ watch: "volume" }),
  fits: (c) => c.value != null,
  shape: "Volume takes a number: how many times normal volume.",
};

export const rsi: MeasureDef = {
  id: "rsi",
  reads: ["snapshot"],
  type: "indicator",
  label: "RSI",
  buttons: BELOW_ABOVE,
  value: { prefix: "RSI", placeholder: "30", range: { what: "RSI", min: 0, max: 100 } },
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
  rises: (c) => (c.is === "above" ? true : c.is === "below" ? false : null),
  fresh: () => ({ watch: "rsi", is: "below" }),
  fits: (c) => c.value != null && (c.is === "above" || c.is === "below"),
  shape: "RSI is above or below a number.",
};

export const strength: MeasureDef = {
  id: "strength",
  reads: ["snapshot"],
  type: "indicator",
  label: "vs. S&P",
  word: "At least",
  // Points ahead of the S&P; behind it is legal ("not lagging by more than 5").
  value: { suffix: "points ahead of the S&P", placeholder: "0", range: { what: "Strength vs the S&P", unit: " points", min: -100, max: 500 } },
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
  // Ahead of the S&P is up; "not lagging by more than N" is neither.
  rises: (c) => ((c.value ?? 0) >= 0 ? true : null),
  fresh: () => ({ watch: "strength", settings: { window: "3M" } }),
  fits: (c) => c.value != null && ["1M", "3M", "6M"].includes(window(c)),
  shape: "Strength vs the S&P takes a number and a window of 1M, 3M or 6M.",
};

export const gap: MeasureDef = {
  id: "gap",
  reads: ["snapshot"],
  type: "indicator",
  label: "Gap up",
  word: "At least",
  value: { suffix: "% gap up", placeholder: "4", range: { what: "A gap", unit: "%", over: 0, max: 100 } },
  // One fire per gap, whatever its volume.
  cooldownDays: () => 1,
  rises: () => true,
  fresh: () => ({ watch: "gap" }),
  fits: (c) => c.value != null,
  shape: "A gap takes a number: the % gap up.",
};
