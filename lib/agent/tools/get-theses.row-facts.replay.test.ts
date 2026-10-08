/**
 * get-theses.row-facts.replay.test.ts — the facts the row lacked (step 8,
 * the first pull request): the open position, the orders awaiting approval,
 * the price with the day's change, the chart numbers the trigger check reads,
 * and the rules the stock inherits. They land on the saved full row, off the
 * one load (work-inputs.ts), and the one builder (rowForModel) writes the
 * model's lines from them.
 *
 * Through the real get_theses execute and its real model-output hook. The
 * tool is imported after the replay has doubled the database, as the other
 * read tests do: imported before, the real client is reached.
 */
import { replayTool, thesisRow, positionRow, thesisUpdateRow, agentConfigRow, REPLAY_ANALYST_ID, REPLAY_USER_ID } from "@/lib/replay";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const rung = (id: string, action: string, predicate: unknown, cooldownDays = 1) => ({ id, action, predicate, rationale: "r", cooldownDays, source: "AGENT" });

/** Sixty closes climbing to $89.50, so RSI and the 5- and 20-day moves have something to read. */
const closes = Array.from({ length: 60 }, (_, i) => 60 + i * 0.5);
const snapshot = {
  asOf: day(ago(1)),
  sma: { 20: 85.25, 50: 78.1, 150: null, 200: 70.4 },
  high20: 90, low20: 80, high52w: 95, low52w: 50,
  volumeAvg20: 1_200_000,
  closes,
  rsVsSpy: { "1M": 3.2, "3M": -1.1, "6M": null },
  gaps: [],
  atr14: 2.15,
};

/** AAA: held, its floor fired this morning and nothing answered it, so it is a full row; BBB: watched and quiet. */
const seed = () => ({
  agentConfig: [agentConfigRow({ triggers: [rung("analyst-clock", "REVIEW", { watch: "repeat", value: 7 }, 7)] })],
  thesis: [
    thesisRow({ id: "t_aaa", ticker: "AAA", status: "HOLDING", lastReviewedAt: ago(1), researchUpdatedAt: ago(1), triggers: [rung("floor-aaa", "EXIT", { watch: "price", is: "below", value: 95 })] }),
    thesisRow({ id: "t_bbb", ticker: "BBB", status: "WATCHING", createdAt: ago(5), lastReviewedAt: ago(1), researchUpdatedAt: ago(1), entryPrice: 36, targetPrice: 48, stopLoss: 32, triggers: [rung("buy-bbb", "ENTER", { watch: "price", is: "above", value: 36 })] }),
  ],
  position: [positionRow({ id: "pos_aaa", symbol: "AAA", avgCost: 100, quantity: 10, openedAt: ago(20), peakPrice: 112 })],
  order: [
    { id: "o_sell", positionId: "pos_aaa", userId: REPLAY_USER_ID, environment: "PAPER", symbol: "AAA", side: "SELL", quantity: 10, status: "AWAITING_APPROVAL", intent: "CLOSE", thesisId: "t_aaa", createdAt: ago(0.1), expiresAt: new Date(Date.now() + 0.9 * DAY) },
    { id: "o_old", positionId: "pos_aaa", userId: REPLAY_USER_ID, environment: "PAPER", symbol: "AAA", side: "SELL", quantity: 10, status: "EXPIRED", intent: "CLOSE", thesisId: "t_aaa", createdAt: ago(3), expiresAt: ago(2) },
  ],
  tickerIndicators: [{ id: "ind_aaa", ticker: "AAA", asOf: snapshot.asOf, computedAt: ago(0.5), volumeFeed: "sip", snapshot }],
  thesisUpdate: [thesisUpdateRow({ id: "fire", thesisId: "t_aaa", type: "TRIGGER_FIRED", triggerId: "floor-aaa", runId: null, timestamp: ago(0.05) })],
});

type Tool = typeof import("@/lib/agent/tools/get-theses");

async function read() {
  const args = { limit: 50 };
  const { result, crashed } = await replayTool("get-theses", "getTheses", { seed: seed(), args, quotes: { AAA: 91, BBB: 33 } });
  if (crashed) throw new Error(`get_theses crashed: ${JSON.stringify(result).slice(0, 2000)}`);
  const mod: Tool = await import("@/lib/agent/tools/get-theses");
  const tool = mod.getTheses({ runId: "r", userId: REPLAY_USER_ID, analystId: REPLAY_ANALYST_ID } as never) as unknown as {
    toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data: Record<string, unknown> } };
  };
  const model = tool.toModelOutput({ toolCallId: "c1", input: args, output: result }).value.data;
  const screen = result.data as Record<string, unknown>;
  // The screen's row has a ticker; the model's row opens with its stock line.
  const row = (d: Record<string, unknown>, ticker: string) => ((d.theses as Array<Record<string, unknown>>) ?? []).find((t) => t.ticker === ticker || String(t.stock ?? "").startsWith(`${ticker} ·`)) as Record<string, unknown>;
  return { mod, model, screen, screenRow: row(screen, "AAA"), modelRow: row(model, "AAA") };
}

