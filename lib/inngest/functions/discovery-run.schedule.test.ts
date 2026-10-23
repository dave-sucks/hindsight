/**
 * Discovery is started by hand only. Until this change a Sunday 9 AM cron
 * sat on the function (18 production runs labelled "discovery-cron", the
 * last on 2026-05-31) while the design said discovery is manual.
 */
const createFunction = jest.fn((..._args: unknown[]) => ({}));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: (...a: unknown[]) => createFunction(...a) } }));

import "./discovery-run";

describe("discovery-run schedule", () => {
  it("starts only on the manual event, with no cron", () => {
    expect(createFunction).toHaveBeenCalledTimes(1);
    const [opts, triggers] = createFunction.mock.calls[0] as [{ id: string }, unknown];
    expect(opts.id).toBe("discovery-run");
    expect(triggers).toEqual([{ event: "app/discovery.run.manual" }]);
    expect(JSON.stringify(triggers)).not.toContain("cron");
  });
});
