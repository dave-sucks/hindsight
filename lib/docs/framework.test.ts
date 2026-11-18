/**
 * framework.test.ts — /how-it-works/framework draws every agent from its
 * record and sizes it on the request the engine built on its sample day; a
 * sample that can't be built is left unsized rather than failing the page.
 * This checks every agent is there, read from its record, and sized, so a
 * blank never ships.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send: jest.fn() } }));

import { AGENTS } from "@/lib/agent/engine/agents";
import { BLOCKS } from "@/lib/agent/engine/blocks";
import { isOwn } from "@/lib/agent/engine/types";
import { MODES } from "@/lib/agent/modes";
import { AGENT_SAMPLES } from "./agent-samples";
import { buildFrameworkData, openingOf } from "./framework";
import { blocksByRarity } from "./framework-content";
import { loadGuide } from "./guide";
import { parseDoc } from "./guide-parse";
import { WRITER_TOOLS } from "./tools";

const data = buildFrameworkData();
const byId = new Map(data.agents.map((a) => [a.id, a]));

describe("the framework page's agents", () => {
  it("has every agent the engine runs, a tab each, in their order", () => {
    expect(data.agents.map((a) => a.id)).toEqual(AGENTS.map((r) => r.id));
  });

  it("builds every agent on its sample day", () => {
    for (const a of data.agents) expect([a.id, a.sample]).toEqual([a.id, expect.any(String)]);
  });

  it.each(AGENTS.map((r) => [r.id, r] as const))("%s: its parts are its record's, in order; a block's title and line are the library's", (_, record) => {
    const a = byId.get(record.id)!;
    const listed = [
      ...record.instructions.map((p) => ({ p, where: "instructions" })),
      ...record.message.map((p) => ({ p, where: "message" })),
      ...(record.newest ?? []).map((p) => ({ p, where: "newest" })),
    ];
    expect(a.parts.map((p) => `${p.where}:${p.id}`)).toEqual(listed.map(({ p, where }) => `${where}:${isOwn(p) ? p.own : p.block}`));
    for (const p of a.parts.filter((x) => x.kind === "block")) {
      const def = BLOCKS[p.id as keyof typeof BLOCKS];
      expect({ title: p.title, about: p.about, source: p.source }).toEqual({ title: def.title, about: def.about, source: def.source });
    }
    expect({ model: a.model, steps: a.maxSteps, tools: a.tools.names, provider: a.tools.provider }).toEqual({ model: record.model, steps: record.maxSteps, tools: [...record.tools], provider: [...(record.providerTools ?? [])] });
  });

  it.each(AGENTS.map((r) => [r.id, r] as const))("%s: each part its sample sent is sized from the manifest, and nothing else is", (_, record) => {
    const built = AGENT_SAMPLES[record.id]!.build(record);
    const sent = [...built.request.parts, ...(built.newest?.parts ?? [])].filter((p) => p.chars > 0);
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

  it("puts the blocks fewest agents get first on the workflow chips", () => {
    const given = (id: string) => data.agents.filter((a) => a.parts.some((p) => p.kind === "block" && p.id === id)).length;
    for (const a of data.agents) {
      const counts = blocksByRarity(a, data.agents).map((p) => given(p.id));
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
