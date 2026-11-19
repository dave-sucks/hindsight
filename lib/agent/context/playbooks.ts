/**
 * The playbooks in full (lib/agent/knowledge/playbooks.ts): when each
 * applies, what confirms a buy, its watch triggers.
 * - playbooks: each of the analyst's. The Writer picks a stock's playbook
 *   from them as it writes (sent only its stock's own, it wrote worse: the
 *   bwxt refresh, 8 runs a side, PR 2's scores).
 * - the_playbook: the stock's own, the one a run deciding on it checks; a
 *   stock with none yet gets each of its analyst's.
 */
import { playbooksBlock } from "@/lib/agent/knowledge/playbooks";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import type { ContextRun, Fact } from "./fact";
import { analystOf, thesisOf } from "./rows";

async function playbooksOf(accountId: string, setups: ReturnType<typeof setupsForAnalyst>): Promise<string | null> {
  const { loadPlaybooks } = await import("@/lib/agent/knowledge/load-playbook");
  return playbooksBlock(setups, await loadPlaybooks(accountId)) || null;
}

/** Each of the analyst's playbooks. */
async function analystPlaybooks(run: ContextRun, analystId: string): Promise<string | null> {
  const a = await analystOf(run, analystId);
  return a ? playbooksOf(a.accountId, setupsForAnalyst(a.setupIds, a.setupOverrides)) : null;
}

export const playbooks: Fact = {
  thesis: (run) => analystPlaybooks(run, run.subject.analystId),
  analyst: (run) => analystPlaybooks(run, run.subject.analystId),
};

export const thePlaybook: Fact = {
  thesis: async (run) => {
    const [a, t] = await Promise.all([analystOf(run, run.subject.analystId), thesisOf(run, run.subject.thesisId)]);
    if (!a) return null;
    const own = t?.setupId ? setupsForAnalyst([t.setupId], a.setupOverrides) : [];
    return playbooksOf(a.accountId, own.length ? own : setupsForAnalyst(a.setupIds, a.setupOverrides));
  },
};
