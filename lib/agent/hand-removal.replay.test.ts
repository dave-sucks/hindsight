/**
 * hand-removal.replay.test.ts — a trigger the principal removes by hand is
 * read by the agents, as the line it is in the stock's feed.
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
 * From 2026-10-30 to 2026-11-19 the agent read the stock's newest 8 Activity
 * lines, a removal by hand included. Since 2026-11-20 the agent's list leaves
 * out every trigger edit (the owner's decision): a trigger the owner changed
 * says so on its own line, and one the owner removed is on the Activity tab
 * only. These tests hold that as it is.
 */
import raw from "@/lib/agent/__fixtures__/abt-hand-removal-2026-10-06.json";
import type { ActivityRow } from "@/lib/agent/stock-context";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import { toFeedItem } from "@/lib/thesis/activity-feed";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { rowForModel, sizeFor } from "@/lib/agent/row-for-model";
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";
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

const HEADER = "Activity on $ABT, newest first: the last 3 reviews, 3 news notes and 3 of your notes, and your last decline.";
const REMOVED_BUY = "Buy if below 6% from the close 5 days ago";
const toRow = (l: Line): ActivityRow & { id: string; summary: string } => ({ ...l, timestamp: new Date(l.timestamp) });
const rowsBefore = (iso: string) => fx.updates.filter((u) => new Date(u.timestamp).getTime() < new Date(iso).getTime()).map(toRow);
/** A listed trigger as the thesis stores it. */
const stored = (t: Listed) => ({ id: t.id, action: t.action, predicate: t.predicate, rationale: t.rationale, source: t.setBy }) as unknown as Trigger;
const ladder = (key: "morning1007" | "morning1008") => fx.at[key].triggers.map(stored);
const line = (pred: (l: Line) => boolean) => toRow(fx.updates.find(pred)!);
const removal1006 = line((u) => u.summary.startsWith("You removed a trigger on ABT: Buy if below 6%"));
const cleanup = line((u) => u.summary.startsWith("Removed a copied rule from ABT"));

describe("the fixture is the production case", () => {
  it("the predicates rebuilt from the reads say what the reads said", () => {
    for (const t of [...fx.at.morning1007.triggers, ...fx.at.morning1008.triggers, fx.removedBuy]) {
      // ABT was watched: its sale line, stored as a sale, read "Take the plan down" until 2026-11-16; the 11-16 migration stores it as STOP_WATCHING.
      const migrated = t.action === "EXIT" ? { ...t, action: "STOP_WATCHING" } : t;
      expect(sentenceOf(migrated as never)).toBe(t.says.replace("Take the plan down if", "Stop watching if"));
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
  const { readAt } = fx.runs.morning1007;
  const read = () => stockContextFor({ ticker: "ABT", rows: rowsBefore(readAt) });

  it("since 2026-11-20 a trigger edit is not in the agent's list: the 10-06 hand edits are on the Activity tab, and the run reads its last review", () => {
    const text = read().text!;
    expect(text.startsWith(HEADER)).toBe(true);
    expect(text).not.toContain("Edited by you");
    expect(text).not.toContain(REMOVED_BUY);
    expect(text.split("\n").slice(1, -1).map((l) => l.slice(0, l.indexOf(": ")))).toEqual(["  Review by its analyst, Oct 5, 8:04 AM at $97.50"]);
    expect(text).not.toBe(fx.runs.morning1007.said);
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

  it("the row's `said` is the last reviews; the owner's 10-07 add and removal and the fire between them are not in it", async () => {
    const full = await morningRead();
    expect(full).not.toBeNull();
    const said = (rowForModel(full!, { named: false, size: sizeFor(full!, false) }) as Record<string, unknown>).said as string;
    expect(said.startsWith(HEADER)).toBe(true);
    expect(said.split("\n").slice(1, -1).map((l) => l.slice(0, l.indexOf(": ")))).toEqual([
      "  Review by its analyst, Oct 7, 8:05 AM at $98.16",
      "  Review by its analyst, Oct 5, 8:04 AM at $97.50",
    ]);
    expect(said).not.toContain("Edited by you");
    expect(said).not.toContain("Review if below $110");
    expect(said).not.toContain("Price up 7% today");
    // On main the run read exactly what production handed it.
    expect(said).not.toBe(fx.runs.morning1008.said);
  });
});
