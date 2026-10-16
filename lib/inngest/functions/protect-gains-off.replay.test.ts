/**
 * With Protect gains off, the trigger check is unchanged. The account's 12
 * holdings at 13:36 ET on 2026-10-16 (lib/agent/__fixtures__/book-2026-10-16.ts):
 * one pass, and what it sent and wrote. MAIN is main's (1dbc513d) pass on the
 * same rows.
 */
import { bookSeed, checkPass } from "@/lib/replay/book";
import { prismaDouble, type PrismaDouble } from "@/lib/replay";

type R = Record<string, unknown>;
const rows = (db: PrismaDouble, model: string) => (db.store[model] ?? []) as R[];

async function offPass(account: R) {
  const db = prismaDouble(bookSeed({ account }));
  const pass = await checkPass(db);
  const tickerOf = (id: unknown) => rows(db, "thesis").find((t) => t.id === id)?.ticker;
  return {
    events: pass.sent.map((e) => ({ ticker: e.data.ticker, triggerId: e.data.triggerId, action: e.data.action, firedPrice: e.data.firedPrice, coFired: e.data.coFired ?? null })),
    audit: rows(db, "thesisUpdate").map((u) => ({ ticker: tickerOf(u.thesisId), type: u.type, triggerId: u.triggerId, summary: u.summary })),
    stamps: rows(db, "thesis").map((t) => ({
      ticker: t.ticker,
      fired: (t.triggers as R[]).filter((x) => x.lastFiredAt === "2026-10-16T17:36:15.000Z").map((x) => x.id),
      state: Object.keys((t.triggerState ?? {}) as R).filter((k) => ((t.triggerState as Record<string, R>)[k]?.firedAt as string) === "2026-10-16T17:36:15.000Z"),
    })).filter((s) => s.fired.length || s.state.length),
    positions: rows(db, "position").map((p) => ({ symbol: p.symbol, protectHigh: p.protectHigh ?? null })),
  };
}

// Recorded on main: three floors fire (CEG, IOT, NVDA) and are stamped; nothing else is written.
const MAIN = {
  events: [
    { ticker: "CEG", triggerId: "cafcc57b", action: "EXIT", firedPrice: 272.13, coFired: null },
    { ticker: "IOT", triggerId: "cf1e7fd0", action: "EXIT", firedPrice: 39.4, coFired: null },
    { ticker: "NVDA", triggerId: "6306936b", action: "EXIT", firedPrice: 215.68, coFired: null },
  ],
  audit: [],
  stamps: [
    { ticker: "CEG", fired: ["cafcc57b"], state: [] },
    { ticker: "IOT", fired: ["cf1e7fd0"], state: [] },
    { ticker: "NVDA", fired: ["6306936b"], state: [] },
  ],
  positions: ["AAPL", "ASML", "CEG", "CORT", "GEV", "IOT", "MSFT", "MU", "NVDA", "PLTR", "V", "WST"].map((symbol) => ({ symbol, protectHigh: null })),
};

describe("Protect gains, switched off — the 2026-10-16 13:36 book", () => {
  it("one pass of the trigger check sends and writes exactly what main does", async () => {
    const pass = await offPass({ protectGainsOn: false });
    expect(pass).toEqual(MAIN);
  });
});
