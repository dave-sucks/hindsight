/**
 * levels.event-count-on-watch.test.ts — an analyst's "N days before / after
 * the event" review reaches a WATCHED stock (DAV-290).
 *
 * Replay: $MIRM, Catalyst Event PM, production 2026-09-18. WATCHING with a
 * buy plan, event date 2026-09-26 (8 days out). The analyst's rules, applied
 * 2026-09-17, are "review 10 days before the event date" and "30 days
 * after". Nothing fired at any check that day: the gate that keeps a watch
 * off the inherited review CLOCK dropped every inherited day count, the
 * event-date ones included.
 */
import { resolveLadder } from "./levels";
import { evaluateTrigger } from "./evaluate";
import type { Trigger } from "./types";

/** MIRM's stored triggers, verbatim from production 2026-09-18. */
const MIRM_TRIGGERS = [
  {
    "id": "c2c6eab6-5da7-4cf4-9a6c-9b1ca483e715",
    "action": "ENTER",
    "source": "AGENT",
    "predicate": {
      "kind": "PRICE_ABOVE",
      "level": 97.5
    },
    "rationale": "Lower the buy trigger from $103 to $97.50. Above that level MIRM would reclaim the immediate breakdown area and the 200-day neighborhood, which is enough confirmation for a pre-PDUFA re-check without waiting for a full 50-day recovery.",
    "lastFiredAt": "2026-09-17T13:50:15.846Z",
    "cooldownDays": 1
  },
  {
    "id": "54de3863-1ac0-440f-9c2c-b2085792bbd4",
    "action": "REVIEW",
    "source": "AGENT",
    "predicate": {
      "kind": "PRICE_BELOW",
      "level": 82
    },
    "rationale": "Re-check the thesis if shares break below the invalidation area before PDUFA.",
    "cooldownDays": 1
  },
  {
    "id": "4c181583-3625-4c6a-9e06-72874d68a211",
    "action": "REVIEW",
    "source": "AGENT",
    "predicate": {
      "kind": "EARNINGS_BEAT"
    },
    "rationale": "A beat could strengthen confidence in runway and launch readiness, so reassess the thesis.",
    "cooldownDays": 7
  },
  {
    "id": "f77f888d-72d2-40f5-ac44-d969b6e690ad",
    "action": "REVIEW",
    "source": "AGENT",
    "predicate": {
      "kind": "EARNINGS_MISS",
      "minSurprisePct": 3
    },
    "rationale": "A miss of at least 3% could weaken the runway or operating backdrop and needs review.",
    "cooldownDays": 7
  },
  {
    "id": "9ddaf188-66ae-4ad4-b2c1-ffbd78f5cac2",
    "action": "EXIT",
    "source": "DEFAULT",
    "predicate": {
      "kind": "PRICE_BELOW",
      "level": 88
    },
    "rationale": "Floor \u2014 sell if the price drops to $88.00, under the 60-day low ($88.98). Below this the plan is wrong.",
    "cooldownDays": 1
  },
  {
    "id": "7ef86cfe-53bb-47c5-9566-7888a46fdb09",
    "action": "REVIEW",
    "source": "DEFAULT",
    "predicate": {
      "kind": "PRICE_ABOVE",
      "level": 137
    },
    "rationale": "Target $137.00 \u2014 decide here: take it, trim it, or raise the target.",
    "cooldownDays": 1
  },
  {
    "id": "97a63135-51da-4f1f-9974-9cb81f10daa5",
    "action": "REVIEW",
    "source": "AGENT",
    "predicate": {
      "days": 3,
      "kind": "REVIEW_CADENCE"
    },
    "rationale": "Compressing cadence to every 3 days given only 15 days remain to the September 26 PDUFA \u2014 weekly is too slow for the final window.",
    "lastFiredAt": "2026-09-01T13:30:35.840Z",
    "cooldownDays": 7
  }
] as unknown as Trigger[];

/** The Catalyst Event PM's rules as they stand in production. */
const CATALYST_RULES: Trigger[] = [
  { id: "859afdef-8a57-4a03-8098-6af366dc238c", action: "REVIEW", predicate: { kind: "REVIEW_CADENCE", days: 10, from: "EVENT", side: "BEFORE" }, rationale: "10 days before the event date on the thesis.", cooldownDays: 10, source: "PRINCIPAL" },
  { id: "18d100c3-6e90-4f23-a876-94c0196a9eaa", action: "REVIEW", predicate: { kind: "REVIEW_CADENCE", days: 30, from: "EVENT", side: "AFTER" }, rationale: "30 days after the event date on the thesis.", cooldownDays: 30, source: "PRINCIPAL" },
];
/** The account's review clock — the rule the gate exists for. */
const ACCOUNT_CLOCK: Trigger[] = [
  { id: "b459cc93", action: "REVIEW", predicate: { kind: "REVIEW_CADENCE", days: 7 }, rationale: "Look at this every 7 days.", cooldownDays: 7 },
];

const resolved = () =>
  resolveLadder({ thesis: MIRM_TRIGGERS, analyst: CATALYST_RULES, account: ACCOUNT_CLOCK, state: "WATCHING", direction: "LONG" });

describe("MIRM 2026-09-18 — a watched stock 8 days from its event", () => {
  it("carries the analyst's '10 days before the event' review", () => {
    const before = resolved().find((t) => t.id === "859afdef-8a57-4a03-8098-6af366dc238c");
    expect(before).toBeDefined();
    expect(before?.level).toBe("ANALYST");
  });

  it("and the evaluator fires it: 09-26 is inside 10 days of 09-18", () => {
    const before = resolved().find((t) => t.id === "859afdef-8a57-4a03-8098-6af366dc238c")!;
    const fired = evaluateTrigger(before.predicate, {
      now: new Date("2026-09-18T14:00:00Z"),
      thesis: { createdAt: new Date("2026-08-01T00:00:00Z"), lastReviewedAt: new Date("2026-09-17T17:50:42.529Z"), catalystDate: new Date("2026-09-26T04:00:00.000Z") },
    } as never);
    expect(fired).toBe(true);
  });

  it("still does not inherit the account's review clock — a watch is on a clock only when it has its own", () => {
    expect(resolved().some((t) => t.id === "b459cc93")).toBe(false);
  });

  it("the '30 days after' rule rides along and is simply false until then", () => {
    const after = resolved().find((t) => t.id === "18d100c3-6e90-4f23-a876-94c0196a9eaa")!;
    expect(after).toBeDefined();
    expect(
      evaluateTrigger(after.predicate, {
        now: new Date("2026-09-18T14:00:00Z"),
        thesis: { createdAt: new Date("2026-08-01T00:00:00Z"), catalystDate: new Date("2026-09-26T04:00:00.000Z") },
      } as never),
    ).toBe(false);
  });
});
