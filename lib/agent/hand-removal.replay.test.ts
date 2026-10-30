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
 * Since 2026-10-30 the agent reads the stock's newest 8 Activity lines as the
 * owner sees them, a removal by hand included: it is "Edited by you" with its
 * change, like the add before it. A removal newer than an add is always in
 * the 8 when the add is, so a run can never read the add and miss the removal.
 */
import raw from "@/lib/agent/__fixtures__/abt-hand-removal-2026-10-06.json";
import { saidLine, unansweredWord, wantsAnswer, type ActivityRow } from "@/lib/agent/stock-context";
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

const HEADER = "WHAT'S BEEN SAID ON $ABT — its newest 8 Activity lines, newest first, as the owner sees them:";
const REMOVED_BUY = "Buy if below 6% from the close 5 days ago";
const toRow = (l: Line): ActivityRow & { id: string; summary: string } => ({ ...l, timestamp: new Date(l.timestamp) });
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
  const { readAt } = fx.runs.morning1007;
  const read = () => stockContextFor({ ticker: "ABT", rows: rowsBefore(readAt) });

  it("the four hand edits of 10-06 are four lines, newest first, the removal among them", () => {
    const text = read().text!;
    // ABT had six lines by then, so the block says six.
    expect(text.startsWith("WHAT'S BEEN SAID ON $ABT — its newest 6 Activity lines, newest first, as the owner sees them:")).toBe(true);
    const edits = [
      "Edited by you [Added: Review if above $10]",
      `Edited by you [Removed: ${REMOVED_BUY}]`,
      `Edited by you [Changed: Buy if above $100.60 → ${REMOVED_BUY}]`,
      "Edited by you [Added: Buy if above $100.60]",
    ];
    const at = edits.map((e) => text.indexOf(e));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).not.toBe(fx.runs.morning1007.said);
  });

  it("the newest edit asks for an answer, and so does the removal on its own", () => {
    expect(read().unansweredDecision?.at).toEqual(line((u) => u.summary === "You added a trigger on ABT: Review if above $10").timestamp);
    expect(wantsAnswer(removal1006)).toBe(true);
  });
});

describe("after a run answers: the 10-07 08:05 answer", () => {
  const answer = fx.updates.find((u) => u.runId === fx.runs.morning1007.id)!;
  const after = new Date(new Date(answer.timestamp).getTime() + 1000).toISOString();

  it("nothing of the principal's waits any more, and the removal is still one of the 8 lines", () => {
    const { text, unansweredDecision } = stockContextFor({ ticker: "ABT", rows: rowsBefore(after) });
    expect(unansweredDecision).toBeNull();
    expect(text).toContain(`Edited by you [Removed: ${REMOVED_BUY}]`);
  });
});

describe("the 09-28 cleanup of copied rules is not the principal's decision", () => {
  it("asks nothing of a run, alone or in the 10-07 read", () => {
    expect(cleanup.summary).toBe("Removed a copied rule from ABT — Price up 7% today → add");
    expect(wantsAnswer(cleanup)).toBe(false);
    expect(unansweredWord([cleanup])).toBeNull();
    expect(stockContextFor({ ticker: "ABT", rows: [cleanup] }).unansweredDecision).toBeNull();
  });
});

describe("a mixed edit: every op is listed, in order", () => {
  // Production has no hand edit with two ops: the popover saves one op per
  // row (thesis-edit.ts). So this is a variant: the 16:15 row, with two of
  // the principal's real 10-06 ops in it.
  const opsOf = (l: ActivityRow) => (l.fieldChanges as { triggerOps: { to: unknown[] } }).triggerOps.to;
  const remove = opsOf(removal1006)[0];
  const add = opsOf(line((u) => u.summary === "You added a trigger on ABT: Review if above $10"))[0];

  it("the line carries both changes", () => {
    const variant = { ...removal1006, fieldChanges: { ...(removal1006.fieldChanges as object), triggerOps: { from: null, to: [remove, add] } } };
    expect(saidLine(toFeedItem(variant))).toContain(`Edited by you [Removed: ${REMOVED_BUY}; Added: Review if above $10]`);
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

  it("the row's `said` carries both removals as the lines they are; the cleanup is older than the 8", async () => {
    const full = await morningRead();
    expect(full).not.toBeNull();
    const said = (rowForModel(full!, { named: false, size: sizeFor(full!, false) }) as Record<string, unknown>).said as string;
    expect(said.startsWith(HEADER)).toBe(true);
    expect(said).toContain("10-07 10:58 · Edited by you [Removed: Review if below $110]");
    expect(said).toContain("10-07 10:04 · Edited by you [Added: Review if below $110]");
    expect(said).toContain("10-07 10:05 · $97.95 · Trigger: Review if below $110");
    expect(said).toContain(`Edited by you [Removed: ${REMOVED_BUY}]`);
    expect(said).not.toContain("Price up 7% today");
    // On main the run read exactly what production handed it.
    expect(said).not.toBe(fx.runs.morning1008.said);
  });
});
