/**
 * framework.test.ts — /how-it-works/framework draws every agent from its
 * record and sizes it on the request the engine built on its sample day; a
 * sample that can't be built is left unsized rather than failing the page.
 * This checks every agent is there, read from its record, and sized, so a
 * blank never ships.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { providerToolNames } from "@/lib/agent/engine/types";
import { AGENTS } from "@/lib/agent/engine/agents";
import { CONTEXT } from "@/lib/agent/engine/parts";
import { MODES } from "@/lib/agent/modes";
import { viewOfRecord, type RequestRecord } from "@/lib/agent/run-requests";
import { AGENT_SAMPLES } from "./agent-samples";
import { buildFrameworkData, openingOf, recordParts, runSizesOf, sizedOnRun } from "./framework";
import { partsByRarity } from "./framework-content";
import { loadGuide } from "./guide";
import { parseDoc } from "./guide-parse";
import { WRITER_TOOLS } from "./tools";

const data = buildFrameworkData();
const byId = new Map(data.agents.map((a) => [a.id, a]));

describe("the framework page's agents", () => {
  it("has every agent the engine runs, a tab each, in their order", () => {
    expect(data.agents.map((a) => a.id)).toEqual(AGENTS.map((r) => r.id));
  });

  it("builds every agent on its sample day, until a run of it is read", () => {
    for (const a of data.agents) expect([a.id, a.sizedOn]).toEqual([a.id, { kind: "sample", from: expect.any(String) }]);
  });

  /** A saved record of the agent's sample request, as a run keeps it: the body as sent, the manifest beside it. */
  const savedRecord = (record: (typeof AGENTS)[number]): RequestRecord => {
    const { request, newest } = AGENT_SAMPLES[record.id]!.build(record);
    const messages = [
      { role: "system", content: request.instructions },
      ...(request.message ? [{ role: "user", content: request.message }] : []),
      ...(newest ? [{ role: "user", content: `${newest.texts.join("\n\n")}\n\nWhy hold it?` }] : []),
    ];
    const tools = record.tools.map((name) => ({ type: "function", function: { name, description: `What ${name} does.`, parameters: { type: "object" } } }));
    return { v: 1, call: "Main", agent: record.id, source: "test", model: record.model, startedAt: "", endedAt: "", requests: [{ messages, tools }], parts: [...request.parts, ...(newest?.parts ?? [])] };
  };

  it.each(AGENTS.map((r) => [r.id, r] as const))("%s: sized on a saved run, its parts, sizes and colors are the ones that run's Context panel shows", (_, record) => {
    const saved = savedRecord(record);
    const agent = sizedOnRun(byId.get(record.id)!, runSizesOf(saved, new Date("2026-11-17T20:55:00Z"), "run_1"));
    const panel = viewOfRecord(saved).categories;
    expect(agent.sizedOn).toEqual({ kind: "run", at: "2026-11-17T20:55:00.000Z", runId: "run_1", gone: [] });
    expect(agent.parts.filter((p) => p.chars != null).map((p) => [p.title, p.chars, p.swatch])).toEqual(panel.filter((c) => c.source).map((c) => [c.name, c.chars, c.part]));
    expect(agent.tools.chars).toBe(panel.find((c) => c.part === "tools")?.chars ?? null);
  });

  it("a part the run didn't send has no size, and one it sent that the record no longer lists is named", () => {
    const pm = byId.get("portfolio_manager")!;
    const run = { at: "2026-11-17T20:55:00.000Z", runId: "run_1", toolChars: 100, parts: [{ id: "portfolio-manager.md", title: "Its own text", kind: "own" as const, where: "instructions" as const, source: "x", chars: 181 }, { id: "old_part", title: "An old part", kind: "own" as const, where: "instructions" as const, source: "x", chars: 50 }] };
    const sized = sizedOnRun(pm, run);
    expect(sized.parts.find((p) => p.id === "portfolio-manager.md")!.chars).toBe(181);
    expect(sized.parts.filter((p) => p.id !== "portfolio-manager.md").every((p) => p.chars == null)).toBe(true);
    expect(sized.sizedOn).toMatchObject({ kind: "run", gone: ["An old part"] });
  });

  it.each(AGENTS.map((r) => [r.id, r] as const))("%s: its parts are its record's, in order: its instructions, its context, its message; a read's title and line are the registry's", (_, record) => {
    const a = byId.get(record.id)!;
    expect(a.parts.map((p) => `${p.where}:${p.id}`)).toEqual(recordParts(record).map((p) => `${p.where}:${p.id}`));
    expect([...new Set(a.parts.map((p) => p.section))]).toEqual(record.conversation ? ["instructions", "context"] : ["instructions", "context", "message"]);
    for (const p of a.parts.filter((x) => x.kind === "context")) {
      const def = CONTEXT[p.id as keyof typeof CONTEXT];
      expect({ title: p.title, about: p.about, source: p.source }).toEqual({ title: def.title, about: def.about, source: def.source });
    }
    expect({ model: a.model, steps: a.maxSteps, tools: a.tools.names, provider: a.tools.provider }).toEqual({ model: record.model, steps: record.maxSteps, tools: [...record.tools], provider: providerToolNames(record) });
  });

  it.each(AGENTS.map((r) => [r.id, r] as const))("%s: each part its sample sent is sized from the manifest, and nothing else is", (_, record) => {
    const built = AGENT_SAMPLES[record.id]!.build(record);
    const all = [...built.request.parts, ...(built.newest?.parts ?? [])].filter((p) => p.chars > 0);
    // Listed as the Context panel lists them: the instruction files, then the facts sent with them, then the rest as sent.
    const withInstructions = (p: (typeof all)[number]) => p.where === "instructions" && p.kind === "context";
    const sent = [...all.filter((p) => p.where === "instructions" && !withInstructions(p)), ...all.filter(withInstructions), ...all.filter((p) => p.where !== "instructions")];
    const sized = byId.get(record.id)!.parts.filter((p) => p.chars != null);
    expect(sized.map((p) => [p.where, p.id, p.chars])).toEqual(sent.map((p) => [p.where, p.id, p.chars]));
    // Every request sends some of its own words.
    expect(sized.some((p) => p.kind === "own")).toBe(true);
  });

  it("measures the tool menu of every agent whose tools the tool set builds", () => {
    for (const a of data.agents) {
      if (a.tools.names.length > a.tools.unmeasured.length) expect([a.id, a.tools.chars]).toEqual([a.id, expect.any(Number)]);
      expect(a.tools.unmeasured.every((n) => a.tools.names.includes(n))).toBe(true);
    }
    expect(byId.get("morning_run")!.tools.chars).toBeGreaterThan(5_000);
  });

  it("gives each own part the opening of its words on the sample, past its heading", () => {
    expect(openingOf("═══\nHOW YOU WORK\n═══\nYou are a working analyst walking\nthrough your book. Then more.")).toBe("You are a working analyst walking through your book.");
    expect(openingOf("═══\nYOUR JOB — one research note, then one call\n═══\n\nSTEP 1 — write it.")).toBe("One research note, then one call");
    expect(openingOf("## Rules\n- **Product.** AI-operated paper trading.")).toBe("Product. AI-operated paper trading.");
    for (const a of data.agents) for (const p of a.parts.filter((x) => x.kind === "own" && x.chars != null)) expect([a.id, p.id, p.about.length > 0]).toEqual([a.id, p.id, true]);
  });

  it("puts the shared texts and reads fewest agents get first on the workflow chips", () => {
    const given = (id: string) => data.agents.filter((a) => a.parts.some((p) => (p.kind === "shared" || p.kind === "context") && p.id === id)).length;
    for (const a of data.agents) {
      const counts = partsByRarity(a, data.agents).map((p) => given(p.id));
      expect([a.id, counts]).toEqual([a.id, [...counts].sort((x, y) => x - y)]);
    }
  });

  it("reads all eight situation texts", () => {
    expect(data.situations).toHaveLength(8);
    for (const s of data.situations) expect(s.chars).toBeGreaterThan(50);
  });
});

