/**
 * notes.replay.test.ts — a conclusion reached in chat reaches the analyst
 * (docs/plans/AGENT_CONTEXT.md §3.1). DOCU, 2026-09-30: in an unscoped chat the
 * principal settled why the starter was small and what would change their
 * mind. None of it reached DOCU's analyst. (The add above $74.07 agreed in the
 * same chat is a trigger, not a note.) Through
 * write_note's and get_theses's real entry points, on DOCU's stored rows
 * (lib/agent/__fixtures__/docu-note-2026-09-30.json).
 */
import raw from "@/lib/agent/__fixtures__/docu-note-2026-09-30.json";
import { replayTool, thesisRow, positionRow, REPLAY_ANALYST_ID } from "@/lib/replay";

type Row = Record<string, unknown>;
const fx = raw as unknown as {
  thesis: Row & { createdAt: string; lastReviewedAt: string };
  position: Row & { openedAt: string };
  rows: Array<Row & { timestamp: string; runMode: string | null }>;
  note: string;
  readAt: string;
  price: number;
};
const onAnalyst = { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { name: "PEAD Specialist", setupIds: ["PEAD", "MA_PULLBACK"], enabled: true } };
const seed = (lines: Row[]) => ({
  thesis: [thesisRow({ ...fx.thesis, createdAt: new Date(fx.thesis.createdAt), lastReviewedAt: new Date(fx.thesis.lastReviewedAt), researchRun: onAnalyst })],
  position: [positionRow({ ...fx.position, analystId: REPLAY_ANALYST_ID, openedAt: new Date(fx.position.openedAt) })],
  thesisUpdate: lines,
});
const stored = fx.rows.map((r) => ({
  ...r,
  thesisId: fx.thesis.id,
  timestamp: new Date(r.timestamp),
  run: r.runMode ? { mode: r.runMode } : null,
  signalIds: [],
  tradeId: null,
  positionAtTime: null,
}));

describe("DOCU: the principal's note, from an unscoped chat to the next morning run", () => {
  it("write_note lands one NOTE line on DOCU with the price then, and nothing else", async () => {
    const { refused, db } = await replayTool("write-note", "writeNoteTool", {
      seed: seed(stored) as never,
      args: { thesis_id: fx.thesis.id, note: fx.note },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: undefined },
      quotes: { DOCU: 67.9 },
    });
    expect(refused).toBe(false);
    const notes = (db.store.thesisUpdate as Row[]).filter((u) => u.type === "NOTE");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ thesisId: fx.thesis.id, rationale: fx.note, priceAtTime: 67.9, });
    expect(Object.keys(notes[0].fieldChanges ?? {})).toEqual([]); // information only: nothing to replace or resolve
  });

  it("the next look at DOCU reads the note as one of its newest lines, whole, with the price then; the note puts DOCU on no list", async () => {
    const written = await replayTool("write-note", "writeNoteTool", {
      seed: seed(stored) as never,
      args: { thesis_id: fx.thesis.id, note: fx.note },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: undefined },
      quotes: { DOCU: 67.9 },
    });
    jest.useFakeTimers({ now: new Date(fx.readAt), doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"] });
    try {
      const { result } = await replayTool("get-theses", "getTheses", {
        // The chat wrote the note at 13:05 ET, after the 12:25 approval (the double stamped it with today).
        seed: seed((written.db.store.thesisUpdate as Row[]).map((u) => ({ ...u, timestamp: u.type === "NOTE" ? new Date("2026-09-30T17:05:00Z") : u.timestamp }))) as never,
        args: { tickers: ["DOCU"] },
        ctx: { runMode: "MORNING_PLAN" },
        quotes: { DOCU: fx.price },
      });
      const docu = (result as unknown as { data: { theses: Array<{ ticker: string; context: string; situations: string[] }> } }).data.theses.find((t) => t.ticker === "DOCU");
      expect(docu).toBeDefined();
      // The owner's note and the resized approval are no situation: nothing asks a run to answer them.
      expect(docu!.situations).toEqual([]);
      expect(docu!.context.startsWith("Activity on $DOCU in the last 45 days, newest first")).toBe(true);
      expect(docu!.context).toContain("Note by you, Sep 30, 1:05 PM at $67.90: Bought a starter");
      expect(docu!.context).toContain("IAM stalls under 17% of ARR");
      // The resized approval carries no words, so it is on the Activity tab and not in the agent's list.
      expect(docu!.context).not.toContain("Bought 120 shares");
    } finally {
      jest.useRealTimers();
    }
  });
});
