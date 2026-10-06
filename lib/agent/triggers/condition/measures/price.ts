/**
 * Price: a $ level, and a % from another price. docs/plans/TRIGGER_TYPES.md §3.2.
 *
 * "Below the 200-day", "up 15% from our entry" and "15% off the high" are
 * these two measures with a variable, not kinds of their own.
 */


import { BELOW_ABOVE, type MeasureDef } from "../measure";
import { PRICE_VARIABLES, variableDef } from "../variables";

import { trailFireLevel, trailOf } from "../../trail";

const SMA_PERIOD: Readonly<Record<string, 20 | 50 | 150 | 200>> = { sma20: 20, sma50: 50, sma150: 150, sma200: 200 };
const MOVE_WINDOW: Readonly<Record<string, "1D" | "5D" | "20D">> = { prev_close: "1D", close_5d: "5D", close_20d: "20D" };

export const price: MeasureDef = {
  id: "price",
  type: "price",
  label: "$ Price",
  buttons: BELOW_ABOVE,
  value: { prefix: "$", placeholder: "0.00", range: { what: "A typed price", unit: "$", over: 0 }, missing: "Enter a price, or use a price variable." },
  variables: { mode: "replace", options: PRICE_VARIABLES, title: "Use a price instead" },
  settings: [
    {
      key: "close",
      label: "When it is checked",
      // A line that waits for the close lets the stock trade under it all day.
      looser: true,
      default: false,
      options: [
        { value: false, label: "Any time in the day" },
        { value: true, label: "Only on the close" },
      ],
    },
  ],
  direct: (c) => !c.variable,
  level: (c) => !c.variable,
  // A typed price is a line at that price; with a variable (an average, a high) it has no one price.
  line: (c, ctx) =>
    !c.variable && c.value != null && (c.is === "above" || c.is === "below")
      ? { price: c.value, side: (c.is === "above") === ctx.isLong ? "UPSIDE" : "DOWNSIDE", projected: false }
      : null,
  closeReason: (c, isLong) => ((c.is === "below") === isLong ? "STOP" : "TARGET"),
  // A price line: one nudge a day. Under an average is a state a review asks about weekly (a buy fires on its crossing, a sale is a standing order).
  cooldownDays: (c, action) => (c.variable && SMA_PERIOD[c.variable] && action === "REVIEW" ? 7 : 1),
  state: (c) => c.variable != null && SMA_PERIOD[c.variable] != null,
  fresh: () => ({ watch: "price", is: "below" }),
  check: (c, ctx) => {
    if (!c.variable && ctx.level !== "THESIS") {
      return "A typed price can't apply to every stock. Use a price variable instead, like the 200-day average.";
    }
    return null;
  },
  // A typed price either way; an average either way; a high only from below (a new high). On the close only for a typed price.
  fits: (c) => {
    if (c.is !== "above" && c.is !== "below") return false;
    if (!c.variable) return c.value != null;
    if (c.settings?.close === true) return false;
    return SMA_PERIOD[c.variable] != null || ((c.variable === "high20" || c.variable === "high52") && c.is === "above");
  },
  shape: "A price is above or below a typed price, an average, or (from below) a high; only a typed price can wait for the close.",
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
  value: {
    suffix: "%",
    placeholder: "0",
    range: { what: "A move", unit: "%", over: 0 },
    ranges: [
      { is: "near", variables: Object.keys(SMA_PERIOD), range: { what: "Within an average", unit: "%", over: 0, max: 10 } },
      { is: "near", variables: ["high52"], range: { what: "Within the 52-week high", unit: "%", min: 0, max: 100 } },
      // A give-back under 1% would fire on noise the moment the high is set.
      { is: "below", variables: ["peak"], range: { what: "A trail", unit: "%", min: 1, under: 100, why: "Under 1% fires on noise the moment a high is set." } },
      { is: "below", range: { what: "A fall", unit: "%", over: 0, under: 100, why: "A fall of 100% or more can't happen." } },
    ],
  },
  variables: {
    mode: "from",
    options: PRICE_VARIABLES,
    title: "Measured from",
    word: (c) => (c.is === "near" ? "of" : "from"),
    required: "Choose what the % is measured from.",
  },
  direct: (c) => c.variable != null && variableDef(c.variable).direct === true,
  // A % from our position is a line that moves with it: a give-back off the high (null until armed), a gain or loss off our entry.
  line: (c, ctx) => {
    if (c.value == null || (c.is !== "above" && c.is !== "below")) return null;
    const side = c.is === "above" ? "UPSIDE" : "DOWNSIDE";
    if (c.variable === "peak") {
      return { price: trailFireLevel(trailOf(c), { peak: ctx.peakPrice, avgCost: ctx.avgCost, isLong: ctx.isLong, atr: ctx.atr14 }), side, projected: true };
    }
    if (c.variable !== "entry") return null;
    const avg = ctx.avgCost;
    if (avg == null || avg <= 0) return { price: null, side, projected: true };
    const favourable = (c.is === "above") === ctx.isLong;
    return { price: favourable ? avg * (1 + c.value / 100) : avg * (1 - c.value / 100), side, projected: true };
  },
  // A give-back from our entry or the high protects a gain (STOP); a day's move with the position is a TARGET.
  closeReason: (c, isLong) => (variableDef(c.variable ?? "prev_close").position ? "STOP" : (c.is === "above") === isLong ? "TARGET" : "STOP"),
  // A gain milestone latches (up 10% stays up 10%), so a week; near the 52-week high is a state a review asks weekly; the rest daily.
  cooldownDays: (c, action) => (c.variable === "entry" ? 7 : c.is === "near" && c.variable === "high52" && action === "REVIEW" ? 7 : 1),
  state: (c) => c.is === "near" && c.variable === "high52",
  fresh: () => ({ watch: "move", is: "below", variable: "prev_close" }),
  // Within: of an average or the 52-week high. Above or below: a recent close or our entry; below only for the high since we bought.
  fits: (c) => {
    if (!c.variable || c.value == null) return false;
    if (c.is === "near") return SMA_PERIOD[c.variable] != null || c.variable === "high52";
    if (c.is !== "above" && c.is !== "below") return false;
    return MOVE_WINDOW[c.variable] != null || c.variable === "entry" || (c.variable === "peak" && c.is === "below");
  },
  shape: "A % move is within an average or the 52-week high, above or below a recent close or our entry, or below the high since we bought.",
};
