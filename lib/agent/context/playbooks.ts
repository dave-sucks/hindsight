/**
 * The playbooks in full (lib/agent/knowledge/playbooks.ts): when each
 * applies, what confirms a buy, its watch triggers.
 * - playbooks: each of the analyst's. The Writer picks a stock's playbook
 *   from them as it writes (sent only its stock's own, it wrote worse: the
 *   bwxt refresh, 8 runs a side, PR 2's scores).
 * - the_playbook: the stock's own, the one a run deciding on it checks; a
 *   stock with none yet gets each of its analyst's.
 * - holding_triggers: the stock's playbook's triggers for a holding, by
 *   reference (H1, H2…), as edit_triggers takes them.
 */
import { playbookTriggerText, playbooksBlock } from "@/lib/agent/knowledge/playbooks";
import { getSetup, setupsForAnalyst } from "@/lib/agent/knowledge/setups";
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

/** The stock's playbook's holding triggers by reference: those that come with the buy, then those written at the fill. */
export const holdingTriggers: Fact = {
  thesis: async (run) => {
    const [a, t] = await Promise.all([analystOf(run, run.subject.analystId), thesisOf(run, run.subject.thesisId)]);
    if (!a || !t) return null;
    if (!t.setupId) return `$${t.ticker} has no playbook.`;
    const { loadPlaybook } = await import("@/lib/agent/knowledge/load-playbook");
    const templates = await loadPlaybook(a.accountId, t.setupId);
    return [`$${t.ticker}'s playbook: ${getSetup(t.setupId, a.setupOverrides)?.name ?? t.setupId}.`, ...playbookTriggerText(templates, "PROPOSAL"), ...playbookTriggerText(templates, "FILL")].join("\n");
  },
};

export const thePlaybook: Fact = {
  thesis: async (run) => {
    const [a, t] = await Promise.all([analystOf(run, run.subject.analystId), thesisOf(run, run.subject.thesisId)]);
    if (!a) return null;
    const own = t?.setupId ? setupsForAnalyst([t.setupId], a.setupOverrides) : [];
    return playbooksOf(a.accountId, own.length ? own : setupsForAnalyst(a.setupIds, a.setupOverrides));
  },
};
