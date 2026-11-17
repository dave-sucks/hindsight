/**
 * setup-overrides.ts — the playbook's sell-distance numbers as settings
 * (DAV-273). An account carries per-setup overrides of the widest sale and
 * the closest one (in ATR), and every reader of the catalog applies them
 * through getSetup(id, overrides). The chase limit, the partial, the time
 * limit and the beat-and-fade review are trigger templates now
 * (./playbooks). An empty override map is the playbook as written.
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
    sale: {
      maxPct: o.stopMaxPct !== undefined ? o.stopMaxPct : setup.sale.maxPct,
      minAtr: o.minAtr ?? setup.sale.minAtr,
    },
  };
}

/** The numbers a setup exposes as settings, read back off a (possibly overridden) setup. */
export function setupNumbers(s: Setup): Required<SetupOverride> {
  return { stopMaxPct: s.sale.maxPct, minAtr: s.sale.minAtr };
}
