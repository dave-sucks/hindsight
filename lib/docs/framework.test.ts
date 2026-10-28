/**
 * framework.test.ts — /how-it-works/framework measures every door from the code, and
 * a measurement that throws is left out rather than failing the page. This
 * checks that every number is actually taken, so a blank never ships.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { MODES } from "@/lib/agent/modes";
import { buildFrameworkData } from "./framework";
import { loadGuide } from "./guide";
import { parseDoc } from "./guide-parse";

describe("the framework page's measurements", () => {
  const data = buildFrameworkData();

  it("measures every door's prompt", () => {
    for (const d of data.doors) expect(d.promptChars).toBeGreaterThan(1_000);
  });

  it("measures the tool menu of every door that sends one", () => {
    for (const d of data.doors.filter((x) => x.id !== "writer")) {
      expect(d.toolChars).toBeGreaterThan(5_000);
      expect(d.tools.length).toBeGreaterThan(3);
    }
  });

  it("finds the house rules in the three doors that carry them", () => {
    const carries = Object.fromEntries(data.doors.map((d) => [d.id, d.houseRules]));
    expect(carries).toMatchObject({ morning: true, trigger: true, chat: true });
  });

  it("reads all seventeen situation texts", () => {
    expect(data.situations).toHaveLength(17);
    for (const s of data.situations) expect(s.chars).toBeGreaterThan(50);
  });
});

describe("each agent doc's facts strip", () => {
  const doors = Object.fromEntries(buildFrameworkData().doors.map((d) => [d.id, d]));
  const guide = loadGuide();
  const AGENT_DOCS = { writer: "writer", "morning-runs": "morning", "trigger-runs": "trigger", chat: "chat" } as const;

  it.each(Object.entries(AGENT_DOCS))("%s states the model, steps and tool count its mode has", (slug, door) => {
    const facts = parseDoc(guide[slug])
      .parts.flatMap((p) => (p.kind === "section" ? p.blocks : []))
      .find((b) => b.kind === "facts");
    const f = Object.fromEntries(facts && facts.kind === "facts" ? facts.facts : []);
    const d = doors[door];
    expect({ model: f.Model, steps: f.Steps, tools: f.Tools }).toEqual({ model: d.model, steps: `Up to ${d.maxSteps}`, tools: String(d.tools.length) });
  });

  it("the analyst builder states the builder's model and steps, and the builder and editor's tools together", () => {
    const facts = parseDoc(guide["analyst-builder"])
      .parts.flatMap((p) => (p.kind === "section" ? p.blocks : []))
      .find((b) => b.kind === "facts");
    const f = Object.fromEntries(facts && facts.kind === "facts" ? facts.facts : []);
    const tools = new Set([...(MODES.builder.toolAllowlist ?? []), ...(MODES.editor.toolAllowlist ?? []), "suggest_config"]);
    expect({ model: f.Model, steps: f.Steps, tools: f.Tools }).toEqual({ model: MODES.builder.model, steps: `Up to ${MODES.builder.maxSteps}`, tools: String(tools.size) });
  });
});

