/** Earnings: before or after the report date, and the result. docs/plans/TRIGGER_TYPES.md §3.3. */

import type { TriggerPredicate } from "../../types";
import { withSettings, type MeasureDef } from "../measure";
import { days, num, pct } from "../words";

export const report: MeasureDef = {
  id: "report",
  type: "earnings",
  label: "Report date",
  buttons: [
    { is: "before", label: "Before" },
    { is: "after", label: "After" },
  ],
  value: { suffix: "days", placeholder: "3", integer: true, min: 0 },
  settings: [{ key: "fromDay", default: 0, words: (v) => (v === 1 ? ", counting from the day after" : "") }],
  actions: ["REVIEW"],
  fresh: () => ({ watch: "report", is: "before" }),
  sentence: (c) =>
    c.is === "before" ? `earnings are ${days(c.value ?? 0)} away or less` : `it is within ${days(c.value ?? 0)} after earnings`,
  pill: (c) => ({ label: c.is === "before" ? "before earnings" : "after earnings", value: days(c.value ?? 0) }),
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
    { is: "miss", label: "Miss" },
    { is: "beat", label: "Beat" },
  ],
  value: { suffix: "% vs. the estimate", placeholder: "0", min: 0 },
  actions: ["REVIEW"],
  fresh: () => ({ watch: "surprise", is: "beat", value: 0 }),
  sentence: (c) => {
    const v = c.value ?? 0;
    return `earnings ${c.is === "beat" ? "beat" : "miss"} the estimate${v > 0 ? ` by ${pct(v)} or more` : ""}`;
  },
  pill: (c) => {
    const v = c.value ?? 0;
    return { label: `earnings ${c.is === "beat" ? "beat" : "miss"}`, value: v > 0 ? `${pct(v)}+` : undefined };
  },
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
