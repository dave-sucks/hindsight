"use server";

/**
 * The playbook's numbers as settings (DAV-273) — read and write an
 * account's per-setup overrides of the setup catalog — and each playbook's
 * trigger templates, read-only until the editing form. OWNER only; the page
 * renders read-only for everyone else.
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
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import type { Template } from "@/lib/agent/knowledge/playbook-templates";

export interface PlaybookSetupView {
  id: SetupId;
  code: string;
  name: string;
  summary: string;
  horizons: string[];
  /** What confirms a buy on the day. */
  confirmation: string[];
  /** The triggers the playbook writes on a stock: this account's list, else the catalog's. */
  templates: Template[];
  /** The numbers in force (the catalog's, with this account's overrides applied). */
  numbers: Required<SetupOverride>;
  /** The catalog's own numbers, for "reset to the playbook". */
  defaults: Required<SetupOverride>;
  /** Which numbers this account changed. */
  overridden: Array<keyof SetupOverride>;
  /** What has to be true before the setup is even a candidate. */
  preconditions: string[];
  /** What says it failed. */
  failureSigns: string[];
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

type AccountPlaybooks = { playbooks: unknown; playbooksSeededAt: Date | null } | null;

function view(overrides: SetupOverrides, account: AccountPlaybooks): PlaybookSetupView[] {
  return SETUPS.map((s) => {
    const o = overrides[s.id];
    const applied = applySetupOverride(s, o);
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      summary: s.summary,
      horizons: s.horizons,
      confirmation: s.entry.confirmation,
      templates: playbookTemplates(account, s.id),
      preconditions: s.preconditions,
      failureSigns: s.failureSigns,
      numbers: setupNumbers(applied),
      defaults: setupNumbers(s),
      overridden: o ? (Object.keys(o) as Array<keyof SetupOverride>) : [],
    };
  });
}

export async function getPlaybookSettings(): Promise<PlaybookSettings> {
  const c = await caller();
  if (!c) return { canEdit: false, setups: view({}, null) };
  const row = await prisma.account.findUnique({ where: { id: c.accountId }, select: { setupOverrides: true, playbooks: true, playbooksSeededAt: true } });
  const overrides = parseSetupOverrides(row?.setupOverrides);
  return { canEdit: c.role === "OWNER", setups: view(overrides, row) };
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

  const row = await prisma.account.findUnique({ where: { id: c.accountId }, select: { setupOverrides: true, playbooks: true, playbooksSeededAt: true } });
  const current = parseSetupOverrides(row?.setupOverrides);
  const next: SetupOverrides = { ...current };
  if (Object.keys(diff).length) next[setup.id] = diff;
  else delete next[setup.id];
  await prisma.account.update({ where: { id: c.accountId }, data: { setupOverrides: next as object } });
  revalidatePath("/settings/playbook");
  return view(next, row).find((v) => v.id === setup.id)!;
}
