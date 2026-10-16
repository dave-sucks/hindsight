/**
 * With the switch off, sales wait as before. The account's 12 holdings at 13:36 ET
 * on 2026-10-16 (lib/agent/__fixtures__/book-2026-10-16.ts), with no sale
 * waiting so every fire reaches its run: one pass of the trigger check, then
 * the trigger run of every sale it fires. MAIN is what main (1dbc513d)
 * produced on the same rows. The one difference is the owner's floor rule,
 * which no switch holds back: the floor on the chart sells automatically.
 */
import { bookSeed, checkPass, triggerRun } from "@/lib/replay/book";
import { prismaDouble, type PrismaDouble } from "@/lib/replay";

type R = Record<string, unknown>;
const rows = (db: PrismaDouble, model: string) => (db.store[model] ?? []) as R[];

async function offDay(account: R) {
  const db = prismaDouble(bookSeed({ account }));
  const pass = await checkPass(db);
  const tickerOf = (id: unknown) => rows(db, "thesis").find((t) => t.id === id)?.ticker;
  const runs = [];
  for (const e of pass.sent.filter((x) => x.data.action === "EXIT")) {
    const run = await triggerRun(db, e.data);
    runs.push({ ticker: e.data.ticker, returned: run.returned?.skipped ?? (run.returned?.direct as R | undefined)?.kind ?? "agent", modelCalls: run.modelCalls, broker: run.sent.length });
  }
  return {
    events: pass.sent.map((e) => ({ ticker: e.data.ticker, triggerId: e.data.triggerId, action: e.data.action, firedPrice: e.data.firedPrice, coFired: e.data.coFired ?? null })),
    audit: rows(db, "thesisUpdate").map((u) => ({ ticker: tickerOf(u.thesisId), type: u.type, triggerId: u.triggerId, summary: u.summary, priceAtTime: u.priceAtTime })),
    orders: rows(db, "order").map((o) => ({ symbol: o.symbol, intent: o.intent, status: o.status, closeReason: o.closeReason, closeSource: o.closeSource, quantity: o.quantity })),
    positions: rows(db, "position").map((p) => ({ symbol: p.symbol, status: p.status })),
    runs,
  };
}

// Recorded on main: the IOT floor (DIRECT) stages a proposal; CEG and NVDA (TACTICAL) wake their agent.
const MAIN = {
  events: [
    { ticker: "CEG", triggerId: "cafcc57b", action: "EXIT", firedPrice: 272.13, coFired: null },
    { ticker: "IOT", triggerId: "cf1e7fd0", action: "EXIT", firedPrice: 39.4, coFired: null },
    { ticker: "NVDA", triggerId: "6306936b", action: "EXIT", firedPrice: 215.68, coFired: null },
  ],
  audit: [
    { ticker: "CEG", type: "TRIGGER_FIRED", triggerId: "cafcc57b", summary: "Sell if below $287.30", priceAtTime: 272.13 },
    { ticker: "IOT", type: "TRIGGER_FIRED", triggerId: "cf1e7fd0", summary: "Sell if below $41.42", priceAtTime: 39.4 },
    { ticker: "NVDA", type: "TRIGGER_FIRED", triggerId: "6306936b", summary: "Sell if below $236", priceAtTime: 215.68 },
  ],
  orders: [
    { symbol: "IOT", intent: "CLOSE", status: "AWAITING_APPROVAL", closeReason: "STOP", closeSource: "price_monitor", quantity: 300 },
  ],
  positions: ["AAPL", "ASML", "CEG", "CORT", "GEV", "IOT", "MSFT", "MU", "NVDA", "PLTR", "V", "WST"].map((symbol) => ({ symbol, status: "OPEN" })),
  runs: [
    { ticker: "CEG", returned: "agent", modelCalls: 1, broker: 0 },
    { ticker: "IOT", returned: "proposed", modelCalls: 0, broker: 0 },
    { ticker: "NVDA", returned: "agent", modelCalls: 1, broker: 0 },
  ],
};

// The floor rule, which no switch holds back: every breached floor on the book is a sale with no model call.
// ASML and PLTR (stored "at most once a day", already fired today) are asked again; CEG and NVDA (stored
// "ask the analyst first") propose instead of waking their analyst; IOT's was already DIRECT.
const FLOORS = [
  { ticker: "ASML", triggerId: "8e790d37", price: 1660.26, level: "$1835", quantity: 5 },
  { ticker: "CEG", triggerId: "cafcc57b", price: 272.13, level: "$287.30", quantity: 51 },
  { ticker: "IOT", triggerId: "cf1e7fd0", price: 39.4, level: "$41.42", quantity: 300 },
  { ticker: "NVDA", triggerId: "6306936b", price: 215.68, level: "$236", quantity: 33 },
  { ticker: "PLTR", triggerId: "21976408", price: 186.09, level: "$196", quantity: 38 },
];

describe("floor sales at once, switched off — the 2026-10-16 13:36 book", () => {
  it("every breached floor proposes its sale with no model call; nothing else differs from main", async () => {
    const day = await offDay({ floorSalesAtOnce: false });
    expect(day).toEqual({
      events: FLOORS.map((f) => ({ ticker: f.ticker, triggerId: f.triggerId, action: "EXIT", firedPrice: f.price, coFired: null })),
      audit: FLOORS.map((f) => ({ ticker: f.ticker, type: "TRIGGER_FIRED", triggerId: f.triggerId, summary: `Sell if below ${f.level}`, priceAtTime: f.price })),
      orders: FLOORS.map((f) => ({ symbol: f.ticker, intent: "CLOSE", status: "AWAITING_APPROVAL", closeReason: "STOP", closeSource: "price_monitor", quantity: f.quantity })),
      positions: MAIN.positions,
      runs: FLOORS.map((f) => ({ ticker: f.ticker, returned: "proposed", modelCalls: 0, broker: 0 })),
    });
    // Everything main fired still fires, and main's one proposal is still made.
    expect(day.events).toEqual(expect.arrayContaining(MAIN.events));
    expect(day.orders).toEqual(expect.arrayContaining(MAIN.orders));
  });
});
