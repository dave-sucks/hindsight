/**
 * declined-sale.lapse.replay.test.ts — an expired sale is a lapse, not a
 * decline (the owner's ruling, 2026-10-13).
 *
 * A lapse is a soft pass: "not now, ask me again". The owner sees every
 * proposal and lets a sale lapse when he wants to see the next day; while the
 * price is still past the floor he expects it proposed again with that day's
 * reasons. Until this, an EXPIRED sale counted as a decline, and on 10-13:
 *
 *  - NVDA (PEAD Specialist): the morning run lowered the floor $236 → $217
 *    at 08:01 ET under the after-a-decline exception. None of its sales had
 *    been declined in the window; two had lapsed (the third was still
 *    waiting for an answer).
 *  - MU: complete_run told the same run "You declined this sale 2×", and its
 *    note repeated "You declined this sale twice already." MU's floor sale
 *    has lapsed five times since 09-29 (four by that morning; the fifth, the
 *    10-12 proposal, was still waiting), and the 7-day window held two.
 *
 * Production rows, read-only, in lib/agent/__fixtures__/sale-lapses-2026-10-13.json.
 * Every case runs a tool's real entry point; NVDA's call is the model's
 * verbatim, sent through the SDK's loop to the morning run's save.
 */
import { generateText, stepCountIs, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { statSync } from "fs";
import fixture from "@/lib/agent/__fixtures__/sale-lapses-2026-10-13.json";
import { replayTool, thesisRow, positionRow, REPLAY_ACCOUNT_ID, REPLAY_RUN_ID, REPLAY_USER_ID, type Replay, type Row } from "@/lib/replay";
import { declinedSaleLine } from "@/lib/agent/declined-sale";
import { needsActionFlag } from "@/lib/agent/needs-action-line";
import { rowForModel } from "@/lib/agent/row-for-model";
import type { NeedsAction } from "@/lib/agent/needs-action";
import type { z } from "zod";

const FIXTURE = "lib/agent/__fixtures__/sale-lapses-2026-10-13.json";
const NVDA_FLOOR_ID = "6306936b-bb02-4298-9ca0-90f586772512";

type Order = Row & { createdAt: string; expiresAt: string | null; updatedAt: string };
type Entry = { at: string; price: number; thesis: Row; position: Row & { openedAt: string }; orders: Order[] };
const fx = fixture as unknown as {
  nvda: Entry & { call: Record<string, unknown> };
  mu: Entry & { decline0916: Order };
  asml: Entry;
};

const dated = (r: Row, keys: string[]) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) && typeof v === "string" ? new Date(v) : v]));
const orderRow = (o: Order): Row => ({ userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID, orderType: "MARKET", thesisId: null, ...dated(o, ["createdAt", "expiresAt", "updatedAt"]) });

function seedOf(ticker: string, e: Entry, orders: Order[] = e.orders): Record<string, Row[]> {
  return {
    thesis: [thesisRow(dated({ ...e.thesis, ticker }, ["createdAt", "lastReviewedAt", "researchUpdatedAt", "catalystDate"]))],
    position: [positionRow({ ...dated(e.position, ["openedAt"]), symbol: ticker, environment: "LIVE" })],
    order: orders.map(orderRow),
  };
}

/** The clock at a production moment; the SDK's and the double's timers stay real. */
async function at<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    return await fn();
  } finally {
    jest.useRealTimers();
  }
}

/** The morning run's real save schema, read without a database. */
async function morningRunSchema(): Promise<z.ZodTypeAny> {
  let schema: z.ZodTypeAny | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { updateThesis } = await import("./tools/update-thesis");
    schema = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "MORNING_PLAN" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return schema!;
}

/** NVDA's 08:01 ET call as the model sent it, through the SDK's loop, to the real save. */
async function nvdaSave(orders: Order[]): Promise<{ received: Record<string, unknown>; save: Replay }> {
  const schema = await morningRunSchema();
  return at(fx.nvda.at, async () => {
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    let turn = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () =>
        ++turn === 1
          ? { content: [{ type: "tool-call", toolCallId: "c1", toolName: "update_thesis", input: JSON.stringify(fx.nvda.call) }], finishReason: { unified: "tool-calls", raw: undefined }, usage, warnings: [] }
          : { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] },
    } as never);
    const out: { received?: Record<string, unknown>; save?: Replay } = {};
    await generateText({
      model,
      prompt: "review",
      tools: {
        update_thesis: tool({
          inputSchema: schema as never,
          execute: async (input: Record<string, unknown>) => {
            out.received = input;
            out.save = await replayTool("update-thesis", "updateThesis", {
              seed: seedOf("NVDA", fx.nvda, orders),
              args: input,
              ctx: { runMode: "MORNING_PLAN", runEnvironment: "LIVE" },
              quotes: { NVDA: fx.nvda.price },
            });
            return out.save.result;
          },
        }),
      },
      stopWhen: stepCountIs(2),
    });
    if (!out.save || !out.received) throw new Error("NVDA: the SDK never reached the save");
    return { received: out.received, save: out.save };
  });
}

