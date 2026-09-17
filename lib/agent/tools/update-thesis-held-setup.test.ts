/**
 * update-thesis-held-setup.test.ts — a held stock whose review names its
 * setup gets that setup's own exits (DAV-285).
 *
 * Replay: $ABT, Secular Compounder, production 2026-09-17. Bought
 * 2026-09-11 at $103.663, floor $96, target $135, twelve triggers, and
 * `setupId` null — bought before setups were named, like 8 of the 9 held
 * stocks. Only a fill writes a setup's exits, so ABT never got the
 * compounder's 60-day business checkpoint, and on main naming its setup
 * stores the id and changes nothing else.
 */

const mockThesisFindUnique = jest.fn();
const mockThesisUpdate = jest.fn();
const mockPositionFindFirst = jest.fn();
const mockThesisUpdateFindFirst = jest.fn().mockResolvedValue(null);
const mockWriteThesisUpdate = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/prisma", () => ({
  prisma: {
    thesis: { findUnique: mockThesisFindUnique, update: mockThesisUpdate },
    position: { findFirst: mockPositionFindFirst },
    thesisUpdate: { findFirst: mockThesisUpdateFindFirst },
  },
}));
jest.mock("@/lib/actions/finnhub.actions", () => ({
  getStockQuote: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/agent/thesis-updates", () => ({
  writeThesisUpdate: mockWriteThesisUpdate,
  diffThesisFields: jest.fn().mockReturnValue({}),
  compactFieldChanges: (fc: unknown) => fc,
}));
jest.mock("@/lib/agent/triggers/load-levels", () => ({
  loadLevelSources: jest.fn().mockResolvedValue(new Map()),
  resolveThesisLadder: jest.fn().mockReturnValue([]),
}));

import { updateThesis } from "./update-thesis";
import type { ToolContext } from "@/lib/agent/tool-context";

