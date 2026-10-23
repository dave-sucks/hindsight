/**
 * An account or analyst rule can be Auto only for a sale: a standing Auto buy, add or trim would fire on every
 * stock under it, with no agent. The rules as stored on 2026-10-22: the account's "up 7% in a day" add, the
 * Secular Compounder's "down 7% in a day" add and its 25%-off-the-high sale. Production holds no standing rule
 * set to Auto on anything but a sale (none is DIRECT today, so the migration writes none).
 */
import { prismaDouble, agentConfigRow, accountRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";
import type { When } from "@/lib/agent/triggers/condition";

const SECULAR = "cmmqxola3000004lbj7c11bfn";
const UP_7: When = { watch: "move", is: "above", value: 7, variable: "prev_close" };
const DOWN_7: When = { watch: "move", is: "below", value: 7, variable: "prev_close" };
const OFF_HIGH: When = { watch: "move", is: "below", value: 25, variable: "peak", settings: { widenAtr: 3 } };

async function add(level: "ACCOUNT" | "ANALYST", action: "ADD" | "TRIM" | "ENTER" | "EXIT", predicate: When, fireMode: "DO_IT" | "ASK_NOW") {
  const db = prismaDouble({ account: [accountRow({ triggers: [] })], agentConfig: [agentConfigRow({ id: SECULAR, name: "Secular Compounder", triggers: [] })] });
  let out: { ok: boolean; message?: string; fireMode?: string } = { ok: false };
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    const { addLevelTrigger } = await import("@/lib/actions/level-triggers");
    try {
      const t = await addLevelTrigger(level, level === "ACCOUNT" ? REPLAY_ACCOUNT_ID : SECULAR, { action, predicate, fireMode }, { accountId: REPLAY_ACCOUNT_ID, actorUserId: "owner" });
      out = { ok: true, fireMode: t.fireMode };
    } catch (err) {
      out = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
  jest.dontMock("@/lib/prisma");
  return out;
}

const REFUSED = { ok: false, message: "Account and analyst rules can be Auto only for a sale. Set Auto on the stock's own trigger." };

describe("Auto on a standing rule is for a sale only", () => {
  it("the account's up-7% add can't be an Auto-add; as Send to Agent it saves", async () => {
    expect(await add("ACCOUNT", "ADD", UP_7, "DO_IT")).toEqual(REFUSED);
    expect(await add("ACCOUNT", "ADD", UP_7, "ASK_NOW")).toMatchObject({ ok: true, fireMode: "ASK_NOW" });
  });

  it("the Compounder's down-7% add can't be an Auto-add, nor an Auto-trim on the same line", async () => {
    expect(await add("ANALYST", "ADD", DOWN_7, "DO_IT")).toEqual(REFUSED);
    expect(await add("ANALYST", "TRIM", UP_7, "DO_IT")).toEqual(REFUSED);
  });

  it("the Compounder's 25%-off-the-high sale can be an Auto-sell, at both levels", async () => {
    expect(await add("ANALYST", "EXIT", OFF_HIGH, "DO_IT")).toMatchObject({ ok: true, fireMode: "DO_IT" });
    expect(await add("ACCOUNT", "EXIT", OFF_HIGH, "DO_IT")).toMatchObject({ ok: true, fireMode: "DO_IT" });
  });
});
