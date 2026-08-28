/**
 * armHeldLadderOnFill — the shared WATCHING → HOLDING flip (DAV-220).
 *
 * The regression these tests pin: `place_trade` and `promoteThesisOnApproval`
 * used to be two copies of this logic, and they drifted. DAV-195 L3 taught the
 * place_trade copy to recompute the displayed level columns from the newly
 * armed triggers; the approval copy never got it. Since every LIVE trade goes
 * through approval, the live path regenerated the ladder while entryPrice /
 * targetPrice / stopLoss kept their watching-era values — the SNOW drift,
 * reintroduced on every live fill.
 *
 * One implementation now serves both, so these assertions cover both paths.
 */

const thesisFindFirst = jest.fn();
const thesisUpdate = jest.fn();
const thesisUpdateCreate = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: {
      findFirst: (...a: unknown[]) => thesisFindFirst(...a),
      update: (...a: unknown[]) => thesisUpdate(...a),
      updateMany: jest.fn(),
    },
    thesisUpdate: { create: (...a: unknown[]) => thesisUpdateCreate(...a) },
  },
}));

import { armHeldLadderOnFill } from "./thesis-flips";

const BASE = {
  analystId: "analyst-1",
  ticker: "PBH",
  fillPrice: 52.975,
  targetPrice: 63,
  stopLoss: 47.5,
  positionId: "pos-1",
  runId: "run-1",
  via: "approved proposal" as const,
};

beforeEach(() => {
  thesisFindFirst.mockReset();
  thesisUpdate.mockReset();
  thesisUpdateCreate.mockReset();
});

describe("armHeldLadderOnFill", () => {
  it("stamps entryPrice with the FILL price, not the planned entry", async () => {
    thesisFindFirst.mockResolvedValue({
      id: "t1", direction: "LONG", horizon: "TARGET",
      catalystDate: null, triggers: [],
    });

    await armHeldLadderOnFill(BASE);

    const data = thesisUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("HOLDING");
    // Once held, entry is a FACT — what the buy actually cost.
    expect(data.entryPrice).toBe(52.975);
  });

  it("recomputes the level columns from the armed triggers (the DAV-195 L3 fix)", async () => {
    thesisFindFirst.mockResolvedValue({
      id: "t1", direction: "LONG", horizon: "TARGET",
      catalystDate: null, triggers: [],
    });

    await armHeldLadderOnFill(BASE);

    const data = thesisUpdate.mock.calls[0][0].data;
    // The columns are a read model of the ladder. They must be written from
    // the triggers we just armed, never left at their watching-era values.
    expect(data).toHaveProperty("targetPrice");
    expect(data).toHaveProperty("stopLoss");
    expect(Array.isArray(data.triggers)).toBe(true);
  });

  it("drops the watching-side ENTER trigger — you can't enter what you hold", async () => {
    thesisFindFirst.mockResolvedValue({
      id: "t1", direction: "LONG", horizon: null, // no horizon → fallback path
      catalystDate: null,
      triggers: [
        { id: "a", action: "ENTER", predicate: { kind: "PRICE_ABOVE", level: 50 } },
        { id: "b", action: "REVIEW", predicate: { kind: "PRICE_BELOW", level: 40 } },
      ],
    });

    await armHeldLadderOnFill(BASE);

    const armed = thesisUpdate.mock.calls[0][0].data.triggers as Array<{ action: string }>;
    expect(armed.some((t) => t.action === "ENTER")).toBe(false);
    expect(armed.some((t) => t.action === "REVIEW")).toBe(true);
  });

  it("is a no-op when the analyst has no WATCHING thesis on the ticker", async () => {
    thesisFindFirst.mockResolvedValue(null);
    await armHeldLadderOnFill(BASE);
    expect(thesisUpdate).not.toHaveBeenCalled();
    expect(thesisUpdateCreate).not.toHaveBeenCalled();
  });

  it("fails soft — a ladder problem never rolls back a filled trade", async () => {
    thesisFindFirst.mockRejectedValue(new Error("db down"));
    await expect(armHeldLadderOnFill(BASE)).resolves.toBeUndefined();
  });

  it("records which path the fill came from", async () => {
    thesisFindFirst.mockResolvedValue({
      id: "t1", direction: "LONG", horizon: "TARGET", catalystDate: null, triggers: [],
    });

    await armHeldLadderOnFill({ ...BASE, via: "place_trade" });
    expect(thesisUpdateCreate.mock.calls[0][0].data.summary).toContain("place_trade");
  });
});
