/**
 * The ledger through the real wrapper (2026-09-25).
 *
 * PLTR, 09-25 09:40 ET: place_trade refused the Compounder's buy, the run
 * closed out and ended COMPLETE, and nothing said the buy never happened.
 * On main the refusal row is written and never read again. Here a refusal
 * stays OPEN until the same tool lands on the same stock or thesis for the
 * analyst — and only then. No phrase, no flag closes it.
 *
 * Runs defineTool's real execute against the replay double; the tool body
 * is a stand-in that returns the real refusal envelopes the wrapper
 * classifies (place_trade's `status: "FAILED"`, update_thesis's `ok: false`).
 */
import { z } from "zod";
import { prismaDouble, type PrismaDouble } from "@/lib/replay";
import fixture from "./__fixtures__/refusals-2026-09-25.json";

const ANALYST = fixture.pltr_buy_refused.analystId;

async function withWrapper(db: PrismaDouble) {
  let defineTool!: typeof import("./define-tool").defineTool;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    defineTool = (await import("./define-tool")).defineTool;
  });
  return defineTool;
}

/** The AI SDK's tool generic does not unify with a loose args object; the wrapper's execute takes the args as-is. */
const run = (tool: unknown, args: Record<string, unknown>, id: string) =>
  (tool as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(args, { toolCallId: id, messages: [] });

const ctx = (runId: string) => ({
  runId, userId: "u", accountId: "a", analystId: ANALYST, runMode: "INTRADAY_TACTICAL",
  runEnvironment: "PAPER" as const, groupId: (p: string) => p,
});

const pltrRow = () => ({
  ...fixture.pltr_buy_refused,
  createdAt: new Date(fixture.pltr_buy_refused.createdAt),
  thesisId: null, resolvedAt: null, resolvedBy: null,
});

describe("a refused call is open until the same tool lands on the stock", () => {
  it("PLTR: the refusal row lands open, with the ticker, from the real place_trade envelope", async () => {
    const db = prismaDouble({});
    const defineTool = await withWrapper(db);
    const tool = defineTool({
      description: "place_trade stand-in", gateLog: "place_trade", ui: "tool-ui",
      schema: z.object({ ticker: z.string(), notional: z.number().optional(), shares: z.number().optional(), direction: z.string() }),
      execute: async () => ({
        summary: fixture.pltr_buy_refused.summary,
        data: { status: "FAILED", note: fixture.pltr_buy_refused.detail },
      }),
    })(ctx(fixture.pltr_buy_refused.runId));
    await run(tool, fixture.pltr_place_trade_args, "1");
    const rows = db.store.gateRejection ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: "place_trade", ticker: "PLTR", analystId: ANALYST, resolvedAt: null });
  });

  it("the buy landing on PLTR — in the retry, or a later run — closes it; a buy on another stock does not", async () => {
    const db = prismaDouble({ gateRejection: [pltrRow()] });
    const defineTool = await withWrapper(db);
    const landed = defineTool({
      description: "place_trade stand-in", gateLog: "place_trade", ui: "tool-ui",
      schema: z.object({ ticker: z.string() }),
      execute: async ({ ticker }) => ({ summary: `Proposed buy: $${ticker}`, data: { success: true, status: "PROPOSED" } }),
    })(ctx("next-run"));

    await run(landed, { ticker: "NVDA" }, "1");
    expect(db.store.gateRejection[0].resolvedAt).toBeNull();

    await run(landed, { ticker: "PLTR" }, "2");
    expect(db.store.gateRejection[0].resolvedAt).toBeInstanceOf(Date);
    expect(db.store.gateRejection[0].resolvedBy).toBe("run:next-run");
  });

  it("a different tool on the stock does not close a refused buy (an update_thesis is not a buy)", async () => {
    const db = prismaDouble({ gateRejection: [pltrRow()] });
    const defineTool = await withWrapper(db);
    const edit = defineTool({
      description: "update_thesis stand-in", gateLog: "update_thesis", ui: "tool-ui",
      schema: z.object({ thesis_id: z.string() }),
      execute: async () => ({ summary: "Reviewed $PLTR", data: { ok: true } }),
    })(ctx("next-run"));
    await run(edit, { thesis_id: "t-pltr" }, "1");
    expect(db.store.gateRejection[0].resolvedAt).toBeNull();
  });

  it("GD: an update_thesis refusal carries the thesis id and the ticker read off the summary, and the landing edit closes it", async () => {
    const db = prismaDouble({});
    const defineTool = await withWrapper(db);
    const gd = fixture.gd_edit_refused;
    let refuse = true;
    const edit = defineTool({
      description: "update_thesis stand-in", gateLog: "update_thesis", ui: "tool-ui",
      schema: z.object({ thesis_id: z.string() }),
      execute: async () =>
        refuse
          ? { summary: gd.summary, data: { ok: false, error: gd.gateCode, message: gd.detail } }
          : { summary: "Updated $GD — plan set down", data: { ok: true } },
    })(ctx(gd.runId));

    await run(edit, { thesis_id: "gd-thesis" }, "1");
    expect(db.store.gateRejection[0]).toMatchObject({ tool: "update_thesis", ticker: "GD", thesisId: "gd-thesis", resolvedAt: null });

    refuse = false;
    await run(edit, { thesis_id: "gd-thesis" }, "2");
    expect(db.store.gateRejection[0].resolvedAt).toBeInstanceOf(Date);
  });
});
