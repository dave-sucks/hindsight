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

/**
 * The notes the deleted horizon templates and plan levels wrote (until
 * 2026-11-16). Rows still carry them; they read as code's, never an analyst's.
 */
const RETIRED_CODE_NOTES = [
  "Hard stop at $1. If we hit it the thesis is broken; close and write up the lessons.",
  "8% drop from entry — something material happened. Re-evaluate before deciding to ride it out or trim.",
  "Hard stop at $1.",
  "Target $1 hit. Decide: close at target or trail higher with confidence intact.",
  "Tight stop at $1. Trade-horizon — get out fast on invalidation.",
  "Target $1 hit. Trade plan executed; close.",
  "Entry trigger — price broke above $1. Validate setup and consider INITIATE.",
  "Short entry trigger — price broke below $1. Validate setup and consider INITIATE short.",
  "Price hit the entry level we dismissed. Re-evaluate the PASS — was the rejection wrong?",
  "Floor $1 — below this the setup is wrong, so the plan comes off rather than waiting to be bought.",
  "Target $1 reached before we bought — the move happened without us, so the entry is stale.",
  "Below $1 the setup is wrong, so the plan comes down instead of waiting to buy.",
  "Above $1 the setup is wrong, so the plan comes down instead of waiting to short.",
  "Target $1: when it gets there, I take it, trim, or raise the target.",
];

/** A note's words with its numbers taken out, so a template matches at whatever level it was written. */
const words = (note: string) => note.replace(/\d+(?:[.,]\d+)*/g, "#");

let templates: Set<string> | null = null;

/** The trigger's note when a person or an analyst wrote it; null when code did (a template, a default) or there is none. */
export function writtenNote(t: { rationale?: string | null; source?: string | null }): string | null {
  const note = t.rationale?.trim();
  if (!note || t.source === "DEFAULT") return null;
  if (note.endsWith(YOU_SET_THIS) || note.endsWith(STANDING_RULE)) return null;
  templates ??= new Set([...templateNotes(), ...levelNotes(), ...RETIRED_CODE_NOTES, ...SEAT_RULE_NOTES].map(words));
  return templates.has(words(note)) ? null : note;
}
