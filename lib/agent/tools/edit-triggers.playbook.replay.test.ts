/**
 * edit_triggers takes a playbook trigger by its reference (W1, H2) and a
 * chart key in an agent's own trigger ({gapDayHigh}); code writes today's
 * number for both from the chart (T1, 2026-11-19).
 *
 * SNDK on EPISODIC_PIVOT, a stock we watch, on its chart of 2026-11-03 as the
 * PEAD Specialist's Writer was shown it (scripts/hero-cases/sndk-writer-watch):
 * price $1,126.52; the newest gap that day, up 3.0%, low $1,100.53, middle
 * $1,126.86, high $1,153.19; no base. The call goes through the tool's own
 * input schema, as the SDK parses a model's call, then the real save.
 */
import type { z } from "zod";
import { replayTool, thesisRow, positionRow, agentConfigRow, accountRow, triggerSentences, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";
import type { Trigger } from "@/lib/agent/triggers/types";

const SNDK_CHART = {
  price: 1126.52,
  base: null,
  gaps: [{ date: "2026-11-03", direction: "UP", pct: 3.0, low: 1100.53, mid: 1126.86, high: 1153.19 }],
  range: { high20: 1733.28, low20: 1067.4, high52w: 2354.39, low52w: 183, pctBelow52wHigh: 52.2, pctAbove52wLow: 515.6 },
  swings: { lastHigh: { price: 1909.48, date: "2026-09-22" }, lastLow: { price: 1659.02, date: "2026-09-28" } },
};
const THESIS = "sndk_watch";

async function edit(args: Record<string, unknown>, row: Partial<Row> = {}) {
  let schema!: z.ZodTypeAny;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { editTriggers } = await import("./edit-triggers");
    schema = (editTriggers({ runId: "r", userId: "u", accountId: "a", runMode: "RESEARCH_RUN" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
  });
  return replayTool("edit-triggers", "editTriggers", {
    seed: {
      thesis: [thesisRow({ id: THESIS, ticker: "SNDK", status: "WATCHING", direction: "LONG", setupId: "EPISODIC_PIVOT", analystId: REPLAY_ANALYST_ID, triggers: [], ...row })],
      agentConfig: [agentConfigRow()],
      account: [accountRow()],
    },
    args: schema.parse({ thesis_id: THESIS, ...args }) as Record<string, unknown>,
    ctx: { runMode: "RESEARCH_RUN", analystId: REPLAY_ANALYST_ID },
    quotes: { SNDK: 1126.52 },
    mocks: { "@/lib/proposals/fill-chart": () => ({ loadFillChart: async () => SNDK_CHART }) },
  });
}
const stored = (r: Awaited<ReturnType<typeof edit>>) => r.db.store.thesis.find((t) => t.id === THESIS)!;
const ops = (r: Awaited<ReturnType<typeof edit>>) => ((r.result.data?.trigger_ops ?? []) as Array<{ ok: boolean; text: string; reason?: string }>);

describe("a playbook trigger by its reference", () => {
  it("W2, the episodic pivot's buy, is priced at the gap day's high and marked the playbook's", async () => {
    const r = await edit({ add: [{ playbook_trigger: "W2" }] });
    expect(r.refused).toBe(false);
    expect(triggerSentences(stored(r))).toEqual(["Buy if above $1153.19"]);
    expect((stored(r).triggers as Trigger[])[0]).toMatchObject({ action: "ENTER", playbook: "WATCH", rationale: "The gap day's high; on a day-2 hold above the gap day's middle, today's price." });
    // One Activity line, as every edit.
    const lines = r.db.store.thesisUpdate.flatMap((u) => ((u.fieldChanges as { triggerOps?: { to: Array<{ text: string }> } })?.triggerOps?.to ?? []).map((o) => o.text));
    expect(lines).toEqual(["Added: Buy if above $1153.19"]);
  });

  it("a reference the playbook doesn't have is refused with its references", async () => {
    const r = await edit({ add: [{ playbook_trigger: "W9" }] });
    expect(ops(r)[0].reason).toMatch(/has no W9: its triggers are W1, W2, W3, W4, W5, H1, H2, H3/);
    expect(stored(r).triggers).toEqual([]);
  });

  it("a holding's trigger on a stock we only watch is refused, saying a watch takes the W triggers", async () => {
    const r = await edit({ add: [{ playbook_trigger: "H1" }] });
    expect(ops(r)[0].reason).toMatch(/H1 is a holding's trigger, and we only watch \$SNDK: a watch takes the W triggers\./);
  });

  it("on a stock with no playbook it is refused, with what to do instead", async () => {
    const r = await edit({ add: [{ playbook_trigger: "W1" }] }, { setupId: null });
    expect(ops(r)[0].reason).toMatch(/has no playbook\. Name one with setup_id, or write the trigger yourself\./);
  });

  it("the same call may name the playbook it reads from", async () => {
    const r = await edit({ setup_id: "PEAD", add: [{ playbook_trigger: "W1" }] }, { setupId: null });
    expect(triggerSentences(stored(r))).toEqual(["Buy if above $1126.86"]);
  });
});

describe("a chart key in an agent's own trigger", () => {
  const review = (value: string) => ({ action: "REVIEW", predicate: { watch: "price", is: "below", value, settings: { close: true } }, rationale: "Under the gap day's low the gap has failed; look again." });

  it("{gapDayLow} is written as today's number, $1,100.53", async () => {
    const r = await edit({ add: [review("{gapDayLow}")] });
    expect(r.refused).toBe(false);
    expect(triggerSentences(stored(r))).toEqual(["Review if below $1100.53 · only on the close"]);
    expect((stored(r).triggers as Trigger[])[0].playbook).toBeUndefined();
  });

  it("a key the chart can't give today is refused with the reason", async () => {
    const r = await edit({ add: [review("{pivot}")] });
    expect(ops(r)[0].reason).toBe("Not written: {pivot}: the chart has no base. Write the number from the chart instead, or leave it.");
    expect(stored(r).triggers).toEqual([]);
  });

  it("an unknown key is refused, naming the valid ones", async () => {
    const r = await edit({ add: [review("{gapHigh}")] });
    expect(ops(r)[0].reason).toMatch(/^\{gapHigh\} isn't a key\. The keys are \{pivot\}, \{pivotChase\}, .*\{riskPct\}; or write the number\.$/);
  });

  it("a live line stays a line: below the 50-day average is read at every check", async () => {
    const r = await edit({ add: [{ action: "REVIEW", predicate: { watch: "price", is: "below", value: "sma50" }, rationale: "Below the 50-day the trend has turned." }] });
    expect(triggerSentences(stored(r))).toEqual(["Review if below the 50-day average"]);
  });

  it("a refused add leaves the rest of the call to land", async () => {
    const r = await edit({ add: [review("{pivot}"), { playbook_trigger: "W2" }] });
    expect(ops(r).map((o) => o.ok)).toEqual([false, true]);
    expect(triggerSentences(stored(r))).toEqual(["Buy if above $1153.19"]);
  });
});

describe("the Writer and the Holding refresh price from the chart: a price is a key or a line, never a typed number", () => {
  const writerCtx = { runMode: "THESIS_WRITER", analystId: REPLAY_ANALYST_ID, runStock: { ticker: "SNDK", thesisId: THESIS, triggerId: "" } };
  let writerSchema!: z.ZodTypeAny;
  beforeAll(async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
      const { editTriggers } = await import("./edit-triggers");
      writerSchema = (editTriggers({ runId: "r", userId: "u", accountId: "a", ...writerCtx } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
    });
  });
  const price = (value: unknown) => ({ add: [{ action: "REVIEW", predicate: { watch: "price", is: "below", value }, rationale: "r" }] });

  it("its schema takes a key or a line for a price, and no number; a % move keeps its number", () => {
    expect(writerSchema.safeParse(price(1100.53)).success).toBe(false);
    expect(writerSchema.safeParse(price("{gapDayLow}")).success).toBe(true);
    expect(writerSchema.safeParse(price("sma50")).success).toBe(true);
    expect(writerSchema.safeParse({ add: [{ action: "REVIEW", predicate: { watch: "move", is: "near", value: 2, variable: "sma50" }, rationale: "r" }] }).success).toBe(true);
    expect(writerSchema.safeParse({ edit: [{ id: "x", level: 148 }] }).data).toEqual({ edit: [{ id: "x" }] });
  });

  const floorRow = { status: "HOLDING", triggers: [{ id: "floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 1000 }, rationale: "The floor." }] };
  async function writerEdit(edit: unknown[]) {
    return replayTool("edit-triggers", "editTriggers", {
      seed: { thesis: [thesisRow({ id: THESIS, ticker: "SNDK", direction: "LONG", setupId: "EPISODIC_PIVOT", analystId: REPLAY_ANALYST_ID, ...floorRow })], agentConfig: [agentConfigRow()], account: [accountRow()] },
      args: writerSchema.parse({ edit }) as Record<string, unknown>,
      ctx: writerCtx,
      quotes: { SNDK: 1126.52 },
      mocks: { "@/lib/proposals/fill-chart": () => ({ loadFillChart: async () => SNDK_CHART }) },
    });
  }

  it("an edit moves the floor to a key: the gap day's low, $1,100.53", async () => {
    const r = await writerEdit([{ id: "floor", price: "{gapDayLow}", rationale: "Under the gap day's low the gap failed." }]);
    expect(triggerSentences(stored(r))).toEqual(["Sell if below $1100.53"]);
  });

  it("a typed number has no field: `value` is gone from the edit, and a % sent to the floor is refused for its unit; the floor stays", async () => {
    expect(writerSchema.safeParse({ edit: [{ id: "floor", value: 1050 }] }).data).toEqual({ edit: [{ id: "floor" }] });
    const r = await writerEdit([{ id: "floor", pct: 1050, rationale: "A typed price." }]);
    expect(ops(r)[0].reason).toMatch(/^This trigger has no editable `pct`/);
    expect(triggerSentences(stored(r))).toEqual(["Sell if below $1000"]);
  });
});

describe("After the buy prices from the chart as the Writer does", () => {
  it("its edit_triggers takes a key or a line for a price, never a typed number", async () => {
    let schema!: z.ZodTypeAny;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
      const { editTriggers } = await import("./edit-triggers");
      schema = (editTriggers({ runId: "r", userId: "u", accountId: "a", runMode: "AFTER_BUY", analystId: REPLAY_ANALYST_ID, runStock: { ticker: "SNDK", thesisId: THESIS, triggerId: "" } } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
    });
    const price = (value: unknown) => ({ add: [{ action: "REVIEW", predicate: { watch: "price", is: "below", value }, rationale: "r" }] });
    expect(schema.safeParse(price(1100.53)).success).toBe(false);
    expect(schema.safeParse(price("{swingLow}")).success).toBe(true);
    expect(schema.safeParse({ add: [{ playbook_trigger: "H2" }] }).success).toBe(true);
  });
});

describe("After the buy leaves the floor that came with the buy", () => {
  const afterBuyCtx = { runMode: "AFTER_BUY", analystId: REPLAY_ANALYST_ID, runStock: { ticker: "SNDK", thesisId: THESIS, triggerId: "" } };
  const holding = { status: "HOLDING", triggers: [
    { id: "floor", action: "EXIT", predicate: { watch: "price", is: "below", value: 1000 }, rationale: "Under the gap day's low.", source: "AGENT" },
    { id: "clock", action: "REVIEW", predicate: { watch: "repeat", value: 30 }, rationale: "A monthly look.", source: "AGENT" },
  ] };
  async function afterBuyEdit(args: Record<string, unknown>) {
    return replayTool("edit-triggers", "editTriggers", {
      seed: { thesis: [thesisRow({ id: THESIS, ticker: "SNDK", direction: "LONG", setupId: "EPISODIC_PIVOT", analystId: REPLAY_ANALYST_ID, ...holding })], agentConfig: [agentConfigRow()], account: [accountRow()], position: [positionRow({ symbol: "SNDK", analystId: REPLAY_ANALYST_ID, status: "OPEN", avgCost: 1126.52, quantity: 5 })] },
      args,
      ctx: afterBuyCtx,
      quotes: { SNDK: 1126.52 },
      mocks: { "@/lib/proposals/fill-chart": () => ({ loadFillChart: async () => SNDK_CHART }) },
    });
  }

  it("an edit or a removal of the floor is refused with why, and the rest of the call lands", async () => {
    const r = await afterBuyEdit({ edit: [{ id: "floor", price: "{gapDayLow}", rationale: "Under the gap day." }, { id: "clock", days: 21, rationale: "Three weeks to the report." }], remove: [{ id: "floor", reason: "Restating it." }] });
    const refused = ops(r).filter((o) => !o.ok);
    expect(refused.map((o) => o.reason)).toEqual(["The floor came with the buy; leave it. Only the owner moves it down, and a later review moves it up.", "The floor came with the buy; leave it. Only the owner moves it down, and a later review moves it up."]);
    expect(triggerSentences(stored(r)).sort()).toEqual(["Review every 21 days", "Sell if below $1000"]);
  });

  it("an add that would replace the floor is refused too", async () => {
    const r = await afterBuyEdit({ add: [{ action: "EXIT", predicate: { watch: "price", is: "below", value: "{gapDayLow}" }, rationale: "Under the gap day's low." }] });
    expect(ops(r)[0]).toMatchObject({ ok: false, reason: "The floor came with the buy; leave it. Only the owner moves it down, and a later review moves it up." });
    expect(triggerSentences(stored(r))).toContain("Sell if below $1000");
  });
});
