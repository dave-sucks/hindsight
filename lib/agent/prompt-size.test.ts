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
import { stockBrief } from "@/lib/agent/stock-brief";
import { tacticalSituation } from "@/lib/agent/system-prompts/intraday-tactical";
import { tacticalKickoff } from "@/lib/agent/system-prompts/tactical-kickoff";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { PLAYBOOKS, playbooksForFire } from "@/lib/agent/playbooks";
import type { Trigger } from "@/lib/agent/triggers/types";

const RECORDED: Record<keyof typeof SAMPLE_PROMPTS, number> = {
  daily: 16_138,
  tactical: 7_166,
  writer: 11_027,
  discovery: 20_773,
  chat: 32_159,
};

/**
 * The tool definitions each agent sends, by size: every tool on its list,
 * description plus the JSON schema the SDK builds from it. They are bigger
 * than the texts (docs/plans/AGENT_ARCHITECTURE.md, 2.4), and they change
 * by accident just as easily.
 */
const RECORDED_TOOLS: Record<string, number> = {
  "research-run": 34_153,
  tactical: 31_464,
  discovery: 34_608,
  principal: 66_244,
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

/**
 * The trigger run's kickoff for the sample stock: the fire, its paragraphs
 * and the stock's brief. Its system prompt is the job alone, so the stock it
 * used to carry is counted here.
 */
const KICKOFF = 2_691;
function sampleKickoff(): string {
  const trail = { id: "trig_trail", predicate: { watch: "move", is: "below", value: 12, variable: "peak" }, action: "EXIT", rationale: "Protect the gain." } as Trigger;
  const stock = stockBrief(
    {
      id: "thesis_1", ticker: "HPE", status: "HOLDING", direction: "LONG", horizon: "TARGET", coreBelief: "Belief.", keyAssumptions: ["a"], invalidationConds: ["b"],
      entryPrice: 53, targetPrice: 70, stopLoss: 50, triggers: [trail], researchAge: { daysOld: 1, freshness: "fresh", horizonThreshold: 7 },
      position: { quantity: 60, avgCost: 53.1, openedAt: "2026-09-21T14:00:00Z", peakPrice: 62.7 },
      needsAction: { kind: "TRIGGER_FIRED", triggerId: "trig_trail", action: "EXIT", summary: "", firedAt: "2026-10-01T15:00:00Z" },
    },
    { named: true, inherited: true, playbooks: false },
  );
  return tacticalKickoff({
    ticker: "HPE",
    fireSentence: sentenceOf(trail),
    situation: tacticalSituation({ thesis: { ticker: "HPE", direction: "LONG", researchAge: { freshness: "fresh", daysOld: 1, horizonThreshold: 7 } as never }, trigger: trail, position: { peakPrice: 62.7 }, fired: { price: 55, coFired: [] } }),
    playbooks: playbooksForFire({ action: "EXIT", held: true, predicate: trail.predicate }),
    stock,
  });
}

describe("the trigger run's kickoff, by size", () => {
  it(`the sample stock: ${KICKOFF.toLocaleString("en-US")} characters`, () => {
    expect(sampleKickoff().length).toBe(KICKOFF);
  });
});

/**
 * Each playbook, by size, under the cap its file states (plan 10.4). A line
 * added to one means a line removed.
 */
const RECORDED_PLAYBOOKS: Record<string, number> = {
  "protective-sale": 1_500,
  "buy-arrives": 2_493,
  "add-or-winner": 1_866,
  earnings: 1_193,
  filings: 1_105,
  protection: 1_144,
  "stale-research": 889,
};

describe("the playbooks, by size", () => {
  it("every playbook is recorded here", () => {
    expect(PLAYBOOKS.map((p) => p.key).sort()).toEqual(Object.keys(RECORDED_PLAYBOOKS).sort());
  });
  for (const p of PLAYBOOKS) {
    it(`${p.key}: ${(RECORDED_PLAYBOOKS[p.key] ?? 0).toLocaleString("en-US")} characters, cap ${p.cap.toLocaleString("en-US")}`, () => {
      expect(p.text.length).toBe(RECORDED_PLAYBOOKS[p.key]);
      expect(p.text.length).toBeLessThanOrEqual(p.cap);
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
