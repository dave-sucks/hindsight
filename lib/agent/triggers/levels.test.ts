jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  resolveLadder,
  LEVEL_PRECEDENCE,
  splitFiresByLevel,
} from "./levels";
import { horizonStandingRules } from "./defaults";
import { resolveThesisLadder, rulesForHorizon } from "./load-levels";
import { triggerBucket } from "./bucket";
import type { Trigger } from "./types";

/** Minimal rung builder — only the fields the resolver reads. */
function rung(over: Partial<Trigger> & Pick<Trigger, "predicate" | "action">): Trigger {
  return {
    id: over.id ?? `id-${Math.random().toString(36).slice(2)}`,
    rationale: over.rationale ?? "because",
    ...over,
  } as Trigger;
}

const trail = (pct: number, id?: string) =>
  rung({ id, predicate: { kind: "TRAILING_FROM_HIGH", pct }, action: "EXIT" });

const gainReview = (pct: number, id?: string) =>
  rung({
    id,
    predicate: { kind: "GAIN_FROM_ENTRY", pct, direction: "UP" },
    action: "REVIEW",
  });

describe("resolveLadder — precedence", () => {
  it("thesis beats analyst beats account beats default in the same bucket", () => {
    const resolved = resolveLadder({
      thesis: [trail(5)],
      analyst: [trail(6)],
      account: [trail(7)],
      defaults: [trail(8)],
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0].level).toBe("THESIS");
    expect((resolved[0].predicate as { pct: number }).pct).toBe(5);
  });

  it("falls through one level at a time as each is removed", () => {
    const levels = [
      { input: { thesis: [trail(5)], analyst: [trail(6)], account: [trail(7)], defaults: [trail(8)] }, level: "THESIS", pct: 5 },
      { input: { thesis: [], analyst: [trail(6)], account: [trail(7)], defaults: [trail(8)] }, level: "ANALYST", pct: 6 },
      { input: { thesis: [], analyst: [], account: [trail(7)], defaults: [trail(8)] }, level: "ACCOUNT", pct: 7 },
      { input: { thesis: [], analyst: [], account: [], defaults: [trail(8)] }, level: "DEFAULT", pct: 8 },
    ];

    for (const { input, level, pct } of levels) {
      const [only] = resolveLadder(input);
      expect(only.level).toBe(level);
      expect((only.predicate as { pct: number }).pct).toBe(pct);
    }
  });

  it("deleting the thesis rung reveals the inherited rung underneath (the only 'revert')", () => {
    const withOverride = resolveLadder({ thesis: [trail(5)], account: [trail(7)] });
    expect(withOverride[0].level).toBe("THESIS");
    expect(withOverride[0].inherited).toBe(false);

    const afterDelete = resolveLadder({ thesis: [], account: [trail(7)] });
    expect(afterDelete[0].level).toBe("ACCOUNT");
    expect(afterDelete[0].inherited).toBe(true);
    expect((afterDelete[0].predicate as { pct: number }).pct).toBe(7);
  });

  it("different buckets coexist — an override does not suppress unrelated rungs", () => {
    const resolved = resolveLadder({
      thesis: [trail(5)],
      account: [trail(7), gainReview(10)],
    });

    expect(resolved).toHaveLength(2);
    expect(resolved.find((t) => t.action === "EXIT")!.level).toBe("THESIS");
    expect(resolved.find((t) => t.action === "REVIEW")!.level).toBe("ACCOUNT");
  });

  it("distinguishes GAIN_FROM_ENTRY UP from DOWN (they are separate buckets)", () => {
    const up = gainReview(10);
    const down = rung({
      predicate: { kind: "GAIN_FROM_ENTRY", pct: 12, direction: "DOWN" },
      action: "REVIEW",
    });
    const resolved = resolveLadder({ thesis: [up], defaults: [down] });

    expect(resolved).toHaveLength(2);
    expect(triggerBucket(up)).not.toBe(triggerBucket(down));
  });

  it("dedupes within a single level, keeping the first", () => {
    const resolved = resolveLadder({ thesis: [trail(5), trail(9)] });
    expect(resolved).toHaveLength(1);
    expect((resolved[0].predicate as { pct: number }).pct).toBe(5);
  });

  it("returns most-specific level first", () => {
    const resolved = resolveLadder({
      thesis: [trail(5)],
      account: [gainReview(10)],
    });
    expect(resolved.map((t) => t.level)).toEqual(["THESIS", "ACCOUNT"]);
  });

  it("LEVEL_PRECEDENCE is the documented order", () => {
    expect([...LEVEL_PRECEDENCE]).toEqual([
      "THESIS",
      "ANALYST",
      "ACCOUNT",
      "DEFAULT",
    ]);
  });
});

