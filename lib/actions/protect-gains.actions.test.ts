/**
 * The owner's Protect-gains setting, through its server actions, on the
 * account's 12 holdings at 13:36 ET on 2026-10-16
 * (lib/agent/__fixtures__/book-2026-10-16.ts). Only the session, the database
 * and the quote are doubled.
 */
import { prismaDouble, type PrismaDouble } from "@/lib/replay";
import { bookSeed } from "@/lib/replay/book";
import { BOOK } from "@/lib/agent/__fixtures__/book-2026-10-16";

type R = Record<string, unknown>;
type Actions = typeof import("@/lib/actions/protect-gains.actions");

async function withActions<T>(db: PrismaDouble, role: "OWNER" | "VIEWER", fn: (a: Actions) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("next/cache", () => ({ revalidatePath: jest.fn() }));
    jest.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_replay" } } }) } }) }));
    jest.doMock("@/lib/auth/account", () => ({ getAccountId: async () => "account_replay", getUserRole: async () => role }));
    jest.doMock("@/lib/market-data/live-quote", () => ({
      getLiveQuotes: async (symbols: string[]) => Object.fromEntries(symbols.map((s) => [s, { quote: { c: BOOK.find((b) => b.ticker === s)!.price } }])),
    }));
    out = await fn((await import("@/lib/actions/protect-gains.actions")) as Actions);
  });
  return out as T;
}

const highs = (db: PrismaDouble) => (db.store.position as R[]).map((p) => p.protectHigh);
const account = (db: PrismaDouble) => (db.store.account as R[])[0];
const seeded = () => prismaDouble(bookSeed({ account: { protectGainsOn: false, protectGainsStartPct: 3, protectGainsGiveBackPct: 5, protectGainsFrom: "NOW", protectGainsSince: null }, position: () => ({ protectHigh: 500, protectHighAt: null }) }));

describe("setProtectGains", () => {
  it("turning it on starts every open holding's high over and stamps when", async () => {
    const db = seeded();
    const saved = await withActions(db, "OWNER", (a) => a.setProtectGains({ on: true, startPct: 3, giveBackPct: 5, from: "NOW" }));
    expect(saved).toMatchObject({ on: true, startPct: 3, giveBackPct: 5, from: "NOW" });
    expect(saved.since).not.toBeNull();
    expect(new Set(highs(db))).toEqual(new Set([null]));
  });

  it("new numbers while it is on keep the high; counting another way starts it over", async () => {
    const db = seeded();
    await withActions(db, "OWNER", (a) => a.setProtectGains({ on: true, startPct: 3, giveBackPct: 5, from: "NOW" }));
    (db.store.position as R[]).forEach((p) => (p.protectHigh = 600));
    await withActions(db, "OWNER", (a) => a.setProtectGains({ on: true, startPct: 1, giveBackPct: 2, from: "NOW" }));
    expect(new Set(highs(db))).toEqual(new Set([600]));
    expect(account(db)).toMatchObject({ protectGainsStartPct: 1, protectGainsGiveBackPct: 2 });
    await withActions(db, "OWNER", (a) => a.setProtectGains({ on: true, startPct: 1, giveBackPct: 2, from: "BUY" }));
    expect(new Set(highs(db))).toEqual(new Set([null]));
  });

  it("only the owner, and only sensible numbers", async () => {
    await expect(withActions(seeded(), "VIEWER", (a) => a.setProtectGains({ on: true, startPct: 3, giveBackPct: 5, from: "NOW" }))).rejects.toThrow(/owner/);
    await expect(withActions(seeded(), "OWNER", (a) => a.setProtectGains({ on: true, startPct: 3, giveBackPct: 0.5, from: "NOW" }))).rejects.toThrow(/Give back/);
    await expect(withActions(seeded(), "OWNER", (a) => a.setProtectGains({ on: true, startPct: 0, giveBackPct: 5, from: "NOW" }))).rejects.toThrow(/Start once up/);
  });
});

describe("previewProtectGains — the confirm list for counting from each buy", () => {
  it("3% / 5%: the seven holdings that would sell at today's price, about $1,943 under their buy prices", async () => {
    const db = prismaDouble(bookSeed());
    const sales = await withActions(db, "OWNER", (a) => a.previewProtectGains({ startPct: 3, giveBackPct: 5 }));
    expect(sales.map((s) => s.ticker)).toEqual(["ASML", "CEG", "CORT", "GEV", "MSFT", "NVDA", "PLTR"]);
    expect(Math.round(sales.reduce((sum, s) => sum + s.result, 0))).toBe(-1943);
    expect(sales.find((s) => s.ticker === "CEG")).toMatchObject({ shares: 51, price: 272.13, line: 292.68 });
  });
});
