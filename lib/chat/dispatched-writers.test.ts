/**
 * A replayed chat renders the result that was STORED. `ui` is part of that
 * stored envelope, so a tool that changes how it renders leaves every past
 * message looking the way it used to — the dispatch rows in an old chat kept
 * printing a raw run id and an ETA after the writing table shipped.
 *
 * The shape below is a real pre-change dispatch result. It still carries
 * everything the table needs, which is why routing by tool NAME fixes the
 * whole history rather than only new calls.
 */
import { collectDispatched } from "./dispatched-writers";

const legacyPart = {
  toolName: "dispatch_thesis_research",
  toolCallId: "call_1",
  result: {
    ok: true,
    ui: "tool-ui", // what it stored before the writing table existed
    summary: "Dispatched thesis-writer for $RARE (mint) — child run cmtgoa0zf000e04jmr56og7cy",
    data: {
      childRunId: "cmtgoa0zf000e04jmr56og7cy",
      ticker: "RARE",
      mode: "mint",
      analystName: "Catalyst Event PM",
      estimatedDurationMs: 240_000,
      items: [
        { kind: "ticker", ticker: "RARE", tag: "mint dispatched", text: "Worker spawned…" },
        { kind: "generic", text: "Watch progress at /runs/cmtgoa0zf000e04jmr56og7cy. ETA ~3-4 min." },
      ],
    },
    sources: [],
  },
};

describe("a dispatch written before the writing table still renders in it", () => {
  it("reads the row out of a legacy result", () => {
    expect(collectDispatched([legacyPart as never])).toEqual([
      {
        childRunId: "cmtgoa0zf000e04jmr56og7cy",
        ticker: "RARE",
        analystName: "Catalyst Event PM",
        mode: "mint",
      },
    ]);
  });

  it("skips a refused dispatch, which has no run to watch", () => {
    const refused = {
      toolName: "dispatch_thesis_research",
      result: {
        ok: true,
        ui: "tool-ui",
        summary: "Dispatch failed: analyst not found",
        data: { childRunId: null, ticker: "RARE" },
        sources: [],
      },
    };
    expect(collectDispatched([refused as never])).toEqual([]);
  });

  it("falls back rather than inventing an analyst name", () => {
    const noAnalyst = {
      toolName: "dispatch_thesis_research",
      result: {
        ok: true,
        ui: "tool-ui",
        summary: "",
        data: { childRunId: "run_1", ticker: "KOD" },
        sources: [],
      },
    };
    expect(collectDispatched([noAnalyst as never])[0].analystName).toBe("an analyst");
  });
});
