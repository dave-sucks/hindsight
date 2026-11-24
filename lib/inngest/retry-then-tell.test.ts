/** The one way a failed run that something asked for is tried again, then told. */
import { retryThenTell, RUN_TRIES, type Left } from "./retry-then-tell";

const TRIED = new Date("2026-11-24T15:05:00Z");

function fakeStep() {
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  const sleeps: string[] = [];
  return {
    events,
    sleeps,
    run: async <T,>(_id: string, fn: () => Promise<T>) => fn(),
    sleep: async (_id: string, time: string) => void sleeps.push(time),
    sendEvent: async (_id: string, e: { name: string; data: unknown }) => void events.push(e as { name: string; data: Record<string, unknown> }),
  };
}

const check = (left: Left) => {
  const told: unknown[] = [];
  return { told, left: async () => left, tell: async (d: unknown) => void told.push(d) };
};

describe("retryThenTell", () => {
  it("sends the same event again in five minutes, counting the try and keeping when the first one started", async () => {
    const step = fakeStep();
    const c = check("retry");
    expect(await retryThenTell<{ orderId: string }>({ name: "app/buy.filled", data: { orderId: "o1" }, ts: TRIED.getTime() }, step, c)).toEqual({ next: "retry" });
    expect(step.sleeps).toEqual(["5m"]);
    expect(step.events).toEqual([{ name: "app/buy.filled", data: { orderId: "o1", recoveryTry: 1, firstTriedAt: TRIED.toISOString() } }]);
    expect(c.told).toEqual([]);
  });

  it("a second retry keeps the first try's time", async () => {
    const step = fakeStep();
    await retryThenTell({ name: "x", data: { recoveryTry: 1, firstTriedAt: "2026-11-24T15:00:00.000Z" }, ts: TRIED.getTime() }, step, check("retry"));
    expect(step.events[0].data).toEqual({ recoveryTry: 2, firstTriedAt: "2026-11-24T15:00:00.000Z" });
  });

  it(`tells the owner instead of a ${RUN_TRIES + 1}th try`, async () => {
    const step = fakeStep();
    const c = check("retry");
    expect(await retryThenTell({ name: "x", data: { recoveryTry: RUN_TRIES - 1 }, ts: TRIED.getTime() }, step, c)).toEqual({ next: "tell" });
    expect(step.events).toEqual([]);
    expect(c.told).toHaveLength(1);
  });

  it("does nothing when the work got done, and tells at once when told to", async () => {
    const done = fakeStep();
    expect(await retryThenTell({ name: "x", data: {}, ts: TRIED.getTime() }, done, check("done"))).toEqual({ next: "done" });
    expect(done.events).toEqual([]);
    const c = check("tell");
    await retryThenTell({ name: "x", data: {}, ts: TRIED.getTime() }, fakeStep(), c);
    expect(c.told).toHaveLength(1);
  });
});
