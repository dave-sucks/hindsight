/**
 * setup-checklist.ts — the compact setup block a thesis row carries into
 * the daily run (DAV-253): what a held name's review checks, from the
 * setup it was bought on, instead of a horizon glossary.
 */

import { getSetup, type Horizon } from "./setups";
import type { SetupOverrides } from "./setup-overrides";
import { setupLines } from "@/lib/agent/analyst-brief";

export interface SetupChecklist {
  id: string;
  name: string;
  /** What must still be true for the setup to be working. */
  failureSigns: string[];
  /** The horizon's manage rule (the trail is the analyst's; this is the shape). */
  manage: string | null;
  /** The time limit, in words. */
  time: string;
  /** What the fill wrote onto the stock from this setup: a partial at this many R, the beat-that-sold review. */
  partialAtR: number | null;
  beatAndFadeReview: boolean;
  /** The lines a fire checks, for this horizon (setupLines' decision cut): a row's `setup_lines`. */
  lines: string[];
}

export function setupChecklist(
  setupId: string | null | undefined,
  horizon: string | null | undefined,
  overrides?: SetupOverrides,
): SetupChecklist | null {
  if (!setupId) return null;
  const s = getSetup(setupId, overrides);
  if (!s) return null;
  const h = (horizon ?? null) as Horizon | null;
  return {
    id: s.id,
    name: s.name,
    failureSigns: s.failureSigns,
    // A horizon with no line of its own gets none, never another horizon's.
    manage: h ? (s.trail[h] ?? null) : (Object.values(s.trail)[0] ?? null),
    time: s.time.text,
    partialAtR: s.manage.partialAtR,
    beatAndFadeReview: s.manage.beatAndFadeReview,
    lines: setupLines(s, h, "decision"),
  };
}
