/** Indicator: volume, RSI, strength vs. the S&P, a gap up. docs/plans/TRIGGER_TYPES.md §3.3. */


import { BELOW_ABOVE, withSettings, type MeasureDef } from "../measure";
import type { Condition } from "../types";
import { isNum, num, shown, wholeIn } from "../words";

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
  problem: (c) => (isNum(c.value) && c.value > 0 && c.value <= 50 ? null : `Volume can be more than 0 and up to 50× normal; ${shown(c.value)}× isn't.`),
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
  problem: (c) => {
    if (!rsi.fits(c)) return "RSI is above or below a number.";
    return isNum(c.value) && c.value >= 0 && c.value <= 100 ? null : `RSI runs 0 to 100; ${shown(c.value)} isn't.`;
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
  fits: (c) => c.value != null && ["1M", "3M", "6M"].includes(window(c)),
  // Points ahead of the S&P; behind it is legal ("not lagging by more than 5").
  problem: (c) => {
    if (!strength.fits(c)) return "Strength vs the S&P takes a number and a window of 1M, 3M or 6M.";
    return isNum(c.value) && c.value >= -100 && c.value <= 500 ? null : `Strength vs the S&P can be -100 to 500 points; ${shown(c.value)} isn't.`;
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
  fits: (c) => c.value != null,
  problem: (c) => {
    if (!isNum(c.value) || c.value <= 0 || c.value > 100) return `A gap can be more than 0% and up to 100%; ${shown(c.value)}% isn't.`;
    const volume = num(c.settings?.volume) ?? 3;
    if (!(volume >= 0 && volume <= 50)) return `A gap's volume can be 0 to 50× normal; ${shown(volume)}× isn't.`;
    const within = num(c.settings?.withinDays);
    // Up to the 10 sessions the snapshot keeps gaps for.
    return within == null || wholeIn(within, 1, 10) ? null : `A gap counts within 1 to 10 whole sessions, the most the snapshot keeps; ${shown(within)} isn't.`;
  },
};
