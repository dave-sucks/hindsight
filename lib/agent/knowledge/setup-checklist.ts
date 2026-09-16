/**
 * setup-checklist.ts — the compact setup block a thesis row carries into
 * the daily run (DAV-253): what a held name's review checks, from the
 * setup it was bought on, instead of a horizon glossary.
 */

import { getSetup, type Horizon } from "./setups";

export interface SetupChecklist {
  id: string;
  name: string;
  /** What must still be true for the setup to be working. */
  failureSigns: string[];
  /** The horizon's manage rule (the trail is the analyst's; this is the shape). */
  manage: string | null;
  /** The time limit, in words. */
  time: string;
}

export function setupChecklist(setupId: string | null | undefined, horizon: string | null | undefined): SetupChecklist | null {
  if (!setupId) return null;
  const s = getSetup(setupId);
  if (!s) return null;
  const h = (horizon ?? null) as Horizon | null;
  return {
    id: s.id,
    name: s.name,
    failureSigns: s.failureSigns,
    manage: (h && s.trail[h]) ?? Object.values(s.trail)[0] ?? null,
    time: s.time.text,
  };
}
