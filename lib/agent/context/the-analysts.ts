/**
 * the_analysts: each analyst's room at the portfolio level (its slots against
 * its limit, its largest trade and the most in one stock), for the chat
 * before it offers a buy. Pinned, the chat has its analyst instead.
 */
import type { Fact } from "./fact";

/** Each analyst's room under its heading. Null when there are none. */
export function analystsText(roomLines: string[]): string | null {
  return roomLines.length ? `## Each analyst's room (a buy for a FULL analyst is refused)\n${roomLines.map((l) => `  • ${l}`).join("\n")}` : null;
}

export const theAnalysts: Fact = {
  chat: async (run) => {
    if (run.subject.analystId) return null;
    const { analystRoomLines } = await import("@/lib/agent/analyst-scope");
    return analystsText(await analystRoomLines(run.subject.accountId, []).catch(() => []));
  },
};