describe("the guide's agent docs", () => {
  const guide = loadGuide();
  const markers = Object.entries(guide).flatMap(([slug, text]) => [...text.matchAll(/<!-- asset: context ([\w-]+) -->/g)].map((m) => [slug, m[1]] as const));

  it("name an agent the engine runs in every context list", () => {
    const ids = new Set(AGENTS.map((r) => r.id as string));
    for (const [slug, id] of markers) expect([slug, id, ids.has(id)]).toEqual([slug, id, true]);
  });

  it("draw every agent's parts on some doc", () => {
    const drawn = new Set(markers.map(([, id]) => id));
    for (const r of AGENTS) expect([r.id, drawn.has(r.id)]).toEqual([r.id, true]);
  });

  const AGENT_DOCS = { writer: "writer", "morning-runs": "morning_run", "trigger-runs": "trigger_run", chat: "chat" } as const;
  it.each(Object.entries(AGENT_DOCS))("%s states the model, steps and tool count its record has", (slug, id) => {
    const facts = parseDoc(guide[slug])
      .parts.flatMap((p) => (p.kind === "section" ? p.blocks : []))
      .find((b) => b.kind === "facts");
    const f = Object.fromEntries(facts && facts.kind === "facts" ? facts.facts : []);
    const r = AGENTS.find((x) => x.id === id)!;
    // The Writer's doc counts the data its run pulls in code before the model writes (lib/docs/tools.ts).
    const tools = id === "writer" ? WRITER_TOOLS.length : r.tools.length;
    expect({ model: f.Model, steps: f.Steps, tools: f.Tools }).toEqual({ model: r.model, steps: `Up to ${r.maxSteps}`, tools: String(tools) });
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
