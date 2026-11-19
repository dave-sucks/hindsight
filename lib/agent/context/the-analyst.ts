/**
 * the_analyst: the analyst a run works for (lib/agent/analyst-brief.ts), with
 * its room (its slots, counted as place_trade counts them) wherever a buy is
 * one of the run's choices. Pinned, the chat's first line names the analyst
 * and its id.
 */
import { analystBrief } from "@/lib/agent/analyst-brief";
import { pinnedAnalystText } from "@/lib/agent/system-prompts/chat";
import type { Fact } from "./fact";
import { analystOf, roomOf } from "./rows";

export const theAnalyst: Fact = {
  // On a stock its analyst doesn't hold, a buy is one of the choices: its room. On a holding, an add takes no new slot.
  thesis: async (run) => {
    const a = await analystOf(run, run.subject.analystId);
    if (!a) return null;
    const room = await roomOf(a);
    return analystBrief(a, room?.held.includes(run.subject.ticker.toUpperCase()) ? null : room);
  },
  analyst: async (run) => {
    const a = await analystOf(run, run.subject.analystId);
    return a ? analystBrief(a, await roomOf(a)) : null;
  },
  // Pinned: its holdings are in the book on each message.
  chat: async (run) => {
    if (!run.subject.analystId) return null;
    const a = await analystOf(run, run.subject.analystId);
    if (!a) return null;
    const room = await roomOf(a);
    return pinnedAnalystText(a, room && { ...room, held: [] });
  },
};
