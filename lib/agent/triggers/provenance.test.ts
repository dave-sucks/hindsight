/**
 * provenance.test.ts — pins the trigger `source` field (TRIGGER_MODEL.md §5
 * convergence gap 2: DEFAULT / AGENT / PRINCIPAL provenance, stamped at
 * write, preserved across update_thesis's wholesale replace).
 *
 * Pure surfaces covered:
 *   1. triggerSchema.source — absent parses (legacy rows), valid values pass
 *      through (they must survive the disk-read gate), bad value rejected,
 *      and NO default is fabricated for legacy rows.
 *   2. defaults.ts builders — every template rung (HELD + WATCHING +
 *      PROMOTED, all horizons) and standingProtectionTriggers carries
 *      source: "DEFAULT".
 *   3. reconcileTriggerReplace — the wholesale-replace reconciler: resent
 *      ids keep their existing source (absent stays absent), only new ids
 *      get stamped "AGENT"; lastFiredAt preservation (the pre-existing
 *      behavior the reconciler absorbed) still holds.
 *   4. applyTriggerCooldownDefaults leaves source intact (write-path
 *      normalizers compose).
 *
 * The applyTriggerAdd PRINCIPAL stamp is covered in
 * lib/actions/thesis-edit-provenance.test.ts (prisma-mocked).
 */

import { triggerSchema } from "./schema";
import {
  defaultTriggersForHorizon,
  standingProtectionTriggers,
  reconcileTriggerReplace,
  applyTriggerCooldownDefaults,
  type Horizon,
  type ThesisState,
} from "./defaults";
import type { Trigger } from "./types";

const HORIZONS: Horizon[] = ["CATALYST", "TARGET", "TRADE", "COMPOUNDER"];
const STATES: ThesisState[] = ["HELD", "WATCHING", "PROMOTED"];

const thesisShape = {
  entryPrice: 100,
  targetPrice: 130,
  stopLoss: 90,
  maxHoldDays: 14,
  catalystDate: new Date(Date.now() + 30 * 86_400_000),
  direction: "LONG" as const,
};

describe("triggerSchema.source", () => {
  const base = {
    predicate: { kind: "PRICE_BELOW", level: 100 },
    action: "EXIT",
    rationale: "stop",
  };

  it("absent source parses (legacy on-disk rows) and stays absent — no fabricated provenance", () => {
    const parsed = triggerSchema.parse(base);
    expect(parsed.source).toBeUndefined();
  });

  it.each(["DEFAULT", "AGENT", "PRINCIPAL"] as const)(
    "%s passes through the disk-read gate",
    (source) => {
      const parsed = triggerSchema.parse({ ...base, source });
      expect(parsed.source).toBe(source);
    },
  );

  it("rejects an unknown source (ANALYST_RULE is reserved for the PR-E cascade)", () => {
    const result = triggerSchema.safeParse({ ...base, source: "ANALYST_RULE" });
    expect(result.success).toBe(false);
  });
});

describe("defaults builders stamp source: DEFAULT", () => {
  it.each(
    STATES.flatMap((state) => HORIZONS.map((h) => [state, h] as const)),
  )("%s %s — every template rung carries DEFAULT", (state, horizon) => {
    const rungs = defaultTriggersForHorizon(horizon, thesisShape, state);
    expect(rungs.length).toBeGreaterThan(0);
    for (const t of rungs) {
      expect(t.source).toBe("DEFAULT");
    }
  });

  it("standingProtectionTriggers stamps DEFAULT on all three rungs", () => {
    const rungs = standingProtectionTriggers();
    expect(rungs).toHaveLength(3);
    for (const t of rungs) {
      expect(t.source).toBe("DEFAULT");
    }
  });
});

