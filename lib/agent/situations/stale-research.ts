/**
 * The research behind a committed view is older than its horizon allows, or
 * missing. Rule: needs-action.ts `researchStaleFlag` (RESEARCH_STALE), or the
 * row's researchAge stale or missing on a researched stock under the same
 * exclusions (a direction, not a seed, held or watched).
 */
import { isUnresearchedSeed } from "@/lib/agent/thesis-direction";
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const staleResearch: SituationDefinition<"STALE_RESEARCH"> = {
  code: "STALE_RESEARCH",
  order: 12,
  appliesTo: "both",
  entry: "row",
  guidance: "",
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
