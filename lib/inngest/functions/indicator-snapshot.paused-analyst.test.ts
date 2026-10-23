/**
 * The 6:30 chart numbers cover what the five-minute check reads: a paused analyst's held stock too (its
 * sales are still checked), never its watched ones. Rows: Momentum Breakout (paused) held MRVL.
 */
import { prismaDouble, thesisRow } from "@/lib/replay";

const run = (enabled: boolean) => ({ agentConfigId: enabled ? "active" : "cmmofy6t3000004l7858o1xma", agentConfig: { name: "x", setupIds: [], enabled } });

it("charts a paused analyst's held stock, not its watched one", async () => {
  const db = prismaDouble({
    thesis: [
      thesisRow({ id: "mrvl", ticker: "MRVL", status: "HOLDING", researchRun: run(false) }),
      thesisRow({ id: "panw", ticker: "PANW", status: "WATCHING", researchRun: run(false) }),
      thesisRow({ id: "iot", ticker: "IOT", status: "WATCHING", researchRun: run(true) }),
    ],
  });
  let tickers: unknown;
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => ((handler = fn), {}) } }));
    await import("./indicator-snapshot");
    await handler!({
      step: {
        run: async (name: string, fn: () => Promise<unknown>) => {
          if (name !== "book-tickers") throw new Error("stop");
          return (tickers = await fn());
        },
      },
    }).catch(() => undefined);
  });
  expect(tickers).toEqual(["IOT", "MRVL", "SPY"]);
});
