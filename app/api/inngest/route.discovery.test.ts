/**
 * The manual discovery start must stay served after its Sunday cron went:
 * the route still hands Inngest a discovery-run function on its event.
 */
type Fn = { id: string; triggers: unknown };
const serve = jest.fn((_opts: { functions: Fn[] }) => ({ GET: jest.fn(), POST: jest.fn(), PUT: jest.fn() }));
jest.mock("inngest/next", () => ({ serve: (opts: { functions: Fn[] }) => serve(opts) }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({
  inngest: { createFunction: (opts: { id: string }, triggers: unknown) => ({ id: opts.id, triggers }) },
}));

import "./route";

describe("Inngest route: discovery", () => {
  it("serves discovery-run on the manual event, and no discovery cron", () => {
    const functions = serve.mock.calls[0][0].functions;
    const discovery = functions.filter((f) => f.id === "discovery-run");
    expect(discovery).toEqual([{ id: "discovery-run", triggers: [{ event: "app/discovery.run.manual" }] }]);
  });
});
