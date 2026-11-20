/**
 * the_cases: what each held or watched stock's thesis rests on, its
 * assumptions and what would prove it wrong (lib/agent/book.ts), so news is
 * read against the thesis and not against one sentence of it.
 */
import type { Fact } from "./fact";

export const theCases: Fact = {
  account: async (run) => {
    const { loadCases } = await import("@/lib/agent/book");
    return (await loadCases(run.subject)) ?? "## What each thesis rests on\nIt couldn't be read this run.";
  },
};
