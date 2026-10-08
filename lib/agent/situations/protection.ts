/**
 * A holding's protection: its floor locks in far less than its gain
 * (UNPROTECTED_GAIN), or would lose too much of the account (FLOOR_TOO_FAR,
 * and the floor's risk with the stock named, which lists a stock even when a
 * fired sale holds the lead). Rule: work-flag.ts `unprotectedGainFlag` and
 * `floorTooFarFlag`, and the floor-risk check the resolver made (./facts.ts).
 */
import { stockFacts } from "./facts";
import type { SituationDefinition } from "./types";

export const protection: SituationDefinition<"PROTECTION"> = {
  code: "PROTECTION",
  order: 9,
  appliesTo: "held",
  entry: "row",
  guidance: "",
  // Each of its three sources lists the stock: the two flags, and the floor risk on its own.
  lists: () => true,
  rule: (stock, book, now) => {
    const facts = stockFacts(stock, book, now);
    const floorRisk = facts.floorRisk;
    if (!facts.floorTooFar && !facts.unprotectedGain && !floorRisk) return { active: false };
    return {
      active: true,
      data: {
        // FLOOR_TOO_FAR ranks above UNPROTECTED_GAIN (work-flag.ts).
        flag: facts.floorTooFar ?? facts.unprotectedGain ?? undefined,
        ...(facts.floorTooFar ? { floorTooFar: facts.floorTooFar } : {}),
        ...(facts.unprotectedGain ? { unprotectedGain: facts.unprotectedGain } : {}),
        ...(floorRisk ? { floorRisk } : {}),
      },
    };
  },
};
