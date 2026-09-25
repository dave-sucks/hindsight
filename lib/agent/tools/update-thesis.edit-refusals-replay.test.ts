/**
 * update-thesis.edit-refusals-replay.test.ts — two edits the tool refused
 * in production and the runs worked around, through the real entry point
 * (DAV-311).
 *
 * GD, Compounder 2026-09-25 08:06:09 ET. The run set GD's plan down —
 * `remove_trigger_ids` for the $315 floor and the $435 target review, a
 * rationale saying why — and was refused `structural_belief_unchanged`
 * ("you're patching targetPrice, stopLoss without touching the belief"),
 * because levels are triggers and removing them changes the derived
 * columns. Five seconds later the same call landed with the rationale
 * copied into `structural_unchanged_reason`. A gate satisfied by repeating
 * the sentence next to it is not a gate. ISRG, 09-23, the same shape.
 *
 * VST, Compounder 2026-09-23 08:04:07 ET. `change_status: "WATCHING"` on a
 * thesis already WATCHING — a no-op verb — refused
 * `watching_transition_from_non_promoted`, and the whole review with it.
 * PEAD's PBH call that morning was refused the same way, correctly: PBH is
 * retired, not watching.
 *
 * On main both calls are refused. Here both land: GD's two triggers come
 * off with one audit row; VST's review is recorded with its status untouched.
 */
import raw from "@/lib/agent/__fixtures__/update-thesis-refusals-2026-09-25.json";
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

type Refused = { error: string; input: Record<string, unknown>; thesis: Record<string, unknown> };
const fx = raw as unknown as Record<string, { refused: Refused[] }>;
const gd = fx.COMPOUNDER_0925.refused.find((r) => (r.thesis as { ticker: string }).ticker === "GD")!;
const vst = fx.COMPOUNDER_0923.refused.find((r) => (r.thesis as { ticker: string }).ticker === "VST")!;

/** The production row, as the run found it, on the replay analyst. */
const rowOf = (r: Refused) => {
  const t = r.thesis;
  return thesisRow({
    id: t.id as string,
    ticker: t.ticker as string,
    status: t.status as string,
    direction: t.direction as string,
    horizon: t.horizon as string,
    setupId: (t.setupId as string | null) ?? null,
    entryPrice: t.entryPrice as number | null,
    targetPrice: t.targetPrice as number | null,
    stopLoss: t.stopLoss as number | null,
    coreBelief: t.coreBelief as string,
    keyAssumptions: t.keyAssumptions as string[],
    invalidationConds: t.invalidationConds as string[],
    conviction: t.conviction as string,
    variantView: t.variantView as string | null,
    triggers: t.triggers as unknown[],
    catalystDate: t.catalystDate ? new Date(t.catalystDate as string) : null,
    analystId: REPLAY_ANALYST_ID,
  });
};

const seedFor = (r: Refused) => ({ thesis: [rowOf(r)], agentConfig: [agentConfigRow()], account: [accountRow()] });

/**
 * GD as the run found it at 08:06: the fixture holds the row AFTER the
 * set-down landed, so the two triggers the call names — the $315 floor
 * (e82b0485…) and the $435 target review (7201b75b…) — and the plan levels
 * they carried are put back from the audit row's own record of the removal.
 */
const gdBefore = () => {
  const row = rowOf(gd);
  const [floorId, targetId] = gd.input.remove_trigger_ids as string[];
  return {
    ...row,
    stopLoss: 315,
    targetPrice: 435,
    triggers: [
      ...(row.triggers as unknown[]),
      { id: floorId, action: "EXIT", predicate: { kind: "PRICE_BELOW", level: 315 }, rationale: "Floor — sell if the price drops to $315.", cooldownDays: 1, source: "AGENT" },
      { id: targetId, action: "REVIEW", predicate: { kind: "PRICE_ABOVE", level: 435 }, rationale: "Target — review above $435.", cooldownDays: 1, source: "AGENT" },
    ],
  };
};

describe("GD 2026-09-25 — setting the plan down is an edit, not a belief change", () => {
  it("removes the floor and the target review with one audit row; nothing is refused, nothing has to be said twice", async () => {
    const before = gdBefore();
    const { refused, refusal, db } = await replayTool("update-thesis", "updateThesis", {
      seed: { thesis: [before], agentConfig: [agentConfigRow()], account: [accountRow()] },
      args: gd.input,
      quotes: { GD: 342.1 },
    });
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    const row = (db.store.thesis as Array<Record<string, unknown>>).find((t) => t.id === gd.thesis.id)!;
    const ids = new Set((row.triggers as Array<{ id: string }>).map((t) => t.id));
    for (const removed of gd.input.remove_trigger_ids as string[]) expect(ids.has(removed)).toBe(false);
    expect((row.triggers as unknown[]).length).toBe((before.triggers as unknown[]).length - 2);
    // Levels are triggers: the floor and target columns follow them off.
    expect(row.stopLoss).toBeNull();
    expect(row.targetPrice).toBeNull();
    expect(db.store.thesisUpdate).toHaveLength(1);
  });
});

describe("VST 2026-09-23 — change_status WATCHING on a watched stock is a review, not a transition", () => {
  it("lands as an ordinary review with the status untouched", async () => {
    const { refused, refusal, db } = await replayTool("update-thesis", "updateThesis", {
      seed: seedFor(vst),
      args: vst.input,
      quotes: { VST: 158.4 },
    });
    expect(refusal).toBeNull();
    expect(refused).toBe(false);
    const row = (db.store.thesis as Array<Record<string, unknown>>).find((t) => t.id === vst.thesis.id)!;
    expect(row.status).toBe("WATCHING");
    const audit = db.store.thesisUpdate as Array<Record<string, unknown>>;
    expect(audit).toHaveLength(1);
    expect(audit[0].type).not.toBe("STATUS_CHANGED");
  });
});
