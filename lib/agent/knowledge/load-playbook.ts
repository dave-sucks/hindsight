/**
 * load-playbook.ts — one playbook's templates for an account (./playbooks).
 * Fails closed: a failed read is null, never the catalog's list, which would
 * write the playbook as it ships over the one the owner edited.
 */
import { prisma } from "@/lib/prisma";
import { playbookTemplates } from "./playbooks";
import type { Template } from "./playbook-templates";

export async function loadPlaybook(accountId: string | null | undefined, setupId: string): Promise<Template[] | null> {
  try {
    const row = accountId ? await prisma.account.findUnique({ where: { id: accountId }, select: { playbooks: true, playbooksSeededAt: true } }) : null;
    return playbookTemplates(row, setupId);
  } catch (err) {
    console.warn(`[loadPlaybook] ${accountId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
