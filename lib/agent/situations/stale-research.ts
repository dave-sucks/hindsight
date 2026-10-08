/**
 * The research behind a committed view is older than its horizon allows, or
 * missing. Rule: work-flag.ts `researchStaleFlag` (RESEARCH_STALE), or the
 * row's researchAge stale or missing on a researched stock under the same
 * exclusions (a direction, not a seed, held or watched).
 */
import { isUnresearchedSeed } from "@/lib/agent/thesis-direction";
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/**
 * What an agent is told when the stock is in this situation: the step-6
 * stale-research text (9e323ec9). Cap 1,200 characters
 * (situations.guidance.test.ts); a line added means a line removed. Not sent
 * to any agent yet: the read that carries it with the stock is a later
 * change, which also takes the matching text out of the prompts.
 */
const GUIDANCE = `When: the research behind a committed view is older than its horizon allows, or missing. The row gives the age and the limit. On a watched stock the next thing to happen could be a buy on it.

Answer, in order:
1. Does the old work still stand against today's data?

What you can do:
- Refresh it (the default): dispatch_thesis_research with mode refresh, then wait_for_thesis_refresh, then re-read the stock and change its levels or conviction if the new work changed your view.
- Re-affirm it: update_thesis saying in one concrete sentence why it still stands ("the backlog case is unchanged; Q2 confirmed it").
- Stop paying for it: drop the review clock, and the plan's triggers too if the plan is dead.

Answered: a refresh, or one of the other two. A held stock owes the same, with more at stake.

Mistakes:
- "Looks fine", or a line you could have written without opening the stock.`;

export const staleResearch: SituationDefinition<"STALE_RESEARCH"> = {
  code: "STALE_RESEARCH",
  order: 12,
  appliesTo: "both",
  entry: "row",
  guidance: GUIDANCE,
  // The flag lists the stock; old research on a row the flag does not lead is read, not listed.
  lists: (data) => data.flag != null,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const t = stock.work.thesis;
    const age = stock.researchAge ?? null;
    const researched =
      t.direction != null && !isUnresearchedSeed(t.direction) && (t.status === "WATCHING" || t.status === "HOLDING");
    const old = researched && (age?.freshness === "stale" || age?.freshness === "missing");
    if (!facts.stale && !old) return { active: false };
    return {
      active: true,
      data: {
        flag: facts.stale ?? undefined,
        ...(age ? { researchAge: age } : {}),
      },
    };
  },
};
