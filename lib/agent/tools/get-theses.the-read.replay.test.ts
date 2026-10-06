/**
 * get-theses.the-read.replay.test.ts — what the model reads of get_theses
 * (docs/plans/AGENT_ARCHITECTURE.md, steps 4b and 4c).
 *
 * In September, 27 of 40 morning opening reads asked for include_history on
 * the whole book because this tool's description invited it, and that turned
 * every row full: 180,000-330,000 characters re-sent on every later step. The
 * writer's research text (snapshot, bull and bear cases, score notes) rode on
 * every full row too, as old as the writer's last visit.
 *
 * Now: the raw history comes back on a read of named stocks; every row says
 * when its research was written and at what price. The research text stays on
 * every full row: a run left to ask for it never did (now-needs-research,
 * 0/12, also with a line saying how). The screen gets the whole result as
 * before.
 *
 * Through the real get_theses execute and its real model-output hook.
 */
import { replayTool, thesisRow, thesisUpdateRow } from "@/lib/replay";

const snapshot = { text: "Nuclear baseload under long contracts; a clean uptrend, score 8.", citations: [] };
const bull = { bullets: [{ text: "Hyperscaler power deals reprice the fleet." }] };
const bear = { bullets: [{ text: "Capacity auction prices fall back." }] };
const scoring = {
  composite: 7,
  trendStrength: { score: 2, note: "Above the 50-day; a long note the writer wrote 51 days ago." },
  relativeStrength: { score: 2, note: "Leads SPY." },
  entryQuality: { score: 1, note: "Not at the entry yet." },
  catalystFreshness: { score: 2, note: "Earnings in three weeks." },
};

/** A watched stock whose review is due, so it is on the work list as a full row. */
const syk = () =>
  thesisRow({
    id: "t_syk",
    ticker: "SYK",
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    entryPrice: 340,
    targetPrice: 420,
    stopLoss: 300,
    snapshot,
    bullCase: bull,
    bearCase: bear,
    scoring,
    researchUpdatedAt: new Date(Date.now() - 51 * 86_400_000),
    lastReviewedAt: new Date(Date.now() - 40 * 86_400_000),
    triggers: [
      { id: "t_buy", action: "ENTER", predicate: { kind: "PRICE_BELOW", level: 340 }, rationale: "Buy the pullback.", cooldownDays: 1 },
      { id: "t_floor", action: "EXIT", predicate: { kind: "PRICE_BELOW", level: 300 }, rationale: "Below the base.", cooldownDays: 1 },
      { id: "t_target", action: "REVIEW", predicate: { kind: "PRICE_ABOVE", level: 420 }, rationale: "Target.", cooldownDays: 1 },
      { id: "t_clock", action: "REVIEW", predicate: { kind: "REVIEW_CADENCE", days: 30 }, rationale: "Monthly.", cooldownDays: 30 },
    ],
  });

const updates = () => [
  thesisUpdateRow({ id: "u_written", thesisId: "t_syk", type: "CREATED", priceAtTime: 348, timestamp: new Date(Date.now() - 51 * 86_400_000), runId: "run_writer", run: { mode: "THESIS_WRITER" } }),
  thesisUpdateRow({ id: "u_review", thesisId: "t_syk", type: "REVIEWED", priceAtTime: 280, rationale: "Plan stands.", timestamp: new Date(Date.now() - 40 * 86_400_000), runId: "run_morning", run: { mode: "MORNING_PLAN" } }),
];

/** A held stock with nothing due: quiet, so a one-line roster entry on the opening read. */
const ceg = () =>
  thesisRow({
    id: "t_ceg",
    ticker: "CEG",
    status: "HOLDING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    setupId: "COMPOUNDER_ACCUMULATION",
    entryPrice: 250,
    targetPrice: 340,
    stopLoss: 262,
    snapshot,
    scoring,
    researchUpdatedAt: new Date(Date.now() - 5 * 86_400_000),
    lastReviewedAt: new Date(Date.now() - 2 * 86_400_000),
    triggers: [
      { id: "c_floor", action: "EXIT", predicate: { kind: "PRICE_BELOW", level: 262 }, rationale: "Under the gain.", cooldownDays: 1 },
      { id: "c_clock", action: "REVIEW", predicate: { kind: "REVIEW_CADENCE", days: 30 }, rationale: "Monthly.", cooldownDays: 30 },
    ],
  });

async function read(args: Record<string, unknown>) {
  const { result } = await replayTool("get-theses", "getTheses", {
    seed: { thesis: [syk(), ceg()], thesisUpdate: updates() },
    ctx: { runMode: "MORNING_PLAN" },
    args,
    quotes: { SYK: 273, CEG: 280 },
  });
  const { getTheses } = await import("@/lib/agent/tools/get-theses");
  const tool = getTheses({ runId: "r", userId: "u", analystId: "a" } as never) as unknown as {
    toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data: Record<string, unknown> } };
  };
  const model = tool.toModelOutput({ toolCallId: "c1", input: args, output: result }).value.data;
  const screen = result.data as Record<string, unknown>;
  const row = (d: Record<string, unknown>) => ((d.theses as Array<Record<string, unknown>>) ?? []).find((t) => t.ticker === "SYK") as Record<string, unknown>;
  return { model, screen, modelRow: row(model), screenRow: row(screen) };
}

describe("get_theses — the read", () => {
  it("the opening read with include_history: no history, the research text kept, and a dated research line", async () => {
    const { model, modelRow } = await read({ include_history: true });
    expect(modelRow).toBeDefined();
    expect(modelRow.history).toBeUndefined();
    // A run left to ask for the research never did (now-needs-research), so it stays on the row.
    expect(modelRow.snapshot).toEqual(snapshot);
    expect(modelRow.bullCase).toEqual(bull);
    expect(modelRow.bearCase).toEqual(bear);
    expect((modelRow.scoring as Record<string, { note?: string }>).trendStrength.note).toMatch(/51 days ago/);
    expect(String(modelRow.research)).toMatch(/^Written \d{4}-\d{2}-\d{2} at \$348, 51 days ago\.$/);
    expect(modelRow.triggerState).toBeUndefined();
    expect(String(model.historyNote)).toMatch(/named stocks/);
  });

  it("asking for history on the whole book no longer sends every stock full", async () => {
    const { model } = await read({ include_history: true });
    // The quiet split stays on: the held stock with nothing due is a roster line, not a full row.
    const full = (model.theses as Array<{ ticker: string }>).map((t) => t.ticker);
    const quiet = (model.quiet_theses as Array<{ ticker: string }>).map((t) => t.ticker);
    expect(full).toEqual(["SYK"]);
    expect(quiet).toEqual(["CEG"]);
  });

  it("a read of a named stock keeps the history and the research text", async () => {
    const { modelRow } = await read({ tickers: ["SYK"], include_history: true });
    expect(Array.isArray(modelRow.history) && (modelRow.history as unknown[]).length).toBeGreaterThan(0);
    expect(modelRow.snapshot).toEqual(snapshot);
    expect((modelRow.scoring as Record<string, { note?: string }>).trendStrength.note).toMatch(/51 days ago/);
    expect(String(modelRow.research)).toMatch(/at \$348/);
  });

  it("the screen still gets the whole row", async () => {
    const { screenRow } = await read({ include_history: true });
    expect(screenRow.snapshot).toEqual(snapshot);
    expect(screenRow.bearCase).toEqual(bear);
  });
});
