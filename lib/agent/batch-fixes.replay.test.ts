/**
 * batch-fixes.replay.test.ts — DAV-328, DAV-332 and DAV-329, each through
 * the real entry point, each from a shape that exists on the book.
 */
import {
  replayTool,
  thesisRow,
  agentConfigRow,
  accountRow,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
} from "@/lib/replay";
import { defaultCooldownDaysForPredicate } from "@/lib/agent/triggers/defaults";

// ── DAV-328 ───────────────────────────────────────────────────────────────
// AIR on the book today: CATALYST horizon, decision 2026-09-29, and a PEAD
// setup stamped on it. The old test wanted the setup to be PRE_CATALYST or
// unnamed, so AIR — one day from its event — was sized FULL. KMX and JBL are
// the same shape.

const airSeed = (over: Record<string, unknown> = {}) => ({
  thesis: [
    thesisRow({
      id: "t_air",
      ticker: "AIR",
      status: "WATCHING",
      direction: "LONG",
      horizon: "CATALYST",
      setupId: "PEAD",
      conviction: "HIGH",
      entryPrice: 150,
      targetPrice: 200,
      stopLoss: 135,
      catalystDate: new Date(Date.now() + 1 * 86_400_000),
      analystId: REPLAY_ANALYST_ID,
      ...over,
    }),
  ],
  agentConfig: [
    agentConfigRow({
      minPositionSize: 2000,
      maxPositionSize: 10000,
      maxPositionTotal: 20000,
      maxOpenPositions: 6,
      riskPct: 1,
    }),
  ],
  account: [
    accountRow({
      requireApprovalBuysPaper: true,
      requireApprovalSellsPaper: true,
      requireApprovalBuysLive: true,
      requireApprovalSellsLive: true,
    }),
  ],
});

const airArgs = {
  ticker: "AIR",
  company_name: "AAR Corp",
  exchange: "NYSE",
  direction: "LONG",
  entry_price: 150,
  target_price: 200,
  stop_loss: 135,
  thesis_id: "t_air",
};

const sizingText = (result: unknown) =>
  (((result as { data?: { sizing?: string[] } }).data?.sizing ?? []) as string[]).join(" ");

describe("DAV-328 — the halving reads the horizon, not the setup", () => {
  it("AIR is halved: a CATALYST thesis one day from its decision, wearing a PEAD setup", async () => {
    const { refused, result } = await replayTool("place-trade", "placeTrade", {
      seed: airSeed(),
      ctx: {
        runMode: "INTRADAY_TACTICAL",
        runEnvironment: "PAPER",
        minPositionSize: 2000,
        maxPositionSize: 10000,
        maxOpenPositions: 6,
      },
      args: airArgs,
      quotes: { AIR: 150 },
    });

    expect(refused).toBe(false);
    expect(sizingText(result)).toMatch(/binary/i);
  });

  it("an ordinary drift name is NOT halved for having its next print on the row", async () => {
    // HPE and DOCU carry `catalystDate` too — it is their next earnings
    // date, 64 and 66 days out. Keying the halving off that column instead
    // of the horizon would have cut both in half for no reason.
    const { refused, result } = await replayTool("place-trade", "placeTrade", {
      seed: {
        ...airSeed(),
        thesis: [
          thesisRow({
            id: "t_air",
            ticker: "HPE",
            status: "WATCHING",
            direction: "LONG",
            horizon: "TARGET",
            setupId: "PEAD",
            conviction: "HIGH",
            entryPrice: 150,
            targetPrice: 200,
            stopLoss: 135,
            catalystDate: new Date(Date.now() + 64 * 86_400_000),
            analystId: REPLAY_ANALYST_ID,
          }),
        ],
      },
      ctx: {
        runMode: "INTRADAY_TACTICAL",
        runEnvironment: "PAPER",
        minPositionSize: 2000,
        maxPositionSize: 10000,
        maxOpenPositions: 6,
      },
      args: { ...airArgs, ticker: "HPE" },
      quotes: { HPE: 150 },
    });

    expect(refused).toBe(false);
    expect(sizingText(result)).not.toMatch(/binary/i);
  });
});

// ── DAV-332 ───────────────────────────────────────────────────────────────

describe("DAV-332 — a crashed preflight no longer completes the run", () => {
  it("the checks throw, the run stays open, and it says so on the run", async () => {
    // The exact production-shaped crash: the audit relation comes back null
    // and the preflight hits `t.updates[0]`. Whatever the cause, the point
    // is that the checks did not run.
    const { result, db } = await replayTool("complete-run", "completeRun", {
      seed: {
        researchRun: [
          {
            id: REPLAY_RUN_ID,
            status: "RUNNING",
            mode: "MORNING_PLAN",
            agentConfigId: REPLAY_ANALYST_ID,
            parameters: {},
            startedAt: new Date(),
            completedAt: null,
          },
        ],
        runEvent: [
          {
            id: "ev",
            runId: REPLAY_RUN_ID,
            type: "run_summary",
            title: "Run summary",
            message: "Reviewed the book.",
            payload: {},
            createdAt: new Date(),
          },
        ],
        thesis: [thesisRow({ id: "t1", ticker: "AAA", status: "HOLDING", updates: null })],
      },
      args: {},
      quotes: { AAA: 91 },
    });

    // Was COMPLETE before this change — every obligation skipped in silence.
    expect(db.store.researchRun[0].status).toBe("RUNNING");
    expect(result.summary).toMatch(/refused/i);
    expect(
      (db.store.runEvent as Array<{ type: string }>).some(
        (e) => e.type === "complete_run_preflight_failed",
      ),
    ).toBe(true);
  });
});

// ── DAV-329 ───────────────────────────────────────────────────────────────

describe("DAV-329 — a state re-asks weekly, a crossing daily", () => {
  it("below-the-200-day and near-the-52-week-high default to a week", () => {
    // ABT sat under its 200-day for nine trading days and the Compounder's
    // review rule fired all nine.
    expect(
      defaultCooldownDaysForPredicate({ kind: "VS_SMA", period: 200, direction: "BELOW" }),
    ).toBe(7);
    expect(defaultCooldownDaysForPredicate({ kind: "PCT_FROM_52W_HIGH", max: 5 })).toBe(7);
  });

  it("a real crossing still asks the day it happens", () => {
    expect(defaultCooldownDaysForPredicate({ kind: "PRICE_ABOVE", level: 100 })).toBe(1);
    expect(defaultCooldownDaysForPredicate({ kind: "NEW_HIGH", window: "20D" })).toBe(1);
    expect(defaultCooldownDaysForPredicate({ kind: "NEAR_SMA", period: 50, withinPct: 2 })).toBe(1);
  });
});
