/**
 * loadSharedNotes past its cap: once the reviewer writes daily, the newest
 * 100 can leave out a note the owner pinned weeks ago or a note still asking
 * a stock for an answer. Those load anyway. Made-up notes, the doubled database.
 */
import { prismaDouble, type PrismaDouble } from "@/lib/replay";

let db: PrismaDouble;
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));

import { loadSharedNotes, NOTES_LOADED } from "./shared-notes.server";

const NOW = new Date("2026-11-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const note = (id: string, over: Record<string, unknown>) => ({
  id, userId: "user_owner", author: "MARKET_REVIEWER", runId: "run_mr", body: id, audience: "STOCKS", analystId: null,
  tickers: ["MU"], eventDate: null, levels: {}, pinnedUntil: null, ...over,
});

describe("the notes a read loads", () => {
  it("the newest 100, and past them the owner's, the pinned and those still asking a stock for an answer", async () => {
    const daily = Array.from({ length: NOTES_LOADED }, (_, i) => note(`context_${i}`, { createdAt: hoursAgo(i + 1) }));
    db = prismaDouble({
      sharedNote: [
        ...daily,
        note("owner_old", { author: "OWNER", createdAt: hoursAgo(500) }),
        note("pinned_old", { author: "OWNER", audience: "ACCOUNT", tickers: [], pinnedUntil: new Date("2026-11-20T00:00:00Z"), createdAt: hoursAgo(600) }),
        note("review_old", { levels: { MU: "REVIEW" }, createdAt: hoursAgo(700) }),
        note("context_old", { createdAt: hoursAgo(800) }),
      ],
    });
    const ids = (await loadSharedNotes("user_owner", NOW)).map((n) => n.id);
    expect(ids).toHaveLength(NOTES_LOADED + 3);
    expect(ids.slice(-3)).toEqual(["owner_old", "pinned_old", "review_old"]);
    expect(ids).not.toContain("context_old");
  });
});
