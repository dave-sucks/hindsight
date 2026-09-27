/**
 * batch-fixes.replay.test.ts — DAV-328, DAV-332 and DAV-329, each through
 * the real entry point, each from a shape that exists on the book.
 */
import {
  replayTool,
  prismaDouble,
  thesisRow,
  positionRow,
  agentConfigRow,
  accountRow,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
} from "@/lib/replay";
import { applyTriggerCooldownDefaults, defaultCooldownDaysForPredicate } from "@/lib/agent/triggers/defaults";
import { isBinaryBet } from "@/lib/agent/knowledge/setups";
import type { Trigger } from "@/lib/agent/triggers/types";

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

const tacticalCtx = {
  runMode: "INTRADAY_TACTICAL",
  runEnvironment: "PAPER" as const,
  minPositionSize: 2000,
  maxPositionSize: 10000,
  maxOpenPositions: 6,
};

describe("DAV-328 — a buy into a dated event is half, a buy after it is not", () => {
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

describe("DAV-328 — the same answer on every path that sizes a buy", () => {
  it("AIR two days AFTER its print is the drift entry, sized in full", async () => {
    // The first version of this fix halved every CATALYST-horizon row for
    // good. AIR, KMX and JBL print on 09-29 and 09-30; the PEAD entry is
    // days 1–3 after. That version would have halved all three buys in the
    // one week they exist to be made.
    const { refused, result } = await replayTool("place-trade", "placeTrade", {
      seed: airSeed({ catalystDate: new Date(Date.now() - 2 * 86_400_000) }),
      ctx: tacticalCtx,
      args: airArgs,
      quotes: { AIR: 150 },
    });

    expect(refused).toBe(false);
    expect(sizingText(result)).not.toMatch(/binary/i);
  });

  it("CYTK — a CATALYST row where no setup fits — stays halved", async () => {
    const { refused, result } = await replayTool("place-trade", "placeTrade", {
      seed: airSeed({ ticker: "CYTK", setupId: "NONE", catalystDate: new Date(Date.now() + 47 * 86_400_000) }),
      ctx: tacticalCtx,
      args: { ...airArgs, ticker: "CYTK" },
      quotes: { CYTK: 150 },
    });

    expect(refused).toBe(false);
    expect(sizingText(result)).toMatch(/binary/i);
  });

  it("the real book, row by row", () => {
    const asOf = new Date("2026-09-27T20:00:00Z");
    const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
    const book: Array<[string, string, string | null, string | null, boolean]> = [
      // ticker, horizon, setup, event, half?
      ["MIRM", "CATALYST", "PRE_CATALYST", "2026-09-26", true],
      ["AIR", "CATALYST", "PEAD", "2026-09-29", true],
      ["KMX", "CATALYST", "PEAD", "2026-09-29", true],
      ["JBL", "CATALYST", "PEAD", "2026-09-30", true],
      ["AGIO", "CATALYST", "PRE_CATALYST", "2026-11-01", true],
      ["CYTK", "CATALYST", "NONE", "2026-11-14", true],
      ["BMRN", "CATALYST", null, "2027-02-28", true],
      ["EXEL", "CATALYST", "PRE_CATALYST", "2027-03-03", true],
      ["CSCO", "TARGET", null, "2026-11-18", false],
      ["HPE", "TARGET", "PEAD", "2026-12-01", false],
      ["DOCU", "TARGET", "PEAD", "2026-12-03", false],
      ["NVDA", "TARGET", "PEAD", null, false],
    ];
    for (const [ticker, horizon, setupId, event, half] of book) {
      expect([ticker, isBinaryBet({ horizon, setupId, catalystDate: event ? d(event) : null }, asOf)]).toEqual([
        ticker,
        half,
      ]);
    }
    // Wednesday 09-30, the first run after AIR and KMX print: full size.
    const wednesday = new Date("2026-09-30T12:00:00Z");
    expect(isBinaryBet({ horizon: "CATALYST", setupId: "PEAD", catalystDate: d("2026-09-29") }, wednesday)).toBe(false);
    // …and on the day itself, still half: the row stores the day, not the hour.
    expect(
      isBinaryBet({ horizon: "CATALYST", setupId: "PEAD", catalystDate: d("2026-09-29") }, new Date("2026-09-29T15:00:00Z")),
    ).toBe(true);
    // Nothing main halves today is sized up: an unnamed CATALYST row stays
    // half after its date (the date may be stale; the event may not be).
    expect(isBinaryBet({ horizon: "CATALYST", setupId: null, catalystDate: d("2026-09-01") }, asOf)).toBe(true);
    expect(isBinaryBet({ horizon: "CATALYST", setupId: "PEAD", catalystDate: null }, asOf)).toBe(true);
  });

  it("an ADD to a held pre-catalyst stock takes the halving too", async () => {
    // The entry was halved and the add was not — so the add came out the
    // size of the entry it was meant to be half of.
    const addTo = async (thesisOver: Record<string, unknown>) => {
      const { refused, result } = await replayTool("manage-position", "managePosition", {
        seed: {
          ...airSeed({
            ticker: "AGIO",
            status: "HOLDING",
            catalystDate: new Date(Date.now() + 34 * 86_400_000),
            ...thesisOver,
          }),
          position: [positionRow({ symbol: "AGIO", quantity: 20, initialQty: 20, avgCost: 150, stopLoss: 135 })],
        },
        ctx: { ...tacticalCtx, maxPositionTotal: 20000 },
        args: { symbol: "AGIO", action: "add_to_position", reason: "Base held; adding into the window." },
        quotes: { AGIO: 150 },
      });
      expect(refused).toBe(false);
      return (result as { data?: { addedQty?: number } }).data?.addedQty ?? 0;
    };

    const plain = await addTo({ horizon: "TARGET", setupId: "MA_PULLBACK", catalystDate: null });
    const binary = await addTo({ horizon: "CATALYST", setupId: "PRE_CATALYST" });

    expect(plain).toBeGreaterThan(1);
    expect(binary).toBeLessThan(plain);
    expect(binary).toBeLessThanOrEqual(Math.ceil(plain / 2));
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

describe("DAV-332 — a run that owes no checks still completes", () => {
  it("a podcast segment run whose first write fails is completed by the second, as before", async () => {
    // A podcast segment skips the preflight by design. Nothing was owed, so
    // nothing was skipped: when the write that marks it complete fails once
    // (a dropped connection), the catch's second attempt must still land,
    // and the run must not say its checks "did not run".
    const db = prismaDouble({
      researchRun: [
        {
          id: REPLAY_RUN_ID,
          status: "RUNNING",
          mode: "PODCAST_SEGMENT",
          agentConfigId: null,
          parameters: {},
          startedAt: new Date(),
          completedAt: null,
        },
      ],
    });
    const runs = (db as unknown as { researchRun: { updateMany: (a: unknown) => Promise<unknown> } }).researchRun;
    const realUpdateMany = runs.updateMany;
    let calls = 0;
    runs.updateMany = async (a: unknown) => {
      calls += 1;
      if (calls === 1) throw new Error("connection reset");
      return realUpdateMany(a);
    };

    const { result } = await replayTool("complete-run", "completeRun", {
      ctx: { analystId: undefined, podcastSegmentId: "segment_replay" },
      args: {},
      mocks: { "@/lib/prisma": () => ({ prisma: db }) },
    });

    expect(calls).toBe(2);
    expect(db.store.researchRun[0].status).toBe("COMPLETE");
    expect(String((result as { summary?: string }).summary ?? "")).not.toMatch(/checks could not run/i);
    expect(
      (db.store.runEvent as Array<{ type: string }>).some((e) => e.type === "complete_run_preflight_failed"),
    ).toBe(false);
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

  it("a BUY on the same kinds keeps the day: it fires on the crossing, once, by itself", () => {
    // GD, GEV and SYK buy on "back above the 50-day". A week's cooldown on
    // a buy swallows the second crossing; it quiets nothing.
    const above50 = { kind: "VS_SMA" as const, period: 50 as const, direction: "ABOVE" as const };
    expect(defaultCooldownDaysForPredicate(above50, "ENTER")).toBe(1);
    expect(defaultCooldownDaysForPredicate(above50, "REVIEW")).toBe(7);
    expect(defaultCooldownDaysForPredicate({ kind: "PCT_FROM_52W_HIGH", max: 5 }, "ENTER")).toBe(1);
    // The pullback setup's entry is a composite holding a VS_SMA.
    const pullback = {
      kind: "AND" as const,
      predicates: [{ kind: "NEAR_SMA" as const, period: 50 as const, withinPct: 2 }, above50],
    };
    expect(defaultCooldownDaysForPredicate(pullback, "ENTER")).toBe(1);
    expect(defaultCooldownDaysForPredicate(pullback, "REVIEW")).toBe(7);

    // …and that is what the write path stores on a new rung.
    const written = applyTriggerCooldownDefaults([
      { id: "buy", action: "ENTER", predicate: above50 },
      { id: "review", action: "REVIEW", predicate: { kind: "VS_SMA", period: 200, direction: "BELOW" } },
    ] as unknown as Trigger[]);
    expect(written.map((t) => [t.id, t.cooldownDays])).toEqual([
      ["buy", 1],
      ["review", 7],
    ]);
  });

  it("a real crossing still asks the day it happens", () => {
    expect(defaultCooldownDaysForPredicate({ kind: "PRICE_ABOVE", level: 100 })).toBe(1);
    expect(defaultCooldownDaysForPredicate({ kind: "NEW_HIGH", window: "20D" })).toBe(1);
    expect(defaultCooldownDaysForPredicate({ kind: "NEAR_SMA", period: 50, withinPct: 2 })).toBe(1);
  });
});
