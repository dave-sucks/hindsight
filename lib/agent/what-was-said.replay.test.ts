/**
 * what-was-said.replay.test.ts — every agent that decides on a stock reads
 * the stock's newest 8 Activity lines first, exactly as the owner sees them
 * (lib/thesis/activity-feed.ts), and a fired trigger stays open until an
 * agent answers it.
 *
 * CEG, Secular Compounder, September 2026, from its stored rows
 * (lib/agent/__fixtures__/ceg-what-was-said-2026-09.json; the position and the
 * analyst's and account's rules from ceg-floor-too-far-2026-09-30.json):
 *
 *  - 09-14 11:43 ET the principal declined a sale in 709 characters, ending
 *    "Hard reject. If anything, today is a setup for the Secular Compounder
 *    to add, not exit." Before 2026-09-30 the trigger runs that afternoon
 *    got it cut at 120 characters; before 2026-10-30 a run got it only until
 *    the next answer. Now it is one of the 8 lines, whole, for as long as it
 *    is among the newest 8.
 *  - 09-16 the analyst's "15% off the high" review fired. The 09-18 morning
 *    run was handed only the newest fire; now every fire is a line.
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
import { activityFeed, recentItems } from "@/lib/thesis/activity-feed";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { rowForModel } from "@/lib/agent/row-for-model";
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

const DECLINE = "cmu1ex281000104jq0w42txms";
const DECLINE_ENDS = "Hard reject. If anything, today is a setup for the Secular Compounder to add, not exit.";
const RAISE_THE_FLOOR = "hold and raise the floor under real structure (the 20-day low, the breakout level)";
const HEADER = "WHAT'S BEEN SAID ON $CEG — its newest 8 Activity lines, newest first, as the owner sees them:";

/** CEG's Activity lines before `at`, stored the way the database holds them (the run joined inline). */
function linesBefore(at: string) {
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
      signalIds: [] as string[],
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
  it("the 8 newest lines: the 09-16 answer, every fire since it, and the principal's 09-14 removal", async () => {
    const { full } = await morningRead(fx.thesis0918, fx.runs.morning0918.readAt, fx.runs.morning0918.price);
    expect(full).not.toBeNull();
    const context = full!.context!;
    expect(context.startsWith(HEADER)).toBe(true);
    // On main the row had `principalDirective: null` and was handed one fire.
    expect(context).toContain('09-16 08:07 · $259.89 · Review — "CEG is under pressure technically');
    expect(context).toContain("09-16 10:15 · $257.59 · Trigger: Trailing 15% from high — review");
    expect(context).toContain(RAISE_THE_FLOOR);
    expect(context).toContain("Trigger: Price below $256.42 — review");
    expect(context).toContain("Edited by you [Removed: Trailing 8% from high → exit]");
    // The 09-14 decline is older than the 8.
    expect(context).not.toContain(DECLINE_ENDS);
    expect(Object.keys(full!)[0]).toBe("context");
    expect(full).not.toHaveProperty("principalDirective");
  });
});

describe("the 09-30 morning read of CEG, through get_theses", () => {
  it("the 09-28 15%-off-the-high review is still open: the principal's cleanup is not an agent's answer", async () => {
    const { full, quiet } = await morningRead(fl.thesisBefore, fx.runs.morning0930.readAt, fx.runs.morning0930.price);
    expect(full).not.toBeNull();
    expect(quiet).toBe(false);
    const context = full!.context!;
    expect(context.startsWith(HEADER)).toBe(true);
    expect(context).toContain('09-28 08:04 · $261.23 · Review — "CEG\'s repeated 200-day review');
    expect(context).toContain("09-28 11:20 · $257.63 · Trigger: Trailing 15% from high — review");
    expect(context).toContain(RAISE_THE_FLOOR);
    // The principal's 09-14 removal of the 8% trail is older than the 8: the full history is one call away.
    expect(context).not.toContain("Trailing 8% from high");
    expect(context).toContain('Full history: get_theses(tickers: ["CEG"], include_history: true)');
  });
});

