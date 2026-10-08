/**
 * A holding's protection: its floor locks in far less than its gain
 * (UNPROTECTED_GAIN), or would lose too much of the account (FLOOR_TOO_FAR,
 * and the resolver's floorRisk, which lists a stock even when a fired sale
 * holds the lead). Rule: needs-action.ts `unprotectedGainFlag` and
 * `floorTooFarFlag`, and resolved-thesis.ts `floorRisk`.
 */
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const protection: SituationDefinition<"PROTECTION"> = {
  code: "PROTECTION",
  order: 9,
  appliesTo: "held",
  entry: "row",
  guidance: "",
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const floorRisk = stock.resolved?.floorRisk ?? null;
    if (!facts.floorTooFar && !facts.unprotectedGain && !floorRisk) return { active: false };
    return {
      active: true,
      data: {
        // FLOOR_TOO_FAR ranks above UNPROTECTED_GAIN (needs-action.ts).
        flag: facts.floorTooFar ?? facts.unprotectedGain ?? undefined,
        ...(facts.floorTooFar ? { floorTooFar: facts.floorTooFar } : {}),
        ...(facts.unprotectedGain ? { unprotectedGain: facts.unprotectedGain } : {}),
        ...(floorRisk ? { floorRisk } : {}),
      },
    };
  },
};
