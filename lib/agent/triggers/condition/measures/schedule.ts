/** Schedule: every N days, and N days from a date. docs/plans/TRIGGER_TYPES.md §3.3. */

import type { TriggerPredicate } from "../../types";
import type { MeasureDef } from "../measure";
import type { Condition } from "../types";
import { DATE_VARIABLES, variableDef } from "../variables";
import { days } from "../words";

const every = (c: Condition) => ((c.value ?? 0) === 1 ? "every day" : `every ${c.value ?? 0} days`);

export const repeat: MeasureDef = {
  id: "repeat",
  type: "schedule",
  label: "Repeat",
  word: "Every",
  value: { suffix: "days", placeholder: "30", integer: true, min: 1 },
  actions: ["REVIEW"],
  timed: true,
  fresh: () => ({ watch: "repeat" }),
  // Counted from the last review.
  sentence: (c, { inGroup }) => (inGroup ? `a review is due (${every(c)})` : every(c)),
  pill: (c) => ({ label: "every", value: days(c.value ?? 0) }),
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
  fresh: () => ({ watch: "from_date", is: "after", variable: "buy" }),
  sentence: (c, { inGroup }) => {
    const n = c.value ?? 0;
    const date = c.variable ? variableDef(c.variable).words : "the date";
    if (c.is === "before") return inGroup ? `${date} is ${days(n)} away or less` : `${days(n)} before ${date}`;
    return inGroup ? `it has been ${days(n)} since ${date}` : `${days(n)} after ${date}`;
  },
  pill: (c) => ({ label: `${days(c.value ?? 0)} ${c.is === "before" ? "before" : "after"}`, chip: c.variable ? variableDef(c.variable).chip : undefined }),
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
