/**
 * The trigger run on the agent engine: in every shape its prompt takes, it is
 * sent what its old builder sent, character for character. The old builder's
 * output on the same cases was frozen before the move
 * (./__fixtures__/trigger-run.golden.json, ./__fixtures__/trigger-run-cases.ts).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import GOLDEN from "./__fixtures__/trigger-run.golden.json";
import { TRIGGER_CASES, TRIGGER_KICKOFF, type TriggerCaseName } from "./__fixtures__/trigger-run-cases";
import { triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";
import { byParts } from "@/lib/agent/run-requests";

const args = (name: TriggerCaseName) => {
  const { pieces, ...rest } = TRIGGER_CASES[name] as (typeof TRIGGER_CASES)[TriggerCaseName] & { pieces?: unknown };
  return { ...(rest as never as Parameters<typeof triggerRunRequest>[0]), portfolioPieces: (pieces as never) ?? null };
};

const k = TRIGGER_KICKOFF;

describe("the trigger run on the engine", () => {
  for (const name of Object.keys(TRIGGER_CASES) as TriggerCaseName[]) {
    it(`${name}: its instructions are what the old builder sent`, () => {
      expect(triggerRunRequest(args(name)).instructions).toBe((GOLDEN.instructions as Record<string, string>)[name]);
    });
  }

  it("its kickoff is what the old run wrote, for a decision and for an Auto trade's write-up", () => {
    const facts = `Tactical run on $CASE. ${k.fireSentence}.${k.contextSuffix}${k.windowSuffix}${k.coFiredSuffix}${k.openOnStock}`;
    expect(triggerRunRequest(args("buy_on_watch"), { facts }).message).toBe(GOLDEN.kickoff);
    const autoFacts = `Write-up on $CASE. ${k.fireSentence}: set to Auto, so no analyst decided. ${k.autoLine}${k.contextSuffix}${k.coFiredSuffix}`;
    expect(triggerRunRequest(args("auto_sale"), { facts: autoFacts }).message).toBe(GOLDEN.autoKickoff);
  });

  it("names every part, and the parts add up to what is sent", () => {
    const built = triggerRunRequest(args("buy_on_watch"), { facts: "Tactical run on $CASE. Buy if above $120." });
    const rows = byParts(built.parts, built.instructions, built.message);
    expect(rows?.map((r) => r.name)).toEqual([
      "The analyst",
      "What happened",
      "Tool-call discipline",
      "Market numbers",
      "Market digest",
      "Portfolio snapshot",
      "Portfolio digest",
      "The stock's row",
      "The belief",
      "What would prove it wrong",
      "A declined buy",
      "House rules",
      "How you write",
      "What fired",
      "The path",
      "Decision framework",
      "Its situations",
      "Decision framework, continued",
      "Hard constraints",
      "The fire",
      "The ask",
    ]);
  });
});
