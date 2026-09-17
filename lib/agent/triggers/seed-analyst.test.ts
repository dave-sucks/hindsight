/**
 * seed-analyst.test.ts — a seat's rules from the playbook, seeded on
 * creation and re-seeded as a diff (DAV-280). Replayed from the three live
 * analysts' rules on 2026-09-16.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { reseedDiff, describeSeatRule } from "./seed-analyst";
import { seatStandingTriggers, SEAT_STANDING_RULES } from "@/lib/agent/knowledge/seat-rules";
import { triggersArraySchema } from "./schema";
import { triggerBucket } from "./bucket";
import { LEVEL_ELIGIBLE_PREDICATE_KINDS } from "@/lib/actions/level-triggers";
import type { Trigger } from "./types";

let n = 0;
const mintId = () => `t${++n}`;

// The live PEAD Specialist rules (set through the popover on 09-14).
const PEAD_LIVE: Trigger[] = [
  { id: "f552414c", action: "EXIT", predicate: { kind: "TRAILING_FROM_HIGH", pct: 12, armAtGainPct: 10 }, rationale: "Gave back 12% from the high, once the position had been up 10% — bank the run." },
  { id: "8d64ad2b", action: "REVIEW", predicate: { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" }, rationale: "Up 10% from entry." },
  { id: "56be49ac", action: "REVIEW", predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" }, rationale: "Down 12% from entry." },
];
// The live Catalyst Event PM rule — the −10% review the playbook doesn't have.
const CATALYST_LIVE: Trigger[] = [
  { id: "88ce7423", action: "REVIEW", predicate: { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "DOWN" }, rationale: "Down 10% into the catalyst." },
];

describe("the seat templates", () => {
  it("every seat's rules parse, are level-eligible, and fill each bucket once", () => {
    for (const seat of Object.keys(SEAT_STANDING_RULES)) {
      const t = seatStandingTriggers(seat, mintId);
      expect(triggersArraySchema.safeParse(t).success).toBe(true);
      expect(new Set(t.map(triggerBucket)).size).toBe(t.length);
      for (const r of t) expect({ seat, kind: r.predicate.kind, ok: LEVEL_ELIGIBLE_PREDICATE_KINDS.has(r.predicate.kind) }).toMatchObject({ ok: true });
      expect(t.every((r) => r.source === "DEFAULT")).toBe(true);
    }
  });
  it("an unknown seat seeds nothing rather than guessing", () => {
    expect(seatStandingTriggers("Momentum Breakout", mintId)).toEqual([]);
  });
});

describe("reseedDiff", () => {
  it("PEAD: the live rules match the template bucket for bucket — nothing to add, nothing foreign", () => {
    const d = reseedDiff("PEAD Specialist", PEAD_LIVE, mintId);
    expect(d.toAdd).toEqual([]);
    expect(d.present).toHaveLength(3);
    expect(d.foreign).toEqual([]);
  });
  it("Catalyst: the two event-date rules would be added; the −10% review is kept as the analyst's own", () => {
    const d = reseedDiff("Catalyst Event PM", CATALYST_LIVE, mintId);
    expect(d.toAdd.map(describeSeatRule)).toEqual([
      "10 days before the event date — review",
      "30 days after the event date — review",
    ]);
    expect(d.foreign.map((t) => t.id)).toEqual(["88ce7423"]);
  });
  it("a fresh analyst gets the whole template", () => {
    const d = reseedDiff("Secular Compounder", [], mintId);
    expect(d.toAdd).toHaveLength(SEAT_STANDING_RULES["Secular Compounder"].length);
    expect(d.present).toEqual([]);
  });
});
