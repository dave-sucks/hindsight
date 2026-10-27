/**
 * Stop when buying — a save reads once and answers from the write.
 *
 * The save used to read the whole setting before AND after the write: two
 * sign-in checks and about nine queries one after another, ~2 s per save
 * with functions across the country from the database. The values below are
 * the production rows: one account turned on at 6% (from the default, off
 * at 8%), analysts on the account's setting (both null).
 */

const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const getAccountId = jest.fn();
const getUserRole = jest.fn();
jest.mock("@/lib/auth/account", () => ({
  getAccountId: (...a: unknown[]) => getAccountId(...a),
  getUserRole: (...a: unknown[]) => getUserRole(...a),
}));

const accountRead = jest.fn();
const accountUpdate = jest.fn();
const analystRead = jest.fn();
const analystUpdate = jest.fn();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findUniqueOrThrow: (...a: unknown[]) => accountRead(...a), update: (...a: unknown[]) => accountUpdate(...a) },
    agentConfig: { findFirst: (...a: unknown[]) => analystRead(...a), update: (...a: unknown[]) => analystUpdate(...a) },
  },
}));

import { getAutoStop, saveAutoStop } from "@/lib/actions/auto-stop.actions";

const ACCOUNT = "acct-1";
const ANALYST = "analyst-1";

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  getAccountId.mockResolvedValue(ACCOUNT);
  getUserRole.mockResolvedValue("OWNER");
  accountRead.mockResolvedValue({ autoStopOnBuy: false, autoStopPct: 8 });
  analystRead.mockResolvedValue({ autoStopOnBuy: null, autoStopPct: null });
  accountUpdate.mockImplementation(async ({ data }) => ({ ...data }));
  analystUpdate.mockImplementation(async ({ data }) => ({ ...data }));
});

describe("saveAutoStop", () => {
  it("turns the account setting on at 6% with one sign-in check, one read and one write", async () => {
    const r = await saveAutoStop({ level: "account", ownerId: ACCOUNT, on: true, pct: 6 });
    expect(r).toEqual({ ok: true, view: { account: { on: true, pct: 6 }, canEdit: true } });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(accountRead).toHaveBeenCalledTimes(1);
    expect(accountUpdate).toHaveBeenCalledWith({
      where: { id: ACCOUNT },
      data: { autoStopOnBuy: true, autoStopPct: 6 },
      select: { autoStopOnBuy: true, autoStopPct: true },
    });
  });

  it("answers with what a fresh read would show", async () => {
    const saved = await saveAutoStop({ level: "account", ownerId: ACCOUNT, on: true, pct: 6 });
    accountRead.mockResolvedValue({ autoStopOnBuy: true, autoStopPct: 6 });
    const reread = await getAutoStop("account", ACCOUNT);
    expect(saved).toEqual({ ok: true, view: reread });
  });

  it("gives an analyst its own values and keeps showing the account's", async () => {
    accountRead.mockResolvedValue({ autoStopOnBuy: true, autoStopPct: 6 });
    const r = await saveAutoStop({ level: "analyst", ownerId: ANALYST, on: true, pct: 10 });
    expect(r).toEqual({
      ok: true,
      view: { account: { on: true, pct: 6 }, analyst: { on: true, pct: 10 }, canEdit: true },
    });
    expect(analystRead).toHaveBeenCalledWith({ where: { id: ANALYST, accountId: ACCOUNT }, select: { autoStopOnBuy: true, autoStopPct: true } });
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("puts an analyst back on the account's setting", async () => {
    analystRead.mockResolvedValue({ autoStopOnBuy: true, autoStopPct: 10 });
    const r = await saveAutoStop({ level: "analyst", ownerId: ANALYST, reset: true });
    expect(r).toEqual({
      ok: true,
      view: { account: { on: false, pct: 8 }, analyst: { on: null, pct: null }, canEdit: true },
    });
  });

  it("still refuses a viewer, a bad percent, and another account's id, writing nothing", async () => {
    getUserRole.mockResolvedValue("VIEWER");
    expect(await saveAutoStop({ level: "account", ownerId: ACCOUNT, on: true, pct: 6 })).toEqual({
      ok: false,
      error: "You can view this setting but not change it.",
    });
    getUserRole.mockResolvedValue("OWNER");
    expect((await saveAutoStop({ level: "account", ownerId: ACCOUNT, on: true, pct: 99 })).ok).toBe(false);
    expect(await saveAutoStop({ level: "account", ownerId: "someone-else", on: true, pct: 6 })).toEqual({ ok: false, error: "Forbidden" });
    analystRead.mockResolvedValue(null);
    expect(await saveAutoStop({ level: "analyst", ownerId: "not-ours", on: true, pct: 6 })).toEqual({ ok: false, error: "Not found" });
    expect(accountUpdate).not.toHaveBeenCalled();
    expect(analystUpdate).not.toHaveBeenCalled();
  });

  it("starts the analyst, account and role reads together", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    analystRead.mockImplementation(async () => (started.push("analyst"), await gate, { autoStopOnBuy: null, autoStopPct: null }));
    accountRead.mockImplementation(async () => (started.push("account"), await gate, { autoStopOnBuy: false, autoStopPct: 8 }));
    getUserRole.mockImplementation(async () => (started.push("role"), await gate, "OWNER"));
    const pending = getAutoStop("analyst", ANALYST);
    await new Promise((r) => setImmediate(r));
    expect(started.sort()).toEqual(["account", "analyst", "role"]);
    release();
    await pending;
  });
});
