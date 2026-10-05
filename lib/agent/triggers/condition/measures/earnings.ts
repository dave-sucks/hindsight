/** Earnings: before or after the report date, and the result. docs/plans/TRIGGER_TYPES.md §3.3. */

import type { TriggerPredicate } from "../../types";
import { withSettings, type MeasureDef } from "../measure";
import { num } from "../words";

export const report: MeasureDef = {
  id: "report",
  type: "earnings",
  label: "Report date",
  buttons: [
    { is: "before", label: "Before earnings" },
    { is: "after", label: "After earnings" },
  ],
  value: { suffix: "days", placeholder: "3", integer: true, min: 0 },
  settings: [{ key: "fromDay", default: 0, words: (v) => (v === 1 ? ", counting from the day after" : "") }],
  actions: ["REVIEW"],
  fresh: () => ({ watch: "report", is: "before" }),
  check: (c) => (c.is === "before" && (c.value ?? 0) > 14 ? "The earnings calendar looks 14 days ahead." : null),
  legacy: {
    from: {
      EARNINGS_WITHIN: (p) => ({ watch: "report", is: "before", value: p.days }),
      EARNINGS_SINCE: (p) => withSettings({ watch: "report", is: "after", value: p.max }, { fromDay: p.min }),
    },
    to: (c): TriggerPredicate | null => {
      if (c.value == null) return null;
      if (c.is === "before") return { kind: "EARNINGS_WITHIN", days: c.value };
      if (c.is === "after") return { kind: "EARNINGS_SINCE", min: num(c.settings?.fromDay) ?? 0, max: c.value };
      return null;
    },
  },
};

export const surprise: MeasureDef = {
  id: "surprise",
  type: "earnings",
  label: "Result",
  buttons: [
    { is: "miss", label: "Earnings miss" },
    { is: "beat", label: "Earnings beat" },
  ],
  value: { suffix: "% or more", placeholder: "0", min: 0, zero: "any amount" },
  actions: ["REVIEW"],
  fresh: () => ({ watch: "surprise", is: "beat", value: 0 }),
  legacy: {
    // A negative minimum is ignored by today's checker (any beat or miss
    // fires), so it reads as 0. Two retired rows carry one.
    from: {
      EARNINGS_BEAT: (p) => ({ watch: "surprise", is: "beat", value: Math.max(0, p.minSurprisePct ?? 0) }),
      EARNINGS_MISS: (p) => ({ watch: "surprise", is: "miss", value: Math.max(0, p.minSurprisePct ?? 0) }),
    },
    to: (c): TriggerPredicate | null => {
      if (c.is !== "beat" && c.is !== "miss") return null;
      const v = c.value ?? 0;
      return { kind: c.is === "beat" ? "EARNINGS_BEAT" : "EARNINGS_MISS", ...(v > 0 ? { minSurprisePct: v } : {}) };
    },
  },
};
