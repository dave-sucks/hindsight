/**
 * setup-checklist.ts — the compact setup block a thesis row carries into
 * the daily run (DAV-253): what a held name's review checks, from the
 * setup it was bought on, instead of a horizon glossary.
 */

import { getSetup, isNamedSetup, setupsForSeat, NO_SETUP_FITS, type Horizon } from "./setups";
import type { SetupOverrides } from "./setup-overrides";

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
    manage: (h && s.trail[h]) ?? Object.values(s.trail)[0] ?? null,
    time: s.time.text,
    partialAtR: s.manage.partialAtR,
    beatAndFadeReview: s.manage.beatAndFadeReview,
  };
}

/** What a row with no setup carries instead: the ask, and the seat's choices. */
export interface NameTheSetup {
  ask: string;
  choose: { id: string; name: string; when: string }[];
}

/**
 * A held stock, or a watched one with a buy price, written before setups
 * were named (DAV-285: 29 of 32 on 2026-09-17). Everything setup-aware skips
 * it — the tactical run's confirmation, the exits a buy writes, the held
 * checklist, the scorecard — until a review names one. Null when the row has
 * a setup, when a review already said none fits, or when there is no plan
 * to name a setup for.
 */
export function nameTheSetup(
  row: { setupId: string | null | undefined; status: string | null; entryPrice: unknown },
  seatName: string | null | undefined,
  overrides?: SetupOverrides,
): NameTheSetup | null {
  if (isNamedSetup(row.setupId) || row.setupId === NO_SETUP_FITS) return null;
  const held = row.status === "HOLDING";
  if (!held && !(row.status === "WATCHING" && row.entryPrice != null)) return null;
  return {
    ask: held
      ? `This stock has no setup named. On this review, name the one it was bought on from the chart and the thesis: update_thesis(setup_id). That also writes the setup's own exits onto the stock. If none fits, setup_id "NONE" and say why in the rationale.`
      : `This plan has no setup named. On this review, name the one its buy price is written on: update_thesis(setup_id). If none fits, setup_id "NONE" and say why in the rationale.`,
    choose: setupsForSeat(seatName, overrides).map((s) => ({ id: s.id, name: s.name, when: s.summary })),
  };
}
