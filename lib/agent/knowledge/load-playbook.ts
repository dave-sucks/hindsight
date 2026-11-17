/**
 * load-playbook.ts — one playbook's templates for an account (./playbooks).
 * Fail-open: a failed read is the catalog's list.
 */
import { prisma } from "@/lib/prisma";
import { playbookTemplates } from "./playbooks";
import type { Template } from "./playbook-templates";

export async function loadPlaybook(accountId: string | null | undefined, setupId: string): Promise<Template[]> {
  try {
    const row = accountId ? await prisma.account.findUnique({ where: { id: accountId }, select: { playbooks: true, playbooksSeededAt: true } }) : null;
    return playbookTemplates(row, setupId);
  } catch (err) {
    console.warn(`[loadPlaybook] ${accountId}:`, err instanceof Error ? err.message : err);
    return playbookTemplates(null, setupId);
  }
}
