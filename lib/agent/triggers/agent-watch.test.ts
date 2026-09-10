/**
 * agent-watch.test.ts — is the agent reviewing this name on a schedule?
 *
 * The pill in the sheet, the row's breathing dot and the Send-to-Agent
 * button all ask this same helper, so they can't end up disagreeing about
 * whether a name is an Agent Watch or a plain one.
 */

import {
  agentWatchDays,
  agentWatchTooltip,
  isAgentWatched,
} from "@/lib/agent/triggers/agent-watch";

const cadence = (days: number) => ({
  predicate: { kind: "REVIEW_CADENCE", days },
  action: "REVIEW",
});
const priceRung = {
  predicate: { kind: "PRICE_ABOVE", level: 186 },
  action: "ENTER",
};

describe("agentWatchDays — is the agent on this one?", () => {
  it("reads the cadence off the trigger", () => {
    expect(agentWatchDays([priceRung, cadence(7)])).toBe(7);
    expect(isAgentWatched([priceRung, cadence(7)])).toBe(true);
  });

  it("triggers with no cadence, or none at all, are a plain watch", () => {
    expect(agentWatchDays([priceRung])).toBeNull();
    expect(agentWatchDays([])).toBeNull();
    expect(isAgentWatched([priceRung])).toBe(false);
  });

  it("a non-array column is a plain watch, not an error", () => {
    expect(agentWatchDays(null)).toBeNull();
    expect(agentWatchDays({ nope: true })).toBeNull();
  });

  it("a malformed rung doesn't take the whole ladder down", () => {
    // Legacy rows carry junk; the pill still has to render.
    expect(agentWatchDays([null, { predicate: null }, cadence(30)])).toBe(30);
  });

  it("a zero or negative cadence is not a schedule", () => {
    expect(agentWatchDays([cadence(0)])).toBeNull();
    expect(agentWatchDays([cadence(-1)])).toBeNull();
  });
});

describe("agentWatchTooltip — one plain sentence", () => {
  it("says how often, in words for the common cases", () => {
    expect(agentWatchTooltip(1)).toBe("The agent reviews this every day.");
    expect(agentWatchTooltip(7)).toBe("The agent reviews this every week.");
    expect(agentWatchTooltip(30)).toBe("The agent reviews this every month.");
    expect(agentWatchTooltip(4)).toBe("The agent reviews this every 4 days.");
  });

  it("says plainly when the agent isn't on it", () => {
    expect(agentWatchTooltip(null)).toBe(
      "You watch this. The agent doesn't review it.",
    );
  });
});
