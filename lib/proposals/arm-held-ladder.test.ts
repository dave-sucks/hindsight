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

describe("armHeldLadderOnFill — the analyst's ladder survives the fill (DAV-234)", () => {
  // ASML, 2026-09-04: a COMPOUNDER watch with an agent-written $2,800 target
  // and a $1,625 support review was bought, and the fill regenerated the
  // ladder from the HELD template — which mints no target rung for
  // COMPOUNDER — so the target column went null and the reviews vanished.
  const asml = {
    id: "t-asml",
    direction: "LONG",
    horizon: "COMPOUNDER",
    catalystDate: null,
    triggers: [
      { id: "enter", action: "ENTER", source: "AGENT", predicate: { kind: "PRICE_ABOVE", level: 1710 }, rationale: "buy" },
      { id: "target", action: "REVIEW", source: "AGENT", predicate: { kind: "PRICE_ABOVE", level: 2800 }, rationale: "target" },
      { id: "support", action: "REVIEW", source: "AGENT", predicate: { kind: "PRICE_BELOW", level: 1625 }, rationale: "support" },
      { id: "floor", action: "EXIT", source: "AGENT", predicate: { kind: "PRICE_BELOW", level: 1580 }, rationale: "floor" },
      { id: "watch-tmpl", action: "REVIEW", source: "DEFAULT", predicate: { kind: "REVIEW_CADENCE", days: 30 }, rationale: "watch template clock" },
    ],
  };

  it("keeps the analyst's target and reviews, drops the buy rung, adds the held protection", async () => {
    thesisFindFirst.mockResolvedValue(asml);
    await armHeldLadderOnFill({ ...BASE, ticker: "ASML", fillPrice: 1716.09, targetPrice: 2800, stopLoss: 1580 });

    const data = thesisUpdate.mock.calls[0][0].data;
    const ids = (data.triggers as Array<{ id: string; action: string; predicate: { kind: string } }>).map((t) => t.id);
    expect(ids).toContain("target");
    expect(ids).toContain("support");
    expect(ids).toContain("floor");
    expect(ids).not.toContain("enter");
    // The held template still supplies what the analyst didn't write.
    const kinds = (data.triggers as Array<{ predicate: { kind: string } }>).map((t) => t.predicate.kind);
    expect(kinds).toContain("TRAILING_FROM_HIGH");
    // And the target column is read off the surviving rung, not lost.
    expect(data.targetPrice).toBe(2800);
    expect(data.stopLoss).toBe(1580);
  });

  it("the WATCHING template's own rungs do not carry over — the HELD template owns that layer", async () => {
    thesisFindFirst.mockResolvedValue(asml);
    await armHeldLadderOnFill({ ...BASE, ticker: "ASML", fillPrice: 1716.09, targetPrice: 2800, stopLoss: 1580 });
    const ids = (thesisUpdate.mock.calls[0][0].data.triggers as Array<{ id: string }>).map((t) => t.id);
    expect(ids).not.toContain("watch-tmpl");
  });
});
