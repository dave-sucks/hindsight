/**
 * refused_calls: the analyst's calls refused in the last 7 days that no run
 * has redone (lib/agent/refusal-carryover.ts). A refusal is an input, never
 * an ending: it is carried here until the same tool lands on the stock.
 */
import { blockedLastTimeSection } from "@/lib/agent/refusal-carryover";
import type { Fact } from "./fact";

export const refusedCalls: Fact = {
  analyst: async (run) => {
    const { listOpenRefusalsForAnalyst } = await import("@/lib/agent/gate-rejections");
    return blockedLastTimeSection(await listOpenRefusalsForAnalyst(run.subject.analystId, 7)) || null;
  },
};