describe("resolveLadder — fire state", () => {
  it("overlays per-thesis fire state onto inherited rungs", () => {
    const fired = "2026-08-01T14:30:00.000Z";
    const [only] = resolveLadder({
      thesis: [],
      account: [trail(7, "acct-trail")],
      triggerState: { "acct-trail": fired },
    });

    expect(only.level).toBe("ACCOUNT");
    expect(only.lastFiredAt).toBe(fired);
  });

  it("leaves thesis-level fire state inline and ignores the map for it", () => {
    const inline = "2026-07-29T11:50:00.000Z";
    const [only] = resolveLadder({
      thesis: [{ ...trail(5, "thesis-trail"), lastFiredAt: inline }],
      triggerState: { "thesis-trail": "2026-01-01T00:00:00.000Z" },
    });

    expect(only.level).toBe("THESIS");
    expect(only.lastFiredAt).toBe(inline);
  });

  it("an inherited rung with no fire-state entry has never fired", () => {
    const [only] = resolveLadder({
      thesis: [],
      account: [trail(7, "acct-trail")],
      triggerState: {},
    });
    expect(only.lastFiredAt).toBeUndefined();
  });

  it("normalizes a null fire-state entry to undefined", () => {
    const [only] = resolveLadder({
      thesis: [],
      account: [trail(7, "acct-trail")],
      triggerState: { "acct-trail": null },
    });
    expect(only.lastFiredAt).toBeUndefined();
  });

  it("does not carry a shared rung's inline lastFiredAt across theses", () => {
    // The trap this guards: an analyst rung is ONE row shared by every
    // thesis under that analyst. If the resolver read its inline
    // lastFiredAt, one thesis firing would put every other thesis's copy
    // into cooldown.
    const shared = { ...trail(6, "analyst-trail"), lastFiredAt: "2026-08-01T00:00:00.000Z" };
    const [only] = resolveLadder({ thesis: [], analyst: [shared], triggerState: {} });
    expect(only.lastFiredAt).toBeUndefined();
  });
});

describe("resolveLadder — purity", () => {
  it("never mutates its inputs", () => {
    const thesis = [trail(5, "t1")];
    const account = [trail(7, "a1")];
    const snapshot = JSON.stringify({ thesis, account });

    resolveLadder({ thesis, account, triggerState: { a1: "2026-08-01T00:00:00.000Z" } });

    expect(JSON.stringify({ thesis, account })).toBe(snapshot);
  });

  it("handles a fully empty cascade", () => {
    expect(resolveLadder({ thesis: [] })).toEqual([]);
  });
});

describe("resolveLadder — viewLevel", () => {
  it("marks a level's OWN rungs as owned when viewed from that level", () => {
    // The bug this pins: /settings/triggers rendered the account's own
    // rules dashed + read-only, because `inherited` was hardcoded to
    // `level !== "THESIS"`. The page could not edit the thing it exists
    // to edit.
    const resolved = resolveLadder({
      thesis: [],
      account: [trail(6, "acct")],
      defaults: [gainReview(10, "def")],
      viewLevel: "ACCOUNT",
    });
    const own = resolved.find((t) => t.id === "acct")!;
    const def = resolved.find((t) => t.id === "def")!;
    expect(own.inherited).toBe(false);
    expect(def.inherited).toBe(true);
  });

  it("treats the account as inherited when viewed from the analyst", () => {
    const resolved = resolveLadder({
      thesis: [],
      analyst: [trail(5, "an")],
      account: [gainReview(15, "acct")],
      viewLevel: "ANALYST",
    });
    expect(resolved.find((t) => t.id === "an")!.inherited).toBe(false);
    expect(resolved.find((t) => t.id === "acct")!.inherited).toBe(true);
  });

  it("defaults to THESIS so the sheet is unchanged", () => {
    const resolved = resolveLadder({
      thesis: [trail(4, "own")],
      account: [gainReview(15, "acct")],
    });
    expect(resolved.find((t) => t.id === "own")!.inherited).toBe(false);
    expect(resolved.find((t) => t.id === "acct")!.inherited).toBe(true);
  });
});

