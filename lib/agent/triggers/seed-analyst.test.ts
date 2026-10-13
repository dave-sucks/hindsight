/**
 * seed-analyst.test.ts — a seat's rules from the playbook, seeded on
 * creation and re-seeded as a diff (DAV-280). Replayed from the three live
 * analysts' rules on 2026-09-16.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { reseedDiff, describeSeatRule } from "./seed-analyst";
import { shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import { analystStandingTriggers, SETUP_STANDING_RULES } from "@/lib/agent/knowledge/seat-rules";
import { triggersArraySchema } from "./schema";
import { triggerSlot } from "./condition/slot";
import { addProblem } from "@/lib/agent/triggers/condition";
import type { Trigger } from "./types";

let n = 0;
const mintId = () => `t${++n}`;

// The live PEAD Specialist rules (set through the popover on 09-14).
const PEAD_LIVE: Trigger[] = [
  { id: "f552414c", action: "EXIT", predicate: { watch: "move", is: "below", value: 12, variable: "peak", settings: { startOnceUpPct: 10 } }, rationale: "Gave back 12% from the high, once the position had been up 10% — bank the run." },
  { id: "8d64ad2b", action: "REVIEW", predicate: { watch: "move", is: "above", value: 10, variable: "entry" }, rationale: "Up 10% from entry." },
  { id: "56be49ac", action: "REVIEW", predicate: { watch: "move", is: "below", value: 12, variable: "entry" }, rationale: "Down 12% from entry." },
];
// The live Catalyst Event PM rule — the −10% review the playbook doesn't have.
const CATALYST_LIVE: Trigger[] = [
  { id: "88ce7423", action: "REVIEW", predicate: { watch: "move", is: "below", value: 10, variable: "entry" }, rationale: "Down 10% into the catalyst." },
];

describe("the seat templates", () => {
  it("every template parses, is level-eligible, and fills each bucket once", () => {
    for (const seat of Object.keys(SETUP_STANDING_RULES)) {
      const t = analystStandingTriggers([seat], mintId);
      expect(triggersArraySchema.safeParse(t).success).toBe(true);
      expect(new Set(t.map(triggerSlot)).size).toBe(t.length);
      for (const r of t) expect({ seat, kind: shapeName(r.predicate), ok: addProblem(r.predicate, "ANALYST") === null }).toMatchObject({ ok: true });
      expect(t.every((r) => r.source === "DEFAULT")).toBe(true);
    }
  });
  it("the template is the analyst's FIRST setup; a setup with no seat rules, or no setups, seeds nothing rather than guessing", () => {
    expect(analystStandingTriggers(["BASE_BREAKOUT", "PEAD"], mintId)).toEqual([]);
    expect(analystStandingTriggers([], mintId)).toEqual([]);
    expect(analystStandingTriggers(["PEAD", "BASE_BREAKOUT"], mintId)).toHaveLength(3);
  });
});

describe("reseedDiff", () => {
  it("PEAD: the live rules match the template bucket for bucket — nothing to add, nothing foreign", () => {
    const d = reseedDiff(["PEAD", "EPISODIC_PIVOT", "MA_PULLBACK"], PEAD_LIVE, mintId);
    expect(d.toAdd).toEqual([]);
    expect(d.present).toHaveLength(3);
    expect(d.foreign).toEqual([]);
  });
  it("Catalyst: the two event-date rules would be added; the −10% review is kept as the analyst's own", () => {
    const d = reseedDiff(["PRE_CATALYST", "BASE_BREAKOUT", "MA_PULLBACK"], CATALYST_LIVE, mintId);
    expect(d.toAdd.map(describeSeatRule)).toEqual([
      "Review 10 days before the event date",
      "Review 30 days after the event date",
      "Review if it files an 8-K 8.01 (other events) or it files an 8-K 7.01 (press release)",
    ]);
    expect(d.foreign.map((t) => t.id)).toEqual(["88ce7423"]);
  });
  it("a fresh analyst gets the whole template", () => {
    const d = reseedDiff(["COMPOUNDER_ACCUMULATION", "BASE_BREAKOUT", "MA_PULLBACK"], [], mintId);
    expect(d.toAdd).toHaveLength(SETUP_STANDING_RULES.COMPOUNDER_ACCUMULATION!.length);
    expect(d.setupName).toBe("Compounder accumulation");
    expect(d.present).toEqual([]);
  });
});
