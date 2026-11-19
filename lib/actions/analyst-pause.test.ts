/**
 * Pause / Resume: the analyst menu's item writes `AgentConfig.enabled`, the
 * switch the morning run, the trigger runs and the buy tools read, and only
 * on an analyst of the signed-in account.
 */

const getUser = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct-1" }));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/alpaca", () => ({ getLatestPricesWithMeta: async () => ({}) }));
jest.mock("@/lib/agent/triggers/seed-analyst", () => ({ seedAnalystTriggers: async () => {} }));

const updateMany = jest.fn();
jest.mock("@/lib/prisma", () => ({ prisma: { agentConfig: { updateMany: (...a: unknown[]) => updateMany(...a) } } }));

import { setAnalystPaused } from "@/lib/actions/analyst.actions";

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  updateMany.mockResolvedValue({ count: 1 });
});

describe("setAnalystPaused", () => {
  it("pausing turns the analyst off, on this account only", async () => {
    await setAnalystPaused("analyst-1", true);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "analyst-1", accountId: "acct-1" }, data: { enabled: false } });
    expect(revalidatePath).toHaveBeenCalledWith("/analysts");
  });

  it("resuming turns it back on", async () => {
    await setAnalystPaused("analyst-1", false);
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "analyst-1", accountId: "acct-1" }, data: { enabled: true } });
  });

  it("refuses an analyst that is not on the account", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(setAnalystPaused("someone-elses", true)).rejects.toThrow("Analyst not found");
  });

  it("refuses when nobody is signed in, and writes nothing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(setAnalystPaused("analyst-1", true)).rejects.toThrow("Not authenticated");
    expect(updateMany).not.toHaveBeenCalled();
  });
});
