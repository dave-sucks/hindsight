/**
 * What the agents and the owner see of Protect gains, on the account's rows
 * (lib/agent/__fixtures__/book-2026-10-16.ts).
 *
 * V, Secular Compounder, bought at $369.25, $401.63 at 13:36 on 10-16 with its
 * floor at $365.50: up 8.8% with a floor under the buy price, so every read
 * asked for the floor to be raised. CEG's position row stores $248; the floor
 * in force on its thesis is $287.30.
 */
import { replayTool, prismaDouble, REPLAY_USER_ID, type PrismaDouble, type StoreSeed } from "@/lib/replay";
import { bookSeed, checkPass, stockOf } from "@/lib/replay/book";
import { SECULAR } from "@/lib/agent/__fixtures__/book-2026-10-16";
import { rowForModel } from "@/lib/agent/row-for-model";

type R = Record<string, unknown>;
const on = { protectGainsOn: true, protectGainsStartPct: 3, protectGainsGiveBackPct: 5, protectGainsFrom: "NOW" };

/** One pass of the trigger check, then the analyst's read of V on what it left, as the model reads the row. */
async function readV(account: R) {
  const db = prismaDouble(bookSeed({ only: ["V"], account, position: () => ({ protectHigh: 404.08, protectHighAt: new Date("2026-10-16T14:01:52Z") }) }));
  await checkPass(db);
  const { result } = await replayTool("get-theses", "getTheses", {
    seed: db.store as StoreSeed,
    ctx: { runMode: "MORNING_PLAN", runEnvironment: "LIVE", analystId: SECULAR, userId: REPLAY_USER_ID },
    args: { tickers: ["V"] },
    quotes: { V: stockOf("V").price },
  });
  const row = ((result.data as R).theses as R[]).find((t) => t.ticker === "V")!;
  return rowForModel(row, { named: true, size: "full" }) as R;
}

describe("the agents' row", () => {
  it("Protect gains on: one line says the floor rises automatically, the floor is raised, and the nag stops", async () => {
    const row = await readV(on);
    expect(row.protect_gains).toBe(
      "The owner's Protect gains raises this stock's floor automatically and no analyst can lower it: it is held at $383.88 or higher, 5% under the $404.08 high and never below the $369.25 buy price.",
    );
    expect(String(row.protection)).toMatch(/floor locks \+4\.0%/);
    expect(JSON.stringify(row)).not.toMatch(/UNPROTECTED/);
  });

  it("Protect gains off: no line, the floor stays at $365.50, and the read still asks for a higher floor", async () => {
    const row = await readV({ protectGainsOn: false });
    expect(row).not.toHaveProperty("protect_gains");
    expect(String(row.protection)).toMatch(/floor locks -1\.0% \(BELOW entry\)/);
    expect(JSON.stringify(row)).toMatch(/UNPROTECTED/);
  });
});

describe("the positions table's floor", () => {
  async function floor(db: PrismaDouble) {
    let out = new Map<string, number | null>();
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/market-data/load-indicators", () => ({ loadIndicatorSnapshots: async () => new Map() }));
      const { floorsInForce } = await import("@/lib/portfolio/floor-in-force");
      const p = (db.store.position as R[])[0];
      out = await floorsInForce([{ id: String(p.id), analystId: String(p.analystId), symbol: String(p.symbol), direction: "LONG", avgCost: Number(p.avgCost), peakPrice: Number(p.peakPrice) }]);
    });
    return out.get(stockOf("CEG").positionId);
  }

  it("reads the floor in force on CEG's thesis, $287.30, not the $248 the position row stores", async () => {
    expect(stockOf("CEG").stopLoss).toBe(248);
    expect(await floor(prismaDouble(bookSeed({ only: ["CEG"] })))).toBe(287.3);
  });

  it("after Protect gains (from the buy) raises CEG's floor, the table reads the raised one", async () => {
    const db = prismaDouble(bookSeed({ only: ["CEG"], account: { ...on, protectGainsFrom: "BUY" }, position: () => ({ protectHigh: null, protectHighAt: null }) }));
    await checkPass(db);
    expect(await floor(db)).toBe(292.68);
  });
});
