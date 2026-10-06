/**
 * prompt-size.test.ts — a prompt can't get longer by accident
 * (docs/plans/AGENT_KNOWLEDGE_PLAN.md, "How we check it").
 *
 * Each of the five agent prompts is built from one fixed sample input and its
 * length is compared with the number recorded here. Any change to a prompt
 * changes its number, so the change shows in the PR:
 *   - a PR that deletes lowers the number;
 *   - a PR that makes a prompt longer raises it by hand and says why in the PR.
 * A lesson rarely belongs in a prompt: one setup → the setup list; one stock
 * or action → the tool's reply; every agent → the shared file; must never
 * happen → a check in the code.
 *
 * Characters, not tokens (about 4 characters to a token).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";

const RECORDED: Record<keyof typeof SAMPLE_PROMPTS, number> = {
  daily: 32_084,
  tactical: 17_698,
  writer: 11_617,
  discovery: 20_773,
  chat: 32_732,
};

/**
 * The tool definitions each agent sends, by size: every tool on its list,
 * description plus the JSON schema the SDK builds from it. They are bigger
 * than the texts (docs/plans/AGENT_ARCHITECTURE.md, 2.4), and they change
 * by accident just as easily.
 */
const RECORDED_TOOLS: Record<string, number> = {
  "research-run": 44_277,
  tactical: 41_240,
  discovery: 48_870,
  principal: 85_806,
};
const RUN_MODE: Record<string, string> = { "research-run": "MORNING_PLAN", tactical: "INTRADAY_TACTICAL", discovery: "DISCOVERY", principal: "PRINCIPAL_CHAT" };

function toolDefinitionChars(mode: string): number {
  const all = createResearchTools({ runId: "size", userId: "u", accountId: "a", analystId: "an", runMode: RUN_MODE[mode], runEnvironment: "PAPER" } as never) as Record<string, { description?: string; inputSchema: unknown }>;
  const allow = (MODES[mode as keyof typeof MODES] as { toolAllowlist?: readonly string[] }).toolAllowlist ?? Object.keys(all);
  return allow.filter((n) => all[n]).reduce((sum, n) => sum + (all[n].description ?? "").length + JSON.stringify(zodSchema(all[n].inputSchema as never).jsonSchema).length, 0);
}

describe("the five agent prompts, by size", () => {
  beforeAll(() => jest.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z") }));
  afterAll(() => jest.useRealTimers());

  for (const name of Object.keys(RECORDED) as Array<keyof typeof RECORDED>) {
    it(`${name}: ${RECORDED[name].toLocaleString("en-US")} characters`, () => {
      expect(SAMPLE_PROMPTS[name]().length).toBe(RECORDED[name]);
    });
  }
});

describe("the four agents' tool definitions, by size", () => {
  for (const mode of Object.keys(RECORDED_TOOLS)) {
    it(`${mode}: ${RECORDED_TOOLS[mode].toLocaleString("en-US")} characters`, () => {
      expect(toolDefinitionChars(mode)).toBe(RECORDED_TOOLS[mode]);
    });
  }
});
