/**
 * frozen-copy.test.ts — DAV-322, from ABT's, NVDA's and BMRN's real rungs.
 *
 * The rows are the live account's on 2026-09-28. ABT's ladder had grown to
 * 13 rungs, six of them copies of rules that live on the Secular Compounder
 * or the account — including a 25%-off-the-high sale identical to the
 * Compounder's own, which would have ignored any change to the seat's
 * number for as long as the position lasted.
 *
 * The cases that matter most here are the ones that must NOT be swept:
 * BMRN's VOXZOGO earnings review sits in the same bucket as the account's
 * and is stamped `DEFAULT`, and an earlier cut of this rule deleted it.
 */
// `seed-account` reaches prisma for its write paths; the rule list this
// test reads is pure. Same shape as defaults.test.ts.
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  frozenCopies,
  sharedRationalesAcross,
  triggerValue,
} from "@/lib/agent/triggers/frozen-copy";
import { defaultTriggersForHorizon } from "@/lib/agent/triggers/defaults";
import { accountSeedTriggers } from "@/lib/agent/triggers/seed-account";
import { triggerBucket } from "@/lib/agent/triggers/bucket";
import type { Trigger } from "@/lib/agent/triggers/types";

const t = (over: Partial<Trigger> & { predicate: Trigger["predicate"]; action: Trigger["action"] }) =>
  ({ id: Math.random().toString(36).slice(2), rationale: "", cooldownDays: 1, ...over }) as Trigger;

// ── The rules above, verbatim from the live account ────────────────────
const COMPOUNDER: Trigger[] = [
  t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 15, direction: "UP" }, action: "REVIEW", source: "PRINCIPAL" }),
  t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 15, direction: "DOWN" }, action: "REVIEW", source: "PRINCIPAL" }),
  t({ predicate: { kind: "PRICE_MOVE_PCT", pct: 7, window: "1D", direction: "DOWN" }, action: "ADD", source: "PRINCIPAL" }),
  t({ predicate: { kind: "TRAILING_FROM_HIGH", pct: 15 }, action: "REVIEW" }),
  t({ predicate: { kind: "TRAILING_FROM_HIGH", pct: 25 }, action: "EXIT" }),
  t({ predicate: { kind: "VS_SMA", period: 200, direction: "BELOW" }, action: "REVIEW", source: "PRINCIPAL" }),
];
const PEAD: Trigger[] = [
  t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" }, action: "REVIEW", source: "PRINCIPAL" }),
  t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" }, action: "REVIEW", source: "PRINCIPAL" }),
  t({ predicate: { kind: "TRAILING_FROM_HIGH", pct: 12 }, action: "EXIT", source: "PRINCIPAL" }),
];
const ACCOUNT: Trigger[] = [
  t({ predicate: { kind: "EARNINGS_BEAT" }, action: "REVIEW", source: "DEFAULT" }),
  t({ predicate: { kind: "EARNINGS_MISS" }, action: "REVIEW", source: "DEFAULT" }),
  t({ predicate: { kind: "PRICE_MOVE_PCT", pct: 7, window: "1D", direction: "UP" }, action: "ADD", source: "DEFAULT" }),
  t({ predicate: { kind: "REVIEW_CADENCE", days: 7 }, action: "REVIEW", source: "DEFAULT" }),
  t({ predicate: { kind: "SEC_EVENT", tier: "MATERIAL" }, action: "REVIEW", source: "DEFAULT" }),
];

// ── The template's sentences, which sit on four stocks apiece ──────────
const ADD_UP = "Up 7% in a day — strength on a held name. Evaluate pressing the winner.";
const ADD_DOWN = "Down 7% in a day — evaluate a pullback-add ONLY if the drop is market-wide.";
const GAIN_UP = "Up 10% from entry — gain milestone checkpoint. Re-underwrite at the new price.";
const GAIN_DOWN = "Down 12% from entry — loser attention. Decide hold-vs-cut deliberately.";

