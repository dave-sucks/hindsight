/**
 * floor-too-far.replay.test.ts — a holding whose floor would lose more than
 * 1.5% of the account is flagged, and the run answers it (DAV-344).
 *
 * CEG, Secular Compounder. Bought 2026-08-13 at $280.33 (30 shares) with the
 * June plan's $220 floor left in place — 21.5% under the fill. An add on
 * 09-14 made it 39 shares at an average $276.90. From 09-15 to 09-30 its
 * reviews fired on most days ("below the 200-day", "15% off the high",
 * "below $256.42") and every run answered "hold, business intact"; the floor
 * never moved. At 12:07 ET on 09-30 the principal moved it to $248 by hand.
 *
 * Through get_theses's real entry point, on CEG's rows as the day found them
 * (lib/agent/__fixtures__/ceg-floor-too-far-2026-09-30.json): the stored row
 * with that one edit reversed, the position, the analyst's and account's
 * rules, the 09-29 snapshot, and the LIVE account's equity from the 09-29
 * digest. The floor that sells first that day was not the $220 stop but the
 * Compounder's 25%-off-the-high trail, at $227.55 off the $303.40 peak.
 */
import raw from "@/lib/agent/__fixtures__/ceg-floor-too-far-2026-09-30.json";
import {
  replayTool,
  prismaDouble,
  thesisRow,
  positionRow,
  agentConfigRow,
  accountRow,
  REPLAY_ANALYST_ID,
  type PrismaDouble,
} from "@/lib/replay";
import type { NeedsAction } from "@/lib/agent/needs-action";
import type { FloorRisk } from "@/lib/agent/floor-risk";

