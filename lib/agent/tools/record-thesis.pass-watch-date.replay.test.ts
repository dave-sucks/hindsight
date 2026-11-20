/**
 * A stock kept on watch with no view can take the event date (2026-09-25).
 *
 * The discovery review said the SMMT and COGT rows "can't hold the FDA
 * date" — the pre-decision review could never fire on them. The rows have
 * no date because the chat never passed one; the save stores it when
 * given. Pinned here so the claim has an answer, through the real tool.
 */
import { replayTool, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay";

describe("update_thesis(catalyst_date) on a pass kept on watch", () => {
  it("COGT as saved on 09-24 — a wake, no date — takes the date from one edit", async () => {
    const wake = { id: "w1", predicate: { watch: "price", is: "below", value: 27 }, action: "REVIEW", rationale: "Pullback — look again.", source: "AGENT" };
    const { refused, refusal, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesisRow({ id: "cogt", ticker: "COGT", status: "WATCHING", direction: null, catalystDate: null, entryPrice: null, targetPrice: null, stopLoss: null, triggers: [wake] })] },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID },
      args: { thesis_id: "cogt", catalyst_date: "2026-11-30T00:00:00.000Z", rationale: "FDA decision date from the company's release: November 30, 2026." },
    });
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    expect(new Date(db.store.thesis[0].catalystDate as Date).toISOString()).toBe("2026-11-30T00:00:00.000Z");
  });

  it("a watched pass with NO wake is still treated as an unresearched seed: the date edit is refused without a direction", async () => {
    // Documented, not endorsed: the gate's exemption is trigger-based. A pass
    // kept on watch with no wake reads as a seed to update_thesis, and a
    // date-only edit needs a direction it does not have.
    const { refused, refusal } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesisRow({ id: "smmt", ticker: "SMMT", status: "WATCHING", direction: null, catalystDate: null, entryPrice: null, targetPrice: null, stopLoss: null, triggers: [] })] },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID },
      args: { thesis_id: "smmt", catalyst_date: "2026-11-14T00:00:00.000Z", rationale: "FDA date." },
    });
    expect(refused).toBe(true);
    expect(refusal?.error).toBe("pending_update_without_direction");
  });
});

