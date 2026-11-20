/**
 * what-was-said.replay.test.ts — every agent that decides on a stock reads
 * the stock's Activity first, as one list (lib/agent/stock-context.ts: the
 * last 3 reviews, the news, the owner's notes and declines), and a fired
 * trigger stays open until an agent answers it.
 *
 * CEG, Secular Compounder, September 2026, from its stored rows
 * (lib/agent/__fixtures__/ceg-what-was-said-2026-09.json; the position and the
 * analyst's and account's rules from ceg-floor-too-far-2026-09-30.json):
 *
 *  - 09-14 11:43 ET the principal declined a sale in 709 characters, ending
 *    "Hard reject. If anything, today is a setup for the Secular Compounder
 *    to add, not exit." Before 2026-09-30 the trigger runs that afternoon
 *    got it cut at 120 characters; before 2026-10-30 a run got it only until
 *    the next answer; until 2026-11-19 only while it was among the newest 8
 *    lines. Now a decline with the owner's words is always in the list, whole.
 *  - 09-16 the analyst's "15% off the high" review fired. A fire is not an
 *    Activity line an agent is sent: it is the stock's situation, and its
 *    trigger's own line says it fired.
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
import { triggerRunSent } from "@/lib/agent/__fixtures__/trigger-run-sent";
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
const HEADER = "Activity on $CEG, newest first: the last 3 reviews, up to 3 news notes, your notes and your declines.";

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
  it("the last 3 reviews and the owner's 09-14 decline, whole", async () => {
    const { full } = await morningRead(fx.thesis0918, fx.runs.morning0918.readAt, fx.runs.morning0918.price);
    expect(full).not.toBeNull();
    const context = full!.context!;
    expect(context.startsWith(HEADER)).toBe(true);
    const heads = context.split("\n").slice(1, -1).map((l) => l.slice(0, l.indexOf(": ")));
    expect(heads).toEqual([
      "  Review by its analyst, Sep 16, 8:07 AM at $259.89",
      "  Review by its analyst, Sep 14, 3:55 PM at $284.75",
      "  Review by its analyst, Sep 14, 3:50 PM at $284.75",
      "  Declined sell 30 shares by you, Sep 14, 11:43 AM",
    ]);
    // The fired rule's own note is on its trigger line, once; the fires themselves and the owner's 09-14 removal are not in the list.
    expect(JSON.stringify(full!.inheritedTriggers)).toContain(RAISE_THE_FLOOR);
    expect(context).not.toContain("Trailing 15% from high");
    expect(context).not.toContain("Trailing 8% from high");
    expect(context).toContain(DECLINE_ENDS);
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
    expect(context.split("\n")[1]).toMatch(/^ {2}Review by its analyst, Sep 28, 8:04 AM at \$261\.23: CEG's repeated 200-day review/);
    // The 15% review that fired at 11:20 is not in the list: it is on its trigger's line (fired, with its note) and it is the stock's situation.
    expect(context).not.toContain("Trailing 15% from high");
    expect(JSON.stringify(full!.inheritedTriggers)).toContain(RAISE_THE_FLOOR);
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
    const prompt = triggerRunSent({
      analyst: { name: fl.analyst.name, analystPrompt: null },
      stock: {
        ticker: "CEG",
        direction: "LONG",
        row: rowForModel({ id: fx.thesis0918.id, ticker: "CEG", status: "HOLDING", direction: "LONG", horizon: "COMPOUNDER", context, coreBelief: "CEG compounds to $360+ over 24 months." }, { named: true, size: "short", playbookChecks: true }) as Row,
      },
      trigger: trail,
      position: { peakPrice: 303.4 },
      fired: { price: firedPrice },
    });
    return { prompt, context: context! };
  };

  it("15:30, the first run after the decline: the whole decline, titled as the tab titles it, and the rule to answer what it asks", () => {
    const { prompt, context } = promptAt(fx.runs.trigger0914_1530.loadedAt, 264.6);
    expect(prompt).toContain("Activity on $CEG, newest first");
    expect(context.split("\n")[1].startsWith("  Declined sell 30 shares by you, Sep 14, 11:43 AM: ")).toBe(true);
    expect(prompt).toContain(DECLINE_ENDS);
    expect(prompt).toContain("The principal's words outrank everything else about a stock.");
    expect(prompt).toContain("When the row's `said` lists the principal's decisions or other triggers");
    expect(prompt).not.toContain("RECENT THESIS ACTIVITY");
  });

  it("15:55: the decline is still read, however many lines were written after it: the owner's last decline is always open", () => {
    const { prompt, context } = promptAt(fx.runs.trigger0914_1555.loadedAt, 264.99);
    expect(prompt).toContain(DECLINE_ENDS);
    expect(context.split(DECLINE_ENDS)).toHaveLength(2);
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

  it("the run reads the morning's note; the three fires are not Activity lines it is sent", () => {
    const context = stockContextFor({ ticker: "MU", rows: loaded }).text!;
    const prompt = triggerRunSent({
      analyst: { name: "PEAD Specialist", analystPrompt: null },
      stock: {
        ticker: "MU",
        direction: "LONG",
        row: rowForModel({ id: "cmrp6chyu000h04l5roqq5ha1", ticker: "MU", status: "HOLDING", direction: "LONG", horizon: "TARGET", context, coreBelief: "MU's HBM-driven earnings-upgrade cycle carries the stock through the next print." }, { named: true, size: "short", playbookChecks: true }) as Row,
      },
      trigger: sale,
      position: { peakPrice: 1100 },
      fired: { price: 1038.82 },
    });
    expect(context.split("\n")[1].startsWith("  Review by its analyst, Sep 28, 8:00 AM at $1082.28: MU hit the $1,100 decision zone")).toBe(true);
    // The three reviews that fired since are not in the list; each is on its own trigger's line as fired.
    expect(context).not.toContain("Reports within 3 days");
    expect(prompt).toContain(
      "When the row's `said` lists the principal's decisions or other triggers fired since the last answer, your note answers what each asks (an earnings date coming, a gain to reassess, a drop to explain) inside the story of the stock, not as a list of the triggers.",
    );
  });
});
