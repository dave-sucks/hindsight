/** Filing: an SEC filing, and insider buying. docs/plans/TRIGGER_TYPES.md §3.3. */


import type { MeasureDef } from "../measure";
import type { Condition, FilingVariable } from "../types";
import { FILING_VARIABLES } from "../variables";
import { num, wholeIn } from "../words";

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
  // One fire per filing (firedFilings), and filings cluster: no cooldown.
  cooldownDays: () => 0,
  // A rule naming a tier is the tier rule, whatever else it names, so it
  // overrides the tier rule above it. One naming only events adds to it.
  groupSlot: (cs) => cs.find((c) => tierOf(c.variable)),
  fresh: () => ({ watch: "filing", variable: "tier:MATERIAL" }),
  fits: (c) => event(c.variable) != null,
  valid: (c) => eventsValid([c]),
  // Several events are one rule when they name at most one tier; then the
  // rule holds at most 20 items and 10 forms.
  validAny: (cs) => (cs.length > 1 && cs.every((c) => event(c.variable)) && cs.filter((c) => tierOf(c.variable)).length <= 1 ? eventsValid(cs) : undefined),
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

/** The events of one rule: an item code is 4–5 characters (2.01), a form 1–20; at most 20 items and 10 forms. */
function eventsValid(cs: readonly Condition[]): boolean {
  const named = cs.map((c) => event(c.variable));
  if (named.some((e) => e == null)) return false;
  const items = named.flatMap((e) => (e && "item" in e ? [e.item] : []));
  const forms = named.flatMap((e) => (e && "form" in e ? [e.form] : []));
  return items.length <= 20 && forms.length <= 10 && items.every((i) => i.length >= 4 && i.length <= 5) && forms.every((f) => f.length >= 1 && f.length <= 20);
}

export const insiders: MeasureDef = {
  id: "insiders",
  reads: ["snapshot"],
  type: "filing",
  label: "Insider buying",
  word: "At least",
  value: { suffix: "insiders buying", placeholder: "3", integer: true, min: 1 },
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
  cooldownDays: () => 30,
  fresh: () => ({ watch: "insiders" }),
  fits: (c) => c.value != null,
  // The snapshot keeps 90 days of buys.
  valid: (c) => wholeIn(c.value, 1, 10) && wholeIn(num(c.settings?.days) ?? 30, 1, 90),
};
