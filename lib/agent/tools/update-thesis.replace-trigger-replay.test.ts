/**
 * update-thesis.replace-trigger-replay.test.ts — a trigger the call adds is
 * never deleted by a removal in the same call (VST, 2026-09-28).
 *
 * VST, Secular Compounder, 21:50 ET. The chat had asked: while the score is
 * under 7, keep a review at $146 instead of the buy. The writer's refresh
 * (run cmum0oeao000404jmts3sp8i0) sent five removals — the review cadence,
 * the buy at $146, the $132 review, the floor, the $210 target — and four
 * new triggers: a review above $146, a 30-day review cadence, a $132 review
 * on the close, an earnings review. Replace the old list with a new one.
 *
 * The save applied the adds first. Three of them landed in a slot the old
 * list still held (one trigger per bucket), so each became an edit of the
 * trigger it was replacing — "Target $210 → $146", "Review cadence: wording
 * updated", "Price below $132: wording updated" — and the removals then
 * deleted them. VST kept one of the four, and no wake at $146. The writer
 * was told the save landed.
 *
 * Deletions now apply before writes. Here the four new triggers land, and
 * the plan check sees what the writer actually asked for: a review above
 * the price with no buy, which it refuses as a half plan — so the writer is
 * handed the refusal instead of a quiet loss.
 */
