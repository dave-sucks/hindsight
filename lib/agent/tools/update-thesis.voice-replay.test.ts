/**
 * update-thesis.voice-replay.test.ts — Visa, 2026-10-05. The trigger run
 * sent its note plus `structural_unchanged_reason`, and the tool stored
 * "<note>\n\n[Belief unchanged: <reason>]" — the bracket under 94 of 274
 * Activity notes in ten days. The field is gone (lib/agent/voice.ts); the
 * note is stored as written. Fails on main, which appends the bracket.
 */
import { replayTool, thesisRow } from "@/lib/replay";

describe("Visa, 2026-10-05: the trigger run's Activity note is saved as written", () => {
  it("the bracket the old reason field added is gone, and the note is word for word", async () => {
    const rationale =
      "Proposed buying Visa at $368.90. My $368.50 buy level hit at $368.97 and held, just above the rising 50-day average ($368.67). Stop stays $344, target $434.";
    const { refused, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesisRow({ ticker: "V", entryPrice: 368.5, targetPrice: 434, stopLoss: 344 })] },
      // What the run sent that day: the note, and the reason the field
      // turned into "[Belief unchanged: …]". The field is gone; a model
      // that still sends it is not refused, and nothing is appended.
      args: {
        thesis_id: "thesis_replay",
        rationale,
        structural_unchanged_reason:
          "The core belief is unchanged because nothing in the fresh data contradicts the key assumptions: no guidance cut, no management disruption, no evidence of yield compression, and no sign that Visa's stablecoin strategy is stalling.",
        price_at_time: 368.9,
      },
      quotes: { V: 368.9 },
    });
    expect(refused).toBe(false);
    const rows = db.store.thesisUpdate as Array<{ rationale: string }>;
    expect(rows.map((r) => r.rationale)).toEqual([rationale]);
  });
});

