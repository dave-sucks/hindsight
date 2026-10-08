/**
 * get_theses carries each live stock's situations (lib/agent/situations)
 * beside the old fields: the lead first, holding the row's own needsAction
 * unchanged, and every plan check on PLAN_PROBLEM. The model is not sent the
 * list yet. Through the real tool on the morning run's opening read.
 */
import { replayTool, thesisRow, thesisUpdateRow } from "@/lib/replay";

const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

/** A holding whose floor fired an hour ago, no run since: a sale is the lead. */
const mu = () =>
  thesisRow({
    id: "t_mu",
    ticker: "MU",
    status: "HOLDING",
    direction: "LONG",
    setupId: "NONE",
    researchUpdatedAt: ago(3),
    lastReviewedAt: ago(1),
    triggers: [{ id: "mu_floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 100 }, rationale: "The floor.", cooldownDays: 0 }],
  });

/** A watch with a buy 40% above the price and a review clock long due: a review leads, the plan check rides second. */
const pbh = () =>
  thesisRow({
    id: "t_pbh",
    ticker: "PBH",
    status: "WATCHING",
    direction: "LONG",
    setupId: "NONE",
    entryPrice: 84,
    targetPrice: 120,
    stopLoss: 70,
    researchUpdatedAt: ago(3),
    lastReviewedAt: ago(60),
    triggers: [
      { id: "pbh_buy", action: "ENTER", predicate: { watch: "price", is: "above", value: 84 }, rationale: "Breakout.", cooldownDays: 1 },
      { id: "pbh_clock", action: "REVIEW", predicate: { watch: "repeat", value: 30 }, rationale: "Monthly.", cooldownDays: 30 },
    ],
  });

/** A holding with nothing going on: a roster line with no situations. */
const quiet = () =>
  thesisRow({ id: "t_q", ticker: "QQQ", status: "HOLDING", direction: "LONG", setupId: "NONE", researchUpdatedAt: ago(3), lastReviewedAt: ago(1), triggers: [] });

async function read(args: Record<string, unknown> = {}) {
  const { result } = await replayTool("get-theses", "getTheses", {
    seed: {
      thesis: [mu(), pbh(), quiet()],
      thesisUpdate: [thesisUpdateRow({ id: "u_fire", thesisId: "t_mu", type: "TRIGGER_FIRED", triggerId: "mu_floor", runId: null, timestamp: new Date(Date.now() - 3_600_000) })],
    },
    ctx: { runMode: "MORNING_PLAN" },
    args,
    quotes: { MU: 95, PBH: 60, QQQ: 400 },
  });
  const { getTheses } = await import("@/lib/agent/tools/get-theses");
  const tool = getTheses({ runId: "r", userId: "u", analystId: "a" } as never) as unknown as {
    toModelOutput: (o: { toolCallId: string; input: unknown; output: unknown }) => { value: { data: Record<string, unknown> } };
  };
  const model = tool.toModelOutput({ toolCallId: "c1", input: args, output: result }).value.data;
  return { screen: result.data as Record<string, unknown>, model };
}

type Row = { ticker: string; needsAction: unknown; situations: Array<{ code: string; data: { flag?: unknown; codes?: Array<{ kind: string }> } }>; resolved?: { planSanity?: Array<{ kind: string }> | null } };

describe("get_theses carries the situations beside the old fields", () => {
  it("each full row's first situation holds its needsAction, unchanged", async () => {
    const rows = (await read()).screen.theses as Row[];
    const byTicker = Object.fromEntries(rows.map((r) => [r.ticker, r]));
    expect(byTicker.MU.situations.map((s) => s.code)).toEqual(["PROTECTIVE_SALE"]);
    expect(byTicker.MU.situations[0].data.flag).toEqual(byTicker.MU.needsAction);
    expect(byTicker.PBH.situations.map((s) => s.code)).toEqual(["REVIEW_DUE", "PLAN_PROBLEM"]);
    expect(byTicker.PBH.situations[0].data.flag).toEqual(byTicker.PBH.needsAction);
  });

  it("every plan check the row carries is on PLAN_PROBLEM", async () => {
    const rows = (await read()).screen.theses as Row[];
    const pbhRow = rows.find((r) => r.ticker === "PBH")!;
    const kinds = (pbhRow.resolved?.planSanity ?? []).map((f) => f.kind);
    expect(kinds).toContain("ENTRY_FAR_FROM_PRICE");
    const plan = pbhRow.situations.find((s) => s.code === "PLAN_PROBLEM")!;
    expect(plan.data.codes!.map((c) => c.kind)).toEqual(kinds);
  });

  it("a quiet stock's roster line carries an empty list", async () => {
    const quietRows = (await read()).screen.quiet_theses as Array<{ ticker: string; situations: unknown[] }>;
    expect(quietRows.find((r) => r.ticker === "QQQ")?.situations).toEqual([]);
  });

  it("the model is not sent the list, on full rows or roster lines", async () => {
    const { model } = await read();
    for (const r of model.theses as Array<Record<string, unknown>>) expect(r).not.toHaveProperty("situations");
    for (const r of model.quiet_theses as Array<Record<string, unknown>>) expect(r).not.toHaveProperty("situations");
  });
});
