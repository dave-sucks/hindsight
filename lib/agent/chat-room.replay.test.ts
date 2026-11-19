/**
 * The chat sees each analyst's room before it offers a buy. On 2026-10-15
 * the chat pinned to the Secular Compounder offered a MU buy and learned at
 * 10:57 from place_trade's refusal that the analyst held 8 of 8. Its eight
 * holdings were the ones at the 10-14 close, the rows used here.
 */
import { prismaDouble, positionRow, agentConfigRow, REPLAY_ACCOUNT_ID } from "@/lib/replay";
import book from "@/lib/agent/__fixtures__/master-chat-writes-2026-10-14.json";

const SECULAR = "cmmqxola3000004lbj7c11bfn";

type Facts = { theAnalyst: typeof import("@/lib/agent/context/the-analyst").theAnalyst; theAnalysts: typeof import("@/lib/agent/context/the-analysts").theAnalysts };

/** The chat's facts as its loaders read them (lib/agent/context/), on the 10-14 close's book. */
async function withBook<T>(fn: (facts: Facts) => Promise<T>): Promise<T> {
  const db = prismaDouble({
    agentConfig: book.analysts.map((a) => agentConfigRow({ ...a, accountId: REPLAY_ACCOUNT_ID })),
    position: book.positions.map((p) => positionRow({ ...p, accountId: REPLAY_ACCOUNT_ID, status: "OPEN" })),
  });
  let out: T | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    out = await fn({ ...(await import("@/lib/agent/context/the-analyst")), ...(await import("@/lib/agent/context/the-analysts")) });
  });
  jest.dontMock("@/lib/prisma");
  return out as T;
}

const chatRun = (analystId: string | null) => ({ subject: { kind: "chat" as const, userId: "user_1", accountId: REPLAY_ACCOUNT_ID, environment: "PAPER" as const, analystId }, now: new Date("2026-10-15T14:57:00Z"), agent: "chat" as const });

describe("the chat's prompt carries each analyst's room", () => {
  it("pinned to the Secular Compounder: 8 of 8, FULL, in its brief", async () => {
    const prompt = await withBook(async ({ theAnalyst }) => (await theAnalyst.chat!(chatRun(SECULAR))) ?? "");
    expect(prompt).toContain("- Positions: 8 of 8 — this analyst is FULL. place_trade will refuse any new buy until one closes.");
  });

  it("unpinned: one line per analyst, the full one named", async () => {
    const prompt = await withBook(async ({ theAnalysts }) => (await theAnalysts.chat!(chatRun(null))) ?? "");
    expect(prompt).toContain("## Each analyst's room (a buy for a FULL analyst is refused)\n");
    expect(prompt).toContain("  • Secular Compounder: Positions: 8 of 8 — this analyst is FULL. place_trade will refuse any new buy until one closes. Largest trade $10,000; most in one stock $20,000.");
    expect(prompt).toContain("  • PEAD Specialist: Positions: 1 of 6 — 5 free. Largest trade $14,000; most in one stock $28,000.");
  });
});