describe("the 09-14 trigger runs", () => {
  const promptAt = (loadedAt: string, firedPrice: number) => {
    const rows = linesBefore(loadedAt);
    const context = stockContextFor({ ticker: "CEG", rows }).text;
    const trail = { id: "cacca7f6-ab5e-4f8c-9922-f2c2c94ce5d8", action: "EXIT", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, rationale: "Gave back 8% from the high." } as Trigger;
    // Since step 10 the trigger run reads the stock as get_theses's short row with the setup's lines; what's been said is its `said`.
    const prompt = buildTacticalSystemPrompt({
      analyst: { name: fl.analyst.name, analystPrompt: null },
      stock: {
        ticker: "CEG",
        direction: "LONG",
        row: rowForModel({ id: fx.thesis0918.id, ticker: "CEG", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", context, coreBelief: "CEG compounds to $360+ over 24 months." }, { named: true, size: "short", setupLines: true }) as Row,
      },
      trigger: trail,
      position: { peakPrice: 303.4 },
      fired: { price: firedPrice },
    });
    return { prompt, inTheEight: recentItems(activityFeed({ updates: rows, orders: [] })).some((i) => i.id === DECLINE) };
  };

  it("15:30, the first run after the decline: the whole decline, titled as the tab titles it, and the rule to answer what it asks", () => {
    const { prompt, inTheEight } = promptAt(fx.runs.trigger0914_1530.loadedAt, 264.6);
    expect(inTheEight).toBe(true);
    // CEG had seven lines by then, so the block says seven.
    expect(prompt).toContain("WHAT'S BEEN SAID ON $CEG — its newest 7 Activity lines, newest first, as the owner sees them:");
    expect(prompt).toContain("Declined sell 30 shares");
    expect(prompt).toContain(DECLINE_ENDS);
    expect(prompt).toContain("The principal's words outrank everything else about a stock.");
    expect(prompt).toContain("When the row's `said` lists the principal's decisions or other triggers");
    expect(prompt).not.toContain("RECENT THESIS ACTIVITY");
  });

  it("15:55: the decline is still read while it is among the newest 8, and not once it isn't", () => {
    const { prompt, inTheEight } = promptAt(fx.runs.trigger0914_1555.loadedAt, 264.99);
    expect(prompt.includes(DECLINE_ENDS)).toBe(inTheEight);
  });
});

/**
 * MU, PEAD Specialist, 2026-09-28 (mu-trigger-run-open-reviews-2026-09-28.json).
 * At 10:45 ET a trigger run handled the $1,041 floor sale while three reviews
 * from that morning were open (reports within 3 days, up 15% from entry, down
 * 4% today). Its one update_thesis answered all three.
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

  it("the run reads the morning's note and the three fires as lines, and is told its note answers what each asks", () => {
    const context = stockContextFor({ ticker: "MU", rows: loaded }).text!;
    const prompt = buildTacticalSystemPrompt({
      analyst: { name: "PEAD Specialist", analystPrompt: null },
      stock: {
        ticker: "MU",
        direction: "LONG",
        row: rowForModel({ id: "cmrp6chyu000h04l5roqq5ha1", ticker: "MU", status: "HOLDING", direction: "LONG", horizon: "TARGET", context, coreBelief: "MU's HBM-driven earnings-upgrade cycle carries the stock through the next print." }, { named: true, size: "short", setupLines: true }) as Row,
      },
      trigger: sale,
      position: { peakPrice: 1100 },
      fired: { price: 1038.82 },
    });
    expect(prompt).toMatch(/09-28 08:00 · \$1082\.28 · (Review|Updated)/);
    expect(prompt).toContain("Trigger: Reports within 3 days — review");
    expect(prompt).toContain("Trigger: Up 15% from entry — review");
    expect(prompt).toContain("Trigger: Price down 4% today — review");
    expect(prompt).toContain(
      "When the row's `said` lists the principal's decisions or other triggers\n     fired since the last answer, your note answers what each asks (an\n     earnings date coming, a gain to reassess, a drop to explain) inside the\n     story of the stock, not as a list of the triggers.",
    );
  });
});
