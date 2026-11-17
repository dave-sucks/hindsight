/** Filing: an SEC filing, and insider buying. docs/plans/TRIGGER_TYPES.md §3.3. */


import type { MeasureDef } from "../measure";
import type { Condition } from "../types";
import { FILING_VARIABLES } from "../variables";
import { shown } from "../words";

function tierOf(v: string | undefined): "RED" | "MATERIAL" | undefined {
  return v === "tier:RED" ? "RED" : v === "tier:MATERIAL" ? "MATERIAL" : undefined;
}

export const filing: MeasureDef = {
  id: "filing",
  reads: ["filings"],
  type: "filing",
  label: "SEC filing",
  word: "Files",
  value: { none: true, placeholder: "Choose a filing" },
  variables: { mode: "replace", options: FILING_VARIABLES, title: "Choose a filing", required: "Choose a filing." },
  actions: ["REVIEW"],
  says: (_c, words) => `it files ${words}`,
  // One fire per filing (firedFilings), and filings cluster: no wait.
  cooldownDays: () => 0,
  fresh: () => ({ watch: "filing", variable: "tier:MATERIAL" }),
  fits: (c) => event(c.variable) != null,
  shape: "Choose a filing: a tier, an 8-K item or a form.",
  rule: (c) => eventProblem(c),
};

/** What a filing variable names: a tier, an 8-K item or a form. */
function event(v: string | undefined): { tier: string } | { item: string } | { form: string } | null {
  if (!v) return null;
  const t = tierOf(v);
  if (t) return { tier: t };
  if (v.startsWith("item:")) return { item: v.slice(5) };
  if (v.startsWith("form:")) return { form: v.slice(5) };
  return null;
}

/** What a filing names: an item code is 4–5 characters (2.01), a form 1–20. */
function eventProblem(c: Condition): string | null {
  const e = event(c.variable);
  if (e == null) return "Choose a filing: a tier, an 8-K item or a form.";
  if ("item" in e && (e.item.length < 4 || e.item.length > 5)) return `An 8-K item is written like 8.01; ${shown(e.item)} isn't.`;
  if ("form" in e && (e.form.length < 1 || e.form.length > 20)) return `A form name is 1 to 20 characters; ${shown(e.form)} isn't.`;
  return null;
}

export const insiders: MeasureDef = {
  id: "insiders",
  reads: ["snapshot"],
  type: "filing",
  label: "Insider buying",
  word: "At least",
  value: { suffix: "insiders buying", placeholder: "3", range: { what: "Insider buying", unit: " insiders", integer: true, min: 1, max: 10 } },
  settings: [
    {
      key: "days",
      label: "Look-back",
      default: 30,
      // The snapshot keeps 90 days of buys.
      range: { what: "Insider buying's look-back (days)", unit: " days", integer: true, min: 1, max: 90, why: "The snapshot keeps 90 days." },
      options: [
        { value: 30, label: "In the last 30 days" },
        { value: 90, label: "In the last 90 days" },
      ],
    },
  ],
  actions: ["REVIEW"],
  cooldownDays: () => 30,
  fresh: () => ({ watch: "insiders" }),
  fits: (c) => c.value != null,
  shape: "Insider buying takes a number: how many insiders.",
};
