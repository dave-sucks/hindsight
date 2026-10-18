/**
 * The owner's Protect-gains setting, through its server actions, on the
 * account's 12 holdings at 13:36 ET on 2026-10-16
 * (lib/agent/__fixtures__/book-2026-10-16.ts). Only the session and the
 * database are doubled.
 */
import { prismaDouble, type PrismaDouble } from "@/lib/replay";
import { bookSeed } from "@/lib/replay/book";

type R = Record<string, unknown>;
type Actions = typeof import("@/lib/actions/protect-gains.actions");

async function withActions<T>(db: PrismaDouble, role: "OWNER" | "VIEWER", fn: (a: Actions) => Promise<T>): Promise<T> {
  let out: T | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("next/cache", () => ({ revalidatePath: jest.fn() }));
    jest.doMock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_replay" } } }) } }) }));
    jest.doMock("@/lib/auth/account", () => ({ getAccountId: async () => "account_replay", getUserRole: async () => role }));
    out = await fn((await import("@/lib/actions/protect-gains.actions")) as Actions);
  });
  return out as T;
}

const highs = (db: PrismaDouble) => (db.store.position as R[]).map((p) => p.protectHigh);
const account = (db: PrismaDouble) => (db.store.account as R[])[0];
const seeded = () => prismaDouble(bookSeed({ account: { protectGainsOn: false, protectGainsStartPct: 3, protectGainsGiveBackPct: 5, protectGainsSince: null }, position: () => ({ protectHigh: 500, protectHighAt: null }) }));

describe("setProtectGains", () => {
  it("turning it on starts every open holding's high over and stamps when", async () => {
    const db = seeded();
    const saved = await withActions(db, "OWNER", (a) => a.setProtectGains({ on: true, startPct: 3, giveBackPct: 5 }));
    expect(saved).toMatchObject({ on: true, startPct: 3, giveBackPct: 5 });
    expect(saved.since).not.toBeNull();
    expect(new Set(highs(db))).toEqual(new Set([null]));
  });

  it("new numbers while it is on keep the high", async () => {
    const db = seeded();
    await withActions(db, "OWNER", (a) => a.setProtectGains({ on: true, startPct: 3, giveBackPct: 5 }));
    (db.store.position as R[]).forEach((p) => (p.protectHigh = 600));
    await withActions(db, "OWNER", (a) => a.setProtectGains({ on: true, startPct: 1, giveBackPct: 2 }));
    expect(new Set(highs(db))).toEqual(new Set([600]));
    expect(account(db)).toMatchObject({ protectGainsStartPct: 1, protectGainsGiveBackPct: 2 });
  });

  it("only the owner, and only sensible numbers", async () => {
    await expect(withActions(seeded(), "VIEWER", (a) => a.setProtectGains({ on: true, startPct: 3, giveBackPct: 5 }))).rejects.toThrow(/owner/);
    await expect(withActions(seeded(), "OWNER", (a) => a.setProtectGains({ on: true, startPct: 3, giveBackPct: 0.5 }))).rejects.toThrow(/Give back/);
    await expect(withActions(seeded(), "OWNER", (a) => a.setProtectGains({ on: true, startPct: 0, giveBackPct: 5 }))).rejects.toThrow(/Start once up/);
  });
});
