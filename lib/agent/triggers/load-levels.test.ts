/**
 * load-levels.test.ts — the DB↔resolver glue.
 *
 * The claim under test is the one the whole cascade rests on: a thesis
 * that stores NO triggers of its own still resolves a fireable ladder
 * from the levels above it. If this breaks, analyst and account rules
 * become decorative — they render on the sheet and never fire, which is
 * exactly the state the signal-side rungs are in today
 * (docs/plans/TRIGGER_MODEL.md §4).
 */

const mockAgentConfigFindMany = jest.fn();
const mockAccountFindMany = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    agentConfig: { findMany: (...a: unknown[]) => mockAgentConfigFindMany(...a) },
    account: { findMany: (...a: unknown[]) => mockAccountFindMany(...a) },
  },
}));

import {
  loadLevelSources,
  parseLevelTriggers,
  parseTriggerState,
  resolveThesisLadder,
  thesisStateFor,
  horizonFor,
} from "./load-levels";
import { DEFAULT_LADDER_IDS } from "./defaults";
import type { Trigger } from "./types";

const trail = (pct: number, id: string): Trigger => ({
  id,
  predicate: { kind: "TRAILING_FROM_HIGH", pct },
  action: "EXIT",
  rationale: "trail",
});

beforeEach(() => {
  mockAgentConfigFindMany.mockReset();
  mockAccountFindMany.mockReset();
});

describe("loadLevelSources", () => {
  it("keys analyst + account triggers by analyst id", async () => {
    mockAgentConfigFindMany.mockResolvedValue([
      { id: "an1", accountId: "acc1", triggers: [trail(5, "an-trail")] },
      { id: "an2", accountId: "acc1", triggers: [] },
    ]);
    mockAccountFindMany.mockResolvedValue([
      { id: "acc1", triggers: [trail(7, "acc-trail")] },
    ]);

    const map = await loadLevelSources(["an1", "an2"]);

    expect(map.get("an1")!.analyst.map((t) => t.id)).toEqual(["an-trail"]);
    expect(map.get("an1")!.account.map((t) => t.id)).toEqual(["acc-trail"]);
    // Both analysts share the account level.
    expect(map.get("an2")!.analyst).toEqual([]);
    expect(map.get("an2")!.account.map((t) => t.id)).toEqual(["acc-trail"]);
  });

  it("dedupes ids and short-circuits on an empty list", async () => {
    expect((await loadLevelSources([])).size).toBe(0);
    expect(mockAgentConfigFindMany).not.toHaveBeenCalled();

    mockAgentConfigFindMany.mockResolvedValue([]);
    mockAccountFindMany.mockResolvedValue([]);
    await loadLevelSources(["an1", "an1", "an1"]);
    expect(mockAgentConfigFindMany.mock.calls[0][0].where.id.in).toEqual(["an1"]);
  });

  it("skips the account query entirely when no analyst has an account", async () => {
    mockAgentConfigFindMany.mockResolvedValue([
      { id: "an1", accountId: "", triggers: [] },
    ]);
    await loadLevelSources(["an1"]);
    expect(mockAccountFindMany).not.toHaveBeenCalled();
  });
});

