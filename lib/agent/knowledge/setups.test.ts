/**
 * setups.test.ts — the catalog is complete and speaks only the vocabulary
 * that will exist. A template naming a kind nobody evaluates is a plan
 * that can't fire — the exact failure 7 of 13 trigger kinds had
 * (docs/plans/AGENT_REBUILD.md §1.6).
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  DELETED_KINDS,
  PLACEHOLDERS,
  PLANNED_KINDS,
  SEAT_SETUPS,
  SETUPS,
  SETUP_IDS,
  describeTemplate,
  getSetup,
  setupIndex,
  templateKinds,
  templatePlaceholders,
} from "./setups";
import { STRATEGY_ARCHETYPES } from "./strategy-archetypes";
import { readKnowledgeLibrary } from "@/lib/agent/tools/read-knowledge-library";
import { createToolContext } from "@/lib/agent/tool-context";

/** Every predicate kind in TriggerPredicate today (lib/agent/triggers/types.ts). */
const LIVE_KINDS = [
  "PRICE_ABOVE", "PRICE_BELOW", "PRICE_MOVE_PCT", "GAIN_FROM_ENTRY", "TRAILING_FROM_HIGH",
  "VS_SMA", "RSI", "EARNINGS_BEAT", "EARNINGS_MISS", "EARNINGS_WITHIN", "EARNINGS_SINCE",
  "REVIEW_CADENCE", "AND", "OR",
];
const AFTER_PR2 = new Set<string>([...LIVE_KINDS, ...PLANNED_KINDS]);

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
    expect(s.archetypes.length).toBeGreaterThan(0);
    expect(s.preconditions.length).toBeGreaterThan(0);
    expect(s.entry.text.length).toBeGreaterThan(0);
    expect(s.stop.text.length).toBeGreaterThan(0);
    expect(s.stop.minAtr).toBeGreaterThan(0);
    expect(s.target.text.length).toBeGreaterThan(0);
    expect(s.target.minR).toBeGreaterThan(0);
    expect(s.riskMultiplier).toBeGreaterThan(0);
    expect(s.sizing.length).toBeGreaterThan(0);
    expect(s.time.text.length).toBeGreaterThan(0);
    expect(s.failureSigns.length).toBeGreaterThan(0);
  });

  it("every ENTRY setup has a condition and a trail for each of its horizons", () => {
    for (const s of SETUPS.filter((x) => x.role === "ENTRY")) {
      if (s.id === "PRE_CATALYST") continue; // entered via D1/D5; its trail is the event
      expect({ id: s.id, template: s.entry.template }).not.toEqual({ id: s.id, template: null });
      for (const h of s.horizons) expect({ id: s.id, h, trail: s.trail[h] ?? null }).not.toMatchObject({ trail: null });
    }
  });

  it("every SCREEN names the ENTRY setups it is entered through", () => {
    for (const s of SETUPS.filter((x) => x.role === "SCREEN")) {
      expect(s.entry.template).toBeNull();
      expect(s.entry.entryVia?.length).toBeGreaterThan(0);
      for (const via of s.entry.entryVia ?? []) expect(getSetup(via)?.role).toBe("ENTRY");
    }
  });

  it("every template names only kinds that exist after PR 2", () => {
    for (const s of SETUPS) {
      for (const k of templateKinds(s.entry.template)) {
        expect({ setup: s.id, kind: k, known: AFTER_PR2.has(k) }).toEqual({ setup: s.id, kind: k, known: true });
      }
    }
  });

  it("no template names a kind PR 2 deletes", () => {
    const used = SETUPS.flatMap((s) => templateKinds(s.entry.template));
    for (const dead of DELETED_KINDS) expect(used).not.toContain(dead);
  });

  it("every placeholder a template uses is defined", () => {
    for (const s of SETUPS) {
      for (const p of templatePlaceholders(s.entry.template)) {
        expect(Object.keys(PLACEHOLDERS)).toContain(p);
      }
    }
  });

  it("every archetype id is a real strategy archetype", () => {
    const ids = new Set(STRATEGY_ARCHETYPES.map((a) => a.id));
    for (const s of SETUPS) for (const a of s.archetypes) expect({ setup: s.id, a, real: ids.has(a) }).toMatchObject({ real: true });
  });

  it("binary catalysts risk half (DAV-245 ruling 2)", () => {
    expect(getSetup("PRE_CATALYST")?.riskMultiplier).toBe(0.5);
    for (const s of SETUPS.filter((x) => x.id !== "PRE_CATALYST")) expect(s.riskMultiplier).toBe(1);
  });

  it("the seat map is DAV-245 ruling 3, exactly", () => {
    expect(SEAT_SETUPS).toEqual({
      "PEAD Specialist": ["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"],
      "Secular Compounder": ["COMPOUNDER_ACCUMULATION", "BASE_BREAKOUT", "MA_PULLBACK"],
      "Catalyst Event PM": ["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"],
    });
  });

  it("describes a template in one line", () => {
    expect(describeTemplate(getSetup("BASE_BREAKOUT")!.entry.template)).toBe(
      "AND[PRICE_ABOVE({pivot}, close), VOLUME_RATIO ≥ 1.5×, PRICE_BELOW({pivotChase})]",
    );
    expect(describeTemplate(getSetup("PEAD")!.entry.template)).toBe(
      "AND[EARNINGS_SINCE(1–3 days), PRICE_ABOVE({gapDayLow})]",
    );
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
    expect(r.summary).toMatch(/^12 setups:/);
  });

  it("returns a full entry with readable content", async () => {
    const r = await tool.execute({ topic: "setup", id: "PEAD" }, opts);
    expect(r.data.found).toBe(true);
    expect(String(r.data.content)).toContain("Post-earnings drift (D4)");
    expect(String(r.data.content)).toContain("EARNINGS_SINCE(1–3 days)");
  });

  it("names the available setups on an unknown id", async () => {
    const r = await tool.execute({ topic: "setup", id: "NOPE" }, opts);
    expect(r.data.found).toBe(false);
    expect(String(r.data.hint)).toContain("BASE_BREAKOUT");
  });
});
