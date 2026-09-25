/**
 * update-thesis.conviction-replay.test.ts — an edit that raises conviction
 * to STRONG/HIGH with no variant view anywhere is SAVED one tier down,
 * through the tool the runs call (DAV-316, DAV-311).
 *
 * Before: `update_thesis` refused "variant_view_required" and the whole
 * edit — levels, triggers, the rationale — was lost with it.
 */
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const existing = () =>
  thesisRow({
    id: "thesis_nvda",
    ticker: "NVDA",
    status: "WATCHING",
    direction: "LONG",
    entryPrice: 130,
    targetPrice: 175,
    stopLoss: 112,
    conviction: "MEDIUM",
    convictionRationale: "Solid, no edge yet.",
    variantView: null,
    analystId: REPLAY_ANALYST_ID,
  });

describe("update_thesis — a patch to STRONG with no variant view", () => {
  it("lands, with conviction stored as MEDIUM and the reason next to the rationale", async () => {
    const { refused, refusal, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [existing()], agentConfig: [agentConfigRow()], account: [accountRow()] },
      args: {
        thesis_id: "thesis_nvda",
        rationale: "Upgrading after the print: the datacenter number cleared the bar we set.",
        conviction: "STRONG",
        conviction_rationale: "Best call on the book this quarter.",
      },
      quotes: { NVDA: 128 },
    });
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    const row = (db.store.thesis as Array<Record<string, unknown>>).find((t) => t.id === "thesis_nvda")!;
    expect(row.conviction).toBe("MEDIUM");
    expect(String(row.convictionRationale)).toMatch(/Stored as MEDIUM: STRONG needs a variant view/);
    expect(db.store.thesisUpdate).toHaveLength(1);
  });

  it("with the variant view on the row already, the upgrade is kept", async () => {
    const { refused, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [existing()], agentConfig: [agentConfigRow()], account: [accountRow()] },
      args: {
        thesis_id: "thesis_nvda",
        rationale: "Upgrading; the edge is stated.",
        conviction: "HIGH",
        conviction_rationale: "Clear edge, want it in size.",
        variant_view: "Consensus models $42B DC; channel checks support $50B+.",
      },
      quotes: { NVDA: 128 },
    });
    expect(refused).toBe(false);
    const row = (db.store.thesis as Array<Record<string, unknown>>).find((t) => t.id === "thesis_nvda")!;
    expect(row.conviction).toBe("HIGH");
  });
});
