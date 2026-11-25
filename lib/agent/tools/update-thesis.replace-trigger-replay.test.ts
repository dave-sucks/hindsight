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
 * Deletions now apply before writes (#732), so the four new triggers land
 * and the plan check sees what the writer actually asked for: a review
 * above the price with no buy. #732 refused that as a half plan. The QB's
 * ruling (DAV-335, 2026-09-29): on a stock we only watch, with no buy, a
 * review at any price is a wake, not a target — so the refresh saves, the
 * $146 review is a wake, and the target column stays empty.
 *
 * Since T1 the writer's save carries no trigger; the same removals and adds
 * reach the save from edit_triggers after it, as replayed here.
 */
import type { z } from "zod";
import raw from "@/lib/agent/__fixtures__/vst-writer-refresh-2026-09-28.json";
import { shapeName } from "@/lib/agent/triggers/condition/__fixtures__/shape-name";
import { applyTriggerOps, type TriggerOp } from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";
import { replayTool, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

type Op = { op: string; id: string; text: string; ok?: boolean; reason?: string };
type Submit = { rationale: string; add_triggers?: Array<{ action: string; predicate: Record<string, unknown>; rationale: string }>; remove_trigger_ids?: string[]; edit_triggers?: unknown[] };
const fx = raw as unknown as {
  runId: string;
  currentPrice: number;
  analyst: { setupIds: string[]; triggers: unknown[] };
  account: { triggers: unknown[]; triggersSeededAt: string };
  thesisBefore: Record<string, unknown> & { id: string; targetPrice: number; triggers: Trigger[] };
  submit: Submit;
  savedOps: Op[];
};

const REVIEW_146 = "Added: Review if above $146 · only on the close";

/** VST's triggers before the call, its watch's floor as the 2026-11-16 migration stores it (STOP_WATCHING, on the close). */
const before: Trigger[] = fx.thesisBefore.triggers.map((t) =>
  t.action === "EXIT" ? ({ ...t, action: "STOP_WATCHING", predicate: { ...(t.predicate as object), settings: { close: true } } } as unknown as Trigger) : t,
);

/** The thesis as the writer's call found it, on the Compounder's rules. */
const seed = () => ({
  thesis: [thesisRow({ ...fx.thesisBefore, triggers: before, analystId: REPLAY_ANALYST_ID })],
  agentConfig: [
    agentConfigRow({ setupIds: fx.analyst.setupIds, triggers: fx.analyst.triggers }),
  ],
  account: [accountRow({ triggers: fx.account.triggers, triggersSeededAt: new Date(fx.account.triggersSeededAt) })],
});

/**
 * The update_thesis args the writer's trigger edits become — edit_triggers
 * sends its adds and removals to the save as these — read through
 * update_thesis's input schema, as the save reads them.
 */
async function writerSaveArgs(submit: Submit = fx.submit): Promise<Record<string, unknown>> {
  let args: Record<string, unknown> = { thesis_id: fx.thesisBefore.id, rationale: submit.rationale, add_triggers: submit.add_triggers, remove_trigger_ids: submit.remove_trigger_ids, edit_triggers: submit.edit_triggers };
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { updateThesis } = await import("@/lib/agent/tools/update-thesis");
    const door = (updateThesis({ runId: "r", userId: "u", accountId: "a", runMode: "THESIS_WRITER" } as never) as unknown as { inputSchema: z.ZodTypeAny }).inputSchema;
    const parsed = door.safeParse(args);
    if (!parsed.success) throw new Error(`update_thesis's schema refused the writer's args: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
    args = parsed.data as Record<string, unknown>;
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
      ...(fx.submit.add_triggers ?? []).map((t) => ({ op: "add" as const, trigger: { ...t, id: "" } as unknown as Trigger })),
      ...(fx.submit.remove_trigger_ids ?? []).map((id) => ({ op: "remove" as const, id })),
    ];
    let stored = before;
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
    // The same nine lines on the same ids, in the order production wrote
    // them; each trigger now reads the way its pill does.
    const SAID_NOW: Record<string, string> = {
      "Price below $132: wording updated": "Review if below $132: wording updated",
      "Added: 0–2 days after the report → review": "Added: Review if within 2 days after earnings",
      "Removed: review every 30 days": "Removed: Review every 30 days",
      "Removed: buy above $146": "Removed: Buy if above $146 · only on the close",
      "Removed: Price below $132 → review": "Removed: Review if below $132",
      "Removed: sell below $132": "Removed: Stop watching if below $132 · only on the close",
      "Removed: review above $146": "Removed: Review if above $146",
    };
    // Two of its adds asked for "only on the close" and landed on a trigger
    // already there; the save dropped the setting then and carries it now
    // (2026-10-09), so these four lines say so.
    const ON_THE_CLOSE: Record<string, string> = {
      "Target $210 → $146": "Upside $210 → $146; Upside: fires on the close",
      "Review if below $132: wording updated": "Review if below $132: fires on the close",
      "Removed: Review if below $132": "Removed: Review if below $132 · only on the close",
      "Removed: Review if above $146": "Removed: Review if above $146 · only on the close",
    };
    const now = (text: string) => ON_THE_CLOSE[SAID_NOW[text] ?? text] ?? SAID_NOW[text] ?? text;
    // Its Stop watching line stays: an agent can't take one off (the owner,
    // 2026-11-25). Production removed it; every other line lands as it did.
    const KEPT = "Removed: Stop watching if below $132 · only on the close";
    expect(lines).toEqual(fx.savedOps.map(({ op, id, text }) => ({ op, id, text: now(text) })).filter((l) => l.text !== KEPT));
    expect(stored.map((t) => [t.action, shapeName(t.predicate)]).sort()).toEqual([["REVIEW", "report:after"], ["STOP_WATCHING", "price:below"]]);
  });
});

describe("VST 2026-09-28 — the writer's refresh, through its check and its save", () => {
  it("the writer's check passes the refresh as written, and the save keeps the review at $146 as a wake", async () => {
    const args = await writerSaveArgs();
    const check = await save(args, true);
    // Under #732 this was refused (missing_enter_trigger): a review above
    // the price with no buy counted as a target with nothing to reach it from.
    expect(check.refused).toBe(false);
    // All four new triggers, the $132 review on the close as written.
    expect(opsOf(check).filter((o) => o.op === "add").map((o) => o.text)).toEqual([
      REVIEW_146,
      "Added: Review every 30 days",
      "Added: Review if below $132 · only on the close",
      "Added: Review if within 2 days after earnings",
    ]);
    expect(check.db.store.thesisUpdate ?? []).toHaveLength(0);

    const saved = await save(args, false);
    expect(saved.refused).toBe(false);
    const row = (saved.db.store.thesis as Array<Record<string, unknown>>).find((t) => t.id === fx.thesisBefore.id)!;
    const now = row.triggers as Trigger[];
    // The four new triggers, and the Stop watching line an agent can't take off (the owner, 2026-11-25).
    expect(now.map((t) => [t.action, shapeName(t.predicate)]).sort()).toEqual([
      ["REVIEW", "price:above"],
      ["REVIEW", "price:below"],
      ["REVIEW", "repeat"],
      ["REVIEW", "report:after"],
      ["STOP_WATCHING", "price:below"],
    ]);
    expect(now.find((t) => t.action === "REVIEW" && shapeName(t.predicate) === "price:above")!.predicate).toMatchObject({ watch: "price", is: "above", value: 146 });
    // A wake, not a target: a stock with no buy, and nothing stores a level.
    expect((row.triggers as Trigger[]).some((t) => t.action === "ENTER")).toBe(false);
    expect(saved.db.store.thesisUpdate).toHaveLength(1);
  });

  it("without the review above the price, the refresh saves all three replacements — on main two of them were deleted", async () => {
    // The call the refusal asks for: the same decision, less the review
    // above $146. On main the new cadence and the new $132 review still
    // landed on the old ones and were deleted with them.
    const submit: Submit = {
      ...fx.submit,
      add_triggers: fx.submit.add_triggers?.filter((t) => shapeName(t.predicate) !== "price:above"),
    };
    const saved = await save(await writerSaveArgs(submit), false);
    expect(saved.refused).toBe(false);
    const row = (saved.db.store.thesis as Array<Record<string, unknown>>).find((t) => t.id === fx.thesisBefore.id)!;
    const now = row.triggers as Trigger[];
    expect(now.filter((t) => t.action === "REVIEW").map((t) => t.predicate)).toEqual([
      { watch: "repeat", value: 30 },
      { watch: "price", is: "below", value: 132, settings: { close: true } },
      // The writer sent fromDay 0; the setting is deleted, so the save drops it.
      { watch: "report", is: "after", value: 2 },
    ]);
    // Of the old triggers only the Stop watching line is left: an agent can't take it off (the owner, 2026-11-25).
    const old = new Set(fx.thesisBefore.triggers.map((t) => t.id));
    expect(now.filter((t) => old.has(t.id)).map((t) => t.action)).toEqual(["STOP_WATCHING"]);
    expect((row.triggers as Trigger[]).some((t) => t.action === "ENTER")).toBe(false);
    expect(saved.db.store.thesisUpdate).toHaveLength(1);
  });
});
