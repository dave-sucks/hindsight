/**
 * playbook_record: the analyst's closed trades, a line per playbook
 * (lib/performance/load-setup-scorecard.ts).
 */
import type { Fact } from "./fact";

/** The record by playbook under its heading. Null when there is none. */
export function setupRecordText(lines: string[] | undefined): string | null {
  return lines?.length ? `## Your record by playbook (closed trades since 2026-05-27)\n${lines.map((l) => `- ${l}`).join("\n")}` : null;
}

export const playbookRecord: Fact = {
  thesis: async (run) => {
    const { loadScorecardLines } = await import("@/lib/performance/load-setup-scorecard");
    const { accountId, analystId, environment } = run.subject;
    return setupRecordText(await loadScorecardLines({ accountId, analystId, environment }));
  },
};
