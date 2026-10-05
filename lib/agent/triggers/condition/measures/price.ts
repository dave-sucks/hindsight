/**
 * Price: a $ level, and a % from another price. docs/plans/TRIGGER_TYPES.md §3.2.
 *
 * "Below the 200-day", "up 15% from our entry" and "15% off the high" are
 * these two measures with a variable, not kinds of their own.
 */

import type { TriggerPredicate } from "../../types";
import { BELOW_ABOVE, withSettings, type MeasureDef } from "../measure";
import { PRICE_VARIABLES, variableDef } from "../variables";
import { num } from "../words";

const SMA_VARIABLE = { 20: "sma20", 50: "sma50", 150: "sma150", 200: "sma200" } as const;
const SMA_PERIOD: Readonly<Record<string, 20 | 50 | 150 | 200>> = { sma20: 20, sma50: 50, sma150: 150, sma200: 200 };
const MOVE_VARIABLE = { "1D": "prev_close", "5D": "close_5d", "20D": "close_20d" } as const;
const MOVE_WINDOW: Readonly<Record<string, "1D" | "5D" | "20D">> = { prev_close: "1D", close_5d: "5D", close_20d: "20D" };

export const price: MeasureDef = {
  id: "price",
  type: "price",
  label: "$ Price",
  buttons: BELOW_ABOVE,
  value: { prefix: "$", placeholder: "0.00", min: 0, missing: "Enter a price, or use a price variable." },
  variables: { mode: "replace", options: PRICE_VARIABLES, title: "Use a price instead" },
  settings: [
    {
      key: "close",
      label: "When it is checked",
      default: false,
      options: [
        { value: false, label: "Any time in the day" },
        { value: true, label: "Only on the close" },
      ],
    },
  ],
  direct: (c) => !c.variable,
  oneEnter: (c) => !c.variable,
  fresh: () => ({ watch: "price", is: "below" }),
  check: (c, ctx) => {
    if (!c.variable && c.value === 0) return "Enter a price, or use a price variable.";
    if (!c.variable && ctx.level !== "THESIS") {
      return "A typed price can't apply to every stock. Use a price variable instead, like the 200-day average.";
    }
    if (c.variable && c.settings?.close === true) return "Only on the close works with a typed price.";
    return null;
  },
  legacy: {
    from: {
      PRICE_ABOVE: (p) => withSettings({ watch: "price", is: "above", value: p.level }, { close: p.basis === "close" ? true : undefined }),
      PRICE_BELOW: (p) => withSettings({ watch: "price", is: "below", value: p.level }, { close: p.basis === "close" ? true : undefined }),
      VS_SMA: (p) => ({ watch: "price", is: p.direction === "ABOVE" ? "above" : "below", variable: SMA_VARIABLE[p.period] }),
      NEW_HIGH: (p) => ({ watch: "price", is: "above", variable: p.window === "20D" ? "high20" : "high52" }),
    },
    to: (c): TriggerPredicate | null => {
      if (c.is !== "above" && c.is !== "below") return null;
      if (!c.variable) {
        if (c.value == null) return null;
        return { kind: c.is === "above" ? "PRICE_ABOVE" : "PRICE_BELOW", level: c.value, ...(c.settings?.close === true ? { basis: "close" as const } : {}) };
      }
      if (c.settings?.close === true) return null;
      const period = SMA_PERIOD[c.variable];
      if (period) return { kind: "VS_SMA", period, direction: c.is === "above" ? "ABOVE" : "BELOW" };
      if ((c.variable === "high20" || c.variable === "high52") && c.is === "above") {
        return { kind: "NEW_HIGH", window: c.variable === "high20" ? "20D" : "52W" };
      }
      return null;
    },
  },
};

export const move: MeasureDef = {
  id: "move",
  type: "price",
  label: "% Move",
  buttons: [
    { is: "below", label: "Below" },
    { is: "near", label: "Within" },
    { is: "above", label: "Above" },
  ],
  value: { suffix: "%", placeholder: "0", min: 0 },
  variables: {
    mode: "from",
    options: PRICE_VARIABLES,
    title: "Measured from",
    word: (c) => (c.is === "near" ? "of" : "from"),
    required: "Choose what the % is measured from.",
  },
  direct: (c) => c.variable != null && variableDef(c.variable).direct === true,
  fresh: () => ({ watch: "move", is: "below", variable: "prev_close" }),
  check: (c) => {
    if (c.is === "near" && (c.value ?? 0) === 0) return "Within needs a distance, such as 2%.";
    if (c.is === "below" && (c.value ?? 0) >= 100) return "A fall of 100% or more can't happen.";
    return null;
  },
  legacy: {
    from: {
      PRICE_MOVE_PCT: (p) => ({ watch: "move", is: p.direction === "UP" ? "above" : "below", value: p.pct, variable: MOVE_VARIABLE[p.window] }),
      GAIN_FROM_ENTRY: (p) =>
        withSettings(
          { watch: "move", is: p.direction === "UP" ? "above" : "below", value: p.pct, variable: "entry" },
          p.skipIfPeakGainPct != null ? { fastWinnerPct: p.skipIfPeakGainPct, fastWinnerDays: p.skipIfPeakWithinDays } : {},
        ),
      TRAILING_FROM_HIGH: (p) =>
        withSettings({ watch: "move", is: "below", value: p.pct, variable: "peak" }, { startOnceUpPct: p.armAtGainPct, widenAtr: p.atrMultiple }),
      NEAR_SMA: (p) => ({ watch: "move", is: "near", value: p.withinPct, variable: SMA_VARIABLE[p.period] }),
      PCT_FROM_52W_HIGH: (p) => ({ watch: "move", is: "near", value: p.max, variable: "high52" }),
    },
    to: (c): TriggerPredicate | null => {
      const v = c.value;
      const s = c.settings ?? {};
      if (!c.variable || v == null) return null;
      if (c.is === "near") {
        const period = SMA_PERIOD[c.variable];
        if (period) return { kind: "NEAR_SMA", period, withinPct: v };
        return c.variable === "high52" ? { kind: "PCT_FROM_52W_HIGH", max: v } : null;
      }
      if (c.is !== "above" && c.is !== "below") return null;
      const direction = c.is === "above" ? "UP" : "DOWN";
      const window = MOVE_WINDOW[c.variable];
      if (window) return { kind: "PRICE_MOVE_PCT", pct: v, direction, window };
      if (c.variable === "entry") {
        const fast = num(s.fastWinnerPct);
        const within = num(s.fastWinnerDays);
        return { kind: "GAIN_FROM_ENTRY", pct: v, direction, ...(fast != null ? { skipIfPeakGainPct: fast, ...(within != null ? { skipIfPeakWithinDays: within } : {}) } : {}) };
      }
      if (c.variable === "peak" && c.is === "below") {
        const arm = num(s.startOnceUpPct);
        const atr = num(s.widenAtr);
        return { kind: "TRAILING_FROM_HIGH", pct: v, ...(arm != null ? { armAtGainPct: arm } : {}), ...(atr != null ? { atrMultiple: atr } : {}) };
      }
      return null;
    },
  },
};
