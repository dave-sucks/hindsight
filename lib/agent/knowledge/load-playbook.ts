/**
 * load-playbook.ts — an account's playbooks (./playbooks), one read.
 * Fails closed: a failed read is null, never the catalog's list, which would
 * write the playbook as it ships over the one the owner edited.
 */
import { prisma } from "@/lib/prisma";
import { playbookTemplates } from "./playbooks";
import type { Template } from "./playbook-templates";

/** Every playbook's templates for an account, by setup id; null when the account couldn't be read. */
export async function loadPlaybooks(accountId: string | null | undefined): Promise<((setupId: string) => Template[]) | null> {
  try {
    const row = accountId ? await prisma.account.findUnique({ where: { id: accountId }, select: { playbooks: true, playbooksSeededAt: true } }) : null;
    return (setupId) => playbookTemplates(row, setupId);
  } catch (err) {
    console.warn(`[loadPlaybook] ${accountId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function loadPlaybook(accountId: string | null | undefined, setupId: string): Promise<Template[] | null> {
  return (await loadPlaybooks(accountId))?.(setupId) ?? null;
}
