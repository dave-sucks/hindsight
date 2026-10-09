/**
 * get-theses.research-line.replay.test.ts — the research line's date and
 * price come from the same row.
 *
 * Production, SYK on 2026-10-08: the writer wrote the research on 2026-08-12
 * at $348.15; a morning save on 10-07 touched a research field. The line read
 * "Written 2026-10-07 at $348.15, 1 days ago": an October date, an August
 * price, with the stock at $277.
 */
import { replayTool, thesisRow, REPLAY_ANALYST_ID, type Row } from "@/lib/replay";

/** get-theses's pure row builder, loaded without a database. */
async function rowForModel(row: Record<string, unknown>, named: boolean): Promise<Record<string, unknown>> {
  let out: Record<string, unknown> = {};
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    out = (await import("./get-theses")).rowForModel(row, { named, size: "full" }) as Record<string, unknown>;
  });
  return out;
}

const WRITER_RUN = "cmspl439a000c04jt2pd0r17b";
const MORNING_RUN = "cmuy27qla001604leogd6f51o";

const syk = () =>
  thesisRow({
    id: "cmsplgpal000f04l71yixvmrl", ticker: "SYK", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER",
    researchRunId: WRITER_RUN, researchUpdatedAt: new Date("2026-10-07T16:04:54.903Z"),
    entryPrice: 300, targetPrice: 420, stopLoss: 260,
  });

it("SYK: written on the writer's date at the writer's price, and the later edit said as an edit", async () => {
  jest.useFakeTimers({ now: new Date("2026-10-08T13:00:00Z"), doNotFake: ["nextTick", "setImmediate", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance"] });
  try {
    const { result } = await replayTool("get-theses", "getTheses", {
      seed: {
        thesis: [syk()],
        researchRun: [
          { id: WRITER_RUN, mode: "THESIS_WRITER", agentConfigId: REPLAY_ANALYST_ID, createdAt: new Date("2026-08-12T08:30:00Z") },
          { id: MORNING_RUN, mode: "MORNING_PLAN", agentConfigId: REPLAY_ANALYST_ID, createdAt: new Date("2026-10-07T12:00:00Z") },
        ] as Row[],
        thesisUpdate: [
          { id: "w", thesisId: "cmsplgpal000f04l71yixvmrl", type: "CREATED", runId: WRITER_RUN, timestamp: new Date("2026-08-12T08:33:41.433Z"), priceAtTime: 348.15, summary: "LONG thesis on SYK", fieldChanges: {}, run: { id: WRITER_RUN, mode: "THESIS_WRITER" } },
          { id: "m", thesisId: "cmsplgpal000f04l71yixvmrl", type: "UPDATED", runId: MORNING_RUN, timestamp: new Date("2026-10-07T16:04:55.184Z"), priceAtTime: 278.2, summary: "Updated SYK", fieldChanges: {}, run: { id: MORNING_RUN, mode: "MORNING_PLAN" } },
        ] as Row[],
      } as never,
      args: { detail: "full", tickers: ["SYK"] },
      ctx: { runMode: "MORNING_PLAN" },
      quotes: { SYK: 277 },
    });
    const row = (result as unknown as { data: { theses: Array<Record<string, unknown>> } }).data.theses.find((t) => t.ticker === "SYK");
    expect(row).toBeDefined();
    expect((await rowForModel(row!, true)).research).toBe("Written 2026-08-12 at $348.15, 57 days ago, edited 2026-10-07.");
  } finally {
    jest.useRealTimers();
  }
});

it("no writer save on record: the research date alone, as before", async () => {
  const line = (await rowForModel({ researchUpdatedAt: "2026-10-07T16:04:54.903Z", researchWritten: null, researchAge: { daysOld: 1 } }, true)).research;
  expect(line).toBe("Written 2026-10-07, 1 day ago.");
});