import raw from "@/lib/agent/__fixtures__/vst-writer-refresh-2026-09-28.json";
import { setupsForAnalyst } from "@/lib/agent/knowledge/setups";
import { validateThesisDecision, type ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import { applyTriggerOps, type TriggerOp } from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

type Op = { op: string; id: string; text: string; ok?: boolean; reason?: string };
type Submit = Parameters<typeof validateThesisDecision>[0];
const fx = raw as unknown as {
  runId: string;
  currentPrice: number;
  analyst: { setupIds: string[]; minConfidence: number; triggers: unknown[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  thesisBefore: Record<string, unknown> & { id: string; targetPrice: number; triggers: Trigger[] };
  submit: Submit;
  savedOps: Op[];
};

const REVIEW_146 = "Added: review above $146";

/** The thesis as the writer's call found it, on the Compounder's rules. */
const seed = () => ({
  thesis: [thesisRow({ ...fx.thesisBefore, analystId: REPLAY_ANALYST_ID })],
  agentConfig: [
    agentConfigRow({ setupIds: fx.analyst.setupIds, minConfidence: fx.analyst.minConfidence, triggers: fx.analyst.triggers }),
  ],
  account: [accountRow({ triggers: fx.account.triggers, triggersSeededAt: new Date(fx.account.triggersSeededAt) })],
});

/** The writer's own validation of its decision, as the run did it. */
function decision(submit: Submit = fx.submit): ValidatedThesisDecision {
  const v = validateThesisDecision(submit, {
    mode: "refresh",
    existingStatus: "WATCHING",
    currentPrice: fx.currentPrice,
    existingTargetPrice: fx.thesisBefore.targetPrice,
    setups: setupsForAnalyst(fx.analyst.setupIds),
    chart: null,
  });
  expect(v.errors).toEqual([]);
  return v.decision as ValidatedThesisDecision;
}

/**
 * The update_thesis args the writer builds from a decision — its real
 * builder, loaded against a stub database (it only needs the import).
 */
async function writerSaveArgs(d: ValidatedThesisDecision): Promise<Record<string, unknown>> {
  let args: Record<string, unknown> = {};
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { buildWriterSaveCall } = await import("@/lib/agent/run-thesis-writer");
    args = buildWriterSaveCall(
      {
        childRunId: fx.runId,
        analystId: REPLAY_ANALYST_ID,
        ticker: "VST",
        mode: "refresh",
        existingThesisId: fx.thesisBefore.id,
        reason: "Convert the ENTER to a REVIEW at the same level if the score stays under 7.",
      },
      null,
      d,
      {},
      { direction: "LONG", status: "WATCHING" },
    ).toolArgs;
  });
  return args;
}

/** One save — the writer's check (dry run) or the write itself. */
const save = (args: Record<string, unknown>, dryRun: boolean) =>
  replayTool("update-thesis", "updateThesis", {
    seed: seed(),
    args,
    ctx: { runId: fx.runId, runMode: "THESIS_WRITER", ...(dryRun ? { dryRun: true } : {}) },
    quotes: { VST: fx.currentPrice },
  });

const opsOf = (r: { result: { data?: Record<string, unknown> } }) => (r.result.data?.trigger_ops ?? []) as Op[];

describe("the fixture is the production call", () => {
  it("applied one op at a time in the order update_thesis sent them, it writes the nine lines VST's save wrote", () => {
    // update_thesis's order: adds, edits, removals, then the levels. One op
    // per call reproduces what one call used to do in that order.
    const ops: TriggerOp[] = [
      ...(fx.submit.add_triggers ?? []).map((t) => ({ op: "add" as const, trigger: { ...t, id: "" } as Trigger })),
      ...(fx.submit.remove_trigger_ids ?? []).map((id) => ({ op: "remove" as const, id })),
    ];
    let stored = fx.thesisBefore.triggers;
    const lines: Array<{ op: string; id: string; text: string }> = [];
    for (const op of ops) {
      const out = applyTriggerOps({
        stored,
        ops: [op],
        direction: "LONG",
        status: "WATCHING",
        actor: "AGENT",
        currentPrice: fx.currentPrice,
        mintId: () => fx.savedOps.find((o) => o.op === "add")!.id,
      });
      stored = out.triggers;
      lines.push(...out.results.filter((r) => r.ok).map(({ op, id, text }) => ({ op, id, text })));
    }
    expect(lines).toEqual(fx.savedOps.map(({ op, id, text }) => ({ op, id, text })));
    expect(stored.map((t) => t.predicate.kind)).toEqual(["EARNINGS_SINCE"]);
  });
});

describe("VST 2026-09-28 — the writer's refresh, through its check and its save", () => {
  it("the writer's check no longer passes a save that deletes the review at $146; it is handed back", async () => {
    const check = await save(await writerSaveArgs(decision()), true);
    // On main the check passed (dry_run: true, nothing refused) with
    // "Removed: review above $146" among the ops, and the save landed.
    const applied = opsOf(check).filter((o) => o.ok);
    expect(applied.map((o) => o.text)).not.toContain("Removed: review above $146");
    expect(check.refused).toBe(true);
    expect(check.refusal?.error).toBe("missing_enter_trigger");
    expect(check.refusal?.message).toMatch(/no buy level/);
    // What it was refused for is what the writer sent — all four new
    // triggers, the $132 review on the close as written (main's edit of the
    // old one dropped the close).
    expect(opsOf(check).filter((o) => o.op === "add").map((o) => o.text)).toEqual([
      REVIEW_146,
      "Added: review every 30 days",
      "Added: Closes below $132 → review",
      "Added: 0–2 days after the report → review",
    ]);
    expect(check.db.store.thesisUpdate ?? []).toHaveLength(0);
  });

  it("without the review above the price, the refresh saves all three replacements — on main two of them were deleted", async () => {
    // The call the refusal asks for: the same decision, less the review
    // above $146. On main the new cadence and the new $132 review still
    // landed on the old ones and were deleted with them.
    const submit: Submit = {
      ...fx.submit,
      add_triggers: fx.submit.add_triggers?.filter((t) => t.predicate.kind !== "PRICE_ABOVE"),
    };
    const saved = await save(await writerSaveArgs(decision(submit)), false);
    expect(saved.refused).toBe(false);
    const row = (saved.db.store.thesis as Array<Record<string, unknown>>).find((t) => t.id === fx.thesisBefore.id)!;
    const now = row.triggers as Trigger[];
    expect(now.map((t) => [t.action, t.predicate])).toEqual([
      ["REVIEW", { kind: "REVIEW_CADENCE", days: 30, from: "LAST_REVIEW" }],
      ["REVIEW", { kind: "PRICE_BELOW", level: 132, basis: "close" }],
      ["REVIEW", { kind: "EARNINGS_SINCE", min: 0, max: 2 }],
    ]);
    const old = new Set(fx.thesisBefore.triggers.map((t) => t.id));
    expect(now.some((t) => old.has(t.id))).toBe(false);
    expect(row.entryPrice).toBeNull();
    expect(row.targetPrice).toBeNull();
    expect(row.stopLoss).toBeNull();
    expect(saved.db.store.thesisUpdate).toHaveLength(1);
  });
});
