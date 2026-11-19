/**
 * update-thesis-morning-claim.replay.test.ts — a morning save that sends the
 * claim: no tool the morning run has takes it, and the rest lands (step 12,
 * part 1; one job a tool since 2026-11-18, the horizon the Writer's too).
 *
 * No morning thread of the 30 days to 2026-10-09 (0 of 45) carried an
 * update_thesis with core_belief: the morning run had already stopped writing
 * claims. The newest that did is MNKD, 2026-07-27 12:00 ET (run
 * cms36e9lj000904l5b08231bp): a held CATALYST stock re-planned after its
 * event, with a new belief, new assumptions and new what-proves-it-wrong. That
 * real call, as the calls the morning run makes now, through the SDK's loop to its real tools, on
 * MNKD's row as that run's own read carried it
 * (lib/agent/__fixtures__/morning-claim-2026-07-27.json). The call also
 * carries fields the save no longer has at all (structural_unchanged_reason,
 * max_hold_days, next_review_at, a whole trigger list); the SDK drops those
 * the same way.
 */
import { statSync } from "fs";
import fixture from "@/lib/agent/__fixtures__/morning-claim-2026-07-27.json";
import { oldLevelFieldsAsTriggerOps, sendAsTheRunWould, thesisRow, positionRow, type Row } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

const FIXTURE = "lib/agent/__fixtures__/morning-claim-2026-07-27.json";
const THE_CLAIM = ["core_belief", "key_assumptions", "invalidation_conditions"];
const GONE_BEFORE = ["price_at_time", "structural_unchanged_reason", "max_hold_days", "next_review_at", "triggers", "horizon"];

type Entry = { call: Record<string, unknown>; price: number; position: { avgCost: number }; thesis: Row };
const entry = fixture as unknown as Entry;

const sentVerbatim = () =>
  sendAsTheRunWould(oldLevelFieldsAsTriggerOps(entry.call, (entry.thesis.triggers ?? []) as unknown as Trigger[], "LONG"), {
    seed: { thesis: [thesisRow({ ...entry.thesis })], position: [positionRow({ symbol: "MNKD", avgCost: entry.position.avgCost })] },
    ctx: { runMode: "MORNING_PLAN" },
    quotes: { MNKD: entry.price },
  });

describe("MNKD 07-27: the newest morning call that sent the claim", () => {
  it("the claim and the horizon reach no tool; the note and the trigger edits land; the stored claim and horizon are the writer's still", async () => {
    const { received, save } = await sentVerbatim();
    for (const f of [...THE_CLAIM, ...GONE_BEFORE]) expect([f, f in entry.call, f in received]).toEqual([f, true, false]);
    expect(received).toMatchObject({ thesis_id: entry.call.thesis_id, note: entry.call.rationale });
    expect(JSON.stringify([received.edit, received.add])).toMatch(/"value":4\b[\s\S]*"value":5.5\b/);
    expect(save.crashed).toBe(false);
    expect(save.refused).toBe(false);
    const row = save.db.store.thesis[0];
    expect(row.coreBelief).toBe(entry.thesis.coreBelief);
    expect(row.keyAssumptions).toEqual(entry.thesis.keyAssumptions);
    expect(row.invalidationConds).toEqual(entry.thesis.invalidationConds);
    expect(row.horizon).toBe(entry.thesis.horizon);
    const written = (save.db.store.thesisUpdate ?? []).filter((u) => u.type !== "TRIGGER_FIRED");
    expect(written.filter((u) => u.rationale).map((u) => u.rationale)).toEqual([entry.call.rationale]);
    for (const w of written) for (const k of ["coreBelief", "keyAssumptions", "invalidationConds", "horizon"]) expect(w.fieldChanges ?? {}).not.toHaveProperty(k);
  });

  it("the fixture holds only the fields the save reads, under the cap", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(40 * 1024);
  });
});