const floorOp = (save: Replay) =>
  (save.result.data as { trigger_ops?: Array<{ id: string; ok: boolean; reason?: string }> } | undefined)?.trigger_ops?.find((o) => o.id === NVDA_FLOOR_ID);
const floorValue = (save: Replay) =>
  (save.db.store.thesis[0].triggers as Array<{ id: string; predicate: { value: number } }>).find((t) => t.id === NVDA_FLOOR_ID)?.predicate.value;

type ReadRow = Row & { ticker: string; needsAction?: NeedsAction | null; heldThroughFloor?: Row | null };

/** A morning read of one stock at a production moment. */
async function morningRead(ticker: string, e: Entry, orders: Order[] = e.orders): Promise<ReadRow> {
  return at(e.at, async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: seedOf(ticker, e, orders),
      args: { detail: "actionable" },
      ctx: { runMode: "MORNING_PLAN", runEnvironment: "LIVE" },
      quotes: { [ticker]: e.price },
    });
    const rows = ((result.data as { theses?: ReadRow[] } | undefined)?.theses ?? []);
    const row = rows.find((r) => r.ticker === ticker);
    if (!row) throw new Error(`${ticker}: not on the read`);
    return row;
  });
}

const lineOf = (row: ReadRow) => {
  const na = row.needsAction;
  if (na?.kind !== "SALE_DECLINED") throw new Error(`expected SALE_DECLINED, got ${na?.kind}`);
  return declinedSaleLine(na);
};

describe("NVDA 10-13 08:01 ET: a lapse never lowers a floor", () => {
  it("the verbatim call: the loosening is refused by the ratchet with its reason, and the rest of the call lands", async () => {
    const { received, save } = await nvdaSave(fx.nvda.orders);
    // The orders as they stood: two lapsed in the window, one still waiting, two real declines a month old.
    expect(fx.nvda.orders.map((o) => o.status)).toEqual(["EXPIRED", "REJECTED", "REJECTED", "EXPIRED", "EXPIRED", "AWAITING_APPROVAL"]);
    expect(received.stop_loss).toBe(217);
    expect(save.crashed).toBe(false);

    expect(floorOp(save)?.ok).toBe(false);
    expect(floorOp(save)?.reason ?? "").toMatch(/"Sell if below \$236" → "Sell if below \$217" — that weakens the protection on a stock we own/);
    const row = save.db.store.thesis[0];
    expect(row.stopLoss).toBe(236);
    expect(floorValue(save)).toBe(236);
    // The rest of the call lands: its conviction note and the one Activity line.
    expect(row.convictionRationale).toBe(fx.nvda.call.conviction_rationale);
    expect((save.db.store.thesisUpdate ?? []).map((u) => u.type)).toEqual(["UPDATED"]);
  });

  it("variant, with one real decline in the window (NVDA's own 09-16 decline moved 21 days on): the 15% re-plan is still allowed", async () => {
    const decline = fx.nvda.orders.find((o) => o.status === "REJECTED" && o.createdAt.startsWith("2026-09-16"))!;
    const shift = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 21 * 86_400_000).toISOString() : null);
    const moved: Order = { ...decline, id: "nvda_decline_moved", createdAt: shift(decline.createdAt)!, expiresAt: shift(decline.expiresAt), updatedAt: shift(decline.updatedAt)! };
    const { save } = await nvdaSave([...fx.nvda.orders, moved]);

    expect(save.crashed).toBe(false);
    expect(floorOp(save)?.ok).toBe(true);
    expect(save.db.store.thesis[0].stopLoss).toBe(217);
    expect(floorValue(save)).toBe(217);
  });
});

