/**
 * what-was-said.replay.test.ts — every agent that decides on a stock reads
 * what has been said on it first, and a fired trigger stays open until an
 * agent answers it (docs/plans/AGENT_CONTEXT.md §3.2, §3.3).
 *
 * CEG, Secular Compounder, September 2026, from its stored rows
 * (lib/agent/__fixtures__/ceg-what-was-said-2026-09.json; the position and the
 * analyst's and account's rules from ceg-floor-too-far-2026-09-30.json):
 *
 *  - 09-14 11:43 ET the principal declined a sale in 709 characters, ending
 *    "Hard reject. If anything, today is a setup for the Secular Compounder
 *    to add, not exit." It was the newest line for four hours. No morning
 *    run from 09-16 to 09-30 was shown it; the trigger runs that afternoon
 *    got it cut at 120 characters, and from 15:55 not at all.
 *  - 09-16 the analyst's "15% off the high" review fired (its rule: "hold and
 *    raise the floor under real structure"). The 09-18 morning run was
 *    handed only the newest fire, "below the 200-day".
 *  - 09-28 11:20 the same review fired again; the principal's cleanup of
 *    copied rules at 11:56 counted as its answer. On 09-30 the morning run
 *    filed CEG as quiet.
 */
import raw from "@/lib/agent/__fixtures__/ceg-what-was-said-2026-09.json";
import floorRaw from "@/lib/agent/__fixtures__/ceg-floor-too-far-2026-09-30.json";
import muRaw from "@/lib/agent/__fixtures__/mu-trigger-run-open-reviews-2026-09-28.json";
import { isAgentAnswer, openFires, type ActivityRow } from "@/lib/agent/stock-context";
import {
  replayTool,
  thesisRow,
  positionRow,
  agentConfigRow,
  accountRow,
  REPLAY_ANALYST_ID,
} from "@/lib/replay";
import { stockContextFor } from "@/lib/agent/stock-context-for";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import type { Trigger } from "@/lib/agent/triggers/types";

