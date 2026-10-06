/** Indicator: volume, RSI, strength vs. the S&P, a gap up. docs/plans/TRIGGER_TYPES.md §3.3. */


import { BELOW_ABOVE, withSettings, type MeasureDef } from "../measure";
import type { Condition } from "../types";
import { isNum, num, wholeIn } from "../words";

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
  fits: (c) => c.value != null,
  valid: (c) => isNum(c.value) && c.value > 0 && c.value <= 50,
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
  fits: (c) => c.value != null && (c.is === "above" || c.is === "below"),
  valid: (c) => rsi.fits(c) && isNum(c.value) && c.value >= 0 && c.value <= 100,
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
  fits: (c) => c.value != null && ["1M", "3M", "6M"].includes(window(c)),
  // Points ahead of the S&P; behind it is legal ("not lagging by more than 5").
  valid: (c) => strength.fits(c) && isNum(c.value) && c.value >= -100 && c.value <= 500,
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
  fits: (c) => c.value != null,
  valid: (c) => {
    if (!isNum(c.value) || c.value <= 0 || c.value > 100) return false;
    const volume = num(c.settings?.volume) ?? 3;
    const within = num(c.settings?.withinDays);
    // Up to the 10 sessions the snapshot keeps gaps for.
    return volume >= 0 && volume <= 50 && (within == null || wholeIn(within, 1, 10));
  },
};
