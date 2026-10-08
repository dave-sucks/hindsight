/**
 * An add on a holding, or a holding near its target: an add trigger fired or
 * is true now, or the holding has come three quarters of the way from entry
 * to target. Rule: the fires and matches with action ADD on a holding, and
 * the resolver's progressToTarget against the step-6 threshold
 * (9e323ec9:lib/agent/playbooks/add-or-winner.ts).
 */
import { firstFlag, itemsFor, stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

/** How far from entry to target a holding has come before it is a decision point. */
export const NEAR_TARGET = 0.75;

export const addOrWinner: SituationDefinition<"ADD_OR_WINNER"> = {
  code: "ADD_OR_WINNER",
  order: 5,
  appliesTo: "held",
  entry: "row",
  guidance: "",
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const items = itemsFor(facts, "ADD_OR_WINNER");
    const progress = stock.resolved?.progressToTarget;
    const near = facts.held && typeof progress === "number" && progress >= NEAR_TARGET;
    if (items.length === 0 && !near) return { active: false };
    return {
      active: true,
      data: {
        flag: firstFlag(items),
        fires: items.map((i) => i.ref),
        ...(near ? { progressToTarget: progress as number } : {}),
      },
    };
  },
};
