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
import { accountSeedTriggers } from "./seed-account";
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
      { id: "acc1", triggers: [trail(7, "acc-trail")], triggersSeededAt: new Date() },
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
  it("lifts the legacy bare-string shape to { firedAt } and drops junk", () => {
    expect(
      parseTriggerState({ a: "2026-08-01T00:00:00.000Z", b: 42, c: null }),
    ).toEqual({ a: { firedAt: "2026-08-01T00:00:00.000Z" } });
  });

  it("reads the object shape, keeping firedAt and dropping anything else", () => {
    expect(
      parseTriggerState({
        a: { firedAt: "2026-08-01T00:00:00.000Z", side: "MATCH" },
        b: { side: "NO_MATCH" },
        c: { firedAt: 7 },
      }),
    ).toEqual({
      a: { firedAt: "2026-08-01T00:00:00.000Z" },
    });
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
  it("gives a thesis with NO stored triggers the account's rules", () => {
    const ladder = resolveThesisLadder(
      { triggers: [], triggerState: {}, status: "HOLDING", horizon: "TARGET" },
      { analyst: [], account: accountSeedTriggers() },
    );

    // The standing minimums now arrive from the ACCOUNT level — they are
    // seeded rows, not a code layer.
    expect(ladder.length).toBeGreaterThan(0);
    expect(ladder.every((t) => t.inherited)).toBe(true);
    expect(ladder.every((t) => t.level === "ACCOUNT")).toBe(true);
    expect(
      ladder.some((t) => t.predicate.kind === "TRAILING_FROM_HIGH"),
    ).toBe(true);
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

  it("drops position-scoped rungs on a WATCHING thesis, whatever level they came from", () => {
    // The account can't know a thesis has no position, so the gate moved
    // into the resolver when these rungs became account rows.
    const ladder = resolveThesisLadder(
      { triggers: [], triggerState: {}, status: "WATCHING", horizon: "TARGET" },
      { analyst: [], account: accountSeedTriggers() },
    );
    expect(ladder.some((t) => t.predicate.kind === "TRAILING_FROM_HIGH")).toBe(false);
    expect(ladder.some((t) => t.predicate.kind === "GAIN_FROM_ENTRY")).toBe(false);
    // The daily-move scale-ins are ADD rungs — a position action — and go
    // too (2026-09-03: they spawned five "scale in" runs on un-held names).
    expect(ladder.some((t) => t.action === "ADD")).toBe(false);
    // What survives is what a watch row can act on: the review clock is
    // opted-in per thesis (W1), so a seeded account leaves nothing here.
    expect(ladder.every((t) => t.action === "REVIEW" || t.action === "EXIT")).toBe(true);
  });

  it("overlays inherited fire state from triggerState", () => {
    const fired = "2026-08-04T15:00:00.000Z";
    const acct = trail(8, "acct-trail");
    const ladder = resolveThesisLadder(
      {
        triggers: [],
        triggerState: { "acct-trail": fired },
        status: "HOLDING",
        horizon: "TARGET",
      },
      { analyst: [], account: [acct] },
    );
    expect(ladder.find((x) => x.id === "acct-trail")!.lastFiredAt).toBe(fired);
  });

  it("resolves to the thesis's own rungs when it has no analyst owner", () => {
    // No analyst ⇒ no account ⇒ nothing to inherit. Such a thesis can't
    // be dispatched to a tactical run either (the evaluator skips it), so
    // an empty inherited ladder is the honest answer rather than
    // pretending a code layer still applies.
    const ladder = resolveThesisLadder(
      { triggers: [trail(4, "own")], triggerState: {}, status: "HOLDING", horizon: "TARGET" },
      undefined,
    );
    expect(ladder.map((t) => t.id)).toEqual(["own"]);
  });
});