describe("get_theses — the facts on the saved row", () => {
  it("the saved full row carries the position, the proposal, the price, the chart and the inherited rules", async () => {
    const { screenRow } = await read();
    expect(screenRow.position).toEqual({ quantity: 10, avgCost: 100, openedAt: expect.any(Date), peakPrice: 112 });
    // Only the order still awaiting approval; the expired one is not a proposal.
    expect(screenRow.proposals).toEqual([
      { id: "o_sell", side: "SELL", intent: "CLOSE", quantity: 10, createdAt: expect.any(Date), expiresAt: expect.any(Date) },
    ]);
    expect(screenRow.price).toEqual({ current: 91, dayChangePct: 0, asOf: expect.any(String) });
    const chart = screenRow.chart as Record<string, unknown>;
    expect(chart.asOf).toBe(snapshot.asOf);
    expect(chart).toMatchObject({ sma20: 85.25, sma50: 78.1, sma200: 70.4, high52w: 95, low20: 80, volumeAvg20: 1_200_000, atr14: 2.15, rsVsSpy1M: 3.2, rsVsSpy3M: -1.1 });
    // The live price against the closes: up from $87.50 five sessions back and $80 twenty back.
    expect(chart.move5dPct).toBeCloseTo(4.0, 1);
    expect(chart.move20dPct).toBeCloseTo(13.8, 1);
    expect(typeof chart.rsi14).toBe("number");
    // The analyst's clock is inherited; the stock's own floor is in `triggers`, not here.
    const inherited = screenRow.inheritedTriggers as Array<{ id: string; says: string; level: string }>;
    expect(inherited.map((x) => [x.id, x.level])).toEqual([["analyst-clock", "ANALYST"]]);
    expect(inherited[0].says).toMatch(/review/i);
    expect((screenRow.triggers as Array<{ id: string }>).map((x) => x.id)).toEqual(["floor-aaa"]);
  });

  it("the model's row is the short row written from them, never the raw facts", async () => {
    const { mod, modelRow } = await read();
    // The raw facts never reach the model; three of their names are now lines of words.
    for (const k of ["proposals", "inheritedTriggers"]) expect(modelRow).not.toHaveProperty(k);
    for (const k of ["position", "price", "chart"]) expect(typeof modelRow[k]).toBe("string");
    expect(mod.ROW_FACTS).toContain("inheritedTriggers");
    expect(modelRow.position).toMatch(/^10 sh at \$100\.00 → \$91\.00 \(-9\.0%\), \$910; opened \d\d-\d\d; high since we bought \$112\.00$/);
    expect(modelRow.proposal_waiting).toMatch(/^sell 10 sh, placed \d\d-\d\d \d\d:\d\d ET, expires \d\d-\d\d \d\d:\d\d ET$/);
    expect(modelRow.price).toMatch(/^\$91\.00, \+0\.0% today \(\d\d-\d\d \d\d:\d\d ET\)$/);
    expect(modelRow.chart).toMatch(/^as of the \d{4}-\d\d-\d\d close: 20d \$85\.25 · 50d \$78\.10 · 200d \$70\.40 · RSI \d+ \(14-day, from the closes and the live price\) · 20d range \$80\.00–\$90\.00 · 52w high \$95\.00 · ATR \$2\.15 · vs the S&P 1M \+3\.2% \/ 3M -1\.1% · 20d avg volume 1\.2M · 5d \+4\.0% · 20d \+13\.8%$/);
    const triggers = modelRow.triggers as string[];
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toMatch(/^Sell if below \$95.* \[id floor-aaa\]$/);
    expect(triggers[1]).toMatch(/^Review every 7 days · inherited \[id analyst-clock\]$/);
  });

  it("a quiet row goes through the builder as one line", async () => {
    const { model, screen } = await read();
    expect((screen.quiet_theses as Array<{ ticker: string }>).map((q) => q.ticker)).toEqual(["BBB"]);
    expect(model.quiet_theses).toEqual(["BBB · watch · LONG · BASE_BREAKOUT · $33.00 · buy $36.00 · target $48.00 · floor $32.00 · score 7 · id t_bbb"]);
  });
});
