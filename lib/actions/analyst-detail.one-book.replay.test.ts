/**
 * An analyst's page shows its own book's trades. PEAD Specialist trades LIVE since its promotion, and its
 * page added its paper trades in: on 2026-11-27 its realized P&L read about $15,200, of which $12,728 was
 * paper (a single paper MU trade made $11,652) against $2,458 live. Its card in the grid, scoped to its
 * book, never did. These are its real positions (ids, book, outcome, realized P&L; the money is stand-in
 * otherwise), through getAnalystDetail with the database doubled.
 */
import { prismaDouble, positionRow, agentConfigRow, REPLAY_ACCOUNT_ID, type PrismaDouble } from "@/lib/replay";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_owner" } } }) } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => REPLAY_ACCOUNT_ID }));
jest.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { getAnalystDetail } from "./analyst.actions";

const PEAD = "cmnhxpjio000004jvox6kl6c7";
const pos = (id: string, symbol: string, environment: string, status: string, outcome: string | null, realizedPnl: number | null, openedAt: string) =>
  positionRow({ id, symbol, environment, status, outcome, realizedPnl, openedAt: new Date(openedAt), accountId: REPLAY_ACCOUNT_ID, analystId: PEAD, closePrice: status === "CLOSED" ? 100 : null, decisions: [], orders: [] });

beforeEach(() => {
  db = prismaDouble({
    agentConfig: [agentConfigRow({ id: PEAD, name: "PEAD Specialist", accountId: REPLAY_ACCOUNT_ID, tradingEnvironment: "LIVE" })],
    position: [
      // Paper, before the promotion.
      pos("cmobfs1xz00e804l5c7nhg9nz", "MU", "PAPER", "CLOSED", "WIN", 11652.06, "2026-04-23T12:06:57Z"),
      pos("cmpgznsbn000804la56m21cnm", "MRVL", "PAPER", "CLOSED", "WIN", 252.49, "2026-05-22T14:02:03Z"),
      pos("cmnn5376d000c04jo1454g8l4", "MRVL", "PAPER", "CLOSED", "WIN", 165.51, "2026-04-06T12:01:13Z"),
      // Live.
      pos("cmwwgybst000q08lbb46jidpk", "PANW", "LIVE", "PENDING_APPROVAL", null, null, "2026-11-25T18:40:37Z"),
      pos("cmwtqwl17001c08jvumgnma1g", "KEYS", "LIVE", "OPEN", null, null, "2026-11-23T20:58:14Z"),
      pos("cmwnosh8e000c07jmgvs54z75", "PANW", "LIVE", "CLOSED", "LOSS", -196.53, "2026-11-19T16:03:29Z"),
      pos("cmv9m90g0000a06l3zv45o24s", "IOT", "LIVE", "OPEN", null, null, "2026-10-15T15:16:02Z"),
    ],
  });
});

describe("PEAD Specialist's page, 2026-11-27: its live book only", () => {
  it("lists its live trades, newest first, and none of its paper ones", async () => {
    const detail = await getAnalystDetail(PEAD);
    expect(detail?.recentTrades.map((t) => t.id)).toEqual(["cmwtqwl17001c08jvumgnma1g", "cmwnosh8e000c07jmgvs54z75", "cmv9m90g0000a06l3zv45o24s"]);
  });

  it("its record is the live one: one loss, no paper wins", async () => {
    const detail = await getAnalystDetail(PEAD);
    expect(detail?.stats).toMatchObject({ wins: 0, losses: 1, winRate: 0, totalPnl: -196.53 });
  });
});
