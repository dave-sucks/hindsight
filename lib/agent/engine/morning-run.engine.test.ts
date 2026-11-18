/**
 * The morning run on the agent engine: in every shape its prompt takes, it is
 * sent what its old builder sent, character for character. The old builder's
 * output on the same cases was frozen before the move
 * (./__fixtures__/morning-run.golden.json, ./__fixtures__/morning-run-cases.ts).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import GOLDEN from "./__fixtures__/morning-run.golden.json";
import { MORNING_CASES, asRunInput, type MorningCaseName } from "./__fixtures__/morning-run-cases";
import { dailyRunRequest } from "@/lib/agent/system-prompt";
import { byParts } from "@/lib/agent/run-requests";

const build = (name: MorningCaseName) => {
  const c = MORNING_CASES[name] as (typeof MORNING_CASES)[MorningCaseName] & { pieces?: unknown };
  return dailyRunRequest(c.analyst as never, { ...asRunInput(c.runInput), portfolioPieces: (c.pieces as never) ?? undefined });
};

describe("the morning run on the engine", () => {
  for (const name of Object.keys(MORNING_CASES) as MorningCaseName[]) {
    it(`${name}: its instructions are what the old builder sent`, () => {
      expect(build(name).instructions).toBe((GOLDEN.instructions as Record<string, string>)[name]);
    });
  }

  it("its first message is the start of the day the cron sent", () => {
    expect(build("quiet").message).toBe(
      "It's the start of the trading day. Run your morning playbook unattended — there is no human to respond to questions. Every turn must call a tool; text-only turns terminate the run as FAILED. End with complete_run.",
    );
  });

  it("names every part, and the parts add up to what is sent", () => {
    const built = build("full");
    expect(byParts(built.parts, built.instructions, built.message)?.map((r) => r.name)).toEqual([
      "The analyst",
      "House rules",
      "How you write",
      "Earnings this week",
      "Filings this week",
      "Regime and cash",
      "Refused calls never redone",
      "How you work",
      "Your job",
      "How tools work",
      "Market numbers",
      "Market digest",
      "Portfolio snapshot",
      "Portfolio digest",
      "The start",
    ]);
  });
});
