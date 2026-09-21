/**
 * morning-research.prompt-config.test.ts — the cron hands the prompt the
 * analyst's LIMIT, not what is left of it.
 *
 * This is the wiring the earlier test did not cover. `buildDailyRunSystemPromptV2`
 * is pure and was always given a number called `maxOpenPositions`; the fault
 * was upstream, in the cron, which had passed `slotsRemaining` in that field
 * since long before anything read it as a limit ("Use remaining slots, not
 * max"). A prompt-only test passes with the bug restored, so it pins nothing.
 * This one asserts on the object the cron actually builds.
 *
 * The PEAD Specialist on 2026-09-18: 4 open, limit 6.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: () => ({}) } }));

import { promptConfigFromAnalyst } from "./morning-research";

const PEAD = {
  name: "PEAD Specialist",
  analystPrompt: "…",
  directionBias: "LONG_ONLY",
  holdDurations: ["SWING"],
  sectors: [],
  signalTypes: [],
  minConfidence: 70,
  minPositionSize: 3000,
  maxPositionSize: 14000,
  maxOpenPositions: 6,
  exclusionList: [],
};

describe("what the cron hands the daily-run prompt", () => {
  it("passes the limit, whatever is open — 6, never 2", () => {
    expect(promptConfigFromAnalyst(PEAD, ["MU", "IOT"]).maxOpenPositions).toBe(6);
  });

  it("a full analyst still gets its limit, not a zero", () => {
    expect(promptConfigFromAnalyst({ ...PEAD, name: "Secular Compounder", maxOpenPositions: 4 }, []).maxOpenPositions).toBe(4);
  });

  it("carries the rest of the row through unchanged", () => {
    const c = promptConfigFromAnalyst(PEAD, ["MU"]);
    expect(c).toMatchObject({
      name: "PEAD Specialist",
      minConfidence: 70,
      minPositionSize: 3000,
      maxPositionSize: 14000,
      watchlist: ["MU"],
    });
  });
});
