/**
 * Pause / Resume: the analyst menu's item writes `AgentConfig.enabled`, the
 * switch the morning run, the trigger runs and the buy tools read, and only
 * on an analyst of the signed-in account. Who may click it is proven with
 * the other switches, in money-moves-need-an-editor.test.ts.
 */
jest.mock("@/lib/auth/editor", () => ({ requireEditor: async () => ({ userId: "user-1", accountId: "acct-1" }) }));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/alpaca", () => ({ getLatestPricesWithMeta: async () => ({}) }));
jest.mock("@/lib/agent/triggers/seed-analyst", () => ({ seedAnalystTriggers: async () => {} }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

const updateMany = jest.fn();
jest.mock("@/lib/prisma", () => ({ prisma: { agentConfig: { updateMany: (...a: unknown[]) => updateMany(...a) } } }));

import { setAnalystPaused } from "@/lib/actions/analyst.actions";

beforeEach(() => {
  jest.clearAllMocks();
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

  it("a value that is not true or false writes nothing: the word \"false\" must not read as a resume", async () => {
    await expect(setAnalystPaused("analyst-1", "false" as never)).rejects.toThrow("Paused is true or false");
    expect(updateMany).not.toHaveBeenCalled();
  });
});
