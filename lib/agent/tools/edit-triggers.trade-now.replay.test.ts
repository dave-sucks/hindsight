/**
 * A planner (After the buy, the Writer's tailoring, the Holding refresh) may
 * not write a buy or add that is already true at today's price: it fires at
 * the next check, a trade now, not a plan (TRADE_NOW). The rest of the call
 * lands. A trigger run keeps it: a buy at today's price is the owner's buy-now.
 *
 * PANW, 2026-11-19, run cmwnqr7rx000308l2q71n8ac2: After the buy, 2 minutes
 * after 15 shares filled at $357.46, wrote "Add if below $406.88 · only on the
 * close" for a break above the old high. PANW was near $360, so it would have
 * fired at that day's 16:20 close pass. The `add` below is that call's, word
 * for word; its three removes named triggers this seed doesn't carry. The
 * chart is PANW's through the Nov 18 session as get_stock_data read it that
 * morning (swing high $406.88 on Oct 28); the price, $359.42, is the one the
 * PANW trigger run fired at five minutes later.
 */
import type { z } from "zod";
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, triggerSentences, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

const PANW_CHART = {
  price: 359.42,
  base: null,
  gaps: [
    { date: "2026-11-12", direction: "DOWN", pct: -3.22, low: 314.79, mid: 320.57, high: 326.34 },
    { date: "2026-11-11", direction: "UP", pct: 3.51, low: 329.88, mid: 335.84, high: 341.8 },
  ],
  range: { high20: 406.88, low20: 301.28, high52w: 432.33, low52w: 139.57, pctBelow52wHigh: 16.2, pctAbove52wLow: 159.6 },
  swings: { lastHigh: { price: 406.88, date: "2026-10-28" }, lastLow: { price: 312.12, date: "2026-11-05" } },
};
const THESIS = "panw_holding";
const AFTER_BUY = { runMode: "AFTER_BUY", analystId: REPLAY_ANALYST_ID, runStock: { ticker: "PANW", thesisId: THESIS, triggerId: "" } };
const TRIGGER_RUN = { runMode: "INTRADAY_TACTICAL", analystId: REPLAY_ANALYST_ID, runStock: { ticker: "PANW", thesisId: THESIS, triggerId: "" } };

