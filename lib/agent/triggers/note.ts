/**
 * A trigger's note. Code writes notes too: a template's, or the trigger in
 * words when the owner set one without typing anything. Those say nothing
 * about why, so a run is shown a trigger's note only when a person or an
 * analyst wrote it, and this file is the one place that decides. Pure.
 */

import { sentenceOf, type When } from "./condition";
import type { TriggerAction } from "./types";
import { templateNotes } from "./defaults";
import { levelNotes } from "./price-levels";
import { SEAT_RULE_NOTES } from "@/lib/agent/knowledge/seat-rules";

const YOU_SET_THIS = ". You set this.";
/** How the account rules' old default ended ("below 6% from the high since we bought — standing rule set by the principal."). */
const STANDING_RULE = " — standing rule set by the principal.";

/** The note on a trigger the owner set without one: the trigger in words. */
export function defaultNote(action: TriggerAction, predicate: When): string {
  return `${sentenceOf({ action, predicate })}${YOU_SET_THIS}`;
}

/** A note's words with its numbers taken out, so a template matches at whatever level it was written. */
const words = (note: string) => note.replace(/\d+(?:[.,]\d+)*/g, "#");

let templates: Set<string> | null = null;

/** The trigger's note when a person or an analyst wrote it; null when code did (a template, a default) or there is none. */
export function writtenNote(t: { rationale?: string | null; source?: string | null }): string | null {
  const note = t.rationale?.trim();
  if (!note || t.source === "DEFAULT") return null;
  if (note.endsWith(YOU_SET_THIS) || note.endsWith(STANDING_RULE)) return null;
  templates ??= new Set([...templateNotes(), ...levelNotes(), ...SEAT_RULE_NOTES].map(words));
  return templates.has(words(note)) ? null : note;
}
