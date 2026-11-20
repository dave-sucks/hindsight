/**
 * The generated reference docs (docs/guide/reference/), built from the code
 * so they can't drift from it: the trigger measures from MEASURES, the
 * setups from SETUPS. guide.test.ts fails when a file is out of date;
 * regenerate with `UPDATE_GUIDE=1 npx jest lib/docs/guide`.
 */

import { DIALOG_ACTIONS, TRIGGER_TYPES, directionWords, sentenceOf, type Condition, type MeasureDef } from "@/lib/agent/triggers/condition";
import { rangeWords, valueRange } from "@/lib/agent/triggers/condition/range";
import type { Trigger, TriggerAction } from "@/lib/agent/triggers/types";
import { SETUPS, type Setup } from "@/lib/agent/knowledge/setups";
import { TRIGGER_TYPE_DOCS } from "./trigger-examples";

const ACTION_WORD: Record<TriggerAction, string> = { ENTER: "buy", ADD: "add", TRIM: "trim", EXIT: "sell", STOP_WATCHING: "stop watching", REVIEW: "review" };

const days = (n: number) => (n === 0 ? "none" : n === 1 ? "1 day" : `${n} days`);

function measureSection(m: MeasureDef): string[] {
  const fresh = m.fresh() as Condition;
  const actions = m.actions ?? DIALOG_ACTIONS;
  const range = valueRange(fresh);
  const facts: string[] = [
    `\`watch: "${m.id}"\``,
    m.buttons ? `is: ${m.buttons.map((b) => `\`${b.is}\``).join(" / ")}` : null,
    m.value.none ? "no number" : range ? `value: ${rangeWords(range)}` : `value: ${[m.value.prefix, m.value.suffix].filter(Boolean).join(" … ") || "a number"}`,
    `actions: ${actions.map((a) => ACTION_WORD[a]).join(", ")}`,
    m.reads?.length ? `reads: ${m.reads.join(", ")}` : m.timed ? null : "reads: the live quote",
    m.timed ? "a clock, stands alone" : null,
  ].filter((x): x is string => x != null);

  const out = [`### ${m.label.replace(/^[^A-Za-z]+/, "")}`, "", facts.join(" · "), ""];
  // What each direction fires on: the words the agents' tools describe `is` with.
  const means = directionWords(m);
  if (means) out.push(`\`is\`: ${means}`, "");

  if (m.variables) {
    const how = m.variables.mode === "replace" ? "stands in for the number" : "the number is measured from it";
    out.push(`**Variables** (${how}):`, "");
    for (const v of m.variables.options) out.push(`- \`${v.id}\`: ${v.label}${v.position ? " (only once we own the stock)" : ""}`);
    out.push("");
  }
  const settings = m.settings ?? [];
  if (settings.length) {
    out.push("**Settings:**", "");
    for (const s of settings) {
      const bits = [s.label, s.range ? rangeWords(s.range) : null, s.default != null ? `default ${String(s.default)}` : null].filter(Boolean);
      out.push(`- \`${s.key}\`${bits.length ? `: ${bits.join(", ")}` : ""}`);
    }
    out.push("");
  }

  const examples = TRIGGER_TYPE_DOCS.flatMap((t) => t.examples).filter((e) => !("match" in e.when) && e.when.watch === m.id);
  if (examples.length) {
    out.push("**Examples:**", "");
    for (const e of examples) out.push(`- "${sentenceOf({ action: e.action, predicate: e.when })}". ${e.why}`, "", "  ```json", `  ${JSON.stringify({ action: e.action, predicate: e.when })}`, "  ```", "");
  }
  return out;
}

export function triggerMeasuresMarkdown(): string {
  const out: string[] = [
    "# Trigger measures",
    "",
    "**Every condition a trigger can watch, with the shape it's saved in.** The twelve measures, grouped by the five types of the Add trigger menu.",
    "",
    "This file is built from `MEASURES` in `lib/agent/triggers/condition/catalog.ts` and the examples in `lib/docs/trigger-examples.ts`; don't edit it by hand. What a trigger is and when one fires is [Triggers](../concepts/triggers.md).",
    "",
    "## The shape",
    "",
    "A trigger is an action and a condition. A condition is one shape everywhere (the form, the save, the agents' tools): `{ watch, is?, value?, variable?, settings? }`, or `{ match: \"all\", conditions: [...] }` for two or more that must all hold. Either of two is two triggers. `watch` names the measure below; the rest are that measure's own fields. Anything else in a trigger list reads as a removed condition.",
    "",
    "Actions are `ENTER` (buy), `ADD`, `TRIM`, `EXIT` (sell) and `REVIEW`. Every trigger reads as one sentence, from `describe.ts`.",
    "",
  ];
  for (const t of TRIGGER_TYPES) {
    const doc = TRIGGER_TYPE_DOCS.find((d) => d.type === t.id);
    out.push(`## ${t.label}`, "");
    if (doc) out.push(`${doc.blurb} ${doc.checked}`, "");
    for (const m of t.measures) out.push(...measureSection(m));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function setupSection(s: Setup): string[] {
  const out = [
    `## ${s.name}`,
    "",
    [`\`${s.id}\``, `playbook ${s.code}`, s.role === "ENTRY" ? "a buy pattern" : "a screen", `horizons: ${s.horizons.map((h) => h.toLowerCase()).join(", ")}`, s.riskMultiplier !== 1 ? `risk × ${s.riskMultiplier}` : null]
      .filter(Boolean)
      .join(" · "),
    "",
    s.summary,
    "",
  ];
  if (s.preconditions.length) out.push("**Before it applies:**", "", ...s.preconditions.map((p) => `- ${p}`), "");
  if (s.entry.entryVia?.length) out.push(`Entered through ${s.entry.entryVia.map((id) => `\`${id}\``).join(", ")}.`, "");
  if (s.entry.confirmation.length) out.push("**A buy is confirmed by:**", "", ...s.entry.confirmation.map((c) => `- ${c}`), "");
  for (const [on, label] of [["WATCH", "on a watch"], ["PROPOSAL", "with the buy"], ["FILL", "at the fill"]] as const) {
    const lines = s.triggers.filter((t) => t.writtenOn === on);
    if (lines.length) out.push(`**Triggers ${label}:**`, "", ...lines.map((t) => `- ${sentenceOf(t as unknown as Trigger)}. ${t.rationale}`), "");
  }
  if (s.failureSigns.length) out.push("**When it's failing:**", "", ...s.failureSigns.map((f) => `- ${f}`), "");
  return out;
}

export function setupsMarkdown(): string {
  const out: string[] = [
    "# Playbooks",
    "",
    `**Every playbook, with its rules.** The ${SETUPS.length} kinds of trade an analyst can take: what must be true first, the triggers each writes, and when it has failed.`,
    "",
    "This file is built from `SETUPS` in `lib/agent/knowledge/setups.ts`; don't edit it by hand. These are the defaults: an account sees each playbook's triggers in Settings → Playbook (`lib/agent/knowledge/playbooks.ts`; the seed is `playbook-templates.ts`), and can change its sell distance numbers there (`setup-overrides.ts`). A `{name}` in a trigger is a chart price the run fills when it writes the trigger. How an analyst picks its playbooks is [Analysts](../concepts/analysts.md); how the Writer uses one is [the Writer](../agents/writer.md).",
    "",
    "A buy pattern carries its own buy condition. A screen only finds stocks; its buy comes from one of the buy patterns it names.",
    "",
  ];
  for (const s of SETUPS) out.push(...setupSection(s));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
