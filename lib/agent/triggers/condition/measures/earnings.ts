/** Earnings: before or after the report date, and the result. docs/plans/TRIGGER_TYPES.md §3.3. */


import type { MeasureDef } from "../measure";

export const report: MeasureDef = {
  id: "report",
  reads: ["earnings"],
  type: "earnings",
  label: "Report date",
  buttons: [
    { is: "before", label: "Before earnings" },
    { is: "after", label: "After earnings" },
  ],
  // The calendar looks 14 days ahead and 5 back; the report day is 0.
  value: {
    suffix: "days",
    placeholder: "3",
    range: { what: "Days around earnings", unit: " days", integer: true, min: 0, max: 14 },
    ranges: [
      { is: "before", range: { what: "Before earnings", unit: " days", integer: true, min: 1, max: 14, why: "The calendar looks 14 days ahead; for the report day itself, use after, from day 0." } },
      { is: "after", range: { what: "After earnings", unit: " days", integer: true, min: 0, max: 5, why: "The calendar looks 5 days back." } },
    ],
  },
  actions: ["REVIEW"],
  says: (c) => {
    const n = c.value ?? 0;
    if (n === 0) return "on the day of earnings";
    return `within ${n} ${n === 1 ? "day" : "days"} ${c.is === "after" ? "after" : "before"} earnings`;
  },
  // True every day of the window, so the cooldown is what makes it fire once; 30 clears any window and is short of a quarter.
  cooldownDays: () => 30,
  fresh: () => ({ watch: "report", is: "before" }),
  fits: (c) => c.value != null && (c.is === "before" || c.is === "after"),
  shape: "Earnings is before or after the report, a number of days.",
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
  value: { suffix: "% or more", placeholder: "0", range: { what: "A surprise", unit: "%", min: 0 }, zero: "any amount" },
  actions: ["REVIEW"],
  cooldownDays: () => 7,
  fresh: () => ({ watch: "surprise", is: "beat", value: 0 }),
  fits: (c) => c.is === "beat" || c.is === "miss",
  shape: "A result is a beat or a miss.",
};
