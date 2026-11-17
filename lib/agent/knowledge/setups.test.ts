/**
 * setups.test.ts — the catalog is complete, and its triggers are its
 * templates (./playbook-templates, tested there): no rule a trigger carries
 * is written here in words.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  PLACEHOLDERS,
  setupsForAnalyst,
  SETUPS,
  SETUP_IDS,
  getSetup,
  setupIndex,
  templatePlaceholders,
} from "./setups";
import { STRATEGY_ARCHETYPES } from "./strategy-archetypes";
import { readKnowledgeLibrary } from "@/lib/agent/tools/read-knowledge-library";
import { createToolContext } from "@/lib/agent/tool-context";

describe("the setup catalog", () => {
  it("has the twelve playbook setups, D1–D12, once each", () => {
    expect(SETUPS).toHaveLength(12);
    expect(SETUPS.map((s) => s.code)).toEqual(
      Array.from({ length: 12 }, (_, i) => `D${i + 1}`),
    );
    expect(new Set(SETUPS.map((s) => s.id)).size).toBe(12);
    expect(SETUPS.map((s) => s.id)).toEqual([...SETUP_IDS]);
  });

  it.each(SETUPS.map((s) => [s.id, s] as const))("%s has every field filled", (_id, s) => {
    expect(s.name.length).toBeGreaterThan(0);
    expect(s.summary.length).toBeGreaterThan(20);
    expect(s.horizons.length).toBeGreaterThan(0);
    expect(s.preconditions.length).toBeGreaterThan(0);
    expect(s.entry.confirmation.length + (s.entry.entryVia?.length ?? 0)).toBeGreaterThan(0);
    expect(s.sale.minAtr).toBeGreaterThan(0);
    expect(s.riskMultiplier).toBeGreaterThan(0);
    expect(s.sizing.length).toBeGreaterThan(0);
    expect(s.failureSigns.length).toBeGreaterThan(0);
    expect(Array.isArray(s.triggers)).toBe(true);
  });

  it("carries no trigger rule in words: the sell price, the Trim, the trail and the time limit are its templates", () => {
    for (const s of SETUPS) {
      expect(Object.keys(s).filter((k) => ["stop", "target", "trail", "time", "manage"].includes(k))).toEqual([]);
      expect("template" in s.entry || "text" in s.entry).toBe(false);
      expect(Object.keys(s.sale)).toEqual(["maxPct", "minAtr"]);
    }
  });

  it("every SCREEN names the ENTRY setups it is entered through", () => {
    for (const s of SETUPS.filter((x) => x.role === "SCREEN")) {
      expect(s.entry.entryVia?.length).toBeGreaterThan(0);
      for (const via of s.entry.entryVia ?? []) expect(getSetup(via)?.role).toBe("ENTRY");
    }
  });

  it("every placeholder a template uses is defined", () => {
    for (const s of SETUPS) {
      for (const t of s.triggers) for (const p of templatePlaceholders(t.predicate)) expect(Object.keys(PLACEHOLDERS)).toContain(p);
    }
  });

  it("every screen a playbook lists has a setup it enters through in the same list", () => {
    const byId = new Map(SETUPS.map((s) => [s.id, s]));
    for (const a of STRATEGY_ARCHETYPES) {
      const stranded = a.setupIds.filter((id) => byId.get(id)?.role === "SCREEN" && !byId.get(id)!.entry.entryVia?.some((via) => a.setupIds.includes(via)));
      expect({ playbook: a.id, stranded }).toEqual({ playbook: a.id, stranded: [] });
    }
  });

  it("every playbook's setups are real setups, each once", () => {
    const ids = new Set(SETUPS.map((s) => s.id));
    for (const a of STRATEGY_ARCHETYPES) {
      expect({ playbook: a.id, unknown: a.setupIds.filter((id) => !ids.has(id)), once: new Set(a.setupIds).size === a.setupIds.length }).toEqual({ playbook: a.id, unknown: [], once: true });
    }
  });

  it("binary catalysts risk half (DAV-245 ruling 2)", () => {
    expect(getSetup("PRE_CATALYST")?.riskMultiplier).toBe(0.5);
    for (const s of SETUPS.filter((x) => x.id !== "PRE_CATALYST")) expect(s.riskMultiplier).toBe(1);
  });

  it("an analyst's setups are its own setting, in its order; none chosen = the whole catalog; an unknown id is ignored (DAV-280)", () => {
    expect(setupsForAnalyst(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]).map((s) => s.id)).toEqual(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"]);
    expect(setupsForAnalyst([]).map((s) => s.id)).toEqual(SETUPS.map((s) => s.id));
    expect(setupsForAnalyst(["GONE", "PRE_CATALYST"]).map((s) => s.id)).toEqual(["PRE_CATALYST"]);
  });

  it("looks up case-insensitively and indexes all twelve", () => {
    expect(getSetup("base_breakout")?.code).toBe("D1");
    expect(setupIndex()).toHaveLength(12);
  });
});

describe("read_knowledge_library — topic 'setup'", () => {
  type Run = { execute: (a: unknown, o: unknown) => Promise<{ ok: boolean; summary: string; data: Record<string, unknown> }> };
  const tool = readKnowledgeLibrary(createToolContext({ runId: "t", userId: "u" } as never)) as unknown as Run;
  const opts = { toolCallId: "t", messages: [] };

  it("returns the index of twelve", async () => {
    const r = await tool.execute({ topic: "setup" }, opts);
    expect(r.ok).toBe(true);
    expect(r.data.count).toBe(12);
    expect(r.summary).toMatch(/^12 playbooks:/);
  });

  it("returns a full entry with readable content: the playbook's words, then its triggers", async () => {
    const r = await tool.execute({ topic: "setup", id: "PEAD" }, opts);
    expect(r.data.found).toBe(true);
    const content = String(r.data.content);
    expect(content).toContain("Post-earnings drift (D4)");
    expect(content).toContain('The playbook\'s watch triggers:\n- Buy if above {gapDayMid} · only on the close: {"action":"ENTER","predicate":{"watch":"price","is":"above","value":"{gapDayMid}","settings":{"close":true}}} — The gap held: a close above the gap day\'s middle.');
    expect(content).toContain("The triggers that come with the buy:\n- Sell if below {sellPrice}: ");
    expect(content).toContain('- Review 60 days after the buy: {"action":"REVIEW","predicate":{"watch":"from_date","is":"after","value":60,"variable":"buy"}} — Hold 30–60 days.');
    expect(content).not.toMatch(/^(Stop|Target|Trail|Time|  Condition):/m);
  });

  it("names the available setups on an unknown id", async () => {
    const r = await tool.execute({ topic: "setup", id: "NOPE" }, opts);
    expect(r.data.found).toBe(false);
    expect(String(r.data.hint)).toContain("BASE_BREAKOUT");
  });
});

describe("the pullback and the drift (HPE 2026-09-15)", () => {
  it("the reversal is the tactical run's confirmation", () => {
    expect(getSetup("MA_PULLBACK")!.entry.confirmation.some((c) => c.includes("close above the prior day's high"))).toBe(true);
  });

  it("PEAD carries its window as data, and only PEAD does", () => {
    expect(getSetup("PEAD")!.entry.windowDays).toEqual([1, 3]);
    // Past the window the stock goes to the pullback playbook: its watch clock's own reason.
    expect(getSetup("PEAD")!.triggers.find((t) => t.writtenOn === "WATCH" && t.action === "REVIEW")!.rationale).toContain("re-writes the stock on the pullback playbook");
    expect(SETUPS.filter((s) => s.entry.windowDays).map((s) => s.id)).toEqual(["PEAD"]);
  });
});
