/**
 * Price: a $ level, and a % from another price. docs/plans/TRIGGER_TYPES.md §3.2.
 *
 * "Below the 200-day", "up 15% from our entry" and "15% off the high" are
 * these two measures with a variable, not kinds of their own.
 */


import { BELOW_ABOVE, withSettings, type MeasureDef } from "../measure";
import { PRICE_VARIABLES, variableDef } from "../variables";
import { isNum, num, shown, wholeIn } from "../words";
import { trailFireLevel, trailOf } from "../../trail";

const SMA_PERIOD: Readonly<Record<string, 20 | 50 | 150 | 200>> = { sma20: 20, sma50: 50, sma150: 150, sma200: 200 };
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
    if (!c.variable && c.value === 0) return "Enter a price, or use a price variable.";
    if (!c.variable && ctx.level !== "THESIS") {
      return "A typed price can't apply to every stock. Use a price variable instead, like the 200-day average.";
    }
    if (c.variable && c.settings?.close === true) return "Only on the close works with a typed price.";
    return null;
  },
  // A typed price either way; an average either way; a high only from below (a new high). On the close only for a typed price.
  fits: (c) => {
    if (c.is !== "above" && c.is !== "below") return false;
    if (!c.variable) return c.value != null;
    if (c.settings?.close === true) return false;
    return SMA_PERIOD[c.variable] != null || ((c.variable === "high20" || c.variable === "high52") && c.is === "above");
  },
  problem: (c) => {
    if (!price.fits(c)) return "A price is above or below a typed price, an average, or (from below) a high; only a typed price can wait for the close.";
    return c.variable != null || isNum(c.value) ? null : `Enter the price as a number, not ${shown(c.value)}.`;
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
  check: (c) => {
    if (c.is === "near" && (c.value ?? 0) === 0) return "Within needs a distance, such as 2%.";
    if (c.is === "below" && (c.value ?? 0) >= 100) return "A fall of 100% or more can't happen.";
    return null;
  },
  // Within: of an average or the 52-week high. Above or below: a recent close or our entry; below only for the high since we bought.
  fits: (c) => {
    if (!c.variable || c.value == null) return false;
    if (c.is === "near") return SMA_PERIOD[c.variable] != null || c.variable === "high52";
    if (c.is !== "above" && c.is !== "below") return false;
    return MOVE_WINDOW[c.variable] != null || c.variable === "entry" || (c.variable === "peak" && c.is === "below");
  },
  problem: (c) => {
    if (!move.fits(c))
      return "A % move is within an average or the 52-week high, above or below a recent close or our entry, or below the high since we bought.";
    if (!isNum(c.value)) return `Enter the % as a number, not ${shown(c.value)}.`;
    const v = c.value;
    const s = c.settings ?? {};
    if (c.is === "near") {
      if (SMA_PERIOD[c.variable!] != null) return v > 0 && v <= 10 ? null : `Within an average can be more than 0% and up to 10%; ${shown(v)}% isn't.`;
      return v >= 0 && v <= 100 ? null : `Within the 52-week high can be 0% to 100%; ${shown(v)}% isn't.`;
    }
    if (c.variable === "peak") {
      // A give-back under 1% would fire on noise the moment the high is set.
      if (v < 1) return `A trail needs at least 1%; ${shown(v)}% would fire on noise the moment a high is set.`;
      const arm = num(s.startOnceUpPct);
      if (arm != null && !(arm >= 0 && arm <= 200)) return `A trail can start once up 0% to 200%; ${shown(arm)}% isn't.`;
      const atr = num(s.widenAtr);
      if (atr != null && !(atr > 0 && atr <= 10)) return `A trail can widen to more than 0 and up to 10× the daily range; ${shown(atr)}× isn't.`;
      return null;
    }
    if (c.variable === "entry") {
      if (!(v > 0)) return `A move from our entry needs more than 0%; ${shown(v)}% isn't.`;
      const fast = num(s.fastWinnerPct);
      if (fast != null && !(fast > 0 && fast <= 500)) return `The big-winner switch can be more than 0% and up to 500%; ${shown(fast)}% isn't.`;
      const within = num(s.fastWinnerDays);
      if (fast != null && within != null && !wholeIn(within, 1, 365)) return `The big-winner switch counts 1 to 365 whole days; ${shown(within)} isn't.`;
      return null;
    }
    return v > 0 ? null : `A move needs more than 0%; ${shown(v)}% isn't.`;
  },
};