const ABT: Trigger[] = [
  // The six copies.
  t({ predicate: { kind: "PRICE_MOVE_PCT", pct: 7, window: "1D", direction: "UP" }, action: "ADD", rationale: ADD_UP, source: "DEFAULT" }),
  t({ predicate: { kind: "PRICE_MOVE_PCT", pct: 7, window: "1D", direction: "DOWN" }, action: "ADD", rationale: ADD_DOWN, source: "DEFAULT" }),
  t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" }, action: "REVIEW", rationale: GAIN_UP, source: "DEFAULT" }),
  t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" }, action: "REVIEW", rationale: GAIN_DOWN, source: "DEFAULT" }),
  t({ predicate: { kind: "TRAILING_FROM_HIGH", pct: 25 }, action: "EXIT", rationale: "Gave back 25% from the high — the catastrophe line for a multi-year hold.", source: "DEFAULT" }),
  t({ predicate: { kind: "TRAILING_FROM_HIGH", pct: 15 }, action: "REVIEW", rationale: "Gave back 15% from the high. This is a question, not a sale.", source: "DEFAULT" }),
  // …and the seven that are ABT's own.
  t({ id: "abt_floor", predicate: { kind: "PRICE_BELOW", level: 96 }, action: "EXIT", source: "AGENT" }),
  t({ id: "abt_target", predicate: { kind: "PRICE_ABOVE", level: 135 }, action: "REVIEW", source: "AGENT" }),
  t({ id: "abt_reviewline", predicate: { kind: "PRICE_BELOW", level: 95.09 }, action: "REVIEW", source: "DEFAULT" }),
  t({ id: "abt_clock10", predicate: { kind: "REVIEW_CADENCE", days: 10 }, action: "REVIEW", source: "DEFAULT" }),
  t({ id: "abt_clock30", predicate: { kind: "REVIEW_CADENCE", days: 30 }, action: "REVIEW", source: "AGENT" }),
  t({ id: "abt_beat", predicate: { kind: "EARNINGS_BEAT" }, action: "REVIEW", rationale: "Re-check the thesis if Abbott beats earnings by at least 1%.", source: "AGENT" }),
  t({ id: "abt_miss", predicate: { kind: "EARNINGS_MISS", minSurprisePct: 3 }, action: "REVIEW", rationale: "Re-check the thesis on a meaningful miss.", source: "AGENT" }),
];

const NVDA: Trigger[] = [
  t({ predicate: { kind: "PRICE_MOVE_PCT", pct: 7, window: "1D", direction: "UP" }, action: "ADD", rationale: ADD_UP, source: "DEFAULT" }),
  // The one with money attached: nothing above it governs. The account's
  // was removed on 09-18 and the copy stayed; the PEAD seat has no add.
  t({ id: "nvda_add_down", predicate: { kind: "PRICE_MOVE_PCT", pct: 7, window: "1D", direction: "DOWN" }, action: "ADD", rationale: ADD_DOWN, source: "DEFAULT" }),
  t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" }, action: "REVIEW", rationale: GAIN_DOWN, source: "DEFAULT" }),
  // Written for NVDA. Same bucket as the account's, and it stays.
  t({ id: "nvda_beat", predicate: { kind: "EARNINGS_BEAT" }, action: "REVIEW", rationale: "Beat — possibly a reason to extend the target.", source: "DEFAULT" }),
  t({ id: "nvda_trim", predicate: { kind: "GAIN_FROM_ENTRY", pct: 16.6, direction: "UP" }, action: "TRIM", rationale: "The 2R partial.", source: "DEFAULT" }),
];

const BMRN: Trigger[] = [
  t({
    id: "bmrn_miss",
    predicate: { kind: "EARNINGS_MISS" },
    action: "REVIEW",
    rationale: "A meaningful earnings miss could signal VOXZOGO commercial erosion and weaken the post-approval re-rating case.",
    source: "DEFAULT",
  }),
];