describe("reconcileTriggerReplace — provenance across the wholesale replace", () => {
  const stop: Trigger = {
    id: "t_stop",
    predicate: { kind: "PRICE_BELOW", level: 90 },
    action: "EXIT",
    rationale: "hard stop",
    cooldownDays: 0,
    source: "DEFAULT",
    lastFiredAt: "2026-07-01T14:00:00.000Z",
  };
  const principalTrail: Trigger = {
    id: "t_trail",
    predicate: { kind: "TRAILING_FROM_HIGH", pct: 8 },
    action: "EXIT",
    rationale: "trail",
    cooldownDays: 0,
    source: "PRINCIPAL",
  };
  const legacyReview: Trigger = {
    id: "t_legacy",
    predicate: { kind: "EARNINGS_BEAT" },
    action: "REVIEW",
    rationale: "beat",
    cooldownDays: 7,
    // no source — pre-provenance on-disk rung
  };
  const existing = [stop, principalTrail, legacyReview];

  it("a resent id KEEPS its existing source — agent reviews don't relabel default/principal rungs", () => {
    // The agent resends the full array (wholesale replace contract),
    // typically without source (it's server-owned metadata).
    const incoming = existing.map(({ source: _s, lastFiredAt: _f, ...t }) => t);
    const out = reconcileTriggerReplace(existing, incoming as Trigger[]);
    expect(out.find((t) => t.id === "t_stop")?.source).toBe("DEFAULT");
    expect(out.find((t) => t.id === "t_trail")?.source).toBe("PRINCIPAL");
  });

  it("a resent legacy rung with no prior source stays unstamped — never fabricate provenance", () => {
    const out = reconcileTriggerReplace(existing, [{ ...legacyReview }]);
    expect(out[0].source).toBeUndefined();
  });

  it("the existing source is authoritative — an agent-fabricated source on a resent id is overridden", () => {
    const out = reconcileTriggerReplace(existing, [
      { ...stop, source: "AGENT" },
      { ...legacyReview, source: "AGENT" },
    ]);
    expect(out[0].source).toBe("DEFAULT");
    // legacy rung: fabricated source is stripped, absent stays absent
    expect(out[1].source).toBeUndefined();
  });

  it("a genuinely new id is stamped AGENT", () => {
    const fresh: Trigger = {
      id: "t_new",
      predicate: { kind: "PRICE_ABOVE", level: 150 },
      action: "REVIEW",
      rationale: "target checkpoint",
    };
    const out = reconcileTriggerReplace(existing, [fresh]);
    expect(out[0].source).toBe("AGENT");
  });

  it("mirrors the lastFiredAt preservation: resent id without a stamp carries the prior stamp", () => {
    const incoming = [{ ...stop, lastFiredAt: undefined }];
    const out = reconcileTriggerReplace(existing, incoming);
    expect(out[0].lastFiredAt).toBe("2026-07-01T14:00:00.000Z");
  });

  it("an agent-provided lastFiredAt is respected (not clobbered by the prior stamp)", () => {
    const incoming = [{ ...stop, lastFiredAt: "2026-07-10T10:00:00.000Z" }];
    const out = reconcileTriggerReplace(existing, incoming);
    expect(out[0].lastFiredAt).toBe("2026-07-10T10:00:00.000Z");
  });

  it("does not mutate its inputs", () => {
    const incoming = [{ ...legacyReview }];
    reconcileTriggerReplace(existing, incoming);
    expect(existing[0].source).toBe("DEFAULT");
    expect(incoming[0].source).toBeUndefined();
  });
});

describe("applyTriggerCooldownDefaults composes with provenance", () => {
  it("leaves source intact while backfilling cooldownDays", () => {
    const t: Trigger = {
      id: "t1",
      predicate: { kind: "EARNINGS_BEAT" },
      action: "REVIEW",
      rationale: "beat",
      source: "AGENT",
    };
    const [out] = applyTriggerCooldownDefaults([t]);
    expect(out.source).toBe("AGENT");
    expect(out.cooldownDays).toBe(7);
  });
});
