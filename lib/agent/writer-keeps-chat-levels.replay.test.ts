/**
 * A writer refresh the chat asked for keeps the levels on the row (ruling
 * 2026-10-15). MU, 10:56:57 ET (child run cmv9nsmws000106lbf2u5njet of chat
 * cmv9nlx12000n06l3d9cmobei): the chat had set buy $906, stop $850, target
 * $1,500. The writer's save added a second buy at $982, which took the buy's
 * slot ("Entry $906 → $982"), and its own edit put $906 back. Its fields
 * below are the save's own, rationales replaced; the row is as it stood.
 */
import { replayTool, thesisRow } from "@/lib/replay";
import type { ValidatedThesisDecision } from "@/lib/agent/thesis-research/decision";
import type { Trigger } from "@/lib/agent/triggers/types";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const THESIS = "cmv9nm3xo000o06l3om8r7ath";
const BUY = "9db623d8-7df0-48bb-b9ce-3968664813ae";
const t = (id: string, action: string, predicate: Record<string, unknown>) => ({ id, action, source: "AGENT", predicate, rationale: "(as set)", cooldownDays: action === "EXIT" ? 0 : 1 });
const row = [
  t(BUY, "ENTER", { watch: "price", is: "above", value: 906 }),
  t("d7fcd231-5a48-42a0-919b-8efc0ac521b0", "ENTER", { watch: "move", is: "near", value: 2, variable: "sma50" }),
  t("010f32d9-158a-4105-b9bb-2e4f47d81ebb", "REVIEW", { watch: "report", is: "before", value: 14 }),
  t("d9b6bc8d-017f-4355-8e8c-fe315084db87", "REVIEW", { watch: "price", is: "below", value: 878 }),
  t("ba421f37-1a10-4fbd-aba8-cafc161c2c6e", "EXIT", { watch: "price", is: "below", value: 850 }),
  t("bb928325-0cde-4168-a03c-aca52371fc8f", "REVIEW", { watch: "price", is: "above", value: 1500 }),
];
const decision = {
  direction: "LONG", entry_price: 906, stop_loss: 850, target_price: 1500, setup_id: "MA_PULLBACK", entry_on_close: false, horizon: "COMPOUNDER", conviction: "HIGH", rationale: "(the writer's rationale)",
  add_triggers: [
    { action: "ENTER", predicate: { watch: "price", is: "above", value: 982 }, rationale: "(the writer's)" },
    { action: "REVIEW", predicate: { watch: "report", is: "before", value: 14 }, rationale: "(the writer's)" },
  ],
  edit_triggers: [
    { action: "ENTER", id: BUY, value: 906, rationale: "(the writer's)" },
    { action: "ENTER", id: "d7fcd231-5a48-42a0-919b-8efc0ac521b0", value: 2, rationale: "(the writer's)" },
  ],
} as unknown as ValidatedThesisDecision;

const writerArgs = { childRunId: "cmv9nsmws000106lbf2u5njet", analystId: SECULAR, ticker: "MU", mode: "refresh" as const, existingThesisId: THESIS, reason: "(the chat's reason)" };
/** The writer loads fresh (its client reads import.meta); under a full run that can pass jest's 5 s default. */
const LOAD_MS = 30_000;
async function save(keep?: Trigger[]): Promise<Record<string, unknown>> {
  let args: Record<string, unknown> = {};
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    const { buildWriterSaveCall } = await import("@/lib/agent/run-thesis-writer");
    args = buildWriterSaveCall(writerArgs, null, decision, {}, { direction: "LONG", status: "WATCHING", keep }).toolArgs;
  });
  jest.dontMock("@/lib/prisma");
  return args;
}
const replay = (args: Record<string, unknown>) =>
  replayTool("update-thesis", "updateThesis", {
    seed: { thesis: [thesisRow({ id: THESIS, ticker: "MU", status: "WATCHING", direction: "LONG", horizon: "COMPOUNDER", analystId: SECULAR, entryPrice: 906, stopLoss: 850, targetPrice: 1500, triggers: row })] },
    ctx: { runMode: "THESIS_WRITER", runId: "cmv9nsmws000106lbf2u5njet", analystId: SECULAR, runEnvironment: "LIVE" },
    args,
    quotes: { MU: 902.44 },
  });
const opsOn = (result: unknown, id: string) => ((result as { data?: { trigger_ops?: Array<{ id?: string; text: string }> } }).data?.trigger_ops ?? []).filter((o) => o.id === id);

describe("MU 10:56:57 — the writer's refresh for the chat", () => {
  it("keeps the chat's buy, stop and target, and says its own levels as information", async () => {
    const args = await save(row as unknown as Trigger[]);
    expect([args.entry_price, args.stop_loss, args.target_price]).toEqual([undefined, undefined, undefined]);
    const { result, db } = await replay(args);
    expect(opsOn(result, BUY)).toEqual([]);
    const buy = (db.store.thesis[0] as { triggers: Array<{ id: string; predicate?: { value?: number }; condition?: { value?: number } }> }).triggers.find((x) => x.id === BUY)!;
    expect((buy.condition ?? buy.predicate)!.value).toBe(906);
    expect(JSON.stringify(db.store.thesis[0])).not.toMatch(/"value":982/);
    expect(String(args.rationale)).toMatch(/This refresh's own: entry \$906, stop \$850, target \$1500, entry \$982\.\]$/);
  }, LOAD_MS);

  it("a refresh after a buy placed by hand keeps the levels as the chat's does; a morning run's does not", async () => {
    let keeps: (a: { keepLevels?: boolean }, m: string | null) => boolean = () => false;
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
      keeps = (await import("@/lib/agent/run-thesis-writer")).keepsExistingLevels;
    });
    jest.dontMock("@/lib/prisma");
    expect(keeps({ keepLevels: true }, null)).toBe(true);
    expect(keeps({}, "PRINCIPAL_CHAT")).toBe(true);
    expect(keeps({}, "RESEARCH_RUN")).toBe(false);
    expect(keeps({}, null)).toBe(false);
  }, LOAD_MS);

  it("a refresh the chat did not ask for (a morning run's) sends its levels: entry_price wins, the $982 comes back refused", async () => {
    const { result } = await replay(await save());
    expect(opsOn(result, BUY)).toEqual([expect.objectContaining({ text: "Entry $982", ok: false, to: 982 })]);
  }, LOAD_MS);
});
