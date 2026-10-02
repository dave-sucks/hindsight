/**
 * The tool definitions an agent sends must be the same bytes on every
 * request of a run, and on every run.
 *
 * OpenAI caches an exact prefix of the request. Until 2026-10-02 one field
 * in `update_thesis` (and `record_thesis`) carried a `.default(() =>
 * randomUUID())`, and the SDK rebuilds every tool's JSON schema per
 * request, so each request's tool block differed at that field and the
 * cache stopped there on every step of every run: the same request cached
 * 71% as sent and 97% with the id held still. This pins the fix: build the
 * tools the way a run does, twice, and compare what the SDK would send.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { zodSchema } from "ai";
import { MODES } from "@/lib/agent/modes";
import { createResearchTools } from "@/lib/agent/tools";

const AGENTS: Array<{ mode: keyof typeof MODES; runMode: string }> = [
  { mode: "research-run", runMode: "MORNING_PLAN" },
  { mode: "tactical", runMode: "INTRADAY_TACTICAL" },
  { mode: "discovery", runMode: "DISCOVERY" },
  { mode: "principal", runMode: "PRINCIPAL_CHAT" },
];

/** Every tool on the agent's list, serialised the way the SDK sends it. */
function definitionsFor(mode: keyof typeof MODES, runMode: string): Array<{ name: string; description: string; schema: string }> {
  const all = createResearchTools({
    runId: "stable", userId: "u", accountId: "a", analystId: "an", runMode, runEnvironment: "PAPER",
  } as never) as Record<string, { description?: string; inputSchema: unknown }>;
  const allow = (MODES[mode] as { toolAllowlist?: readonly string[] }).toolAllowlist ?? Object.keys(all);
  return allow
    .filter((name) => all[name])
    .map((name) => ({
      name,
      description: all[name].description ?? "",
      schema: JSON.stringify(zodSchema(all[name].inputSchema as never).jsonSchema),
    }));
}

describe("an agent's tool definitions are the same on every request", () => {
  for (const { mode, runMode } of AGENTS) {
    it(`${mode}: two builds send byte-identical definitions`, () => {
      const first = definitionsFor(mode, runMode);
      const second = definitionsFor(mode, runMode);
      expect(first.length).toBeGreaterThan(0);
      for (let i = 0; i < first.length; i++) {
        expect(second[i].name).toBe(first[i].name);
        expect(second[i].description).toBe(first[i].description);
        expect(second[i].schema).toBe(first[i].schema);
      }
    });
  }

  it("no definition carries a generated id as a default", () => {
    for (const { mode, runMode } of AGENTS) {
      for (const def of definitionsFor(mode, runMode)) {
        expect(def.schema).not.toMatch(/"default":"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/);
      }
    }
  });

  it("the trigger items the thesis tools show the model leave the server's fields out", () => {
    const defs = definitionsFor("principal", "PRINCIPAL_CHAT");
    for (const name of ["update_thesis", "record_thesis"]) {
      const def = defs.find((d) => d.name === name);
      expect(def).toBeDefined();
      for (const field of ["lastFiredAt", "firedFilings", "firedReports", "writtenPrice", "writtenAt"]) {
        expect(def!.schema).not.toContain(`"${field}"`);
      }
    }
  });
});