describe("resolveLadder — override annotation", () => {
  it("tells a winning rung what it displaced", () => {
    const [only] = resolveLadder({
      thesis: [gainReview(20)],
      defaults: [gainReview(10)],
    });
    expect(only.level).toBe("THESIS");
    expect(only.overrides?.level).toBe("DEFAULT");
    expect((only.overrides?.predicate as { pct: number }).pct).toBe(10);
  });

  it("names the NEAREST level below, not the bottom of the chain", () => {
    const [only] = resolveLadder({
      thesis: [trail(4)],
      analyst: [trail(5)],
      account: [trail(6)],
      defaults: [trail(8)],
    });
    expect(only.overrides?.level).toBe("ANALYST");
    expect((only.overrides?.predicate as { pct: number }).pct).toBe(5);
  });

  it("leaves `overrides` absent when nothing was displaced", () => {
    const [only] = resolveLadder({ thesis: [trail(4)] });
    expect(only.overrides).toBeUndefined();
  });

  it("annotates an inherited winner too", () => {
    const [only] = resolveLadder({
      thesis: [],
      account: [trail(6)],
      defaults: [trail(8)],
    });
    expect(only.level).toBe("ACCOUNT");
    expect(only.inherited).toBe(true);
    expect(only.overrides?.level).toBe("DEFAULT");
  });
});

describe("account sell rules resolve per horizon (DAV-250)", () => {
  const account = horizonStandingRules();

  it("each horizon's set resolves without self-collision", () => {
    for (const h of ["CATALYST", "TARGET", "TRADE", "COMPOUNDER"] as const) {
      const mine = rulesForHorizon(account, h);
      expect(new Set(mine.map(triggerBucket)).size).toBe(mine.length);
      expect(resolveLadder({ thesis: [], account: mine })).toHaveLength(mine.length);
    }
  });

  it("a held compounder inherits the 25% sale, a held trade the 8% one", () => {
    const sources = { analyst: [], account };
    const sell = (horizon: string) =>
      resolveThesisLadder({ triggers: [], status: "HOLDING", horizon }, sources)
        .filter((t) => t.action === "EXIT" && t.predicate.kind === "TRAILING_FROM_HIGH")
        .map((t) => (t.predicate.kind === "TRAILING_FROM_HIGH" ? t.predicate.pct : null));
    expect(sell("COMPOUNDER")).toEqual([25]);
    expect(sell("TRADE")).toEqual([8]);
    expect(sell("CATALYST")).toEqual([]);
  });

  it("a thesis-level rule still beats its horizon's account rule", () => {
    const own = [
      { id: "own", predicate: { kind: "TRAILING_FROM_HIGH", pct: 8 }, action: "EXIT", rationale: "pinned" },
    ];
    const ladder = resolveThesisLadder(
      { triggers: own, status: "HOLDING", horizon: "COMPOUNDER" },
      { analyst: [], account },
    );
    const trail = ladder.filter((t) => t.action === "EXIT" && t.predicate.kind === "TRAILING_FROM_HIGH");
    expect(trail.map((t) => t.id)).toEqual(["own"]);
  });

  it("a watched name inherits none of them (position-scoped)", () => {
    const ladder = resolveThesisLadder(
      { triggers: [], status: "WATCHING", horizon: "TRADE" },
      { analyst: [], account },
    );
    expect(ladder.filter((t) => t.action === "EXIT" || t.action === "ADD")).toEqual([]);
  });
});

describe("splitFiresByLevel", () => {
  it("files thesis rungs inline and inherited rungs into triggerState", () => {
    const resolved = resolveLadder({
      thesis: [trail(4, "own")],
      account: [gainReview(15, "acct")],
      defaults: [gainReview(10, "def-masked")],
    });
    const split = splitFiresByLevel(resolved);
    expect(split.firedTriggerIds).toEqual(["own"]);
    expect(split.firedInheritedTriggerIds).toEqual(["acct"]);
  });

  it("handles an all-inherited and an all-owned batch", () => {
    const inheritedOnly = resolveLadder({ thesis: [], defaults: [trail(8, "d")] });
    expect(splitFiresByLevel(inheritedOnly).firedTriggerIds).toEqual([]);

    const ownedOnly = resolveLadder({ thesis: [trail(8, "t")] });
    expect(splitFiresByLevel(ownedOnly).firedInheritedTriggerIds).toEqual([]);
  });

  it("returns empty arrays for an empty batch", () => {
    expect(splitFiresByLevel([])).toEqual({
      firedTriggerIds: [],
      firedInheritedTriggerIds: [],
    });
  });
});

