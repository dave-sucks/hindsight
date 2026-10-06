/**
 * get-theses.two-flags.replay.test.ts — decision 4 of
 * docs/plans/AGENT_ARCHITECTURE.md (approved 2026-10-02): "no buy level" and
 * "score under the minimum" stop listing a stock on the morning work list by
 * themselves. In September they caused 20 of the 236 morning reviews; 17 of
 * those were a stock with no buy price warned that "the buy will be refused".
 *
 * A stock with no buy price comes onto the list on its review clock or when a
 * trigger fires (the 2026-09-08 ruling). The flags still show whenever the
 * stock is opened. "Nothing can wake it" keeps listing: nothing else would.
 *
 * Through the real get_theses on the morning run's opening read.
 */
import { replayTool, thesisRow } from "@/lib/replay";

const lowScore = {
  composite: 5,
  trendStrength: { score: 1, note: "" },
  relativeStrength: { score: 1, note: "" },
  entryQuality: { score: 1, note: "" },
  catalystFreshness: { score: 2, note: "" },
};
const clock = { id: "clock", action: "REVIEW", predicate: { watch: "repeat", value: 30 }, rationale: "Monthly.", cooldownDays: 30 };

/** A watched LONG, reviewed yesterday, its clock not due: only its flags could list it. */
const watched = (over: Record<string, unknown>) =>
  thesisRow({
    status: "WATCHING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    setupId: "COMPOUNDER_ACCUMULATION",
    entryPrice: null,
    targetPrice: null,
    stopLoss: null,
    scoring: lowScore,
    researchUpdatedAt: new Date(Date.now() - 3 * 86_400_000),
    lastReviewedAt: new Date(Date.now() - 1 * 86_400_000),
    triggers: [clock],
    ...over,
  });

async function openingRead(rows: Record<string, unknown>[], quotes: Record<string, number>) {
  const { result } = await replayTool("get-theses", "getTheses", {
    seed: { thesis: rows },
    ctx: { runMode: "MORNING_PLAN", minConfidence: 70 },
    args: {},
    quotes,
  });
  const data = result.data as { theses: Array<{ ticker: string; resolved?: { planSanity?: Array<{ kind: string }> | null } }>; quiet_theses: Array<{ ticker: string }> };
  return {
    full: data.theses.map((t) => t.ticker),
    quiet: (data.quiet_theses ?? []).map((t) => t.ticker),
    flags: (ticker: string) => (data.theses.find((t) => t.ticker === ticker)?.resolved?.planSanity ?? []).map((f) => f.kind),
  };
}

async function namedRead(row: Record<string, unknown>, ticker: string, price: number) {
  const { result } = await replayTool("get-theses", "getTheses", {
    seed: { thesis: [row] },
    ctx: { runMode: "MORNING_PLAN", minConfidence: 70 },
    args: { tickers: [ticker] },
    quotes: { [ticker]: price },
  });
  const t = (result.data as { theses: Array<{ resolved?: { planSanity?: Array<{ kind: string }> | null } }> }).theses[0];
  return (t?.resolved?.planSanity ?? []).map((f) => f.kind);
}

describe("decision 4 — two flags stop listing a stock by themselves", () => {
  it("no buy level, a review clock not due: a roster line, not a full row", async () => {
    const r = await openingRead([watched({ id: "t_vst", ticker: "VST" })], { VST: 150 });
    expect(r.full).not.toContain("VST");
    expect(r.quiet).toContain("VST");
  });

  it("the flag still shows when the stock is opened", async () => {
    const flags = await namedRead(watched({ id: "t_vst", ticker: "VST" }), "VST", 150);
    expect(flags).toContain("NO_BUY_LEVEL");
  });

  it("the score flag needs a buy to refuse: none on a stock with no buy level", async () => {
    const flags = await namedRead(watched({ id: "t_vst", ticker: "VST" }), "VST", 150);
    expect(flags).not.toContain("COMPOSITE_BELOW_MINIMUM");
  });

  it("with a buy level, the score flag shows when opened but does not list the stock by itself", async () => {
    const priced = watched({
      id: "t_etn",
      ticker: "ETN",
      // Written three days ago, so its buy level isn't stale (that flag lists a stock, as it should).
      createdAt: new Date(Date.now() - 3 * 86_400_000),
      entryPrice: 330,
      targetPrice: 400,
      stopLoss: 300,
      triggers: [
        clock,
        { id: "buy", action: "ENTER", predicate: { watch: "price", is: "below", value: 330 }, rationale: "Buy the pullback.", cooldownDays: 1 },
        { id: "floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 300 }, rationale: "Below the base.", cooldownDays: 1 },
        { id: "target", action: "REVIEW", predicate: { watch: "price", is: "above", value: 400 }, rationale: "Target.", cooldownDays: 1 },
      ],
    });
    expect(await namedRead(priced, "ETN", 345)).toContain("COMPOSITE_BELOW_MINIMUM");
    const r = await openingRead([priced], { ETN: 345 });
    expect(r.full).not.toContain("ETN");
  });

  it("nothing can wake it (no buy price, no trigger, no review): still listed", async () => {
    const r = await openingRead([watched({ id: "t_luxe", ticker: "LUXE", triggers: [] })], { LUXE: 12 });
    expect(r.full).toContain("LUXE");
    expect(r.flags("LUXE")).toContain("NOTHING_CAN_WAKE");
  });
});
