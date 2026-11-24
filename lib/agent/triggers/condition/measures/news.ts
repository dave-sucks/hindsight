/** News: a high note the Market Reviewer wrote on the stock. The 9:00 notes' weight decides how soon the analyst looks; only high starts a look. */

import type { MeasureDef } from "../measure";

export const note: MeasureDef = {
  id: "note",
  reads: ["notes"],
  type: "news",
  label: "News note",
  word: "On",
  value: { none: true, placeholder: "a high note from the Market Reviewer" },
  actions: ["REVIEW"],
  says: () => "the Market Reviewer writes a high note on it",
  fresh: () => ({ watch: "note" }),
  fits: () => true,
  shape: "A news note takes nothing more: it is the Market Reviewer's high note on the stock.",
};
