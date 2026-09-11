/**
 * The DAV-250 migration against the book as it stood on 2026-09-11: the
 * account's legacy every-horizon rules, SRRK inheriting the 8% sell,
 * ASML/CEG/WST carrying their own 8% sell, ABT already on 15%/25%.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { planHorizonRules, type HeldThesisRow } from "./horizon-rules-migration";
import type { Trigger } from "./types";

let n = 0;
const mintId = () => `new-${++n}`;
const r = (id: string, predicate: Trigger["predicate"], action: Trigger["action"]): Trigger => ({
  id,
  predicate,
  action,
  rationale: id,
});

const LEGACY_ACCOUNT: Trigger[] = [
  r("up7", { kind: "PRICE_MOVE_PCT", pct: 7, direction: "UP", window: "1D" }, "ADD"),
  r("dn7", { kind: "PRICE_MOVE_PCT", pct: 7, direction: "DOWN", window: "1D" }, "ADD"),
  r("g10", { kind: "GAIN_FROM_ENTRY", pct: 10, direction: "UP" }, "REVIEW"),
  r("t8", { kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT"),
  r("l12", { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" }, "REVIEW"),
  r("cad", { kind: "REVIEW_CADENCE", days: 7 }, "REVIEW"),
  r("ew", { kind: "EARNINGS_WITHIN", days: 3 }, "REVIEW"),
];

const COMPOUNDER_SEAT: Trigger[] = [
  r("seat15", { kind: "TRAILING_FROM_HIGH", pct: 15 }, "REVIEW"),
  r("seat25", { kind: "TRAILING_FROM_HIGH", pct: 25 }, "EXIT"),
];

const own8 = (ticker: string) => r(`${ticker}-t8`, { kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT");

const HELD: HeldThesisRow[] = [
  { id: "srrk", ticker: "SRRK", horizon: "CATALYST", direction: "LONG", triggers: [], analystRules: [] },
  { id: "smmt", ticker: "SMMT", horizon: "CATALYST", direction: "LONG", triggers: [own8("SMMT")], analystRules: [] },
  ...["ASML", "CEG", "WST"].map((t) => ({
    id: t.toLowerCase(),
    ticker: t,
    horizon: "COMPOUNDER",
    direction: "LONG",
    triggers: [own8(t)],
    analystRules: COMPOUNDER_SEAT,
  })),
  {
    id: "abt",
    ticker: "ABT",
    horizon: "COMPOUNDER",
    direction: "LONG",
    triggers: [r("abt25", { kind: "TRAILING_FROM_HIGH", pct: 25 }, "EXIT")],
    analystRules: COMPOUNDER_SEAT,
  },
  { id: "nvda", ticker: "NVDA", horizon: "TARGET", direction: "LONG", triggers: [own8("NVDA")], analystRules: [] },
];

const plan = planHorizonRules({ account: LEGACY_ACCOUNT, held: HELD, loosen: ["ASML", "CEG", "WST"], mintId });

describe("planHorizonRules — the account", () => {
  it("replaces the four legacy buckets and keeps everything else", () => {
    expect(plan.account!.removed.map((t) => t.id).sort()).toEqual(["dn7", "g10", "l12", "t8"]);
    const ids = plan.account!.next.map((t) => t.id);
    for (const kept of ["up7", "cad", "ew"]) expect(ids).toContain(kept);
  });

  it("does not add a second every-horizon +7% add", () => {
    const ups = plan.account!.next.filter(
      (t) => t.predicate.kind === "PRICE_MOVE_PCT" && t.predicate.direction === "UP" && t.action === "ADD",
    );
    expect(ups.map((t) => t.id)).toEqual(["up7"]);
  });

  it("leaves no every-horizon sell rule behind", () => {
    expect(plan.account!.next.filter((t) => t.action === "EXIT" && !t.horizons?.length)).toEqual([]);
  });

  it("is a no-op on an account already on horizon rules", () => {
    const again = planHorizonRules({ account: plan.account!.next, held: [], loosen: [], mintId });
    expect(again.account).toBeNull();
  });
});

describe("planHorizonRules — the holdings", () => {
  const change = (id: string) => plan.theses.find((c) => c.thesisId === id);

  it("SRRK keeps the 8% sell it inherited today — pinned onto the thesis", () => {
    const srrk = change("srrk")!;
    expect(srrk.pinned.map((t) => [t.predicate, t.action])).toEqual([
      [{ kind: "TRAILING_FROM_HIGH", pct: 8 }, "EXIT"],
    ]);
    expect(srrk.loosened).toEqual([]);
  });

  it("stocks carrying their own sell line are untouched", () => {
    expect(change("smmt")).toBeUndefined();
    expect(change("nvda")).toBeUndefined();
    expect(change("abt")).toBeUndefined();
  });

  it("ASML, CEG and WST lose their own 8% sell, so the compounder's 25% governs", () => {
    for (const id of ["asml", "ceg", "wst"]) {
      const c = change(id)!;
      expect(c.loosened.map((t) => t.id)).toEqual([`${id.toUpperCase()}-t8`]);
      expect(c.pinned).toEqual([]);
      expect(c.nextTriggers.some((t) => t.predicate.kind === "TRAILING_FROM_HIGH")).toBe(false);
    }
  });

  it("re-running changes nothing", () => {
    const heldAfter = HELD.map((h) => {
      const c = plan.theses.find((x) => x.thesisId === h.id);
      return c ? { ...h, triggers: c.nextTriggers } : h;
    });
    const again = planHorizonRules({
      account: plan.account!.next,
      held: heldAfter,
      loosen: ["ASML", "CEG", "WST"],
      mintId,
    });
    expect(again.account).toBeNull();
    expect(again.theses).toEqual([]);
  });

  it("refuses to loosen a named stock that isn't a compounder", () => {
    const p = planHorizonRules({ account: LEGACY_ACCOUNT, held: HELD, loosen: ["NVDA", "ZZZ"], mintId });
    expect(p.theses.find((c) => c.thesisId === "nvda")).toBeUndefined();
    expect(p.warnings).toEqual([
      "NVDA: horizon is TARGET, not COMPOUNDER — left as it is.",
      "ZZZ: not held — nothing to loosen.",
    ]);
  });
});