describe("resolveLadder — WATCHING cadence opt-in (W1, DAV-216)", () => {
  const cadence = (days: number, id?: string) =>
    rung({ id, predicate: { kind: "REVIEW_CADENCE", days }, action: "REVIEW" });

  it("drops inherited REVIEW_CADENCE on a WATCHING thesis (all levels)", () => {
    const resolved = resolveLadder({
      thesis: [],
      analyst: [cadence(1, "analyst-cadence")],
      account: [cadence(7, "account-cadence")],
      defaults: [cadence(14, "default-cadence")],
      state: "WATCHING",
    });
    expect(resolved.filter((t) => t.predicate.kind === "REVIEW_CADENCE")).toEqual([]);
  });

  it("keeps a thesis-level cadence on WATCHING — the opt-in survives, unannotated", () => {
    const resolved = resolveLadder({
      thesis: [cadence(30, "own-cadence")],
      account: [cadence(7, "account-cadence")],
      state: "WATCHING",
    });
    const kept = resolved.filter((t) => t.predicate.kind === "REVIEW_CADENCE");
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe("own-cadence");
    expect(kept[0].level).toBe("THESIS");
    // The account rung was gated out before the claim loop, so the opt-in
    // is not annotated as "overriding" a rule that doesn't apply here.
    expect(kept[0].overrides).toBeUndefined();
  });

  it("HELD keeps inheriting the account cadence — positions never drop off the clock", () => {
    const resolved = resolveLadder({
      thesis: [],
      account: [cadence(7, "account-cadence")],
      state: "HELD",
    });
    const kept = resolved.filter((t) => t.predicate.kind === "REVIEW_CADENCE");
    expect(kept).toHaveLength(1);
    expect(kept[0].level).toBe("ACCOUNT");
  });

  it("PROMOTED keeps inheriting — a decide-today must not go quiet", () => {
    const resolved = resolveLadder({
      thesis: [],
      account: [cadence(7, "account-cadence")],
      state: "PROMOTED",
    });
    expect(
      resolved.filter((t) => t.predicate.kind === "REVIEW_CADENCE"),
    ).toHaveLength(1);
  });

  it("state omitted (settings surfaces) renders account cadence normally", () => {
    const resolved = resolveLadder({
      thesis: [],
      account: [cadence(7, "account-cadence")],
      viewLevel: "ACCOUNT",
    });
    expect(
      resolved.filter((t) => t.predicate.kind === "REVIEW_CADENCE"),
    ).toHaveLength(1);
  });

});

describe("resolveLadder — position actions never reach an un-held thesis (2026-09-03)", () => {
  // The account's standing "±7% in a day — scale in" rules are PRICE_MOVE_PCT
  // with action ADD. The predicate gate let them onto WATCHING rows and the
  // 5-minute cron spawned tactical runs to add to positions that did not
  // exist (HPE, RARE, PLTR, NOW on 2026-09-03).
  const scaleIn = rung({
    id: "acct-scale-in",
    predicate: { kind: "PRICE_MOVE_PCT", pct: 7, direction: "UP", window: "1D" },
    action: "ADD",
  });
  const trim = rung({
    id: "acct-trim",
    predicate: { kind: "PRICE_ABOVE", level: 200 },
    action: "TRIM",
  });
  const floor = rung({
    id: "acct-floor",
    predicate: { kind: "PRICE_BELOW", level: 100 },
    action: "EXIT",
  });

  it("drops ADD / TRIM / MOVE_STOP on WATCHING and PROMOTED at every level", () => {
    for (const state of ["WATCHING", "PROMOTED"] as const) {
      const ids = resolveLadder({
        thesis: [trim],
        account: [scaleIn, floor],
        state,
      }).map((t) => t.id);
      expect(ids).not.toContain("acct-scale-in");
      expect(ids).not.toContain("acct-trim");
      // A floor stays: on an un-held thesis it resolves to DEMOTE, a verdict.
      expect(ids).toContain("acct-floor");
    }
  });

  it("keeps them on HELD — scaling in is what a held ladder is for", () => {
    const ids = resolveLadder({
      thesis: [trim],
      account: [scaleIn, floor],
      state: "HELD",
    }).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["acct-scale-in", "acct-trim", "acct-floor"]));
  });

  it("no state (settings pages) renders everything", () => {
    expect(resolveLadder({ thesis: [], account: [scaleIn, trim, floor] })).toHaveLength(3);
  });
});
