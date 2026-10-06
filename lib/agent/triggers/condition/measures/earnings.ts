/** Earnings: before or after the report date, and the result. docs/plans/TRIGGER_TYPES.md §3.3. */


import { withSettings, type MeasureDef } from "../measure";
import { isNum, num, wholeIn } from "../words";

export const report: MeasureDef = {
  id: "report",
  reads: ["earnings"],
  type: "earnings",
  label: "Report date",
  buttons: [
    { is: "before", label: "Before earnings" },
    { is: "after", label: "After earnings" },
  ],
  value: { suffix: "days", placeholder: "3", integer: true, min: 0 },
  settings: [{ key: "fromDay", default: 0, words: (v) => (v === 1 ? ", counting from the day after" : "") }],
  actions: ["REVIEW"],
  says: (c) => {
    const n = c.value ?? 0;
    const from = num(c.settings?.fromDay) ?? 0;
    if (n === 0) return "on the day of earnings";
    if (c.is === "after" && from > 0) return `${from}–${n} days after earnings`;
    return `within ${n} ${n === 1 ? "day" : "days"} ${c.is === "after" ? "after" : "before"} earnings`;
  },
  // True every day of the window, so the cooldown is what makes it fire once; 30 clears any window and is short of a quarter.
  cooldownDays: () => 30,
  fresh: () => ({ watch: "report", is: "before" }),
  fits: (c) => c.value != null && (c.is === "before" || c.is === "after"),
  // The calendar looks 14 days ahead and 5 back; the report day is 0.
  valid: (c) => {
    if (!report.fits(c)) return false;
    if (c.is === "before") return wholeIn(c.value, 1, 14);
    const from = num(c.settings?.fromDay) ?? 0;
    return wholeIn(from, 0, 5) && wholeIn(c.value, 0, 5) && from <= (c.value as number);
  },
  check: (c) => (c.is === "before" && (c.value ?? 0) > 14 ? "The earnings calendar looks 14 days ahead." : null),
};

export const surprise: MeasureDef = {
  id: "surprise",
  reads: ["earnings"],
  type: "earnings",
  label: "Result",
  buttons: [
    { is: "miss", label: "Earnings miss" },
    { is: "beat", label: "Earnings beat" },
  ],
  value: { suffix: "% or more", placeholder: "0", min: 0, zero: "any amount" },
  actions: ["REVIEW"],
  cooldownDays: () => 7,
  fresh: () => ({ watch: "surprise", is: "beat", value: 0 }),
  fits: (c) => c.is === "beat" || c.is === "miss",
  valid: (c) => surprise.fits(c) && (c.value == null || isNum(c.value)),
};
