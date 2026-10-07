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

import { shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import {
  frozenCopies,
  sharedRationalesAcross,
  triggerValue,
} from "@/lib/agent/triggers/frozen-copy";
import { defaultTriggersForHorizon } from "@/lib/agent/triggers/defaults";
import { accountSeedTriggers } from "@/lib/agent/triggers/seed-account";
import { triggerSlot } from "@/lib/agent/triggers/condition/slot";
import type { Trigger } from "@/lib/agent/triggers/types";

const t = (over: Partial<Trigger> & { predicate: Trigger["predicate"]; action: Trigger["action"] }) =>
  ({ id: Math.random().toString(36).slice(2), rationale: "", cooldownDays: 1, ...over }) as Trigger;

// ── The rules above, verbatim from the live account ────────────────────
const COMPOUNDER: Trigger[] = [
  t({ predicate: { watch: "move", is: "above", value: 15, variable: "entry" }, action: "REVIEW", source: "PRINCIPAL" }),
  t({ predicate: { watch: "move", is: "below", value: 15, variable: "entry" }, action: "REVIEW", source: "PRINCIPAL" }),
  t({ predicate: { watch: "move", is: "below", value: 7, variable: "prev_close" }, action: "ADD", source: "PRINCIPAL" }),
  t({ predicate: { watch: "move", is: "below", value: 15, variable: "peak" }, action: "REVIEW" }),
  t({ predicate: { watch: "move", is: "below", value: 25, variable: "peak" }, action: "EXIT" }),
  t({ predicate: { watch: "price", is: "below", variable: "sma200" }, action: "REVIEW", source: "PRINCIPAL" }),
];
const PEAD: Trigger[] = [
  t({ predicate: { watch: "move", is: "below", value: 12, variable: "entry" }, action: "REVIEW", source: "PRINCIPAL" }),
  t({ predicate: { watch: "move", is: "above", value: 10, variable: "entry" }, action: "REVIEW", source: "PRINCIPAL" }),
  t({ predicate: { watch: "move", is: "below", value: 12, variable: "peak" }, action: "EXIT", source: "PRINCIPAL" }),
];
const ACCOUNT: Trigger[] = [
  t({ predicate: { watch: "surprise", is: "beat", value: 0 }, action: "REVIEW", source: "DEFAULT" }),
  t({ predicate: { watch: "surprise", is: "miss", value: 0 }, action: "REVIEW", source: "DEFAULT" }),
  t({ predicate: { watch: "move", is: "above", value: 7, variable: "prev_close" }, action: "ADD", source: "DEFAULT" }),
  t({ predicate: { watch: "repeat", value: 7 }, action: "REVIEW", source: "DEFAULT" }),
  t({ predicate: { watch: "filing", variable: "tier:MATERIAL" }, action: "REVIEW", source: "DEFAULT" }),
];

// ── The template's sentences, which sit on four stocks apiece ──────────
const ADD_UP = "Up 7% in a day — strength on a held name. Evaluate pressing the winner.";
const ADD_DOWN = "Down 7% in a day — evaluate a pullback-add ONLY if the drop is market-wide.";
const GAIN_UP = "Up 10% from entry — gain milestone checkpoint. Re-underwrite at the new price.";
const GAIN_DOWN = "Down 12% from entry — loser attention. Decide hold-vs-cut deliberately.";

const ABT: Trigger[] = [
  // The six copies.
  t({ predicate: { watch: "move", is: "above", value: 7, variable: "prev_close" }, action: "ADD", rationale: ADD_UP, source: "DEFAULT" }),
  t({ predicate: { watch: "move", is: "below", value: 7, variable: "prev_close" }, action: "ADD", rationale: ADD_DOWN, source: "DEFAULT" }),
  t({ predicate: { watch: "move", is: "above", value: 10, variable: "entry" }, action: "REVIEW", rationale: GAIN_UP, source: "DEFAULT" }),
  t({ predicate: { watch: "move", is: "below", value: 12, variable: "entry" }, action: "REVIEW", rationale: GAIN_DOWN, source: "DEFAULT" }),
  t({ predicate: { watch: "move", is: "below", value: 25, variable: "peak" }, action: "EXIT", rationale: "Gave back 25% from the high — the catastrophe line for a multi-year hold.", source: "DEFAULT" }),
  t({ predicate: { watch: "move", is: "below", value: 15, variable: "peak" }, action: "REVIEW", rationale: "Gave back 15% from the high. This is a question, not a sale.", source: "DEFAULT" }),
  // …and the seven that are ABT's own.
  t({ id: "abt_floor", predicate: { watch: "price", is: "below", value: 96 }, action: "EXIT", source: "AGENT" }),
  t({ id: "abt_target", predicate: { watch: "price", is: "above", value: 135 }, action: "REVIEW", source: "AGENT" }),
  t({ id: "abt_reviewline", predicate: { watch: "price", is: "below", value: 95.09 }, action: "REVIEW", source: "DEFAULT" }),
  t({ id: "abt_clock10", predicate: { watch: "repeat", value: 10 }, action: "REVIEW", source: "DEFAULT" }),
  t({ id: "abt_clock30", predicate: { watch: "repeat", value: 30 }, action: "REVIEW", source: "AGENT" }),
  t({ id: "abt_beat", predicate: { watch: "surprise", is: "beat", value: 0 }, action: "REVIEW", rationale: "Re-check the thesis if Abbott beats earnings by at least 1%.", source: "AGENT" }),
  t({ id: "abt_miss", predicate: { watch: "surprise", is: "miss", value: 3 }, action: "REVIEW", rationale: "Re-check the thesis on a meaningful miss.", source: "AGENT" }),
];

const NVDA: Trigger[] = [
  t({ predicate: { watch: "move", is: "above", value: 7, variable: "prev_close" }, action: "ADD", rationale: ADD_UP, source: "DEFAULT" }),
  // The one with money attached: nothing above it governs. The account's
  // was removed on 09-18 and the copy stayed; the PEAD seat has no add.
  t({ id: "nvda_add_down", predicate: { watch: "move", is: "below", value: 7, variable: "prev_close" }, action: "ADD", rationale: ADD_DOWN, source: "DEFAULT" }),
  t({ predicate: { watch: "move", is: "below", value: 12, variable: "entry" }, action: "REVIEW", rationale: GAIN_DOWN, source: "DEFAULT" }),
  // Written for NVDA. Same bucket as the account's, and it stays.
  t({ id: "nvda_beat", predicate: { watch: "surprise", is: "beat", value: 0 }, action: "REVIEW", rationale: "Beat — possibly a reason to extend the target.", source: "DEFAULT" }),
  t({ id: "nvda_trim", predicate: { watch: "move", is: "above", value: 16.6, variable: "entry" }, action: "TRIM", rationale: "The 2R partial.", source: "DEFAULT" }),
];

const BMRN: Trigger[] = [
  t({
    id: "bmrn_miss",
    predicate: { watch: "surprise", is: "miss", value: 0 },
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
  { ticker: "ASML", triggers: [t({ predicate: { watch: "move", is: "above", value: 7, variable: "prev_close" }, action: "ADD", rationale: ADD_UP }), t({ predicate: { watch: "move", is: "above", value: 10, variable: "entry" }, action: "REVIEW", rationale: GAIN_UP })] },
  { ticker: "WST", triggers: [t({ predicate: { watch: "move", is: "below", value: 7, variable: "prev_close" }, action: "ADD", rationale: ADD_DOWN }), t({ predicate: { watch: "move", is: "below", value: 12, variable: "entry" }, action: "REVIEW", rationale: GAIN_DOWN })] },
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
    const trail = copies.find((c) => c.bucket === triggerSlot({ predicate: { watch: "move", is: "below", value: 25, variable: "peak" }, action: "EXIT" }));
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
      t({ id: "own_trail", predicate: { watch: "move", is: "below", value: 8, variable: "peak" }, action: "EXIT", rationale: "Tighter than the seat because this one gaps.", source: "AGENT" }),
    ];
    expect(frozenCopies({ own, analyst: COMPOUNDER, account: ACCOUNT, sharedRationales: shared })).toHaveLength(0);
  });

  it("7. triggerValue reads the number a rung is set at", () => {
    expect(triggerValue({ predicate: { watch: "move", is: "below", value: 25, variable: "peak" } })).toBe(25);
    expect(triggerValue({ predicate: { watch: "price", is: "below", value: 96 } })).toBe(96);
    expect(triggerValue({ predicate: { watch: "surprise", is: "beat", value: 0 } })).toBeNull();
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
    const accountBuckets = new Set(accountSeedTriggers().map(triggerSlot));
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
      const clash = stamped.filter((s) => accountBuckets.has(triggerSlot(s)));
      // The review clock is the one shared bucket that is legitimately the
      // thesis's own — a CATALYST name reviews on its own schedule, not the
      // account's 7 days. Everything else is the account's to own.
      const notTheClock = clash.filter((c) => shapeName(c.predicate) !== "repeat");
      expect({ horizon, stamped: notTheClock.map(triggerSlot) }).toEqual({
        horizon,
        stamped: [],
      });
    }
  });
});
