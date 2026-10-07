/** Schedule: every N days, and N days from a date. docs/plans/TRIGGER_TYPES.md §3.3. */


import type { MeasureDef } from "../measure";
import { DATE_VARIABLES, variableDef } from "../variables";

export const repeat: MeasureDef = {
  id: "repeat",
  type: "schedule",
  label: "Repeat",
  word: "Every",
  value: { suffix: "days", placeholder: "30", range: { what: "A repeat", unit: " days", integer: true, min: 1, max: 365 } },
  actions: ["REVIEW"],
  timed: true,
  clock: true,
  // The cadence is the interval.
  cooldownDays: (c) => c.value ?? 0,
  fresh: () => ({ watch: "repeat" }),
  fits: (c) => c.value != null,
  shape: "A repeat takes a number of days.",
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
  value: { suffix: "days", placeholder: "60", range: { what: "A date count", unit: " days", integer: true, min: 1, max: 365 } },
  variables: { mode: "from", options: DATE_VARIABLES, title: "Counted from", word: () => "from", required: "Choose what to count from." },
  actions: ["TRIM", "EXIT", "REVIEW"],
  timed: true,
  says: (c) => `${c.value ?? 0} ${c.value === 1 ? "day" : "days"} ${c.is ?? "after"} ${c.variable ? variableDef(c.variable).words : "a date"}`,
  cooldownDays: (c) => c.value ?? 0,
  fresh: () => ({ watch: "from_date", is: "after", variable: "buy" }),
  // After the buy, or either side of the event date.
  fits: (c) =>
    c.value != null && (c.is === "after" || c.is === "before") && (c.variable === "event" || (c.variable === "buy" && c.is === "after")),
  shape: "A date count runs after the buy, or before or after the event date.",
  check: (c) => (c.variable === "buy" && c.is === "before" ? "The buy is already in the past. Pick After." : null),
};