type Row = Record<string, unknown>;
const fx = raw as unknown as {
  thesisBefore: Row & { id: string; createdAt: string; lastReviewedAt: string; researchUpdatedAt: string | null; triggers: Array<Row & { id: string }> };
  principalEdit: { floorTriggerId: string; from: number; to: number };
  lastUpdateBefore: { type: string; triggerId: string; timestamp: string; summary: string };
  position: Row & { quantity: number; initialQty: number; avgCost: number; openedAt: string; peakPrice: number; peakAt: string };
  analyst: { name: string; setupIds: string[]; triggers: unknown[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  snapshot: { asOf: string; snapshot: Row };
  equity: Record<"2026-09-29" | "2026-08-13", number>;
  price0930: { at: string; price: number };
  fill0813: { triggersBefore: unknown[]; orders: Array<{ intent: string; filledPrice: number; filledQty: number; filledAt: string }> };
};

type ThesisOut = { ticker: string; needsAction: NeedsAction | null; resolved?: { floorRisk?: FloorRisk | null } | null };
const cegRow = (result: unknown): ThesisOut =>
  ((result as { data: { theses: ThesisOut[] } }).data.theses ?? []).find((t) => t.ticker === "CEG")!;

const onAnalyst = { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { name: fx.analyst.name, setupIds: fx.analyst.setupIds, enabled: true } };
const rules = () => ({
  agentConfig: [agentConfigRow({ name: fx.analyst.name, setupIds: fx.analyst.setupIds, triggers: fx.analyst.triggers, enabled: true })],
  account: [accountRow({ triggers: fx.account.triggers, triggersSeededAt: new Date(fx.account.triggersSeededAt) })],
  tickerIndicators: [{ id: "ceg_0929", ticker: "CEG", asOf: fx.snapshot.asOf, snapshot: fx.snapshot.snapshot, computedAt: new Date("2026-09-29T10:30:00Z") }],
});

/** CEG on 09-30 before 12:07 ET, with the floor trigger at `floor`. */
function seed0930(floor: number) {
  const triggers = fx.thesisBefore.triggers.map((t) =>
    t.id === fx.principalEdit.floorTriggerId ? { ...t, predicate: { ...(t.predicate as Row), value: floor } } : t,
  );
  return {
    ...rules(),
    thesis: [
      thesisRow({
        ...fx.thesisBefore,
        stopLoss: floor,
        triggers,
        createdAt: new Date(fx.thesisBefore.createdAt),
        lastReviewedAt: new Date(fx.thesisBefore.lastReviewedAt),
        researchUpdatedAt: fx.thesisBefore.researchUpdatedAt ? new Date(fx.thesisBefore.researchUpdatedAt) : null,
        researchRun: onAnalyst,
      }),
    ],
    position: [
      positionRow({
        ...fx.position,
        analystId: REPLAY_ANALYST_ID,
        openedAt: new Date(fx.position.openedAt),
        peakAt: new Date(fx.position.peakAt),
        environment: "LIVE",
      }),
    ],
    thesisUpdate: [
      {
        id: "u_0930_fire",
        thesisId: fx.thesisBefore.id,
        type: fx.lastUpdateBefore.type,
        triggerId: fx.lastUpdateBefore.triggerId,
        summary: fx.lastUpdateBefore.summary,
        timestamp: new Date(fx.lastUpdateBefore.timestamp),
        fieldChanges: null,
        rationale: "",
      },
    ],
  };
}

const fakeClock = (at: Date) =>
  jest.useFakeTimers({
    now: at,
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });

async function read(seed: ReturnType<typeof seed0930> | Row, opts: { at: Date; price: number; equity: number }) {
  fakeClock(opts.at);
  try {
    return await replayTool("get-theses", "getTheses", {
      seed: seed as never,
      args: {},
      ctx: { runEnvironment: "LIVE", runMode: "MORNING_PLAN" },
      quotes: { CEG: opts.price },
      equity: opts.equity,
    });
  } finally {
    jest.useRealTimers();
  }
}

const AT_0930 = new Date(fx.price0930.at);
const TRAIL_FLOOR = Math.round(fx.position.peakPrice * 0.75 * 100) / 100; // $227.55

describe("the fixture is the production case", () => {
  it("39 shares at $276.90, a $220 floor, the 25% trail off a $303.40 peak, and a review that fired at 09:35", () => {
    expect(fx.position).toMatchObject({ quantity: 39, initialQty: 30, peakPrice: 303.4 });
    expect(fx.position.avgCost).toBeCloseTo(276.9, 2);
    expect(fx.principalEdit).toMatchObject({ from: 220, to: 248 });
    expect(fx.analyst.triggers).toContainEqual(expect.objectContaining({ action: "EXIT", predicate: { watch: "move", is: "below", value: 25, variable: "peak" } }));
    expect(fx.lastUpdateBefore).toMatchObject({ type: "TRIGGER_FIRED", summary: "Price below $256.42 — review — deferred to the next daily review" });
    expect(TRAIL_FLOOR).toBe(227.55);
  });
});

describe("CEG 2026-09-30 through get_theses", () => {
  it("is flagged FLOOR_TOO_FAR with the numbers — over the review that fired this morning", async () => {
    const { result } = await read(seed0930(220), { at: AT_0930, price: fx.price0930.price, equity: fx.equity["2026-09-29"] });
    const row = cegRow(result);
    // On main this row's work was the review that fired at 09:35 —
    // "Price below $256.42" — and nothing about the floor.
    expect(row.needsAction).toMatchObject({
      kind: "FLOOR_TOO_FAR",
      floorPrice: TRAIL_FLOOR,
      quantity: 39,
      pctOfAccount: 1.7,
      structureBelow: [{ label: "20-day low", price: 250.55 }],
    });
    const na = row.needsAction as Extract<NeedsAction, { kind: "FLOOR_TOO_FAR" }>;
    expect(na.lossAtFloor).toBeCloseTo((fx.position.avgCost - TRAIL_FLOOR) * 39, 1); // $1,924.60
    expect(na.line).toBe(
      "At the $227.55 floor, 39 shares bought at an average $276.90 lose $1,925 — 1.7% of the $113,065 account, over the 1.5% a floor may risk (a buy is sized to about 1%). " +
        "Structure below the $251.30 price: 20-day low $250.55. " +
        'Answer it: move the floor under real structure, trim so the loss at the floor fits, or say why this floor stands — "hold, business intact" alone does not answer it.',
    );
    // The same numbers ride on the resolved block, named.
    expect(row.resolved?.floorRisk).toMatchObject({ floorPrice: TRAIL_FLOOR, pctOfAccount: 1.7 });
    expect(row.resolved?.floorRisk?.line).toMatch(/^\$CEG: at the \$227\.55 floor/);
  });

  it("with the $248 floor the principal set at 12:07, it is not flagged — the review is the work again", async () => {
    const { result } = await read(seed0930(fx.principalEdit.to), { at: AT_0930, price: fx.price0930.price, equity: fx.equity["2026-09-29"] });
    const row = cegRow(result);
    expect(row.resolved?.floorRisk ?? null).toBeNull();
    expect(row.needsAction).toMatchObject({ kind: "TRIGGER_FIRED", triggerId: fx.lastUpdateBefore.triggerId, action: "REVIEW" });
  });

  it("a fired trim still comes first — money moving now — and the floor's numbers ride on the row", async () => {
    const seed = seed0930(220);
    const trim = { id: "trim_1", action: "TRIM", predicate: { watch: "move", is: "below", value: 2, variable: "prev_close" }, rationale: "A trim.", cooldownDays: 1 };
    (seed.thesis[0].triggers as Row[]).push(trim);
    seed.thesisUpdate[0] = { ...seed.thesisUpdate[0], triggerId: "trim_1", summary: "Price down 2% today — trim" };
    const { result } = await read(seed, { at: AT_0930, price: fx.price0930.price, equity: fx.equity["2026-09-29"] });
    const row = cegRow(result);
    expect(row.needsAction).toMatchObject({ kind: "TRIGGER_FIRED", action: "TRIM" });
    expect(row.resolved?.floorRisk).toMatchObject({ floorPrice: TRAIL_FLOOR, pctOfAccount: 1.7 });
  });

  it("no equity, no flag — the check fails open", async () => {
    const { result } = await read(seed0930(220), { at: AT_0930, price: fx.price0930.price, equity: 0 });
    const row = cegRow(result);
    expect(row.resolved?.floorRisk ?? null).toBeNull();
    expect(row.needsAction).toMatchObject({ kind: "TRIGGER_FIRED" });
  });
});

describe("CEG 2026-08-13 — the fill at $280.33 with June's $220 floor", () => {
  it("the first read after the fill flags it: $1,810, 1.9% of the account", async () => {
    const fill = fx.fill0813.orders.find((o) => o.intent === "OPEN")!;
    const FILL_AT = new Date(fill.filledAt);
    // The watched row the fill found: the June plan (buy $255, floor $220,
    // target $360) and the ladder the 13:31 close-out left.
    const db: PrismaDouble = prismaDouble({
      ...rules(),
      thesis: [
        thesisRow({
          ...fx.thesisBefore,
          status: "WATCHING",
          entryPrice: 255,
          stopLoss: 220,
          targetPrice: 360,
          triggers: fx.fill0813.triggersBefore,
          createdAt: new Date(fx.thesisBefore.createdAt),
          lastReviewedAt: FILL_AT,
          researchUpdatedAt: FILL_AT,
          researchRun: onAnalyst,
        }),
      ],
    });
    // The fill, through the one function every buy fill goes through.
    fakeClock(FILL_AT);
    try {
      await jest.isolateModulesAsync(async () => {
        jest.doMock("@/lib/prisma", () => ({ prisma: db }));
        const { armHeldLadderOnFill } = await import("@/lib/proposals/thesis-flips");
        await armHeldLadderOnFill({
          analystId: REPLAY_ANALYST_ID,
          ticker: "CEG",
          fillPrice: fill.filledPrice,
          targetPrice: 360,
          stopLoss: 220,
          positionId: fx.position.id as string,
          via: "approved proposal",
        });
      });
    } finally {
      jest.useRealTimers();
    }
    expect(db.store.thesis[0]).toMatchObject({ status: "HOLDING", entryPrice: 280.33, stopLoss: 220 });

    const { result } = await read(
      {
        ...rules(),
        thesis: db.store.thesis,
        // The double applies no column defaults; the fill's audit row is stamped as Prisma would.
        thesisUpdate: db.store.thesisUpdate.map((u) => ({ timestamp: FILL_AT, ...u })),
        position: [
          positionRow({
            ...fx.position,
            analystId: REPLAY_ANALYST_ID,
            quantity: fill.filledQty,
            initialQty: fill.filledQty,
            avgCost: fill.filledPrice,
            peakPrice: null,
            openedAt: FILL_AT,
            environment: "LIVE",
          }),
        ],
      },
      { at: new Date(FILL_AT.getTime() + 60_000), price: fill.filledPrice, equity: fx.equity["2026-08-13"] },
    );
    const row = cegRow(result);
    expect(row.needsAction).toMatchObject({ kind: "FLOOR_TOO_FAR", floorPrice: 220, avgCost: 280.33, quantity: 30, pctOfAccount: 1.9 });
    expect((row.needsAction as { lossAtFloor: number }).lossAtFloor).toBeCloseTo(1809.9, 1);
  });
});
