/**
 * watch_stock: the chat's soft watch, a stock wanted back at a price or on a
 * day with no view yet. Replay: the chat's watches with no clock, 11-18
 * (CSCO, MLTX, HROW, CGEM, APMD were saved as PASS with status WATCHING and a
 * review at a price). It goes on watch with no view and no playbook, stamped
 * as the owner's add, with its one look-again review written by code as an
 * agent's; later edits of it go through edit_triggers; a stock with a live
 * thesis is refused, by its id.
 */
import type { z } from "zod";
import { replayTool, thesisRow, agentConfigRow, accountRow, triggerSentences, REPLAY_ANALYST_ID } from "@/lib/replay";

const REASON = "Interesting after the readout, but no view until the price comes to us.";
const WHY = "Back at the $8 gap low the readout risk is priced: look again there.";

const watch = (args: Record<string, unknown> = { look_again_price: 8 }, seed: Record<string, unknown[]> = {}, ctx: Record<string, unknown> = {}) =>
  replayTool("watch-stock", "watchStock", {
    seed: { agentConfig: [agentConfigRow()], ...seed },
    ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID, ...ctx },
    args: { ticker: "mltx", reason: REASON, why: WHY, ...args },
    quotes: { MLTX: 9.4 },
  });
const mltx = (db: Awaited<ReturnType<typeof watch>>["db"]) => db.store.thesis.filter((x) => x.ticker === "MLTX");

describe("watch_stock", () => {
  it("puts the stock on watch with no view, stamped as the owner's add, with its one look-again written as an agent's", async () => {
    const { db } = await watch();
    const [t] = mltx(db);
    expect(t).toMatchObject({ status: "WATCHING", direction: null, sourceKind: "USER_ADDED", source: "MANUAL" });
    expect(triggerSentences(t)).toEqual(["Review if below $8"]);
    expect((t.triggers as Array<{ source?: string; rationale?: string }>)[0]).toMatchObject({ source: "AGENT", rationale: WHY });
    expect(db.store.thesisUpdate.filter((u) => (u as { thesisId?: string }).thesisId === t.id).map((u) => (u as { type?: string }).type)).toEqual(["CREATED"]);
  }, 30_000);

  // A day used to be "Review every N days", a clock that every note restarted (the #1051 review).
  it("an event's date is saved as the stock's event date, and the review is the day after it", async () => {
    const day = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const { db } = await watch({ look_again_event_date: day });
    const [t] = mltx(db);
    expect(triggerSentences(t)).toEqual(["Review 1 day after the event date"]);
    expect((t as { catalystDate?: Date }).catalystDate?.toISOString().slice(0, 10)).toBe(day);
  }, 30_000);

  it("after the next report is the day after it", async () => {
    const { db } = await watch({ look_again_after_next_report: true });
    expect(triggerSentences(mltx(db)[0])).toEqual(["Review if within 1 day after earnings"]);
  }, 30_000);

  it("exactly one look-again: none or two is refused, and nothing is written", async () => {
    for (const args of [{}, { look_again_price: 8, look_again_event_date: "2026-12-17" }, { look_again_after_next_report: true, look_again_event_date: "2026-12-17" }]) {
      const { result, db } = await watch(args);
      expect(result.data).toMatchObject({ status: "FAILED" });
      expect(String(result.data?.note)).toMatch(/exactly one of look_again_price, look_again_after_next_report or look_again_event_date/);
      expect(mltx(db)).toHaveLength(0);
    }
  }, 30_000);

  it("the chat with no analyst pinned names the analyst", async () => {
    const { db } = await watch({ look_again_price: 8, analyst_id: REPLAY_ANALYST_ID }, {}, { analystId: undefined });
    expect(mltx(db).map((t) => t.status)).toEqual(["WATCHING"]);
  }, 30_000);

  it("a stock with a live thesis is refused, by its id, and nothing is written", async () => {
    const live = thesisRow({ id: "mltx_live", ticker: "MLTX", status: "WATCHING", direction: "LONG", analystId: REPLAY_ANALYST_ID });
    const { result, db } = await watch({ look_again_price: 8 }, { thesis: [live] });
    expect(result.data).toMatchObject({ status: "FAILED", thesis_id: "mltx_live" });
    expect(mltx(db)).toHaveLength(1);
  }, 30_000);
});

describe("later, its look-again moves with edit_triggers, past the seed rule", () => {
  it("the agent's review on a no-view watch is edited, not refused as a seed's", async () => {
    let schema!: z.ZodTypeAny;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
      const { editTriggers } = await import("./edit-triggers");
      schema = (editTriggers({ runId: "r", userId: "u", accountId: "a", runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
    });
    const review = { id: "look-again", action: "REVIEW", predicate: { watch: "price", is: "below", value: 8 }, rationale: WHY, source: "AGENT", fireMode: "NEXT_MORNING" };
    const { db } = await replayTool("edit-triggers", "editTriggers", {
      seed: {
        thesis: [thesisRow({ id: "mltx_watch", ticker: "MLTX", status: "WATCHING", direction: null, analystId: REPLAY_ANALYST_ID, triggers: [review] })],
        agentConfig: [agentConfigRow()],
        account: [accountRow()],
      },
      args: schema.parse({ thesis_id: "mltx_watch", edit: [{ id: "look-again", value: 7.5, rationale: "The gap low moved: $7.50." }] }) as Record<string, unknown>,
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID },
      quotes: { MLTX: 9.4 },
    });
    expect(triggerSentences(db.store.thesis.find((x) => x.id === "mltx_watch")!)).toEqual(["Review if below $7.50"]);
  }, 30_000);
});