type Row = Record<string, unknown>;
type StoredLine = { id: string; type: string; triggerId: string | null; timestamp: string; summary: string; rationale: string | null; fieldChanges: unknown; runId: string | null; priceAtTime: number | null; runMode: string | null };
const fx = raw as unknown as {
  runs: Record<"morning0918" | "morning0930", { readAt: string; price: number }> & Record<"trigger0914_1530" | "trigger0914_1555", { loadedAt: string }>;
  thesis0918: Row & { id: string; triggers: Trigger[]; createdAt: string; lastReviewedAt: string; researchUpdatedAt: string };
  updates: StoredLine[];
};
const fl = floorRaw as unknown as {
  thesisBefore: Row & { id: string; triggers: Trigger[]; createdAt: string; lastReviewedAt: string; researchUpdatedAt: string | null };
  position: Row & { openedAt: string; peakAt: string };
  analyst: { name: string; setupIds: string[]; triggers: Trigger[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  snapshot: { asOf: string; snapshot: Row };
  equity: Record<string, number>;
};

const DECLINE_ENDS = "Hard reject. If anything, today is a setup for the Secular Compounder to add, not exit.";
const RAISE_THE_FLOOR = "hold and raise the floor under real structure (the 20-day low, the breakout level)";

/** CEG's Activity lines before `at`, stored the way the database holds them (the run joined inline). */
function linesBefore(at: string): Row[] {
  const cut = new Date(at).getTime();
  return fx.updates
    .filter((u) => new Date(u.timestamp).getTime() < cut)
    .map((u) => ({
      id: u.id,
      thesisId: fx.thesis0918.id,
      type: u.type,
      triggerId: u.triggerId,
      timestamp: new Date(u.timestamp),
      summary: u.summary,
      rationale: u.rationale,
      fieldChanges: u.fieldChanges ?? {},
      runId: u.runId,
      priceAtTime: u.priceAtTime,
      tradeId: null,
      signalIds: [],
      positionAtTime: null,
      run: u.runMode ? { mode: u.runMode } : null,
    }));
}

const onAnalyst = { agentConfigId: REPLAY_ANALYST_ID, agentConfig: { name: fl.analyst.name, setupIds: fl.analyst.setupIds, enabled: true } };

function seed(thesis: typeof fx.thesis0918 | typeof fl.thesisBefore, at: string) {
  return {
    agentConfig: [agentConfigRow({ name: fl.analyst.name, setupIds: fl.analyst.setupIds, triggers: fl.analyst.triggers, enabled: true })],
    account: [accountRow({ triggers: fl.account.triggers, triggersSeededAt: new Date(fl.account.triggersSeededAt) })],
    tickerIndicators: [{ id: "ceg_snap", ticker: "CEG", asOf: fl.snapshot.asOf, snapshot: fl.snapshot.snapshot, computedAt: new Date("2026-09-29T10:30:00Z") }],
    thesis: [
      thesisRow({
        ...thesis,
        ticker: "CEG",
        createdAt: new Date(thesis.createdAt),
        lastReviewedAt: new Date(thesis.lastReviewedAt),
        researchUpdatedAt: thesis.researchUpdatedAt ? new Date(thesis.researchUpdatedAt) : null,
        researchRun: onAnalyst,
      }),
    ],
    position: [
      positionRow({
        ...fl.position,
        analystId: REPLAY_ANALYST_ID,
        openedAt: new Date(fl.position.openedAt),
        peakAt: new Date(fl.position.peakAt),
        environment: "LIVE",
      }),
    ],
    thesisUpdate: linesBefore(at),
  };
}

async function morningRead(thesis: typeof fx.thesis0918 | typeof fl.thesisBefore, at: string, price: number) {
  jest.useFakeTimers({
    now: new Date(at),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: seed(thesis, at) as never,
      args: { detail: "actionable" },
      ctx: { runEnvironment: "LIVE", runMode: "MORNING_PLAN" },
      quotes: { CEG: price },
      equity: fl.equity["2026-09-29"],
    });
    const data = (result as unknown as { data: { theses: Array<Row & { ticker: string; context: string | null }>; quiet_theses: Array<{ ticker: string }> } }).data;
    return { full: data.theses.find((t) => t.ticker === "CEG") ?? null, quiet: data.quiet_theses.some((t) => t.ticker === "CEG") };
  } finally {
    jest.useRealTimers();
  }
}

describe("the fixture is the production case", () => {
  it("the decline, both 15%-off-the-high fires, and the cleanup that closed the second one", () => {
    const decline = fx.updates.find((u) => u.type === "PROPOSAL_REJECTED")!;
    expect(decline.rationale).toContain(DECLINE_ENDS);
    const fifteen = fx.updates.filter((u) => u.type === "TRIGGER_FIRED" && u.triggerId === "06506e39-522f-4ad1-aa62-d7fe10bf7003");
    expect(fifteen.map((u) => u.timestamp.slice(0, 16))).toEqual(["2026-09-16T14:15", "2026-09-28T15:20"]);
    expect(fx.updates.filter((u) => u.summary.startsWith("Removed a copied rule from CEG")).map((u) => u.timestamp.slice(0, 16))).toEqual([
      "2026-09-28T15:56",
      "2026-09-28T15:56",
    ]);
  });
});

describe("the 09-18 morning run's read of CEG, through get_theses", () => {
  it("opens with the 09-16 answer and all three fires since it — not the 09-14 decline, which the trigger runs answered", async () => {
    const { full } = await morningRead(fx.thesis0918, fx.runs.morning0918.readAt, fx.runs.morning0918.price);
    expect(full).not.toBeNull();
    const context = full!.context!;
    // On main the row had `principalDirective: null` and was handed one fire.
    expect(context).toContain("Last look: morning run, 09-16 08:07");
    expect(context).toContain("Since then, not yet answered:");
    expect(context).toContain(RAISE_THE_FLOOR); // the 15% review main never handed over
    expect(context).toContain("Review if below $256.42 — 09-16 10:30");
    expect(context).toMatch(/Review if below the 200-day average — fired 2×/);
    expect(context).not.toContain(DECLINE_ENDS);
    expect(Object.keys(full!)[0]).toBe("context");
    expect(full).not.toHaveProperty("principalDirective");
  });
});

describe("the 09-30 morning read of CEG, through get_theses", () => {
  it("the 09-28 15%-off-the-high review is still open: the principal's cleanup is not an agent's answer, and is not shown", async () => {
    const { full } = await morningRead(fl.thesisBefore, fx.runs.morning0930.readAt, fx.runs.morning0930.price);
    expect(full).not.toBeNull();
    const context = full!.context!;
    expect(context).toContain("Last look: morning run, 09-28 08:04");
    expect(context).toContain("09-28 11:20 at $257.63");
    expect(context).toContain(RAISE_THE_FLOOR);
    expect(context).not.toContain("copied rule");
    expect(context).not.toContain(DECLINE_ENDS);
  });
});

describe("the 09-14 trigger runs", () => {
  const promptAt = (loadedAt: string, firedPrice: number) => {
    const rows = linesBefore(loadedAt).map((r) => ({ ...r, runMode: (r.run as { mode?: string } | null)?.mode ?? null })) as never;
    const context = stockContextFor({
      ticker: "CEG",
      rows,
      triggers: [...fx.thesis0918.triggers, ...fl.analyst.triggers],
      now: new Date(loadedAt),
      currentPrice: firedPrice,
    }).text;
    const trail = { id: "cacca7f6-ab5e-4f8c-9922-f2c2c94ce5d8", action: "EXIT", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, rationale: "Gave back 8% from the high." } as Trigger;
    return buildTacticalSystemPrompt({
      analyst: { name: fl.analyst.name, mandate: null },
      thesis: {
        id: fx.thesis0918.id,
        ticker: "CEG",
        direction: "LONG",
        horizon: "COMPOUNDER",
        setupId: null,
        coreBelief: "CEG compounds to $360+ over 24 months.",
        keyAssumptions: [],
        invalidationConds: [],
        entryPrice: 280.33,
        targetPrice: 360,
        stopLoss: 220,
        snapshotText: null,
        bullCaseBullets: [],
        bearCaseBullets: [],
        researchAge: { freshness: "fresh", daysOld: 5, horizonThreshold: 90 } as never,
        allTriggers: [trail],
      },
      trigger: trail,
      position: { quantity: 30, avgCost: 280.33, daysHeld: 32, peakPrice: 303.4 },
      context,
      fired: { price: firedPrice, coFired: [] },
    });
  };

  it("15:30, the first run after the decline: the whole decline, the price then and now, and the rule to answer it by name", () => {
    const prompt = promptAt(fx.runs.trigger0914_1530.loadedAt, 264.6);
    expect(prompt).toContain("WHAT'S BEEN SAID ON $CEG");
    expect(prompt).toContain("The principal, 09-14 11:43: Declined the sale (30 shares) at $273.98, now $264.60 (−3.4%)");
    expect(prompt).toContain(DECLINE_ENDS);
    expect(prompt).toContain("The principal's decisions outrank the trigger's own rationale.");
    expect(prompt).toContain("When WHAT'S BEEN SAID lists the principal's decisions or other triggers");
    expect(prompt).not.toContain("RECENT THESIS ACTIVITY");
  });

  it("15:55: the 15:30 run answered it, so it is no longer handed over", () => {
    expect(promptAt(fx.runs.trigger0914_1555.loadedAt, 264.99)).not.toContain(DECLINE_ENDS);
  });
});

/**
 * MU, PEAD Specialist, 2026-09-28 (mu-trigger-run-open-reviews-2026-09-28.json).
 * CEG never had a trigger run while a review sat open — every CEG fire after
 * 09-15 was a review held for the morning run — so this is the real case of
 * the same gap: at 10:45 ET a trigger run handled the $1,041 floor sale while
 * three reviews from that morning were open (reports within 3 days, up 15%
 * from entry, down 4% today). Its one update_thesis answered all three and
 * named none but the report in passing.
 */
describe("a trigger run with other reviews open (MU 09-28 10:45 ET)", () => {
  type Line = Omit<ActivityRow, "timestamp"> & { timestamp: string };
  const mu = muRaw as unknown as { loadedAt: string; triggers: Trigger[]; rows: Line[]; closeout: Line };
  const toRow = (l: Line): ActivityRow => ({ ...l, timestamp: new Date(l.timestamp) });
  const loaded = mu.rows.map(toRow);
  const sale = mu.triggers.find((t) => t.id === "t4")!;

  it("the fixture is the production case: three reviews open, and the run's one line closes all three", () => {
    expect(openFires(loaded).map((f) => f.triggerId).sort()).toEqual(["2eeaf28c-8082-4d28-b5d9-2fa8bdc82ace", "t6", "t9"].sort());
    const closeout = toRow(mu.closeout);
    expect(isAgentAnswer(closeout)).toBe(true);
    expect(openFires([...loaded, closeout])).toEqual([]);
    expect(mu.closeout.rationale).not.toMatch(/15%|4%/);
  });

  it("the prompt lists the three open reviews and tells the run its update_thesis answers each, by name", () => {
    const context = stockContextFor({ ticker: "MU", rows: loaded, triggers: mu.triggers, now: new Date(mu.loadedAt) }).text!;
    const prompt = buildTacticalSystemPrompt({
      analyst: { name: "PEAD Specialist", mandate: null },
      thesis: {
        id: "cmrp6chyu000h04l5roqq5ha1",
        ticker: "MU",
        direction: "LONG",
        horizon: "TARGET",
        setupId: null,
        coreBelief: "MU's HBM-driven earnings-upgrade cycle carries the stock through the next print.",
        keyAssumptions: [],
        invalidationConds: [],
        entryPrice: 895.94,
        targetPrice: 1100,
        stopLoss: 1041,
        snapshotText: null,
        bullCaseBullets: [],
        bearCaseBullets: [],
        researchAge: { freshness: "fresh", daysOld: 3, horizonThreshold: 30 } as never,
        allTriggers: mu.triggers,
      },
      trigger: sale,
      position: { quantity: 13, avgCost: 895.94, daysHeld: 20, peakPrice: 1100 },
      context,
      fired: { price: 1038.82, coFired: [] },
    });
    expect(prompt).toContain("Last look: morning run, 09-28 08:00");
    expect(prompt).toContain("Since then, not yet answered:");
    expect(prompt).toContain("Reports within 3 days — decide before the print");
    expect(prompt).toContain("At +15% from entry, reassess");
    expect(prompt).toContain("A sharp 1-day drop could be either normal volatility");
    expect(prompt).toContain(
      "When WHAT'S BEEN SAID lists the principal's decisions or other triggers\n     fired since the last answer, your update_thesis answers them too: say\n     what you decided on each, by name.",
    );
  });
});
