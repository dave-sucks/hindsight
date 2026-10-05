/** Filing: an SEC filing, and insider buying. docs/plans/TRIGGER_TYPES.md §3.3. */

import type { TriggerPredicate } from "../../types";
import type { MeasureDef } from "../measure";
import type { Condition, FilingVariable } from "../types";
import { FILING_VARIABLES, variableDef } from "../variables";
import { num } from "../words";

function tierOf(v: string | undefined): "RED" | "MATERIAL" | undefined {
  return v === "tier:RED" ? "RED" : v === "tier:MATERIAL" ? "MATERIAL" : undefined;
}

export const filing: MeasureDef = {
  id: "filing",
  type: "filing",
  label: "SEC filing",
  word: "Files",
  value: { none: true, placeholder: "Choose a filing" },
  variables: { mode: "replace", options: FILING_VARIABLES, title: "Choose a filing", required: "Choose a filing." },
  actions: ["REVIEW"],
  fresh: () => ({ watch: "filing", variable: "tier:MATERIAL" }),
  sentence: (c) => `the company files ${c.variable ? variableDef(c.variable).words : "something with the SEC"}`,
  pill: (c) => {
    const tier = tierOf(c.variable);
    if (tier) return { label: "SEC filing", value: tier === "RED" ? "red flag" : "material" };
    return { label: "SEC filing", chip: c.variable ? variableDef(c.variable).chip : undefined };
  },
  legacy: {
    from: {
      SEC_EVENT: (p) => {
        const events: FilingVariable[] = [
          ...(p.tier ? [`tier:${p.tier}` as const] : []),
          ...(p.items ?? []).map((i) => `item:${i}` as const),
          ...(p.forms ?? []).map((f) => `form:${f}` as const),
        ];
        if (events.length <= 1) return { watch: "filing", ...(events[0] ? { variable: events[0] } : {}) };
        // A rule naming several events (the Catalyst seat's 8.01 + 7.01 wake) is
        // "any of" one-event conditions; foldAny writes it back as one kind.
        return { match: "any", conditions: events.map((variable): Condition => ({ watch: "filing", variable })) };
      },
    },
    to: (c): TriggerPredicate | null => fold([c]),
    foldAny: (cs) => (cs.length > 1 ? fold(cs) : null),
  },
};

/** One SEC_EVENT naming every event in `cs` (at most one tier). */
function fold(cs: Condition[]): TriggerPredicate | null {
  let tier: "RED" | "MATERIAL" | undefined;
  const items: string[] = [];
  const forms: string[] = [];
  for (const c of cs) {
    const v = c.variable;
    if (!v) return null;
    const t = tierOf(v);
    if (t) {
      if (tier) return null;
      tier = t;
    } else if (v.startsWith("item:")) items.push(v.slice(5));
    else if (v.startsWith("form:")) forms.push(v.slice(5));
    else return null;
  }
  return { kind: "SEC_EVENT", ...(tier ? { tier } : {}), ...(items.length ? { items } : {}), ...(forms.length ? { forms } : {}) };
}

export const insiders: MeasureDef = {
  id: "insiders",
  type: "filing",
  label: "Insider buying",
  word: "At least",
  value: { suffix: "insiders", placeholder: "3", integer: true, min: 1 },
  settings: [
    {
      key: "days",
      label: "Look-back",
      default: 30,
      options: [
        { value: 30, label: "In the last 30 days" },
        { value: 90, label: "In the last 90 days" },
      ],
    },
  ],
  actions: ["REVIEW"],
  fresh: () => ({ watch: "insiders" }),
  sentence: (c) => `${c.value ?? 0} or more insiders buy within ${num(c.settings?.days) ?? 30} days`,
  pill: (c) => ({ label: "insiders buying", value: `${c.value ?? 0}+ in ${num(c.settings?.days) ?? 30}d` }),
  legacy: {
    from: { INSIDER_CLUSTER: (p) => ({ watch: "insiders", value: p.minBuyers, settings: { days: p.days } }) },
    to: (c): TriggerPredicate | null => (c.value != null ? { kind: "INSIDER_CLUSTER", minBuyers: c.value, days: num(c.settings?.days) ?? 30 } : null),
  },
};
