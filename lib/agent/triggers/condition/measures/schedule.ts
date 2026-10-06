/** Schedule: every N days, and N days from a date. docs/plans/TRIGGER_TYPES.md §3.3. */


import type { MeasureDef } from "../measure";
import { DATE_VARIABLES, variableDef } from "../variables";
import { shown, wholeIn } from "../words";

export const repeat: MeasureDef = {
  id: "repeat",
  type: "schedule",
  label: "Repeat",
  word: "Every",
  value: { suffix: "days", placeholder: "30", integer: true, min: 1 },
  actions: ["REVIEW"],
  timed: true,
  clock: true,
  // The cadence is the interval.
  cooldownDays: (c) => c.value ?? 0,
  fresh: () => ({ watch: "repeat" }),
  fits: (c) => c.value != null,
  problem: (c) => (wholeIn(c.value, 1, 365) ? null : `A repeat runs every 1 to 365 whole days; ${shown(c.value)} isn't.`),
  // Counted from the last review.
};

export const fromDate: MeasureDef = {
  id: "from_date",
  type: "schedule",
  label: "From a date",
  buttons: [
    { is: "after", label: "After" },
    { is: "before", label: "Before" },
  ],
  value: { suffix: "days", placeholder: "60", integer: true, min: 1 },
  variables: { mode: "from", options: DATE_VARIABLES, title: "Counted from", word: () => "from", required: "Choose what to count from." },
  actions: ["TRIM", "EXIT", "REVIEW"],
  timed: true,
  says: (c) => `${c.value ?? 0} ${c.value === 1 ? "day" : "days"} ${c.is ?? "after"} ${c.variable ? variableDef(c.variable).words : "a date"}`,
  cooldownDays: (c) => c.value ?? 0,
  fresh: () => ({ watch: "from_date", is: "after", variable: "buy" }),
  // After the buy, or either side of the event date.
  fits: (c) =>
    c.value != null && (c.is === "after" || c.is === "before") && (c.variable === "event" || (c.variable === "buy" && c.is === "after")),
  problem: (c) => {
    if (!fromDate.fits(c)) return "A date count runs after the buy, or before or after the event date.";
    return wholeIn(c.value, 1, 365) ? null : `A date count runs 1 to 365 whole days; ${shown(c.value)} isn't.`;
  },
  check: (c) => (c.variable === "buy" && c.is === "before" ? "The buy is already in the past. Pick After." : null),
};
