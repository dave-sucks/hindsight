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
/** A decline note of the real one's shape (paraphrased): holding, and the level to act on. */
const NOTE =
  "Holding to see whether it recovers. " +
  "If this sale is declined, the stop should move up to about $40.50.";

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
        predicate: { watch: "price", is: "below", value: FLOOR },
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

  it("4. a review that changes nothing leaves the run unfinished — the row written by update_thesis itself", async () => {
    const seed = {
      researchRun: [runRow()],
      thesis: [iotThesis()],
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
    };
    // The 09-21 shape: a note and nothing else. This row used to be seeded
    // by hand, and from 2026-08-25 update_thesis could not write it — every
    // call counted its own review stamp as a change.
    const review = await replayTool("update-thesis", "updateThesis", {
      seed,
      args: { thesis_id: "t_iot", rationale: "Looked at it again; holding for now." },
      quotes: { IOT: PRICE_NEXT_DAY },
    });
    // The double applies no column defaults; production stamps every row.
    const written = (review.db.store.thesisUpdate ?? []).map((u: Record<string, unknown>): Record<string, unknown> => ({ ...u, timestamp: u.timestamp ?? new Date() }));
    expect(written.map((u) => u.type)).toEqual(["REVIEWED"]);

    const { result, crashed } = await replayTool("complete-run", "completeRun", {
      // The double joins nothing: the thesis carries its own audit lines.
      seed: { ...seed, thesis: [{ ...review.db.store.thesis[0], updates: written }], thesisUpdate: written },
      args: {},
      quotes: { IOT: PRICE_NEXT_DAY },
    });

    expect(crashed).toBe(false);
    expect(result.summary).toMatch(/refused/i);
    expect(JSON.stringify(result)).toContain("IOT");
  });
});

/**
 * The three edits the QB landed on the first cut of this PR (2026-09-27).
 * All three went through because the exemption filtered out every LOWERED
 * violation while a decline was live. A decline is "not at this price" —
 * not a week of open season on the stock.
 */
describe("DAV-315 — what a decline does NOT unlock", () => {
  const TRAIL = {
    id: "trg_trail",
    predicate: { watch: "move", is: "below", value: 8, variable: "peak" },
    action: "EXIT",
    rationale: "Seat trail.",
    cooldownDays: 0,
    source: "PRINCIPAL",
  };

  it("6. the floor cannot be dropped to a level that is not a floor ($41.40 → $5)", async () => {
    const { result } = await replayTool("update-thesis", "updateThesis", {
      seed: {
        thesis: [iotThesis()],
        position: [iotPosition()],
        order: [declinedSaleOrder()],
      },
      args: { thesis_id: "t_iot", stop_loss: 5, rationale: "Giving it lots of room." },
      quotes: { IOT: PRICE_NEXT_DAY },
    });

    // 15% below $41.40 is $35.19. $5 is not re-drawing a floor, it is
    // removing one, and removing one is the principal's act.
    expect(storedStop(result)).toBe(FLOOR);
  });

  it("7. the trail is not the line that was declined (8% → 30%)", async () => {
    const { result } = await replayTool("update-thesis", "updateThesis", {
      seed: {
        thesis: [iotThesis({ triggers: [...(iotThesis().triggers as unknown[]), TRAIL] })],
        position: [iotPosition()],
        order: [declinedSaleOrder()],
      },
      args: {
        thesis_id: "t_iot",
        edit_triggers: [{ id: "trg_trail", pct: 30, rationale: "Widen it." }],
      },
      quotes: { IOT: PRICE_NEXT_DAY },
    });

    const op = (
      result as { data?: { trigger_ops?: Array<{ id: string; ok: boolean }> } }
    ).data?.trigger_ops?.find((o) => o.id === "trg_trail");
    expect(op?.ok ?? false).toBe(false);
  });

  it("8. once the price recovers above the line, the decline is spent", async () => {
    const { result } = await replayTool("update-thesis", "updateThesis", {
      seed: {
        thesis: [iotThesis()],
        position: [iotPosition()],
        order: [declinedSaleOrder()],
      },
      // $38 is inside the 15% bound, so only the recovery stops this one.
      args: { thesis_id: "t_iot", stop_loss: 38, rationale: "Room." },
      quotes: { IOT: 46 },
    });

    expect(storedStop(result)).toBe(FLOOR);
  });
  it("9. with no live price the floor stays where it is — lowering a safety line errs strict", async () => {
    // QB review: a quote outage is not evidence the price is still past the
    // line. The work item still fires without a quote (case 1's rule); the
    // exemption does not.
    const { result } = await replayTool("update-thesis", "updateThesis", {
      seed: {
        thesis: [iotThesis()],
        position: [iotPosition()],
        order: [declinedSaleOrder()],
      },
      args: {
        thesis_id: "t_iot",
        stop_loss: 40.5,
        rationale: "You declined the $41.40 sale to give it room. Re-drawn to $40.50.",
      },
      quotes: {},
    });

    expect(floorOp(result)?.ok).toBe(false);
    expect(storedStop(result)).toBe(FLOOR);
  });
});
