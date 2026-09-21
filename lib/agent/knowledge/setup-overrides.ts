/**
 * setup-overrides.ts — the playbook's numbers as settings (DAV-273).
 *
 * The setup catalog (setups.ts) ships the playbook's numbers as code:
 * the trade stop cap, the minimum ATR, the chase limit, the target's R
 * floor, the partial at N R, the beat-that-sold review, the time limit,
 * the risk multiplier. Dave's standing requirement is that the app is
 * customizable from a place he can see, so those numbers are also
 * settings: an account carries per-setup overrides, edited on
 * /settings/playbook, and every reader of the catalog applies them
 * through getSetup(id, overrides). The catalog is the default, never the
 * store; an empty override map is the playbook as written.
 *
 * Pure: the shape, the validation, and the merge. The loader is in
 * ./load-setup-overrides (prisma).
 */

import { z } from "zod";
import type { Setup, SetupId } from "./setups";

export const setupOverrideSchema = z
  .object({
    /** Widest the stop may be from entry, %, on a TRADE. Null = no cap. */
    stopMaxPct: z.number().positive().max(50).nullable().optional(),
    /** A stop closer than this many ATR is inside the noise. */
    minAtr: z.number().min(0).max(5).optional(),
    /** Do not buy more than this far past the level, %. Null = no chase rule. */
    chaseLimitPct: z.number().positive().max(25).nullable().optional(),
    /** The reward-to-risk floor the plan must clear. */
    targetMinR: z.number().min(1).max(10).optional(),
    /** The fill writes a partial sale at this many R. Null = none. */
    partialAtR: z.number().positive().max(10).nullable().optional(),
    /** The fill writes the beat-the-market-sold review. */
    beatAndFadeReview: z.boolean().optional(),
    /**
     * The fill writes a review this long after the buy. Null = none.
     *
     * The unit is the setup's own (`setup.time.unit`) — sessions for the
     * short breakout clocks, calendar days for the 60-day checkpoints — and
     * the settings screen says which beside the box. The stored key keeps
     * its old name so accounts that already set one are not orphaned.
     */
    timeTradingDays: z.number().int().positive().max(365).nullable().optional(),
    /** Multiplies the risk per trade (0.5 for a binary event). */
    riskMultiplier: z.number().positive().max(2).optional(),
  })
  .strict();

export type SetupOverride = z.infer<typeof setupOverrideSchema>;
export type SetupOverrides = Partial<Record<SetupId, SetupOverride>>;

export const setupOverridesSchema = z.record(z.string(), setupOverrideSchema);

/** Parse a stored map, dropping anything malformed rather than failing a read. */
export function parseSetupOverrides(raw: unknown): SetupOverrides {
  const parsed = setupOverridesSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data as SetupOverrides;
  const out: SetupOverrides = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const one = setupOverrideSchema.safeParse(v);
      if (one.success) out[k as SetupId] = one.data;
    }
  }
  return out;
}

/** The setup with an account's numbers laid over the playbook's. */
export function applySetupOverride(setup: Setup, o: SetupOverride | undefined): Setup {
  if (!o) return setup;
  return {
    ...setup,
    entry: { ...setup.entry, chaseLimitPct: o.chaseLimitPct !== undefined ? o.chaseLimitPct : setup.entry.chaseLimitPct },
    stop: {
      ...setup.stop,
      maxPct: o.stopMaxPct !== undefined ? o.stopMaxPct : setup.stop.maxPct,
      minAtr: o.minAtr ?? setup.stop.minAtr,
    },
    target: { ...setup.target, minR: o.targetMinR ?? setup.target.minR },
    manage: {
      partialAtR: o.partialAtR !== undefined ? o.partialAtR : setup.manage.partialAtR,
      beatAndFadeReview: o.beatAndFadeReview ?? setup.manage.beatAndFadeReview,
    },
    time: { ...setup.time, count: o.timeTradingDays !== undefined ? o.timeTradingDays : setup.time.count },
    riskMultiplier: o.riskMultiplier ?? setup.riskMultiplier,
  };
}

/** The numbers a setup exposes as settings, read back off a (possibly overridden) setup. */
export function setupNumbers(s: Setup): Required<SetupOverride> {
  return {
    stopMaxPct: s.stop.maxPct,
    minAtr: s.stop.minAtr,
    chaseLimitPct: s.entry.chaseLimitPct,
    targetMinR: s.target.minR,
    partialAtR: s.manage.partialAtR,
    beatAndFadeReview: s.manage.beatAndFadeReview,
    timeTradingDays: s.time.count,
    riskMultiplier: s.riskMultiplier,
  };
}
