/**
 * hand-removal.replay.test.ts — a trigger the principal removes by hand
 * stays known to the agents, in the row's `said`.
 *
 * ABT, Secular Compounder (lib/agent/__fixtures__/abt-hand-removal-2026-10-06.json):
 *
 *  - 10-06 (ET) the principal added a buy above $100.60 (15:42), changed it
 *    to a buy 6% below the close 5 days ago (15:45), removed it (16:15) and
 *    added a review above $10 (17:12). The 10-07 morning run's `said` listed
 *    the add, the change and the review, never the removal, and the run set
 *    a buy at $100.60 again.
 *  - 10-07 the principal added a review below $110 (10:04), it fired (10:05)
 *    and they removed it (10:58). The 10-08 morning run's `said` listed the
 *    add and the fire, not the removal.
 *
 * Two parts: since the last answer, a removal is one of the principal's
 * decisions, read like any hand edit; and a "Removed by the principal" block,
 * whose header says once what it asks, keeps the newest three after a run has
 * answered, until a trigger reading the same is back on the stock. The 09-28
 * cleanup of copied rules is in neither.
 *
 * The wording is written out here, not imported, so the test pins it.
 */
import raw from "@/lib/agent/__fixtures__/abt-hand-removal-2026-10-06.json";
import { principalDecision, buildStockContext, type ActivityRow } from "@/lib/agent/stock-context";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { rowForModel, sizeFor } from "@/lib/agent/row-for-model";
import { replayTool, prismaDouble, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

type Line = { id: string; type: string; timestamp: string; triggerId: string | null; summary: string; rationale: string | null; fieldChanges: Record<string, unknown>; runId: string | null; priceAtTime: number | null; runMode: string | null };
type Listed = { id: string; action: string; predicate: unknown; says: string; rationale?: string; cooldownDays?: number; setBy?: string };
type At = { entryPrice: number | null; targetPrice: number | null; stopLoss: number | null; lastReviewedAt: string; researchUpdatedAt: string; triggers: Listed[] };
type Read = { id: string; readAt: string; price: number; said: string };
const fx = raw as unknown as {
  runs: Record<"morning1007" | "morning1008", Read>;
  thesis: { id: string; ticker: string; status: string; direction: string; horizon: string; setupId: string; createdAt: string };
  at: Record<"morning1007" | "morning1008", At>;
  updates: Line[];
  removedBuy: Listed;
};

const HEADER = "Removed by the principal (don't add these back unless the thesis changes):";
/** The ask is said once, in the header: never on a line. */
const KEEP = "Don't add it back";
const REMOVED_BUY = "Buy if below 6% from the close 5 days ago";
const toRow = (l: Line): ActivityRow => ({ ...l, timestamp: new Date(l.timestamp) });
const rowsBefore = (iso: string) => fx.updates.filter((u) => new Date(u.timestamp).getTime() < new Date(iso).getTime()).map(toRow);
/** A listed trigger as the thesis stores it. */
const stored = (t: Listed) => ({ id: t.id, action: t.action, predicate: t.predicate, rationale: t.rationale, cooldownDays: t.cooldownDays, source: t.setBy }) as unknown as Trigger;
const ladder = (key: "morning1007" | "morning1008") => fx.at[key].triggers.map(stored);
const line = (pred: (l: Line) => boolean) => toRow(fx.updates.find(pred)!);
const removal1006 = line((u) => u.summary.startsWith("You removed a trigger on ABT: Buy if below 6%"));
const cleanup = line((u) => u.summary.startsWith("Removed a copied rule from ABT"));

describe("the fixture is the production case", () => {
  it("the predicates rebuilt from the reads say what the reads said", () => {
    for (const t of [...fx.at.morning1007.triggers, ...fx.at.morning1008.triggers, fx.removedBuy]) {
      expect(sentenceOf(t as never, false)).toBe(t.says); // ABT was watched
    }
    expect(fx.removedBuy.says).toBe(REMOVED_BUY);
  });

  it("neither morning run was told of a removal", () => {
    expect(fx.runs.morning1007.said).toContain("Changed: Buy if above $100.60 → Buy if below 6% from the close 5 days ago");
    expect(fx.runs.morning1007.said).not.toContain("Removed");
    expect(fx.runs.morning1008.said).toContain("Added: Review if below $110");
    expect(fx.runs.morning1008.said).not.toContain("Removed");
  });
});

describe("the 10-07 08:00 read, the run that set the buy again", () => {
  const { readAt, price } = fx.runs.morning1007;
  const read = () => stockContextFor({ ticker: "ABT", rows: rowsBefore(readAt), triggers: ladder("morning1007"), now: new Date(readAt), currentPrice: price });

  it("since the last answer: the removal, between the change and the review, read like any hand edit", () => {
    expect(read().text).toContain(
      [
        "Since then, not yet answered:",
        "  The principal, 10-06 17:12: Set by hand: Added: Review if above $10 at $97.50, now $98.50 (+1.0%)",
        `  The principal, 10-06 16:15: Set by hand: Removed: ${REMOVED_BUY} at $97.50, now $98.50 (+1.0%)`,
        `  The principal, 10-06 15:45: Set by hand: Changed: Buy if above $100.60 → ${REMOVED_BUY} at $97.50, now $98.50 (+1.0%)`,
        "  The principal, 10-06 15:42: Set by hand: Added: Buy if above $100.60 at $97.50, now $98.50 (+1.0%)",
      ].join("\n"),
    );
  });

  it("the newest decision still leads, and the removal asks for an answer like any hand edit", () => {
    expect(read().unansweredDecision).toMatchObject({ wantsAnswer: true, line: "Set by hand: Added: Review if above $10 at $97.50, now $98.50 (+1.0%)" });
    expect(principalDecision(removal1006)).toMatchObject({ wantsAnswer: true, line: `Set by hand: Removed: ${REMOVED_BUY}` });
  });

  it("and it opens the block under the principal's notes (ABT has none), the ask said once in the header", () => {
    const text = read().text!;
    expect(text).toMatch(
      /^WHAT'S BEEN SAID ON \$ABT\nRemoved by the principal \(don't add these back unless the thesis changes\):\n {2}10-06 16:15: Buy if below 6% from the close 5 days ago\nLast look: morning run, 10-05 08:04 — "ABT is already out on a protective stop/,
    );
    expect(text).not.toContain(KEEP);
  });
});

