/**
 * manager_writeup: the Portfolio Manager's write-up from this day in this
 * book, for the evening summary. Nothing on a day it didn't run: an older
 * write-up is not today's.
 */
import type { Fact } from "./fact";

export const managerWriteup: Fact = {
  account: async (run) => {
    // An account with no owner has no Portfolio Manager.
    if (!run.subject.accountId) return null;
    const { writeupOn } = await import("@/lib/agent/portfolio-manager/run");
    const text = await writeupOn(run.subject, run.now);
    return text ? `## The Portfolio Manager's write-up today\n${text}` : null;
  },
};
