/**
 * load-setup-overrides.ts — an account's playbook numbers (DAV-273).
 * Fail-open: a failed read is the catalog as written.
 */
import { prisma } from "@/lib/prisma";
import { parseSetupOverrides, type SetupOverrides } from "./setup-overrides";

export async function loadSetupOverrides(accountId: string | null | undefined): Promise<SetupOverrides> {
  if (!accountId) return {};
  try {
    const row = await prisma.account.findUnique({ where: { id: accountId }, select: { setupOverrides: true } });
    return parseSetupOverrides(row?.setupOverrides);
  } catch (err) {
    console.warn(`[loadSetupOverrides] ${accountId}:`, err instanceof Error ? err.message : err);
    return {};
  }
}