describe("after a run answers: the 10-07 08:05 answer", () => {
  const answer = fx.updates.find((u) => u.runId === fx.runs.morning1007.id)!;
  const after = new Date(new Date(answer.timestamp).getTime() + 1000).toISOString();
  const read = () => stockContextFor({ ticker: "ABT", rows: rowsBefore(after), triggers: ladder("morning1008"), now: new Date(after), currentPrice: answer.priceAtTime });

  it("the removal leaves the since-the-last-answer block, and stays in the Removed-by-the-principal block", () => {
    const { text, unansweredDecision } = read();
    expect(text).toContain("Last look: morning run, 10-07 08:05");
    expect(text).toContain("Nothing since.");
    expect(text).not.toContain("Set by hand: Removed:");
    expect(text).toContain(`${HEADER}\n  10-06 16:15: ${REMOVED_BUY}\nLast look:`);
    // The lasting block puts nothing on the list by itself.
    expect(unansweredDecision).toBeNull();
  });
});

describe("a removed trigger back on the stock", () => {
  const { readAt, price } = fx.runs.morning1008;

  it("is not said as removed; the principal's other removal still is", () => {
    const without = stockContextFor({ ticker: "ABT", rows: rowsBefore(readAt), triggers: ladder("morning1008"), now: new Date(readAt), currentPrice: price }).text!;
    expect(without).toContain(`${HEADER}\n  10-07 10:58: Review if below $110\n  10-06 16:15: ${REMOVED_BUY}\n`);
    const back = stockContextFor({ ticker: "ABT", rows: rowsBefore(readAt), triggers: [...ladder("morning1008"), stored(fx.removedBuy)], now: new Date(readAt), currentPrice: price }).text!;
    expect(back).toContain(`${HEADER}\n  10-07 10:58: Review if below $110\nLast look:`);
    expect(back).not.toContain(`16:15: ${REMOVED_BUY}`);
  });

  it("on the 10-07 read, with the 6% buy back, there is no block at all", () => {
    const { readAt: at1007, price: p1007 } = fx.runs.morning1007;
    const back = stockContextFor({ ticker: "ABT", rows: rowsBefore(at1007), triggers: [...ladder("morning1007"), stored(fx.removedBuy)], now: new Date(at1007), currentPrice: p1007 }).text!;
    expect(back).not.toContain("Removed by the principal");
    // What the principal decided on 10-06 is still history since the last answer.
    expect(back).toContain(`Set by hand: Removed: ${REMOVED_BUY}`);
  });
});