/** ABT's stored triggers, verbatim from production 2026-09-17. */
const ABT_TRIGGERS = [
  {
    "id": "earnbeat1",
    "action": "REVIEW",
    "source": "AGENT",
    "predicate": {
      "kind": "EARNINGS_BEAT",
      "minSurprisePct": 1
    },
    "rationale": "Re-check the thesis if Abbott beats earnings by at least 1%; confirm Libre growth, diagnostics synergy progress, and whether the beat supports a higher-confidence entry.",
    "cooldownDays": 7
  },
  {
    "id": "earnmiss2",
    "action": "REVIEW",
    "source": "AGENT",
    "predicate": {
      "kind": "EARNINGS_MISS",
      "minSurprisePct": 2
    },
    "rationale": "Re-check the thesis on a meaningful miss; test whether EPS power or segment execution is slipping enough to threaten the compounding case.",
    "cooldownDays": 7
  },
  {
    "id": "exit84",
    "action": "EXIT",
    "source": "AGENT",
    "fireMode": "TACTICAL",
    "predicate": {
      "kind": "PRICE_BELOW",
      "level": 96
    },
    "rationale": "If already held and $ABT breaks below $96, review immediately for structural damage versus a simple drawdown; this is the protective line tied to the thesis setup.",
    "cooldownDays": 1
  },
  {
    "id": "rev135",
    "action": "REVIEW",
    "source": "AGENT",
    "predicate": {
      "kind": "PRICE_ABOVE",
      "level": 135
    },
    "rationale": "If $ABT reaches $135, review whether the thesis has largely played out or whether earnings power has improved enough to justify a higher long-term value.",
    "cooldownDays": 1
  },
  {
    "id": "cadence",
    "action": "REVIEW",
    "source": "AGENT",
    "predicate": {
      "days": 30,
      "kind": "REVIEW_CADENCE"
    },
    "rationale": "Regular maintenance review to test the thesis against new business evidence, not just the stock price.",
    "cooldownDays": 7
  },
  {
    "id": "d40232f7-cdfc-49da-a1ab-efeaff435789",
    "action": "REVIEW",
    "source": "DEFAULT",
    "predicate": {
      "kind": "PRICE_BELOW",
      "level": 95.09
    },
    "rationale": "8% drop from entry \u2014 something material happened. Re-evaluate before deciding to ride it out or trim.",
    "cooldownDays": 1
  },
  {
    "id": "24c7d002-b633-452b-95c6-39c8497c40a4",
    "action": "ADD",
    "source": "DEFAULT",
    "predicate": {
      "pct": 7,
      "kind": "PRICE_MOVE_PCT",
      "window": "1D",
      "direction": "UP"
    },
    "rationale": "Up 7% in a day \u2014 strength on a held name. Evaluate pressing the winner (add + raise target/stop) if the move is thesis-confirming, not an exhaustion spike. Approval-gated.",
    "cooldownDays": 3
  },
  {
    "id": "6ddd4838-a614-43a6-b505-714fe4f17a75",
    "action": "ADD",
    "source": "DEFAULT",
    "predicate": {
      "pct": 7,
      "kind": "PRICE_MOVE_PCT",
      "window": "1D",
      "direction": "DOWN"
    },
    "rationale": "Down 7% in a day \u2014 evaluate a pullback-add ONLY if the drop is market/sector-wide with the thesis intact. A company-specific drop is thesis damage: do not add \u2014 hold, trim, or exit. Approval-gated.",
    "cooldownDays": 3
  },
  {
    "id": "f96d1cd8-27a5-469d-b203-1f2972689ca8",
    "action": "REVIEW",
    "source": "DEFAULT",
    "predicate": {
      "pct": 10,
      "kind": "GAIN_FROM_ENTRY",
      "direction": "UP"
    },
    "rationale": "Up 10% from entry \u2014 gain milestone checkpoint. Re-underwrite at the new price: raise the floor to lock the gain in, and arm the next milestone.",
    "cooldownDays": 7
  },
  {
    "id": "d4991e66-7877-44c6-90bd-ab5476d27f4e",
    "action": "REVIEW",
    "source": "DEFAULT",
    "predicate": {
      "pct": 15,
      "kind": "TRAILING_FROM_HIGH"
    },
    "rationale": "Gave back 15% from the high. This is a question, not a sale: is the reason we bought still true? If yes, hold and raise the floor under real structure (the 20-day low, the breakout level). If partly, trim. Sell only if you can name what broke in the business.",
    "cooldownDays": 7
  },
  {
    "id": "934cc6bd-54ef-4814-a8cb-ac4157883c7f",
    "action": "EXIT",
    "source": "DEFAULT",
    "predicate": {
      "pct": 25,
      "kind": "TRAILING_FROM_HIGH"
    },
    "rationale": "Gave back 25% from the high \u2014 the catastrophe line for a multi-year hold. The review at 15% should have acted long before this; if we are here, protect the capital.",
    "cooldownDays": 0
  },
  {
    "id": "6d0fa696-819b-4f8e-aa48-6a98e4faf3a8",
    "action": "REVIEW",
    "source": "DEFAULT",
    "predicate": {
      "pct": 12,
      "kind": "GAIN_FROM_ENTRY",
      "direction": "DOWN"
    },
    "rationale": "Down 12% from entry \u2014 loser attention. Decide hold-vs-cut deliberately, before the hard stop decides for us.",
    "cooldownDays": 7
  }
];

function abtRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmspld5md000504l72u7ft9ve",
    userId: "user_1",
    ticker: "ABT",
    status: "HOLDING",
    direction: "LONG",
    horizon: "COMPOUNDER",
    setupId: null,
    entryPrice: 103.663,
    targetPrice: 135,
    stopLoss: 96,
    researchRun: { agentConfigId: "analyst_1" },
    snapshot: null,
    bullCase: null,
    bearCase: null,
    recentCatalysts: null,
    fundamentals: null,
    latestEarnings: null,
    catalystsAndEvents: null,
    analystConsensus: null,
    insiderTechnical: null,
    coreBelief: "Libre and diagnostics compound earnings for years.",
    keyAssumptions: ["a1", "a2"],
    invalidationConds: ["i1", "i2"],
    scoring: null,
    conviction: "MEDIUM",
    convictionRationale: "Existing.",
    variantView: null,
    catalystDate: null,
    maxHoldDays: null,
    lastReviewedAt: new Date("2026-09-16T12:00:00Z"),
    triggers: ABT_TRIGGERS,
    triggerState: {},
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tool(): { execute: (args: any) => Promise<any> } {
  const ctx = {
    runId: "run_abt",
    userId: "user_1",
    accountId: "account_1",
    analystId: "analyst_1",
    groupId: (phase: string) => phase,
  } as ToolContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return updateThesis(ctx) as unknown as { execute: (args: any) => Promise<any> };
}