const shared = sharedRationalesAcross([
  { ticker: "ABT", triggers: ABT },
  { ticker: "NVDA", triggers: NVDA },
  { ticker: "BMRN", triggers: BMRN },
  // A third and fourth stock carrying the same template sentences is what
  // makes them recognisable as a template's, rather than anyone's writing.
  { ticker: "ASML", triggers: [t({ predicate: { kind: "PRICE_MOVE_PCT", pct: 7, window: "1D", direction: "UP" }, action: "ADD", rationale: ADD_UP }), t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" }, action: "REVIEW", rationale: GAIN_UP })] },
  { ticker: "WST", triggers: [t({ predicate: { kind: "PRICE_MOVE_PCT", pct: 7, window: "1D", direction: "DOWN" }, action: "ADD", rationale: ADD_DOWN }), t({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" }, action: "REVIEW", rationale: GAIN_DOWN })] },
]);

const idsOf = (list: ReturnType<typeof frozenCopies>) => list.map((c) => c.trigger.id);

describe("DAV-322 — the copies come off", () => {
  it("1. ABT loses exactly six, and keeps its own plan", () => {
    const copies = frozenCopies({ own: ABT, analyst: COMPOUNDER, account: ACCOUNT, sharedRationales: shared });
    expect(copies).toHaveLength(6);
    const removed = new Set(idsOf(copies));
    // The plan for this stock survives: floor, target, review line, both
    // clocks, and the two earnings reviews its analyst wrote.
    for (const keep of ["abt_floor", "abt_target", "abt_reviewline", "abt_clock10", "abt_clock30", "abt_beat", "abt_miss"]) {
      expect(removed.has(keep)).toBe(false);
    }
  });

  it("2. the 25% sale goes because it is the Compounder's number, not ABT's", () => {
    const copies = frozenCopies({ own: ABT, analyst: COMPOUNDER, account: ACCOUNT, sharedRationales: shared });
    const trail = copies.find((c) => c.bucket === triggerBucket({ predicate: { kind: "TRAILING_FROM_HIGH", pct: 25 }, action: "EXIT" }));
    expect(trail?.reason).toBe("SAME_RUNG_SAME_NUMBER");
    expect(trail?.governedBy).toBe("ANALYST");
  });

  it("3. NVDA's stranded down-7% add comes off even with nothing above it", () => {
    const copies = frozenCopies({ own: NVDA, analyst: PEAD, account: ACCOUNT, sharedRationales: shared });
    const stranded = copies.find((c) => c.trigger.id === "nvda_add_down");
    expect(stranded).toBeDefined();
    expect(stranded!.governedBy).toBeNull();
  });

  it("4. NVDA keeps the earnings review written for it, and its 2R partial", () => {
    const removed = new Set(idsOf(frozenCopies({ own: NVDA, analyst: PEAD, account: ACCOUNT, sharedRationales: shared })));
    expect(removed.has("nvda_beat")).toBe(false);
    expect(removed.has("nvda_trim")).toBe(false);
  });

  it("5. BMRN's VOXZOGO review stays — an earlier cut of this rule deleted it", () => {
    // Same bucket as the account's earnings review, stamped DEFAULT, and
    // plainly written about this company. `source` cannot tell them apart;
    // the sentence can.
    const copies = frozenCopies({ own: BMRN, analyst: [], account: ACCOUNT, sharedRationales: shared });
    expect(copies).toHaveLength(0);
  });

  it("6. a rung at a different number with its own words is an override, not a copy", () => {
    const own = [
      t({ id: "own_trail", predicate: { kind: "TRAILING_FROM_HIGH", pct: 8 }, action: "EXIT", rationale: "Tighter than the seat because this one gaps.", source: "AGENT" }),
    ];
    expect(frozenCopies({ own, analyst: COMPOUNDER, account: ACCOUNT, sharedRationales: shared })).toHaveLength(0);
  });

  it("7. triggerValue reads the number a rung is set at", () => {
    expect(triggerValue({ predicate: { kind: "TRAILING_FROM_HIGH", pct: 25 } })).toBe(25);
    expect(triggerValue({ predicate: { kind: "PRICE_BELOW", level: 96 } })).toBe(96);
    expect(triggerValue({ predicate: { kind: "EARNINGS_BEAT" } })).toBeNull();
  });
});

/**
 * The other half: the template that made them has to stop.
 *
 * Checked as an invariant over every horizon rather than one example,
 * because the bug was one horizon's template quietly carrying a rung the
 * account already had. A new horizon added later gets caught by this.
 */
describe("DAV-322 — a new holding is not given a copy in the first place", () => {
  it("8. no horizon's held template stamps a rung the account already carries", () => {
    const accountBuckets = new Set(accountSeedTriggers().map(triggerBucket));
    const thesis = {
      ticker: "X",
      direction: "LONG" as const,
      entryPrice: 100,
      targetPrice: 130,
      stopLoss: 92,
      catalystDate: new Date("2026-11-01"),
    };
    for (const horizon of ["COMPOUNDER", "TARGET", "TRADE", "CATALYST"] as const) {
      const stamped = defaultTriggersForHorizon(horizon, thesis as never, "HELD");
      const clash = stamped.filter((s) => accountBuckets.has(triggerBucket(s)));
      // The review clock is the one shared bucket that is legitimately the
      // thesis's own — a CATALYST name reviews on its own schedule, not the
      // account's 7 days. Everything else is the account's to own.
      const notTheClock = clash.filter((c) => c.predicate.kind !== "REVIEW_CADENCE");
      expect({ horizon, stamped: notTheClock.map(triggerBucket) }).toEqual({
        horizon,
        stamped: [],
      });
    }
  });
});
