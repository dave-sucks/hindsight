/** Schedule: every N days, and N days from a date. docs/plans/TRIGGER_TYPES.md §3.3. */

import type { TriggerPredicate } from "../../types";
import type { MeasureDef } from "../measure";
import { DATE_VARIABLES } from "../variables";

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
  // Counted from the last review.
  legacy: {
    from: { REVIEW_CADENCE: (p) => ((p.from ?? "LAST_REVIEW") === "LAST_REVIEW" ? { watch: "repeat", value: p.days } : null) },
    to: (c): TriggerPredicate | null => (c.value != null ? { kind: "REVIEW_CADENCE", days: c.value } : null),
  },
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
  cooldownDays: (c) => c.value ?? 0,
  fresh: () => ({ watch: "from_date", is: "after", variable: "buy" }),
  check: (c) => (c.variable === "buy" && c.is === "before" ? "The buy is already in the past. Pick After." : null),
  legacy: {
    from: {
      REVIEW_CADENCE: (p) => {
        if (p.from === "BUY") return { watch: "from_date", is: "after", value: p.days, variable: "buy" };
        if (p.from === "EVENT") return { watch: "from_date", is: p.side === "BEFORE" ? "before" : "after", value: p.days, variable: "event" };
        return null;
      },
    },
    to: (c): TriggerPredicate | null => {
      if (c.value == null || (c.is !== "after" && c.is !== "before")) return null;
      if (c.variable === "buy") return c.is === "after" ? { kind: "REVIEW_CADENCE", days: c.value, from: "BUY" } : null;
      if (c.variable === "event") return { kind: "REVIEW_CADENCE", days: c.value, from: "EVENT", side: c.is === "before" ? "BEFORE" : "AFTER" };
      return null;
    },
  },
};
