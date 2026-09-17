"use server";

/**
 * The playbook's numbers as settings (DAV-273) — read and write an
 * account's per-setup overrides of the setup catalog. OWNER only; the
 * page renders read-only for everyone else.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { SETUPS, SETUP_IDS, type SetupId } from "@/lib/agent/knowledge/setups";
import {
  applySetupOverride,
  parseSetupOverrides,
  setupNumbers,
  setupOverrideSchema,
  type SetupOverride,
  type SetupOverrides,
} from "@/lib/agent/knowledge/setup-overrides";

export interface PlaybookSetupView {
  id: SetupId;
  code: string;
  name: string;
  summary: string;
  horizons: string[];
  entryText: string;
  stopText: string;
  targetText: string;
  timeText: string;
  /** The numbers in force (the catalog's, with this account's overrides applied). */
  numbers: Required<SetupOverride>;
  /** The catalog's own numbers, for "reset to the playbook". */
  defaults: Required<SetupOverride>;
  /** Which numbers this account changed. */
  overridden: Array<keyof SetupOverride>;
}

export interface PlaybookSettings {
  canEdit: boolean;
  setups: PlaybookSetupView[];
}

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const accountId = await getAccountId(user.id);
  if (!accountId) return null;
  const role = await getUserRole(user.id, accountId);
  return { user, accountId, role };
}

function view(overrides: SetupOverrides): PlaybookSetupView[] {
  return SETUPS.map((s) => {
    const o = overrides[s.id];
    const applied = applySetupOverride(s, o);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      summary: s.summary,
      horizons: s.horizons,
      entryText: s.entry.text,
      stopText: s.stop.text,
      targetText: s.target.text,
      timeText: s.time.text,
      numbers: setupNumbers(applied),
      defaults: setupNumbers(s),
      overridden: o ? (Object.keys(o) as Array<keyof SetupOverride>) : [],
    };
  });
}

export async function getPlaybookSettings(): Promise<PlaybookSettings> {
  const c = await caller();
  if (!c) return { canEdit: false, setups: view({}) };
  const row = await prisma.account.findUnique({ where: { id: c.accountId }, select: { setupOverrides: true } });
  const overrides = parseSetupOverrides(row?.setupOverrides);
  return { canEdit: c.role === "OWNER", setups: view(overrides) };
}

/**
 * Save one setup's numbers. Only the fields that differ from the catalog
 * are stored, so "reset" is the same call with the catalog's values.
 */
export async function savePlaybookSetup(input: { setupId: string; numbers: SetupOverride }): Promise<PlaybookSetupView> {
  const c = await caller();
  if (!c) throw new Error("Unauthorized");
  if (c.role !== "OWNER") throw new Error("Only the account owner can change the playbook");
  const setup = SETUPS.find((s) => s.id === input.setupId);
  if (!setup || !SETUP_IDS.includes(setup.id)) throw new Error(`Unknown setup ${input.setupId}`);
  const parsed = setupOverrideSchema.safeParse(input.numbers);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));

  const defaults = setupNumbers(setup);
  const diff: SetupOverride = {};
  for (const k of Object.keys(parsed.data) as Array<keyof SetupOverride>) {
    const v = parsed.data[k];
    if (v === undefined) continue;
    if (v !== defaults[k]) (diff as Record<string, unknown>)[k] = v;
  }

  const row = await prisma.account.findUnique({ where: { id: c.accountId }, select: { setupOverrides: true } });
  const current = parseSetupOverrides(row?.setupOverrides);
  const next: SetupOverrides = { ...current };
  if (Object.keys(diff).length) next[setup.id] = diff;
  else delete next[setup.id];
  await prisma.account.update({ where: { id: c.accountId }, data: { setupOverrides: next as object } });
  revalidatePath("/settings/playbook");
  return view(next).find((v) => v.id === setup.id)!;
}
