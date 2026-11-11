/**
 * Note: an urgent note names the stock. The account's standing rule
 * "Review if an urgent note names this stock" (lib/agent/triggers/seed-account.ts)
 * is this measure. It fires when the note is saved (lib/agent/triggers/urgent-note.ts),
 * never on the five-minute check, which reads it as false.
 */

import type { MeasureDef } from "../measure";

export const note: MeasureDef = {
  id: "note",
  type: "note",
  label: "Urgent note",
  word: "When",
  value: { none: true, placeholder: "an urgent note names it" },
  actions: ["REVIEW"],
  accountOnly: true,
  check: (_c, ctx) => (ctx.level === "ACCOUNT" ? null : "An urgent note's rule is an account rule: every stock inherits it, so it is never set on a stock or an analyst."),
  says: () => "an urgent note names this stock",
  // One fire per note, when it is saved.
  cooldownDays: () => 0,
  fresh: () => ({ watch: "note" }),
  fits: () => true,
  shape: "An urgent note takes nothing else: it fires when one names the stock.",
};