type Stored = { id: string; action: string; predicate: { kind: string; days?: number; from?: string } };

function written(): Stored[] | undefined {
  expect(mockThesisUpdate).toHaveBeenCalled();
  return (mockThesisUpdate.mock.calls[0][0].data as { triggers?: Stored[] }).triggers;
}

describe("update_thesis — a held stock gets its setup's exits when the review names the setup", () => {
  beforeEach(() => {
    mockThesisFindUnique.mockReset();
    mockThesisUpdate.mockReset();
    mockThesisUpdate.mockResolvedValue(abtRow());
    mockPositionFindFirst.mockReset();
    mockPositionFindFirst.mockResolvedValue({ avgCost: 103.663, openedAt: new Date("2026-09-11T17:36:00.482Z") });
    mockWriteThesisUpdate.mockClear();
  });

  it("ABT: naming compounder accumulation writes the 60-day checkpoint counted from the buy, and touches nothing else", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(abtRow());
    const result = await tool().execute({
      thesis_id: "cmspld5md000504l72u7ft9ve",
      rationale: "Bought as an accumulation in a quality compounder near its 200-day; naming the setup it was bought on.",
      setup_id: "COMPOUNDER_ACCUMULATION",
    });
    expect(result.data?.ok).not.toBe(false);

    const data = mockThesisUpdate.mock.calls[0][0].data as { setupId?: string };
    expect(data.setupId).toBe("COMPOUNDER_ACCUMULATION");

    const next = written();
    expect(next).toBeDefined();
    expect(next).toHaveLength(ABT_TRIGGERS.length + 1);
    // Every trigger ABT already had is exactly as it was — its own 30-day
    // review clock included.
    expect(next!.slice(0, ABT_TRIGGERS.length)).toEqual(ABT_TRIGGERS);
    const added = next![next!.length - 1];
    expect(added.action).toBe("REVIEW");
    expect(added.predicate).toEqual({ kind: "REVIEW_CADENCE", days: 60, from: "BUY" });

    // One Activity line for it.
    const audit = mockWriteThesisUpdate.mock.calls[0][0] as { fieldChanges?: { triggerOps?: { to: { text: string }[] } } };
    expect(audit.fieldChanges?.triggerOps?.to).toHaveLength(1);
  });

  it("naming the same setup again writes nothing a second time", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(abtRow({ setupId: "COMPOUNDER_ACCUMULATION" }));
    await tool().execute({
      thesis_id: "cmspld5md000504l72u7ft9ve",
      rationale: "Routine review; the setup is unchanged.",
      setup_id: "COMPOUNDER_ACCUMULATION",
    });
    expect(written()).toBeUndefined();
  });

  it("'no setup fits' is stored and writes no exits", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(abtRow());
    const result = await tool().execute({
      thesis_id: "cmspld5md000504l72u7ft9ve",
      rationale: "Looked at the chart and the thesis: a story position with no catalog pattern behind the buy.",
      setup_id: "NONE",
    });
    expect(result.data?.ok).not.toBe(false);
    expect((mockThesisUpdate.mock.calls[0][0].data as { setupId?: string }).setupId).toBe("NONE");
    expect(written()).toBeUndefined();
  });

  it("a watched stock gets no exits from naming its setup — the fill writes those", async () => {
    mockThesisFindUnique.mockResolvedValueOnce(abtRow({ status: "WATCHING" }));
    mockPositionFindFirst.mockResolvedValue(null);
    await tool().execute({
      thesis_id: "cmspld5md000504l72u7ft9ve",
      rationale: "Naming the setup the buy price is written on.",
      setup_id: "COMPOUNDER_ACCUMULATION",
    });
    expect(written()).toBeUndefined();
  });
});
