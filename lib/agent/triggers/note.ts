/**
 * A trigger's note. One the owner set without typing a note gets a default:
 * the trigger in words. That restates the condition and says nothing about
 * why, so a run is shown a trigger's note only when someone wrote one. Pure.
 */

import { conditionSentence, sentenceOf, type When } from "./condition";
import type { TriggerAction } from "./types";

/** The note on a trigger the owner set without one: the trigger in words. */
export function defaultNote(action: TriggerAction, predicate: When): string {
  return `${sentenceOf({ action, predicate })}. You set this.`;
}

/** The trigger's note when someone wrote it; null when it is a default (this one, or the account rules' old one). */
export function writtenNote(t: { action: TriggerAction; predicate: unknown; rationale?: string | null }): string | null {
  const note = t.rationale?.trim();
  if (!note) return null;
  const predicate = t.predicate as When;
  if (note === defaultNote(t.action, predicate)) return null;
  if (note === `${conditionSentence(predicate)} — standing rule set by the principal.`) return null;
  return note;
}
