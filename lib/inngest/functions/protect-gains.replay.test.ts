/**
 * Protect gains raises the stock's own floor, through the trigger check, on
 * the account's rows (lib/agent/__fixtures__/book-2026-10-16.ts); the floor's
 * own sale does the selling.
 *
 * PLTR, Secular Compounder: bought at $192.01, tracked high $210.25 (10-13),
 * floor $196 stored as "ask the analyst first". On 2026-10-15 at 09:30 ET it
 * traded $193.93, under the floor; the trigger run held and proposed nothing.
 * GEV: bought at $984.59, tracked high $1,050.33 (10-06), floor $868 — never a
 * floor at or above the buy price — and $932.00 on 10-16.
 */
import { prismaDouble, type PrismaDouble } from "@/lib/replay";
import { bookSeed, checkPass, stockOf, triggerRun } from "@/lib/replay/book";
import { AT } from "@/lib/agent/__fixtures__/book-2026-10-16";

type R = Record<string, unknown>;
const orders = (db: PrismaDouble) => (db.store.order ?? []) as R[];
const thesis = (db: PrismaDouble) => (db.store.thesis as R[])[0];
const floorOf = (db: PrismaDouble, id: string) => (thesis(db).triggers as R[]).find((t) => t.id === id) as R & { predicate: R };
const raises = (db: PrismaDouble) => ((db.store.thesisUpdate ?? []) as R[]).filter((u) => String(u.summary).startsWith("Floor raised")).map((u) => u.summary);
const on = (from: "NOW" | "BUY") => ({ protectGainsOn: true, protectGainsStartPct: 3, protectGainsGiveBackPct: 5, protectGainsFrom: from });
// The new columns, as a row that predates them reads: empty.
const unset = () => ({ protectHigh: null, protectHighAt: null });

describe("PLTR 2026-10-15 09:30 — the run held through its $196 floor", () => {
  const at = new Date("2026-10-15T13:30:45Z");
  const prices = { PLTR: { price: 193.925, prevClose: 200.97 } };
  // The floor as it stood before its first fire that morning.
  const day = (account: R) =>
    prismaDouble(bookSeed({ only: ["PLTR"], account, position: unset, thesis: (s) => ({ triggers: s.triggers.map((t) => (t.id === "21976408" ? { ...t, lastFiredAt: undefined } : t)) }) }));

  it("Protect gains on (3% / 5%, from the buy): the floor rises to $199.74, and that pass sells under it, with no model", async () => {
    const db = day(on("BUY"));
    const pass = await checkPass(db, { at, prices });
    expect(floorOf(db, "21976408")).toMatchObject({ fireMode: "DIRECT", predicate: { watch: "price", is: "below", value: 199.74 } });
    expect(thesis(db)).toMatchObject({ stopLoss: 199.74 });
    expect(raises(db)).toEqual(["Floor raised to $199.74 to protect the gain (5% under the $210.25 high since the buy)"]);
    expect(pass.sent.map((e) => [e.data.triggerId, e.data.firedPrice])).toEqual([["21976408", 193.925]]);

    const run = await triggerRun(db, pass.sent[0].data, { at, fill: 193.93 });
    expect(run.modelCalls).toBe(0);
    expect(run.returned).toMatchObject({ fireMode: "DIRECT", direct: { kind: "proposed", reason: "STOP" } });
    expect(orders(db)).toEqual([expect.objectContaining({ symbol: "PLTR", intent: "CLOSE", status: "AWAITING_APPROVAL", quantity: 38, closeReason: "STOP" })]);
  });

  it("Protect gains off: the $196 floor stays where it was and fires as it did", async () => {
    const db = day({ protectGainsOn: false });
    const pass = await checkPass(db, { at, prices });
    expect(floorOf(db, "21976408").predicate).toMatchObject({ value: 196 });
    expect(raises(db)).toEqual([]);
    expect(pass.sent.map((e) => e.data.triggerId)).toEqual(["21976408"]);
  });
});

