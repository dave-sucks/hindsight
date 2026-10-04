/**
 * ops.replace.test.ts — the trigger dialog's Save on a trigger that exists.
 *
 * One op swaps the condition, action and fire mode. The history belongs to
 * the condition: kept in the same slot (a new value for the same rule),
 * dropped in another (a different rule, new id). docs/plans/TRIGGER_TYPES.md.
 */

import { applyTriggerOps } from "./ops";
import type { Trigger } from "./types";

let seq = 0;
const mintId = () => `new-${++seq}`;

const trail: Trigger = {
  id: "trail",
  predicate: { kind: "TRAILING_FROM_HIGH", pct: 25 },
  action: "EXIT",
  rationale: "Give back 25% from the high and the run is over.",
  lastFiredAt: "2026-09-28T15:20:00.000Z",
  cooldownDays: 1,
  source: "AGENT",
};
const floor: Trigger = {
  id: "floor",
  predicate: { kind: "PRICE_BELOW", level: 248 },
  action: "EXIT",
  rationale: "Floor — sell if the price drops to $248.00.",
  source: "PRINCIPAL",
};
const review: Trigger = {
  id: "review",
  predicate: { kind: "VS_SMA", period: 200, direction: "BELOW" },
  action: "REVIEW",
  rationale: "Below the 200-day — review the business.",
  source: "DEFAULT",
};

const run = (op: { id: string; trigger: Trigger }, opts: { actor?: "AGENT" | "PRINCIPAL"; stored?: Trigger[] } = {}) =>
  applyTriggerOps({
    stored: opts.stored ?? [trail, floor, review],
    ops: [{ op: "replace", ...op }],
    direction: "LONG",
    status: "HOLDING",
    actor: opts.actor ?? "PRINCIPAL",
    mintId,
  });

const built = (t: Partial<Trigger> & Pick<Trigger, "predicate" | "action">): Trigger => ({
  id: "from-the-dialog",
  rationale: "A trigger set by hand.",
  source: "PRINCIPAL",
  ...t,
});

beforeEach(() => {
  seq = 0;
});

describe("replace — same slot", () => {
  it("keeps the id, the fire history and the cooldown, and moves the number in the sentence", () => {
    const out = run({ id: "trail", trigger: built({ predicate: { kind: "TRAILING_FROM_HIGH", pct: 20 }, action: "EXIT" }) });
    expect(out.results).toEqual([expect.objectContaining({ ok: true, id: "trail" })]);
    const t = out.triggers.find((x) => x.id === "trail")!;
    expect(t.predicate).toEqual({ kind: "TRAILING_FROM_HIGH", pct: 20 });
    expect(t.lastFiredAt).toBe(trail.lastFiredAt);
    expect(t.cooldownDays).toBe(1);
    expect(t.rationale).toBe("Give back 20% from the high and the run is over.");
    expect(t.source).toBe("PRINCIPAL");
  });

  it("refuses a save that changes nothing", () => {
    const out = run({ id: "review", trigger: built({ predicate: review.predicate, action: "REVIEW" }) });
    expect(out.results[0]).toEqual(expect.objectContaining({ ok: false, reason: expect.stringMatching(/Nothing to change/) }));
  });
});

describe("replace — another slot", () => {
  it("is a new rule: a new id and no fire history", () => {
    const out = run({
      id: "trail",
      trigger: built({ predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" }, action: "EXIT" }),
    });
    expect(out.results).toEqual([expect.objectContaining({ ok: true, id: "new-1" })]);
    expect(out.triggers.some((x) => x.id === "trail")).toBe(false);
    const t = out.triggers.find((x) => x.id === "new-1")!;
    expect(t.predicate).toEqual({ kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" });
    expect(t.lastFiredAt).toBeUndefined();
  });

  it("refuses to land on a slot another trigger already holds", () => {
    const out = run({ id: "review", trigger: built({ predicate: { kind: "PRICE_BELOW", level: 240 }, action: "EXIT" }) });
    expect(out.results[0]).toEqual(expect.objectContaining({ ok: false, reason: expect.stringMatching(/already has/) }));
    expect(out.triggers).toEqual([trail, floor, review]);
  });

  it("still runs the ratchet for an agent: swapping a stop for a looser one is refused", () => {
    const out = run(
      { id: "floor", trigger: built({ predicate: { kind: "PRICE_BELOW", level: 220 }, action: "EXIT" }) },
      { actor: "AGENT" },
    );
    expect(out.results[0]).toEqual(expect.objectContaining({ ok: false }));
  });
});
