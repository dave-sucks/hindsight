/**
 * declined-sale.replay.test.ts — the five acceptance cases for DAV-315,
 * built from IOT's real rows and run through the tools' real entry points.
 *
 * The production story these replay (2026-09-16 → 09-25): IOT bought at
 * $39.83, floor set to $41.40 by the principal, the floor broke on 09-16
 * and the sale was declined with a note naming the level he wanted. The
 * same ask came back four more times, three expired, and it sold on 09-25
 * at $39.32 — 5.0% below the first ask. The one run in between added two
 * unrelated triggers.
 *
 * Every case asserts through `execute`, never a helper: the rule this ships
 * is only worth anything if the tools reach it.
 */
import {
  replayTool,
  thesisRow,
  positionRow,
  thesisUpdateRow,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
  REPLAY_USER_ID,
  REPLAY_ACCOUNT_ID,
  daysAgo,
} from "@/lib/replay";

const FLOOR = 41.4;
const AVG_COST = 39.83;
/** The price on 09-17, the morning after the first decline. */
const PRICE_NEXT_DAY = 40.2;
const NOTE =
  "its moving here and there. Im gonna see if theres any chance it picks back up. " +
  "If you don't approve this, I'd immediately raise the stop to around $40.50.";

const iotThesis = (over: Record<string, unknown> = {}) =>
  thesisRow({
    id: "t_iot",
    ticker: "IOT",
    status: "HOLDING",
    horizon: "TARGET",
    entryPrice: AVG_COST,
    targetPrice: 52,
    stopLoss: FLOOR,
    triggers: [
      {
        id: "trg_floor",
        predicate: { kind: "PRICE_BELOW", level: FLOOR },
        action: "EXIT",
        rationale: "Protective floor.",
        cooldownDays: 0,
        fireMode: "DIRECT",
        source: "PRINCIPAL",
      },
    ],
    ...over,
  });

const iotPosition = () =>
  positionRow({ id: "pos_iot", symbol: "IOT", avgCost: AVG_COST, quantity: 230 });

/** A protective sale the principal saw and declined. */
const declinedSaleOrder = (over: Record<string, unknown> = {}) => ({
  id: "ord_declined",
  positionId: "pos_iot",
  userId: REPLAY_USER_ID,
  accountId: REPLAY_ACCOUNT_ID,
  environment: "PAPER",
  symbol: "IOT",
  side: "SELL",
  intent: "CLOSE",
  orderType: "MARKET",
  quantity: 230,
  status: "REJECTED",
  closeReason: "STOP",
  rejectionMessage: NOTE,
  // expiresAt set = a card was actually staged in front of him.
  expiresAt: daysAgo(0),
  createdAt: daysAgo(1),
  ...over,
});

const runRow = () => ({
  id: REPLAY_RUN_ID,
  status: "RUNNING",
  mode: "MORNING_PLAN",
  agentConfigId: REPLAY_ANALYST_ID,
  parameters: {},
  startedAt: new Date(),
  completedAt: null,
});

type ThesisOut = { ticker: string; needsAction?: { kind?: string; rejectMessage?: string | null } | null };

const rowsFrom = (result: unknown): ThesisOut[] => {
  const data = (result as { data?: { theses?: ThesisOut[] } }).data;
  return data?.theses ?? [];
};

/**
 * The ratchet refuses ONE OP, not the whole call — `update_thesis` returns
 * `ok: true` with the refusal inside `data.trigger_ops` (TRIGGERS.md §8).
 * Asserting on the harness's top-level `refused` here would pass whether
 * the edit landed or not, which is the shape that shipped four dead rules.
 */
const floorOp = (result: unknown) => {
  const ops = (result as { data?: { trigger_ops?: Array<{ id: string; ok: boolean; reason?: string }> } })
    .data?.trigger_ops;
  return ops?.find((o) => o.id === "trg_floor");
};
const storedStop = (result: unknown) =>
  (result as { data?: { card?: { stop_loss?: number | null } } }).data?.card?.stop_loss ?? null;

describe("DAV-315 — a declined sale becomes the next run's job", () => {
  it("1. get_theses puts the declined sale on the work list, with the note", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [iotThesis()],
        position: [iotPosition()],
        order: [declinedSaleOrder()],
      },
      args: {},
      quotes: { IOT: PRICE_NEXT_DAY },
    });

    const iot = rowsFrom(result).find((t) => t.ticker === "IOT");
    expect(iot).toBeDefined();
    expect(iot!.needsAction?.kind).toBe("SALE_DECLINED");
    // The principal's own words have to reach the run, not a summary of them.
    expect(iot!.needsAction?.rejectMessage).toContain("$40.50");
  });

  it("5. a declined TARGET sale is not work — that one means 'let it run'", async () => {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [iotThesis()],
        position: [iotPosition()],
        order: [declinedSaleOrder({ closeReason: "TARGET" })],
      },
      args: {},
      quotes: { IOT: PRICE_NEXT_DAY },
    });

    const iot = rowsFrom(result).find((t) => t.ticker === "IOT");
    expect(iot?.needsAction?.kind).not.toBe("SALE_DECLINED");
  });

  it("2. the run may lower the floor after a decline, with a reason", async () => {
    const { result } = await replayTool("update-thesis", "updateThesis", {
      seed: {
        thesis: [iotThesis()],
        position: [iotPosition()],
        order: [declinedSaleOrder()],
      },
      args: {
        thesis_id: "t_iot",
        stop_loss: 40.5,
        rationale:
          "You declined the $41.40 sale to give it room. Re-drawn to $40.50, just under the gap-day close.",
      },
      quotes: { IOT: PRICE_NEXT_DAY },
    });

    expect(floorOp(result)?.ok).toBe(true);
    // And it actually moved — an accepted op that changes nothing is not a fix.
    expect(storedStop(result)).toBe(40.5);
  });

  it("3. the same lowering with no declined sale is still refused", async () => {
    const { result } = await replayTool("update-thesis", "updateThesis", {
      seed: {
        thesis: [iotThesis()],
        position: [iotPosition()],
        order: [],
      },
      args: {
        thesis_id: "t_iot",
        stop_loss: 40.5,
        rationale: "Giving it room.",
      },
      quotes: { IOT: PRICE_NEXT_DAY },
    });

    // The ratchet is otherwise exactly as it was — DAV-185 still stands.
    expect(floorOp(result)?.ok).toBe(false);
    expect(floorOp(result)?.reason ?? "").toMatch(/weakens the protection/i);
    expect(storedStop(result)).toBe(FLOOR);
  });

  it("4. a REVIEWED-only answer leaves the run unfinished", async () => {
    const { result, crashed } = await replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [runRow()],
        thesis: [
          iotThesis({ updates: [{ type: "REVIEWED", triggerId: null, timestamp: new Date() }] }),
        ],
        position: [iotPosition()],
        order: [declinedSaleOrder()],
        runEvent: [
          {
            id: "ev_summary",
            runId: REPLAY_RUN_ID,
            type: "run_summary",
            title: "Run summary",
            message: "Reviewed the book.",
            payload: {},
            createdAt: new Date(),
          },
        ],
        // The 09-21 shape: a review row that changed nothing.
        thesisUpdate: [
          thesisUpdateRow({ thesisId: "t_iot", runId: REPLAY_RUN_ID, type: "REVIEWED" }),
        ],
      },
      args: {},
      quotes: { IOT: PRICE_NEXT_DAY },
    });

    expect(crashed).toBe(false);
    expect(result.summary).toMatch(/refused/i);
    expect(JSON.stringify(result)).toContain("IOT");
  });
});