describe("parseLevelTriggers — fail-open", () => {
  it("returns [] for malformed JSON instead of throwing", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseLevelTriggers([{ nope: true }], "analyst=x")).toEqual([]);
    warn.mockRestore();
  });

  it("returns [] for null/absent", () => {
    expect(parseLevelTriggers(null, "x")).toEqual([]);
    expect(parseLevelTriggers(undefined, "x")).toEqual([]);
  });

  it("round-trips a valid array", () => {
    expect(parseLevelTriggers([trail(6, "t1")], "x").map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("parseTriggerState", () => {
  it("keeps string entries and drops everything else", () => {
    expect(
      parseTriggerState({ a: "2026-08-01T00:00:00.000Z", b: 42, c: null }),
    ).toEqual({ a: "2026-08-01T00:00:00.000Z" });
  });

  it("treats a non-object (or array) as empty", () => {
    expect(parseTriggerState(null)).toEqual({});
    expect(parseTriggerState("nope")).toEqual({});
    expect(parseTriggerState([1, 2])).toEqual({});
  });
});

describe("thesisStateFor / horizonFor", () => {
  it("maps status to the template state axis", () => {
    expect(thesisStateFor("HOLDING")).toBe("HELD");
    expect(thesisStateFor("PROMOTED")).toBe("PROMOTED");
    expect(thesisStateFor("WATCHING")).toBe("WATCHING");
    expect(thesisStateFor(null)).toBe("WATCHING");
  });

  it("falls back to TARGET for an unknown horizon", () => {
    expect(horizonFor("TRADE")).toBe("TRADE");
    expect(horizonFor(null)).toBe("TARGET");
    expect(horizonFor("NONSENSE")).toBe("TARGET");
  });
});

describe("resolveThesisLadder", () => {
  it("gives a thesis with NO stored triggers a full inherited ladder", () => {
    const ladder = resolveThesisLadder(
      { triggers: [], triggerState: {}, status: "HOLDING", horizon: "TARGET" },
      { analyst: [], account: [] },
    );

    // The standing protection minimums arrive from the DEFAULT level.
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder.every((t) => t.inherited)).toBe(true);
    expect(ladder.map((t) => t.id)).toContain(DEFAULT_LADDER_IDS.trailRatchet);
  });

  it("lets an account rule override a code default, and an analyst rule override the account", () => {
    const base = { triggers: [], triggerState: {}, status: "HOLDING", horizon: "TARGET" };

    const acct = resolveThesisLadder(base, {
      analyst: [],
      account: [trail(6, "acc-trail")],
    }).find((t) => t.predicate.kind === "TRAILING_FROM_HIGH")!;
    expect(acct.level).toBe("ACCOUNT");
    expect((acct.predicate as { pct: number }).pct).toBe(6);

    const analyst = resolveThesisLadder(base, {
      analyst: [trail(5, "an-trail")],
      account: [trail(6, "acc-trail")],
    }).find((t) => t.predicate.kind === "TRAILING_FROM_HIGH")!;
    expect(analyst.level).toBe("ANALYST");
    expect((analyst.predicate as { pct: number }).pct).toBe(5);
  });

  it("lets the thesis override every level above it", () => {
    const own = resolveThesisLadder(
      {
        triggers: [trail(4, "own-trail")],
        triggerState: {},
        status: "HOLDING",
        horizon: "TARGET",
      },
      { analyst: [trail(5, "an-trail")], account: [trail(6, "acc-trail")] },
    ).find((t) => t.predicate.kind === "TRAILING_FROM_HIGH")!;

    expect(own.level).toBe("THESIS");
    expect(own.inherited).toBe(false);
    expect((own.predicate as { pct: number }).pct).toBe(4);
  });

  it("carries no position-scoped defaults on a WATCHING thesis", () => {
    const ladder = resolveThesisLadder(
      { triggers: [], triggerState: {}, status: "WATCHING", horizon: "TARGET" },
      { analyst: [], account: [] },
    );
    expect(ladder.map((t) => t.id)).not.toContain(DEFAULT_LADDER_IDS.trailRatchet);
  });

  it("overlays inherited fire state from triggerState", () => {
    const fired = "2026-08-04T15:00:00.000Z";
    const ladder = resolveThesisLadder(
      {
        triggers: [],
        triggerState: { [DEFAULT_LADDER_IDS.trailRatchet]: fired },
        status: "HOLDING",
        horizon: "TARGET",
      },
      { analyst: [], account: [] },
    );
    const t = ladder.find((x) => x.id === DEFAULT_LADDER_IDS.trailRatchet)!;
    expect(t.lastFiredAt).toBe(fired);
  });

  it("resolves against code defaults alone when the thesis has no analyst owner", () => {
    const ladder = resolveThesisLadder(
      { triggers: [], triggerState: {}, status: "HOLDING", horizon: "TARGET" },
      undefined,
    );
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder.every((t) => t.level === "DEFAULT")).toBe(true);
  });
});
