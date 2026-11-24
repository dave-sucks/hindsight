/**
 * A watch carries watch triggers (2026-11-17). A trigger on our position (a move from our buy
 * price, the high since we bought, days since the buy) is refused at the save on a stock we only
 * watch, by id, with the fix; the rest of the call lands. On a holding it lands.
 *
 * TRV (Secular Compounder, WATCHING) carries "Review 60 days after the buy", saved by a run; it
 * reads false until there is a buy. The stored row stays as it is: nothing fixes it in code, and
 * removing it is the fix. Its triggers as stored on 2026-11-17, notes left out.
 */
import { replayTool, thesisRow, positionRow } from "@/lib/replay";
import { POSITION_ON_A_WATCH } from "@/lib/agent/triggers/condition";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const TRV = "cmum3c72c000h04jp9ztyxxko";
const AFTER_BUY = "d7ee0098-e1c7-4ce9-8ad9-81e922500234";
const t = (id: string, action: string, fireMode: string, predicate: Record<string, unknown>) => ({ id, action, fireMode, source: "AGENT", predicate, rationale: "(as set)" });
const STORED = [
  t("c3dd145a-2420-45cf-a815-d071112883b6", "REVIEW", "NEXT_MORNING", { is: "before", value: 7, watch: "report" }),
  t("4dc33c7d-8b00-45dd-8b1e-a6a302094567", "REVIEW", "NEXT_MORNING", { is: "beat", value: 10, watch: "surprise" }),
  t("1a4dd264-2bb6-4d51-904b-386e7516e0ab", "REVIEW", "NEXT_MORNING", { is: "miss", value: 0, watch: "surprise" }),
  t(AFTER_BUY, "REVIEW", "NEXT_MORNING", { is: "after", value: 60, watch: "from_date", variable: "buy" }),
  t("968ed379-b566-4419-9094-b01238612cd8", "ENTER", "ASK_NOW", { is: "above", value: 407.87, watch: "price", settings: { close: true } }),
  t("e1642d0c-b315-4bee-ac35-e23a531a1b1c", "STOP_WATCHING", "ASK_NOW", { is: "below", value: 391, watch: "price", settings: { close: true } }),
  t("a5ad20b7-501c-41a6-aa5c-5c73921a665b", "REVIEW", "NEXT_MORNING", { is: "above", value: 453.6, watch: "price" }),
];

// The same stock once bought: its watch's buy and Stop watching came off, and a sale went on.
const HELD = [...STORED.filter((x) => x.action === "REVIEW"), t("held-floor", "EXIT", "ASK_NOW", { is: "below", value: 391, watch: "price" })];

const LOAD_MS = 30_000;
const save = (args: Record<string, unknown>, status: "WATCHING" | "HOLDING" = "WATCHING") =>
  replayTool("update-thesis", "updateThesis", {
    seed: {
      thesis: [thesisRow({ id: TRV, ticker: "TRV", status, direction: "LONG", horizon: "COMPOUNDER", setupId: "BASE_BREAKOUT", analystId: SECULAR, triggers: status === "HOLDING" ? HELD : STORED })],
      ...(status === "HOLDING" ? { position: [positionRow({ analystId: SECULAR, symbol: "TRV", avgCost: 410, openedAt: new Date("2026-11-10T15:00:00Z") })] } : {}),
    },
    ctx: { runMode: "MORNING_PLAN", runId: "run-trv", analystId: SECULAR, runEnvironment: "LIVE" },
    args: { thesis_id: TRV, rationale: "(the run's note)", ...args },
    quotes: { TRV: 402.1 },
  });
type Op = { id?: string; ok?: boolean; text: string; reason?: string };
const ops = (result: unknown) => ((result as { data?: { trigger_ops?: Op[] } }).data?.trigger_ops ?? []) as Op[];
const stored = (db: { store: Record<string, unknown[]> }) => (db.store.thesis[0] as { triggers: Array<{ id: string; predicate: Record<string, unknown> }> }).triggers;

