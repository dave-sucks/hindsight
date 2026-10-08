/**
 * Each situation's guidance: written once, under its cap, in five parts,
 * naming only tools the morning run has (docs/plans/AGENT_ARCHITECTURE.md,
 * 10.4). Not sent to any agent yet; the read that carries it is a later
 * change.
 */
import { MODES } from "@/lib/agent/modes";
import { SITUATIONS } from "./index";
import type { SituationCode } from "./types";

/** Caps as approved (10.4): the four long ones as set there, 1,200 otherwise. */
const CAPS: Record<SituationCode, number> = {
  PROTECTIVE_SALE: 1_500,
  BUY_ARRIVES: 2_500,
  ADD_OR_WINNER: 2_000,
  REVIEW_DUE: 2_000,
  PROMOTED_AWAITING: 1_200,
  BUY_BLOCKED_FULL: 1_200,
  EARNINGS: 1_200,
  FILING: 1_200,
  QUIET_WATCH_WOKE: 1_200,
  PROTECTION: 1_200,
  FIRST_RESEARCH: 1_200,
  STALE_RESEARCH: 1_200,
  PLAN_PROBLEM: 1_200,
  YOUR_WORD_UNANSWERED: 1_200,
  SOLD_ONE_REVIEW: 1_200,
  NO_SETUP_NAMED: 1_200,
};

const PARTS = ["When:", "Answer, in order:", "What you can do", "Answered:", "Mistakes:"];

/** Every tool any agent has: the union of the modes' lists. */
const ALL_TOOLS = new Set(Object.values(MODES).flatMap((m) => [...(m.toolAllowlist ?? [])]));
const MORNING_TOOLS = new Set(MODES["research-run"].toolAllowlist ?? []);

describe("each situation's guidance", () => {
  it.each(SITUATIONS.map((d) => [d.code, d] as const))("%s: written, under its cap, in five parts, plain", (code, d) => {
    expect(d.guidance.length).toBeGreaterThan(0);
    expect(d.guidance.length).toBeLessThanOrEqual(CAPS[code]);
    let at = -1;
    for (const part of PARTS) {
      const i = d.guidance.indexOf(part);
      expect(i).toBeGreaterThan(at);
      at = i;
    }
    expect(d.guidance).not.toMatch(/\*\*|⚠|[A-Z]{4,} [A-Z]{4,}/);
  });

  it.each(SITUATIONS.map((d) => [d.code, d] as const))("%s: names only tools the morning run has", (_code, d) => {
    const named = (d.guidance.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []).filter((w) => ALL_TOOLS.has(w));
    // Every guidance answers with a tool, so the check has something to check.
    expect(named.length).toBeGreaterThan(0);
    for (const tool of named) expect(MORNING_TOOLS.has(tool)).toBe(true);
  });

  it("each is written once: no two situations carry the same text", () => {
    expect(new Set(SITUATIONS.map((d) => d.guidance)).size).toBe(SITUATIONS.length);
  });
});
