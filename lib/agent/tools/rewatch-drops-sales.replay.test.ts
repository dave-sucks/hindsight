/**
 * A sale back to watch takes the stock's Sell lines off in the same step, so
 * "Sell if exists only on a holding" is true in the data, not only in the
 * ladder that reads it (2026-11-16).
 *
 * ANET, as production stores it on 2026-11-16 (read-only): sold 2026-09-01
 * on a stop, RETIRED (SOLD), still carrying its two Sell lines (below $184.50,
 * and 4% off the high). Both ways back to watch:
 *   - the close path that keeps a stock WATCHING (closeThesisForPosition, a
 *     protective exit whose belief survived), on ANET as it stood held;
 *   - update_thesis change_status WATCHING on the sold row, through its real
 *     entry point.
 */
import { prismaDouble, replayTool, thesisRow, REPLAY_ANALYST_ID, triggerSentences } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

const ANET_ID = "cmt0zqjmc000504l5zq6djk32";
const TRIGGERS = [
  { id: "09a4a3f1-6a7d-4e39-9506-9f5cf0c50ed2", action: "EXIT", fireMode: "ASK_NOW", predicate: { is: "below", value: 184.5, watch: "price" }, rationale: "Hard stop at $175.99."},
  { id: "61c7c342-b7b5-47fc-8939-680fa3da5c9e", action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { is: "above", value: 215, watch: "price" }, rationale: "Target $215 hit. Decide: close at target or trail higher with confidence intact."},
  { id: "f57a2801-773b-463b-ba5c-957d9989060d", action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { is: "beat", value: 0, watch: "surprise" }, rationale: "Beat — possibly a reason to extend the target."},
  { id: "8bfc23b7-ab85-4034-a86b-6ebc3cb7a9c6", action: "REVIEW", fireMode: "NEXT_MORNING", predicate: { is: "miss", value: 3, watch: "surprise" }, rationale: "Miss ≥ 3% — re-evaluate target."},
  { id: "df7e2d95-dd24-422c-a506-d8728ed686ba", action: "EXIT", fireMode: "DO_IT", predicate: { is: "below", value: 4, watch: "move", variable: "peak" }, rationale: "Gave back 4% from the high."},
];
const ANET = { id: ANET_ID, ticker: "ANET", direction: "LONG", horizon: "TARGET", setupId: null, triggers: TRIGGERS, analystId: REPLAY_ANALYST_ID };
const sales = (ts: unknown) => (ts as Trigger[]).filter((t) => t.action === "EXIT");

describe("ANET back to watch: its Sell lines come off with the status", () => {
  it("the close path that keeps it WATCHING (belief survived) leaves no Sell line", async () => {
    const db = prismaDouble({ thesis: [thesisRow({ ...ANET, status: "HOLDING" })] });
    expect(sales(TRIGGERS)).toHaveLength(2);
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      const { closeThesisForPosition } = await import("@/lib/proposals/thesis-flips");
      await closeThesisForPosition({ analystId: REPLAY_ANALYST_ID, ticker: "ANET", positionId: "p_anet", closeReason: "STOP", rationale: "Sold on the stop; the belief holds.", beliefSurvived: true });
    });
    const row = (db.store.thesis as Array<Record<string, unknown>>)[0];
    expect(row.status).toBe("WATCHING");
    expect(sales(row.triggers)).toEqual([]);
  });

  it("update_thesis change_status WATCHING on the sold row takes both Sell lines off, each a line in Activity", async () => {
    const r = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [thesisRow({ ...ANET, status: "RETIRED", retiredReason: "SOLD", closedAt: new Date("2026-09-01T17:48:11.563Z"), closeReason: "STOP" })] },
      args: { thesis_id: ANET_ID, change_status: "WATCHING", rationale: "The sale review: the drift case holds, so ANET goes back on watch for a reclaim." },
      ctx: { runMode: "MORNING_PLAN" },
      quotes: { ANET: 180 },
    });
    expect(r.refused).toBe(false);
    const row = r.db.store.thesis[0] as Record<string, unknown>;
    expect(row).toMatchObject({ status: "WATCHING", retiredReason: null });
    expect(triggerSentences(row).some((t) => t.startsWith("Sell if"))).toBe(false);
    expect(sales(row.triggers)).toEqual([]);
    expect((row.triggers as Trigger[]).map((t) => t.id)).toEqual(TRIGGERS.filter((t) => t.action !== "EXIT").map((t) => t.id));
    const ops = (r.result.data?.trigger_ops ?? []) as Array<{ op: string; ok: boolean; text: string }>;
    expect(ops.filter((o) => o.op === "remove" && o.ok).map((o) => o.text)).toEqual(["Removed: Sell if below $184.50", "Removed: Sell if below 4% from the high since we bought"]);
  });
});
