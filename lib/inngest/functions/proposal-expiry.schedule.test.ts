/**
 * The expiry job's schedule, read off the function as it registers with
 * Inngest. A proposal lapses 24 h after it is made, by the clock, so the job
 * that writes the lapse down must run nights and weekends.
 *
 * 2026-10-31: seven Friday-afternoon sale proposals lapsed Saturday morning
 * and stayed "waiting" in the record (and on the Proposals list) until the
 * job's next weekday tick, while the card had already dropped its Review
 * button. The schedule was weekdays 4 AM–8 PM ET, copied from reconcile-orders.
 */

async function registeredCron(): Promise<string> {
  let cron = "";
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/market-data/live-quote", () => ({ getLiveQuotes: jest.fn() }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_c: unknown, trigger: { cron: string }, handler: unknown) => ({ trigger, handler }), send: jest.fn() },
    }));
    const { proposalExpiry } = (await import("./proposal-expiry")) as unknown as { proposalExpiry: { trigger: { cron: string } } };
    cron = proposalExpiry.trigger.cron;
  });
  for (const m of ["@/lib/prisma", "@/lib/market-data/live-quote", "@/lib/inngest/client"]) jest.dontMock(m);
  return cron;
}

describe("proposal-expiry schedule", () => {
  it("runs every 30 minutes, every hour, every day of the week, in New York time", async () => {
    const cron = await registeredCron();
    expect(cron.startsWith("TZ=America/New_York ")).toBe(true);
    const [minute, hour, , , dayOfWeek] = cron.replace(/^TZ=\S+\s+/, "").split(/\s+/);
    expect({ minute, hour, dayOfWeek }).toEqual({ minute: "*/30", hour: "*", dayOfWeek: "*" });
  });
});