describe("GEV — never a floor at or above its buy price", () => {
  const gev = stockOf("GEV");
  const FLOOR = "8861139d";
  const at = (min: number) => new Date(AT.getTime() + min * 60_000);
  const priced = (price: number) => ({ GEV: { price, prevClose: gev.prevClose } });
  const day = (from: "NOW" | "BUY") => prismaDouble(bookSeed({ only: ["GEV"], account: on(from), position: unset }));
  const floorSale = (p: { sent: Array<{ data: R }> }) => p.sent.filter((e) => e.data.triggerId === FLOOR).map((e) => e.data.firedPrice);

  it("counted from the buy: the floor goes from $868 to $997.82 and sells at once at $932", async () => {
    const db = day("BUY");
    const pass = await checkPass(db);
    expect(floorOf(db, FLOOR).predicate).toMatchObject({ value: 997.82 });
    expect(floorSale(pass)).toEqual([932]);
  });

  it("counted from now: nothing on the day it is turned on; at 3% over the buy the floor rises to the buy price, then sells there", async () => {
    const db = day("NOW");
    expect(floorSale(await checkPass(db, { prices: priced(932) }))).toEqual([]);
    expect((db.store.position as R[])[0]).toMatchObject({ protectHigh: 932 });
    expect(floorOf(db, FLOOR).predicate).toMatchObject({ value: 868 });
    // A stale price raises nothing.
    await checkPass(db, { at: at(30), tradeAt: at(5), prices: priced(1100) });
    expect((db.store.position as R[])[0]).toMatchObject({ protectHigh: 932 });
    expect(raises(db)).toEqual([]);

    expect(floorSale(await checkPass(db, { at: at(35), prices: priced(1020) }))).toEqual([]);
    expect(floorOf(db, FLOOR).predicate).toMatchObject({ value: 984.59 });
    expect(raises(db)).toEqual(["Floor raised to $984.59, the buy price, to protect the gain (the high since Protect gains was turned on is $1020.00)"]);
    // It never comes down, and a pass with no new line writes nothing.
    expect(floorSale(await checkPass(db, { at: at(40), prices: priced(990) }))).toEqual([]);
    expect(raises(db)).toHaveLength(1);
    expect(floorSale(await checkPass(db, { at: at(45), prices: priced(984) }))).toEqual([984]);
  });
});

describe("NVDA — a winner past its target keeps its protection", () => {
  // NVDA, PEAD Specialist: bought at $218.23, tracked high $242.51, its target a review at $243.37. A run to $260 (constructed).
  const day = () => prismaDouble(bookSeed({ only: ["NVDA"], account: on("BUY"), position: unset }));
  const priced = (price: number) => ({ NVDA: { price, prevClose: stockOf("NVDA").prevClose } });

  it("the floor rises to $247.00, past the $243.37 target, and the target stays where it is", async () => {
    const db = day();
    await checkPass(db, { prices: priced(260) });
    expect(floorOf(db, "6306936b").predicate).toMatchObject({ value: 247 });
    expect(floorOf(db, "ff683e3b").predicate).toMatchObject({ value: 243.37 });
    expect(raises(db)).toEqual(["Floor raised to $247.00 to protect the gain (5% under the $260.00 high since the buy), past its $243.37 target"]);
  });
});

describe("a raise that is refused is said on the stock", () => {
  // CEG with its target review moved under its $282.01 buy price (constructed): a thesis the shape check refuses to write.
  const day = () =>
    prismaDouble(bookSeed({
      only: ["CEG"],
      account: on("BUY"),
      position: unset,
      thesis: (s) => ({ triggers: s.triggers.map((t) => (t.id === "9dde5606" ? { ...t, predicate: { watch: "price", is: "above", value: 280 } } : t)) }),
    }));
  const notProtected = (db: PrismaDouble) => ((db.store.thesisUpdate ?? []) as R[]).filter((u) => String(u.summary).startsWith("Not protected"));

  it("one Activity line names the floor and the reason, once a day", async () => {
    const db = day();
    await checkPass(db, { prices: { CEG: { price: 300, prevClose: 299 } } });
    expect(floorOf(db, "cafcc57b").predicate).toMatchObject({ value: 287.3 });
    expect(notProtected(db).map((u) => u.summary)).toEqual([expect.stringMatching(/^Not protected: the floor could not be raised to \$292\.68 — LONG thesis requires target_price > entry_price/)]);
    // The database stamps the time; the next pass that day adds nothing.
    for (const u of notProtected(db)) u.timestamp = AT;
    await checkPass(db, { at: new Date(AT.getTime() + 5 * 60_000), prices: { CEG: { price: 300, prevClose: 299 } } });
    expect(notProtected(db)).toHaveLength(1);
  });
});

describe("V — the floor moves in steps of at least 1%", () => {
  // V, Secular Compounder: bought at $369.25, floor $365.50, high since Protect gains was turned on $404.08.
  const day = () => prismaDouble(bookSeed({ only: ["V"], account: on("NOW"), position: () => ({ protectHigh: 404.08, protectHighAt: null }) }));
  const priced = (price: number) => ({ V: { price, prevClose: stockOf("V").prevClose } });
  const at = (min: number) => new Date(AT.getTime() + min * 60_000);

  it("the first raise lands; a new high under 1% more moves nothing; the next 1% does", async () => {
    const db = day();
    await checkPass(db, { prices: priced(401.63) });
    await checkPass(db, { at: at(5), prices: priced(406) });
    await checkPass(db, { at: at(10), prices: priced(409) });
    expect(raises(db)).toEqual([
      "Floor raised to $383.88 to protect the gain (5% under the $404.08 high since Protect gains was turned on)",
      "Floor raised to $388.55 to protect the gain (5% under the $409.00 high since Protect gains was turned on)",
    ]);
  });
});