describe("the 09-28 cleanup of copied rules is not the principal's decision", () => {
  it("reads as nothing, alone or in the 10-07 read", () => {
    expect(cleanup.summary).toBe("Removed a copied rule from ABT — Price up 7% today → add");
    expect(principalDecision(cleanup)).toBeNull();
    // Alone it is nothing on record: no decision, no removal, no block.
    const alone = stockContextFor({ ticker: "ABT", rows: [cleanup], removals: [cleanup], triggers: [], now: new Date(fx.runs.morning1007.readAt) });
    expect(alone.text).toBeNull();
    expect(alone.unansweredDecision).toBeNull();
    const { readAt, price } = fx.runs.morning1007;
    const at1007 = stockContextFor({ ticker: "ABT", rows: rowsBefore(readAt), triggers: ladder("morning1007"), now: new Date(readAt), currentPrice: price }).text!;
    expect(at1007).not.toContain("Price up 7% today");
  });
});

describe("a mixed edit: a removal is listed among the ops", () => {
  // Production has no hand edit with two ops: the popover saves one op per
  // row (thesis-edit.ts), and every multi-op row with a removal is the app's
  // bookkeeping (a fill, a plan set down), not the principal's. So this is a
  // variant: the 16:15 row, with two of the principal's real 10-06 ops in it.
  const opsOf = (l: ActivityRow) => (l.fieldChanges as { triggerOps: { to: unknown[] } }).triggerOps.to;
  const remove = opsOf(removal1006)[0];
  const change = opsOf(line((u) => u.summary.startsWith("You changed a trigger on ABT")))[0];
  const add = opsOf(line((u) => u.summary === "You added a trigger on ABT: Review if above $10"))[0];
  const variant = (ops: unknown[]): ActivityRow => ({ ...removal1006, fieldChanges: { ...(removal1006.fieldChanges as object), triggerOps: { from: null, to: ops } } });

  it("every op listed in order, the price after the last", () => {
    expect(principalDecision(variant([remove, add]), 97.5, 98.5)?.line).toBe(
      `Set by hand: Removed: ${REMOVED_BUY}; Added: Review if above $10 at $97.50, now $98.50 (+1.0%)`,
    );
    expect(principalDecision(variant([change, remove]), 97.5, 98.5)?.line).toBe(
      `Set by hand: Changed: Buy if above $100.60 → ${REMOVED_BUY}; Removed: ${REMOVED_BUY} at $97.50, now $98.50 (+1.0%)`,
    );
  });

  it("the Removed-by-the-principal block takes the removal only", () => {
    const text = buildStockContext({ ticker: "ABT", rows: [variant([remove, add])], labelFor: () => null, now: new Date(fx.runs.morning1007.readAt) }).text!;
    expect(text).toContain(`${HEADER}\n  10-06 16:15: ${REMOVED_BUY}\nLast look:`);
    expect(text).not.toContain("16:15: Review if above $10");
  });
});

describe("counted inside the cap with the notes, and never cut", () => {
  // Built for the rule, not from production: a long note, four removals and
  // eight fires. The notes and the newest three removals are whole; the fires
  // that don't fit fold into a count.
  const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h));
  const answer: ActivityRow = { type: "UPDATED", timestamp: at(10), runId: "r", runMode: "MORNING_PLAN", rationale: "Hold." };
  const long = "x".repeat(900);
  const note: ActivityRow = { id: "n", type: "NOTE", timestamp: at(9), runId: "chat", rationale: long };
  const removals: ActivityRow[] = [1, 2, 3, 4].map((i) => ({
    ...removal1006,
    id: `rm${i}`,
    timestamp: at(4 + i),
    fieldChanges: { source: { to: "USER" }, triggerOps: { to: [{ id: `t${i}`, op: "remove", text: `Removed: Review if above $${i}0` }] } },
  }));
  const fires: ActivityRow[] = Array.from({ length: 8 }, (_, i) => ({ type: "TRIGGER_FIRED", triggerId: `f${i}`, timestamp: at(11 + i), runId: null, summary: `alert ${i}` }));

  it("the note whole, the newest three removals under it, the fires folded", () => {
    const { text } = buildStockContext({
      ticker: "X",
      rows: [answer, note, ...fires],
      removals,
      labelFor: (id) => ({ label: `alert ${id}`, rationale: "y".repeat(200) }),
      now: at(20),
    });
    expect(text).toContain(`"${long}"\n${HEADER}\n  10-06 04:00: Review if above $40\n  10-06 03:00: Review if above $30\n  10-06 02:00: Review if above $20\nLast look:`);
    expect(text).not.toContain("Review if above $10\n");
    expect(text).toMatch(/ and \d more fired since: /);
    expect(text!.length - long.length).toBeLessThanOrEqual(1_600);
  });
});

