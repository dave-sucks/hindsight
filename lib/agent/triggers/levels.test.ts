import {
  resolveLadder,
  LEVEL_PRECEDENCE,
  dropRedundantInherited,
} from "./levels";
import { inheritableDefaultLadder, DEFAULT_LADDER_IDS } from "./defaults";
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

describe("dropRedundantInherited — the anti-drift guard", () => {
  it("drops a rung that merely restates what is inherited", () => {
    const kept = dropRedundantInherited([trail(8, "resent")], [trail(8, "inherited")]);
    expect(kept).toEqual([]);
  });

  it("keeps a rung whose VALUE differs — that is a real override", () => {
    const kept = dropRedundantInherited([trail(5, "own")], [trail(8, "inherited")]);
    expect(kept.map((t) => t.id)).toEqual(["own"]);
  });

  it("keeps a rung whose fire mode differs", () => {
    const incoming = { ...trail(8, "own"), fireMode: "DIRECT" as const };
    const inherited = { ...trail(8, "inh"), fireMode: "TACTICAL" as const };
    expect(dropRedundantInherited([incoming], [inherited]).map((t) => t.id)).toEqual([
      "own",
    ]);
  });

  it("treats absent fireMode as TACTICAL rather than as a difference", () => {
    const incoming = trail(8, "own"); // no fireMode
    const inherited = { ...trail(8, "inh"), fireMode: "TACTICAL" as const };
    expect(dropRedundantInherited([incoming], [inherited])).toEqual([]);
  });

  it("ignores rationale differences — rewording is not overriding", () => {
    const incoming = { ...trail(8, "own"), rationale: "reworded by the agent" };
    expect(dropRedundantInherited([incoming], [trail(8, "inh")])).toEqual([]);
  });

  it("keeps rungs in buckets nothing is inherited for", () => {
    const kept = dropRedundantInherited(
      [trail(8, "redundant"), gainReview(25, "novel")],
      [trail(8, "inherited")],
    );
    expect(kept.map((t) => t.id)).toEqual(["novel"]);
  });

  it("is a no-op when nothing is inherited", () => {
    const incoming = [trail(8, "a"), gainReview(10, "b")];
    expect(dropRedundantInherited(incoming, [])).toBe(incoming);
  });

  it("survives a full resend of the resolved ladder without collapsing the cascade", () => {
    // The exact drift scenario: the agent reads the resolved ladder and
    // faithfully resends every rung. Only its own overrides should persist.
    const own = trail(4, "own-trail");
    const resolved = resolveLadder({
      thesis: [own],
      account: [gainReview(15, "acct-gain")],
      defaults: [trail(8, "def-trail"), gainReview(10, "def-gain")],
    });

    const stored = dropRedundantInherited(
      resolved.map((t) => ({ ...t })),
      resolved.filter((t) => t.inherited),
    );

    expect(stored.map((t) => t.id)).toEqual(["own-trail"]);
  });
});

describe("inheritableDefaultLadder", () => {
  it("uses stable ids across calls (fire state keys off them)", () => {
    const a = inheritableDefaultLadder("TARGET");
    const b = inheritableDefaultLadder("TARGET");
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(a.map((t) => t.id)).toContain(DEFAULT_LADDER_IDS.trailRatchet);
  });

  it("stamps every rung source=DEFAULT", () => {
    for (const t of inheritableDefaultLadder("COMPOUNDER")) {
      expect(t.source).toBe("DEFAULT");
    }
  });

  it("carries the three standing protection rungs on every held horizon", () => {
    for (const horizon of ["CATALYST", "TARGET", "TRADE", "COMPOUNDER"] as const) {
      const ids = inheritableDefaultLadder(horizon).map((t) => t.id);
      expect(ids).toContain(DEFAULT_LADDER_IDS.gainCheckpoint);
      expect(ids).toContain(DEFAULT_LADDER_IDS.trailRatchet);
      expect(ids).toContain(DEFAULT_LADDER_IDS.loserAttention);
    }
  });

  it("omits the pullback-add on TRADE only", () => {
    expect(inheritableDefaultLadder("TRADE").map((t) => t.id)).not.toContain(
      DEFAULT_LADDER_IDS.scaleInPullback,
    );
    expect(inheritableDefaultLadder("TARGET").map((t) => t.id)).toContain(
      DEFAULT_LADDER_IDS.scaleInPullback,
    );
  });

  it("is empty for WATCHING and PROMOTED (position-scoped predicates)", () => {
    expect(inheritableDefaultLadder("TARGET", "WATCHING")).toEqual([]);
    expect(inheritableDefaultLadder("TARGET", "PROMOTED")).toEqual([]);
  });

  it("emits one rung per bucket, so it resolves without self-collision", () => {
    const ladder = inheritableDefaultLadder("TARGET");
    const buckets = ladder.map(triggerBucket);
    expect(new Set(buckets).size).toBe(ladder.length);
    expect(resolveLadder({ thesis: [], defaults: ladder })).toHaveLength(
      ladder.length,
    );
  });
});
