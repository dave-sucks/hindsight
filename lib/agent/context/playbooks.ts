/**
 * playbooks: playbooks in full (lib/agent/knowledge/playbooks.ts): when each
 * applies, what confirms a buy, its watch triggers. On a thesis, its own
 * playbook only; a stock with none yet (the Writer's first look) gets each
 * of its analyst's, to choose from. On an analyst, each of its playbooks.
 */
import { playbooksBlock } from "@/lib/agent/knowledge/playbooks";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import type { Fact } from "./fact";
import { analystOf, thesisOf } from "./rows";

async function playbooksOf(accountId: string, setups: ReturnType<typeof setupsForAnalyst>): Promise<string | null> {
  const { loadPlaybooks } = await import("@/lib/agent/knowledge/load-playbook");
  return playbooksBlock(setups, await loadPlaybooks(accountId)) || null;
}

export const playbooks: Fact = {
  thesis: async (run) => {
    const [a, t] = await Promise.all([analystOf(run, run.subject.analystId), thesisOf(run, run.subject.thesisId)]);
    if (!a) return null;
    const own = t?.setupId ? setupsForAnalyst([t.setupId], a.setupOverrides) : [];
    return playbooksOf(a.accountId, own.length ? own : setupsForAnalyst(a.setupIds, a.setupOverrides));
  },
  analyst: async (run) => {
    const a = await analystOf(run, run.subject.analystId);
    return a ? playbooksOf(a.accountId, setupsForAnalyst(a.setupIds, a.setupOverrides)) : null;
  },
};
