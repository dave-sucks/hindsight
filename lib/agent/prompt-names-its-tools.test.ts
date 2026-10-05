/**
 * prompt-names-its-tools.test.ts — a text never names a tool its agent
 * cannot call (docs/plans/AGENT_ARCHITECTURE.md, step 3).
 *
 * The chat's text told it to finish with `record_run_summary` and
 * `complete_run`, neither of which it has; the trigger run's named
 * `web_search` and `get_theses`, which it never called. A tool name in a
 * text is an instruction; one that points at nothing is a dead instruction
 * the model still reads every time. Each sample prompt is scanned for every
 * name in the tool catalog, and each name found must be on that mode's list.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { SAMPLE_PROMPTS } from "@/lib/agent/__fixtures__/sample-prompts";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";

const MODE_OF: Record<string, string> = { daily: "research-run", tactical: "tactical", discovery: "discovery", chat: "principal" };

describe("every tool a text names is on that agent's list", () => {
  beforeAll(() => jest.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z") }));
  afterAll(() => jest.useRealTimers());

  const catalog = Object.keys(
    createResearchTools({ runId: "names", userId: "u", accountId: "a", analystId: "an", runMode: "PRINCIPAL_CHAT", runEnvironment: "PAPER" } as never),
  );

  for (const [sample, mode] of Object.entries(MODE_OF)) {
    it(`${sample} names only tools on the ${mode} list`, () => {
      const text = SAMPLE_PROMPTS[sample as keyof typeof SAMPLE_PROMPTS]();
      const allow = new Set((MODES[mode as keyof typeof MODES] as { toolAllowlist?: readonly string[] }).toolAllowlist ?? catalog);
      const named = catalog.filter((name) => new RegExp(`\\b${name}\\b`).test(text));
      const missing = named.filter((name) => !allow.has(name));
      expect(missing).toEqual([]);
    });
  }
});
