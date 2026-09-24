/** Proves the harness reaches a real execute. Replaces no test; guards the harness. */
import { replayTool, thesisRow } from "@/lib/replay";

describe("the replay harness reaches a tool's real entry point", () => {
  it("reads the refusal out of the envelope, not off the misleading top-level ok", async () => {
    const { result, refused, refusal } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesisRow({ id: "t1", status: "PASSED" })] },
      args: { thesis_id: "t1", rationale: "Revisiting a pass." },
    });
    // The trap: the envelope says ok on a refused call.
    expect(result.ok).toBe(true);
    expect(refused).toBe(true);
    expect(refusal?.error).toBe("terminal_status");
  });

  it("runs update_thesis end to end and writes its audit row", async () => {
    const { refused, db, calls } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesisRow({ id: "t1", ticker: "AAA" })] },
      args: { thesis_id: "t1", rationale: "Re-affirming after a look at the chart; nothing changed." },
    });
    expect(calls).toContain("thesis.findUnique");
    expect(refused).toBe(false);
    expect(db.store.thesisUpdate.length).toBeGreaterThan(0);
  });

  it("names the export when it is wrong, instead of failing obscurely", async () => {
    await expect(replayTool("update-thesis", "nope", {})).rejects.toThrow(/no exported tool "nope"/);
  });

  // The harness doubles the broker. A replay that quietly placed a real order
  // would be worse than having no test, so the stub throws by construction.
  it("refuses to reach a broker", async () => {
    await expect(
      replayTool("update-thesis", "updateThesis", {
        seed: { thesis: [thesisRow({ id: "t1" })] },
        args: { thesis_id: "t1", rationale: "n/a" },
        mocks: {
          "@/lib/agent/tools/update-thesis": () => ({
            updateThesis: () => ({
              execute: async () => {
                const { placeMarketOrder } = await import("@/lib/alpaca");
                return placeMarketOrder({} as never);
              },
            }),
          }),
        },
      }),
    ).rejects.toThrow(/must never place or cancel a real order/);
  });
});
