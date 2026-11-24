/**
 * get-theses.the-read.replay.test.ts — what the model reads of get_theses
 * (docs/plans/AGENT_ARCHITECTURE.md, steps 4b, 4c and 8).
 *
 * In September, 27 of 40 morning opening reads asked for include_history on
 * the whole book because this tool's description invited it, and that turned
 * every row full: 180,000-330,000 characters re-sent on every later step. The
 * writer's research text rode on every full row too, as old as the writer's
 * last visit.
 *
 * Now: a stock in a situation is the short row (the belief, the plan, the
 * snapshot's first paragraph, the score; no bull or bear case); the raw
 * history and the research essays come back on a read of named stocks; every
 * row says when its research was written and at what price. The screen gets
 * the whole result as before.
 *
 * Through the real get_theses execute and its real model-output hook.
 */
import { replayTool, thesisRow, thesisUpdateRow, positionRow } from "@/lib/replay";
import { situationText } from "@/lib/agent/situation-skills";

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
    snapshot,
    bullCase: bull,
    bearCase: bear,
    scoring,
    researchUpdatedAt: new Date(Date.now() - 51 * 86_400_000),
    lastReviewedAt: new Date(Date.now() - 40 * 86_400_000),
    triggers: [
      { id: "t_buy", action: "ENTER", predicate: { watch: "price", is: "below", value: 340 }, rationale: "Buy the pullback."},
      { id: "t_floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 300 }, rationale: "Below the base."},
      { id: "t_target", action: "REVIEW", predicate: { watch: "price", is: "above", value: 420 }, rationale: "Target."},
      { id: "t_clock", action: "REVIEW", predicate: { watch: "repeat", value: 30 }, rationale: "Monthly."},
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
    snapshot,
    scoring,
    researchUpdatedAt: new Date(Date.now() - 5 * 86_400_000),
    lastReviewedAt: new Date(Date.now() - 2 * 86_400_000),
    triggers: [
      { id: "c_floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 262 }, rationale: "Under the gain."},
      { id: "c_clock", action: "REVIEW", predicate: { watch: "repeat", value: 30 }, rationale: "Monthly."},
    ],
  });

async function read(args: Record<string, unknown>) {
  const { result } = await replayTool("get-theses", "getTheses", {
    // CEG's position: what we paid is the position's, never the thesis's.
    seed: { thesis: [syk(), ceg()], thesisUpdate: updates(), position: [positionRow({ id: "p_ceg", symbol: "CEG", avgCost: 270 })] },
    ctx: { runMode: "MORNING_PLAN" },
    args,
    quotes: { SYK: 273, CEG: 280 },
  });
  const { getTheses } = await import("@/lib/agent/tools/get-theses");
  type ForModel = { toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data: Record<string, unknown> } } };
  const as = (runMode: string) => (getTheses({ runId: "r", userId: "u", analystId: "a", runMode } as never) as unknown as ForModel).toModelOutput({ toolCallId: "c1", input: args, output: result }).value.data;
  const model = as("MORNING_PLAN");
  const screen = result.data as Record<string, unknown>;
  // The screen's row has a ticker; the model's row opens with its stock line.
  const row = (d: Record<string, unknown>) => ((d.theses as Array<Record<string, unknown>>) ?? []).find((t) => t.ticker === "SYK" || String(t.stock ?? "").startsWith("SYK ·")) as Record<string, unknown>;
  return { model, screen, modelRow: row(model), screenRow: row(screen), as };
}

describe("get_theses — the read", () => {
  it("the opening read with include_history: the row, no history, no long research, and a dated research line", async () => {
    const { model, modelRow } = await read({ include_history: true });
    expect(modelRow).toBeDefined();
    expect(modelRow.history).toBeUndefined();
    expect(modelRow.stock).toBe("SYK · watch · LONG · BASE_BREAKOUT · outlook bullish · conviction MEDIUM");
    // The bull and bear cases and the research summary come only when the read asks for the research.
    for (const k of ["snapshot", "bull_case", "bear_case"]) expect([k, k in modelRow]).toEqual([k, false]);
    expect(String(modelRow.research)).toMatch(/^Written \d{4}-\d{2}-\d{2} at \$348\.00, 51 days ago\.$/);
    expect(modelRow).not.toHaveProperty("triggerState");
    expect(String(model.historyNote)).toMatch(/named stocks/);
  });

  it("asking for history on the whole book no longer sends every stock full", async () => {
    const { model } = await read({ include_history: true });
    // The quiet split stays on: the held stock with nothing due is one line, not a row.
    const full = (model.theses as Array<{ stock: string }>).map((t) => t.stock.split(" · ")[0]);
    // Every stock is a line of the stock table, held first; the quiet one is nowhere else.
    const lines = (model.stocks as string[]).slice(2);
    expect(full).toEqual(["SYK"]);
    expect(lines.map((l) => l.split(" | ")[0]).sort()).toEqual(["CEG", "SYK"]);
    expect(lines.find((l) => l.startsWith("CEG"))).toMatch(/^CEG \| held \| — \| \$280\.00 \| /);
    expect(model.quiet_theses).toBeUndefined();
  });

  it("a read of a named stock that asks for the research and the history gets both", async () => {
    const { modelRow } = await read({ tickers: ["SYK"], include_history: true, include_research: true });
    expect(Array.isArray(modelRow.history) && (modelRow.history as unknown[]).length).toBeGreaterThan(0);
    expect(modelRow.snapshot).toBe(snapshot.text);
    expect(modelRow.bull_case).toEqual(["Hyperscaler power deals reprice the fleet."]);
    expect(modelRow.bear_case).toEqual(["Capacity auction prices fall back."]);
    expect(String(modelRow.research)).toMatch(/at \$348\.00/);
  });

  it("the morning run's own list carries what each situation asks: its skill, the part for a stock we watch", async () => {
    const { model, screenRow } = await read({});
    const sent = Object.keys(model.guidance as Record<string, string>);
    expect(sent).toContain("REVIEW_DUE");
    for (const code of sent) expect(screenRow.situations).toContain(code);
    expect(sent).toHaveLength((screenRow.situations as string[]).length);
    expect((model.guidance as Record<string, string>).REVIEW_DUE).toBe(situationText("REVIEW_DUE", false));
  });

  it("every other reader gets the situation's name on the row and no text: a read by ticker, the chat, a trigger run's own read", async () => {
    const byTicker = await read({ tickers: ["SYK"] });
    expect(byTicker.model.guidance).toBeUndefined();
    expect(byTicker.modelRow.situations).toEqual(["BUY_ARRIVES: Possible buy · below $340", "REVIEW_DUE: Review · every 30 days, 10 days overdue"]);
    const list = await read({});
    for (const runMode of ["PRINCIPAL_CHAT", "INTRADAY_TACTICAL", "DISCOVERY"]) {
      const data = list.as(runMode);
      expect([runMode, data.guidance]).toEqual([runMode, undefined]);
      expect(JSON.stringify(data.theses)).toContain("REVIEW_DUE: Review · every 30 days, 10 days overdue");
    }
  });

  it("the screen still gets the whole row", async () => {
    const { screenRow } = await read({ include_history: true });
    expect(screenRow.snapshot).toEqual(snapshot);
    expect(screenRow.bearCase).toEqual(bear);
  });
});