describe("MU 10-13 before 08:00 ET: the read says lapses, not declines", () => {
  it("the work item and the row count two lapses and no decline, and the line says so", async () => {
    // The run's own read said heldThroughCount 2, declineCount 2.
    expect((fx.mu as unknown as { readThen: { needsAction: { declineCount: number } } }).readThen.needsAction.declineCount).toBe(2);
    const row = await morningRead("MU", fx.mu);

    expect(row.needsAction).toMatchObject({ kind: "SALE_DECLINED", declineCount: 0, lapseCount: 2, floorPrice: 1005 });
    expect(row.heldThroughFloor).toMatchObject({ floorPrice: 1005, declined: 0, lapsed: 2 });
    // What the model reads of the row.
    expect((rowForModel(row, { named: true, size: "full" }) as Row).heldThroughFloor).toMatchObject({ declined: 0, lapsed: 2 });

    // The replay serves no daily bars, so the recent low ($978.50 that morning) is absent here.
    const line = lineOf(row);
    expect(line).toBe(
      "Proposed 2× and left to lapse: not a decline. Most recently 2026-10-09, and the price is still past the $1005.00 line, with no new plan since. While the price is still past the floor, propose it again with today's reasons. A review that changes nothing does not answer it.",
    );
    expect(line).not.toMatch(/declined/i);
    expect(needsActionFlag(row.needsAction!)).toEqual({ name: "Sale lapsed", detail: "2×, last 2026-10-09" });
  });

  it("complete_run, with MU unanswered, says the same thing — the line the run copied on 10-13", async () => {
    const e = fx.mu;
    const { result, crashed } = await at(e.at, () =>
      replayTool("complete-run", "completeRun", {
        seed: {
          ...seedOf("MU", e),
          researchRun: [{ id: REPLAY_RUN_ID, status: "RUNNING", mode: "MORNING_PLAN", agentConfigId: "analyst_replay", parameters: {}, startedAt: new Date(e.at), completedAt: null }],
          runEvent: [{ id: "ev_summary", runId: REPLAY_RUN_ID, type: "run_summary", title: "Run summary", message: "Reviewed the book.", payload: {}, createdAt: new Date(e.at) }],
        },
        args: {},
        ctx: { runEnvironment: "LIVE" },
        quotes: { MU: e.price },
      }),
    );
    expect(crashed).toBe(false);
    const text = JSON.stringify(result);
    expect(result.summary).toMatch(/refused/i);
    expect(text).toContain("MU (");
    expect(text).toContain("Proposed 2× and left to lapse: not a decline.");
    expect(text).not.toContain("You declined");
  });

  it("variant, with MU's own real decline of 09-16 moved into the window: it reads as one decline and two lapses", async () => {
    const d = fx.mu.decline0916;
    const shift = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 21 * 86_400_000).toISOString() : null);
    const row = await morningRead("MU", fx.mu, [...fx.mu.orders, { ...d, createdAt: shift(d.createdAt)!, expiresAt: shift(d.expiresAt), updatedAt: shift(d.updatedAt)! }]);
    expect(row.needsAction).toMatchObject({ declineCount: 1, lapseCount: 2 });
    expect(lineOf(row)).toMatch(/^You declined this sale\. Proposed 2× more and left to lapse: not a decline\./);
  });
});

describe("a real decline still reads as one", () => {
  /**
   * ASML, Secular Compounder: the one real decline in the 7 days before 10-13
   * (proposed 10-07, REJECTED 10-08), after a lapse (proposed 10-06, expired
   * 10-07). It never read as live: the 10-08 08:04 ET morning run had already
   * lowered the floor $1,835 → $1,568 on that lapse alone (the same bug as
   * NVDA's), and the price stayed above $1,568. The variant puts the floor
   * back at $1,835 as it stood before that save; every other row is real,
   * read at the 10-09 morning read's time and price.
   */
  it("variant, ASML with the floor back at $1,835: 'You declined this sale', and the lapse beside it", async () => {
    const triggers = (fx.asml.thesis.triggers as Array<Row & { id: string; predicate: Row }>).map((t) =>
      t.id === "5ebdea7c-a9db-4b6b-918c-b582b2748c41" ? { ...t, predicate: { ...t.predicate, value: 1835 } } : t,
    );
    const row = await morningRead("ASML", { ...fx.asml, thesis: { ...fx.asml.thesis, stopLoss: 1835, triggers } });

    expect(row.needsAction).toMatchObject({ kind: "SALE_DECLINED", declineCount: 1, lapseCount: 1, floorPrice: 1835 });
    expect(row.heldThroughFloor).toMatchObject({ floorPrice: 1835, declined: 1, lapsed: 1 });
    const line = lineOf(row);
    expect(line).toMatch(/^You declined this sale\. Proposed once more and left to lapse: not a decline\. Most recently 2026-10-08, and the price is still past the \$1835\.00 line/);
    expect(line).toContain("Answer it: re-draw the floor");
    expect(needsActionFlag(row.needsAction!)).toEqual({ name: "Sale declined", detail: "1 declined, 1 lapsed, last 2026-10-08" });
  });
});

it("the fixture holds only the fields the save and the read use, under the cap", () => {
  expect(statSync(FIXTURE).size).toBeLessThan(30 * 1024);
  for (const e of [fx.nvda, fx.mu, fx.asml]) {
    expect(Object.keys(e.thesis)).not.toEqual(expect.arrayContaining(["snapshot"]));
    expect(Object.keys(e.thesis)).not.toEqual(expect.arrayContaining(["bullCase"]));
    for (const o of e.orders) if (o.rejectionMessage) expect(o.rejectionMessage).toMatch(/not kept/);
  }
});