describe("the 10-08 08:00 read of ABT, through get_theses", () => {
  const { readAt, price } = fx.runs.morning1008;
  const at = fx.at.morning1008;

  async function morningRead() {
    const lines = fx.updates
      .filter((u) => new Date(u.timestamp).getTime() < new Date(readAt).getTime())
      .map((u) => ({ ...u, thesisId: fx.thesis.id, timestamp: new Date(u.timestamp), tradeId: null, signalIds: [], positionAtTime: null, run: u.runMode ? { mode: u.runMode } : null }));
    jest.useFakeTimers({
      now: new Date(readAt),
      doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    });
    try {
      const { result } = await replayTool("get-theses", "getTheses", {
        seed: {
          agentConfig: [agentConfigRow({ name: "Secular Compounder", setupIds: [fx.thesis.setupId] })],
          account: [accountRow()],
          thesis: [
            thesisRow({
              ...fx.thesis,
              createdAt: new Date(fx.thesis.createdAt),
              entryPrice: at.entryPrice,
              targetPrice: at.targetPrice,
              stopLoss: at.stopLoss,
              lastReviewedAt: new Date(at.lastReviewedAt),
              researchUpdatedAt: new Date(at.researchUpdatedAt),
              triggers: ladder("morning1008"),
              researchRun: { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { name: "Secular Compounder", setupIds: [fx.thesis.setupId], enabled: true } },
            }),
          ],
          thesisUpdate: lines,
        } as never,
        args: { detail: "actionable" },
        ctx: { runMode: "MORNING_PLAN" },
        quotes: { ABT: price },
      });
      const data = (result as unknown as { data: { theses: Array<Record<string, unknown> & { ticker: string }> } }).data;
      return data.theses.find((t) => t.ticker === "ABT") ?? null;
    } finally {
      jest.useRealTimers();
    }
  }

  it("the row's `said` carries both removals, the 10-06 one a run already answered included; the cleanup is not in it", async () => {
    const full = await morningRead();
    expect(full).not.toBeNull();
    const said = (rowForModel(full!, { named: false, size: sizeFor(full!, false) }) as Record<string, unknown>).said as string;
    expect(said).toMatch(
      /^WHAT'S BEEN SAID ON \$ABT\nRemoved by the principal \(don't add these back unless the thesis changes\):\n {2}10-07 10:58: Review if below \$110\n {2}10-06 16:15: Buy if below 6% from the close 5 days ago\nLast look: morning run, 10-07 08:05/,
    );
    expect(said).toContain("  The principal, 10-07 10:58: Set by hand: Removed: Review if below $110 at $97.95, now $98.73 (+0.8%)\n");
    expect(said).toContain("  The principal, 10-07 10:04: Set by hand: Added: Review if below $110 at $98.16, now $98.73 (+0.6%)");
    expect(said).not.toContain(`Set by hand: Removed: ${REMOVED_BUY}`);
    expect(said).not.toContain(KEEP);
    expect(said).not.toContain("Price up 7% today");
    // On main the run read exactly what production handed it.
    expect(said).not.toBe(fx.runs.morning1008.said);
  });

  it("the removals come by their own query, not the activity window: the principal's two, not the cleanup, not a run's own removals", async () => {
    const lines = fx.updates.map((u) => ({ ...u, thesisId: fx.thesis.id, timestamp: new Date(u.timestamp), run: u.runMode ? { mode: u.runMode } : null }));
    const db = prismaDouble({
      agentConfig: [agentConfigRow({ name: "Secular Compounder" })],
      account: [accountRow()],
      thesis: [thesisRow({ ...fx.thesis, createdAt: new Date(fx.thesis.createdAt), triggers: ladder("morning1008") })],
      thesisUpdate: lines,
    } as never);
    let load!: Awaited<ReturnType<typeof import("@/lib/agent/work-inputs").loadWorkInputs>>;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      const { loadWorkInputs } = await import("@/lib/agent/work-inputs");
      load = await loadWorkInputs([fx.thesis.id], { analystId: REPLAY_ANALYST_ID, prices: { ABT: { price, t: new Date(readAt).getTime() / 1000, dp: null } } }, new Date(readAt));
    });
    const ids = (load.removedByHand.get(fx.thesis.id) ?? []).map((r) => r.id);
    expect(ids).toEqual([
      fx.updates.find((u) => u.summary === "You removed a trigger on ABT: Review if below $110")!.id,
      removal1006.id,
    ]);
  });
});
