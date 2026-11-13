// The sample prompts reach the database client and Inngest through the Writer; neither is called.
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { HOUSE_RULES } from "@/lib/agent/house-rules";
import type { PromptName } from "@/lib/agent/tools/field-contract";
import { AGENT_CONTEXT, type ContextAgent } from "./agent-context";
import { loadGuide } from "./guide";

/** The agents whose instructions are one of the four sample prompts. */
const PROMPTS: ReadonlyArray<[ContextAgent, PromptName]> = [
  ["morning-runs", "daily"],
  ["trigger-runs", "tactical"],
  ["chat", "chat"],
  ["writer", "writer"],
];

describe("what each agent is sent (lib/docs/agent-context.ts)", () => {
  it.each(PROMPTS)("%s lists the house rules and the analyst brief exactly when its prompt carries them", (agent, prompt) => {
    const text = SAMPLE_PROMPTS[prompt]();
    const parts = new Set(AGENT_CONTEXT[agent].map((c) => c.part));
    expect({ house: parts.has("house"), analyst: parts.has("analyst") }).toEqual({ house: text.includes(HOUSE_RULES), analyst: text.includes("## Analyst:") });
  });

  it("is drawn on every agent's doc, from this list", () => {
    const guide = loadGuide();
    for (const agent of Object.keys(AGENT_CONTEXT)) {
      expect([agent, guide[agent]?.includes(`<!-- asset: context ${agent} -->`)]).toEqual([agent, true]);
    }
  });
});