/** What the stock carried when After the buy ran: the floor the fill wrote, and the chat's sell price kept as a review. */
const HELD: Trigger[] = [
  { id: "floor", action: "EXIT", source: "PRINCIPAL", fireMode: "DO_IT", predicate: { watch: "price", is: "below", value: 336.01 }, rationale: "Sell if below $336.01. You set this." },
  { id: "gap_review", action: "REVIEW", source: "AGENT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 339.92 }, rationale: "The Nov 18 gap-day low." },
] as unknown as Trigger[];

const ADD_BELOW = {
  predicate: { watch: "price", is: "below", settings: { close: true }, value: "{priorHigh}" },
  action: "ADD",
  rationale: "If Palo Alto gets back through its old high after this earnings report, that would say institutions are still building positions and the move is spreading beyond the first gap day. I would look to add only on that kind of follow-through.",
  fireMode: "ASK_NOW",
};
const THE_CALL = [
  { predicate: { watch: "move", is: "above", value: 10, variable: "entry" }, action: "REVIEW", rationale: "Palo Alto jumped after earnings and the numbers were clean, so if we get another 10% from our buy too fast I want to look for a reversal day and decide whether to take some off rather than let a quick win fade.", fireMode: "NEXT_MORNING" },
  { predicate: { watch: "move", is: "below", value: 12, variable: "entry" }, action: "REVIEW", rationale: "This was a buy for the weeks after a strong earnings report, not for a failed gap. If the stock falls 12% from our entry, I want a fresh look at whether the earnings win was real enough to keep holding.", fireMode: "ASK_NOW" },
  { predicate: { watch: "repeat", value: 7 }, action: "REVIEW", rationale: "Palo Alto just reset higher on earnings, guidance, and strong contract growth, and I want a weekly check on whether buyers are still supporting the move and whether the Applied Compute deal is changing the story.", fireMode: "NEXT_MORNING" },
  ADD_BELOW,
];

async function edit(ctx: Record<string, unknown>, args: Record<string, unknown>, triggers: Trigger[] = HELD) {
  let schema!: z.ZodTypeAny;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { editTriggers } = await import("./edit-triggers");
    schema = (editTriggers({ runId: "r", userId: "u", accountId: "a", ...ctx } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return replayTool("edit-triggers", "editTriggers", {
    seed: {
      thesis: [thesisRow({ id: THESIS, ticker: "PANW", status: "HOLDING", direction: "LONG", setupId: null, analystId: REPLAY_ANALYST_ID, triggers } as Partial<Row>)],
      position: [positionRow({ symbol: "PANW", avgCost: 357.4625, quantity: 15, initialQty: 15, environment: "LIVE" })],
      agentConfig: [agentConfigRow()],
      account: [accountRow()],
    },
    args: schema.parse(args) as Record<string, unknown>,
    ctx,
    quotes: { PANW: 359.42 },
    mocks: { "@/lib/proposals/fill-chart": () => ({ loadFillChart: async () => PANW_CHART }) },
  });
}
const stored = (r: Awaited<ReturnType<typeof edit>>) => r.db.store.thesis.find((t) => t.id === THESIS)!;
const ops = (r: Awaited<ReturnType<typeof edit>>) => (r.result.data?.trigger_ops ?? []) as Array<{ op: string; ok: boolean; text: string; reason?: string }>;
const TRADE_NOW = "This would fire at the next check: that's a trade now, not a plan. Write the condition you mean (an add on a break above uses 'above').";

describe("a planner's buy or add already true at today's price is refused: a trade now, not a plan", () => {
  it("PANW's After the buy call: the add below $406.88 is refused, the rest of the call lands", async () => {
    const r = await edit(AFTER_BUY, { add: THE_CALL });
    expect(r.crashed).toBe(false);
    expect(ops(r).find((o) => o.text === "Added: Add if below $406.88 · only on the close")).toMatchObject({ ok: false, reason: TRADE_NOW });
    const after = triggerSentences(stored(r));
    expect(after).not.toContain("Add if below $406.88 · only on the close");
    expect(after).toContain("Review if below 12% from our entry");
    // The floor the fill wrote is as it was.
    expect(after).toContain("Sell if below $336.01");
  });

  it("the condition it meant, a close above the old high, lands", async () => {
    const r = await edit(AFTER_BUY, { add: [{ ...ADD_BELOW, predicate: { ...ADD_BELOW.predicate, is: "above" } }] });
    expect(r.refused).toBe(false);
    expect(triggerSentences(stored(r))).toContain("Add if above $406.88 · only on the close");
  });

  it("an edit that makes a true condition an add is refused the same way", async () => {
    const held = [...HELD, { id: "old_high", action: "REVIEW", source: "AGENT", fireMode: "ASK_NOW", predicate: { watch: "price", is: "below", value: 406.88, settings: { close: true } }, rationale: "Under the old high." } as unknown as Trigger];
    const r = await edit(AFTER_BUY, { edit: [{ id: "old_high", action: "ADD", rationale: "Add under the old high." }] }, held);
    expect(ops(r)[0]).toMatchObject({ op: "edit", id: "old_high", ok: false, reason: TRADE_NOW });
    expect((stored(r).triggers as Trigger[]).find((t) => t.id === "old_high")?.action).toBe("REVIEW");
  });

  it("a trigger run keeps it: a buy or add at today's price is the owner's buy-now", async () => {
    const r = await edit(TRIGGER_RUN, { add: [ADD_BELOW] });
    expect(ops(r).some((o) => o.reason === TRADE_NOW)).toBe(false);
    expect(triggerSentences(stored(r))).toContain("Add if below $406.88 · only on the close");
  });
});