describe("TRV, a watch: a trigger on our position is refused at the save, the rest lands", () => {
  it("adding 'Review if up 10% from our buy price' and 'Review if below $395': the first is refused with the fix, the second lands", async () => {
    const { result, db } = await save({
      add_triggers: [
        { action: "REVIEW", predicate: { watch: "move", is: "above", value: 10, variable: "entry" }, rationale: "A profit check." },
        { action: "REVIEW", predicate: { watch: "price", is: "below", value: 395 }, rationale: "A look under the pullback low." },
      ],
    });
    const refused = ops(result).filter((o) => o.ok === false);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBe(POSITION_ON_A_WATCH);
    const after = stored(db);
    expect(after.some((x) => x.predicate.variable === "entry")).toBe(false);
    expect(after.some((x) => x.predicate.watch === "price" && x.predicate.value === 395)).toBe(true);
  }, LOAD_MS);

  it("editing the stored 'Review 60 days after the buy' is refused; removing it lands", async () => {
    const edited = await save({ edit_triggers: [{ action: "REVIEW", id: AFTER_BUY, value: 45, rationale: "Sooner." }] });
    expect(ops(edited.result).find((o) => o.id === AFTER_BUY)).toMatchObject({ ok: false, reason: POSITION_ON_A_WATCH });
    expect(stored(edited.db).find((x) => x.id === AFTER_BUY)!.predicate.value).toBe(60);

    const removed = await save({ remove_trigger_ids: [AFTER_BUY] });
    expect(stored(removed.db).some((x) => x.id === AFTER_BUY)).toBe(false);
  }, LOAD_MS);

  it("a sale-side look at a price ('Review if above $453.60') is not on our position, so the save takes it", async () => {
    const { result } = await save({ add_triggers: [{ action: "REVIEW", predicate: { watch: "price", is: "above", value: 470 }, rationale: "The next extension." }] });
    expect(ops(result).filter((o) => o.ok === false)).toEqual([]);
  }, LOAD_MS);

  it("on a holding, the same profit check lands", async () => {
    const { result, db } = await save({ add_triggers: [{ action: "REVIEW", predicate: { watch: "move", is: "above", value: 10, variable: "entry" }, rationale: "A profit check." }] }, "HOLDING");
    expect(ops(result).filter((o) => o.ok === false)).toEqual([]);
    expect(stored(db).some((x) => x.predicate.variable === "entry")).toBe(true);
  }, LOAD_MS);
});

describe("record_thesis: a new watch with a trigger on our position is refused with the fix", () => {
  it("'Review 60 days after the buy' on a mint", async () => {
    const { result, db } = await replayTool("record-thesis", "recordThesis", {
      seed: { thesis: [] },
      ctx: { runMode: "THESIS_WRITER", runId: "run-mint", analystId: SECULAR, runEnvironment: "LIVE" },
      args: {
        ticker: "TRV", direction: "LONG", horizon: "COMPOUNDER", setup_id: "BASE_BREAKOUT", conviction: "MEDIUM", conviction_rationale: "A sound insurer at a fair price, waiting for its breakout.", rationale: "(the writer's)",
        core_belief: "Travelers writes commercial and personal insurance and earns on the float. We own it while underwriting stays profitable and investment income keeps growing.",
        kpis: ["The combined ratio stays under 95% through 2027", "Net investment income keeps growing as the portfolio reinvests at higher yields", "A reserve charge that resets the combined ratio above 100%", "Guidance for investment income cut on the next print"],
        source_kind: "RESEARCH",
        triggers: [
          { action: "ENTER", predicate: { watch: "price", is: "above", value: 407.87, settings: { close: true } }, rationale: "The pivot." },
          { action: "REVIEW", predicate: { watch: "from_date", is: "after", value: 60, variable: "buy" }, rationale: "60-day checkpoint." },
        ],
      },
      quotes: { TRV: 402.1 },
    });
    expect((result as { data?: { status?: string; note?: string } }).data).toMatchObject({ status: "FAILED", note: POSITION_ON_A_WATCH });
    expect(db.store.thesis ?? []).toEqual([]);
  }, LOAD_MS);
});
