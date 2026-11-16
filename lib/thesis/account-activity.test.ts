/**
 * account-activity.test.ts — the homepage Activity is the stocks' Activity
 * lists cut to trades and watch status, named by stored fields. Every row is
 * a live-account row as stored (text cut to its opening): IOT's buy (10-15),
 * CORT's sale and the stop-watch that followed (10-20, 10-27), MSFT's
 * Auto-sell and return to watch (11-12, 11-13), NVDA's expired sale card
 * (11-12), SMCI's dropped watch (10-19), SNDK's pass (11-04), and CEG's sale
 * by your own click on paper, never a proposal (08-12).
 */
const orderFind = jest.fn();
const lineFind = jest.fn();
jest.mock("@/lib/prisma", () => ({ prisma: { order: { findMany: (a: unknown) => orderFind(a) }, thesisUpdate: { findMany: (a: unknown) => lineFind(a) } } }));

import { loadAccountActivity } from "./account-activity.server";
import { accountActivityKind } from "./account-activity";

const at = (iso: string) => new Date(iso);
const order = (o: Record<string, unknown>) => ({
  rationale: null, rejectionMessage: null, withdrawnReason: null, alpacaConfirmedAt: null, filledPrice: null, filledAt: null, triggerIds: [], ...o,
});

const ORDERS = [
  // IOT: a buy proposal, approved and filled.
  order({ id: "cmv9m90hs000b06l3xlg7n6ov", thesisId: "cmu062bge000004jtd1aqp304", symbol: "IOT", intent: "OPEN", side: "BUY", status: "FILLED", quantity: 300, expiresAt: at("2026-10-16T14:10:30.562Z"), filledPrice: 42.695, filledAt: at("2026-10-15T15:16:03.150Z"), alpacaConfirmedAt: at("2026-10-15T15:16:03.143Z"), createdAt: at("2026-10-15T14:10:30.084Z"), updatedAt: at("2026-10-15T15:20:13.410Z"), positionId: "cmv9m90g0000a06l3zv45o24s", position: { avgCost: 42.695 }, rationale: "Buying Samsara at $42.21." }),
  // CORT: the analyst's sale proposal, approved and filled.
  order({ id: "cmvfsv9si000207l2x9009qwp", thesisId: "cmuhp4n4e000e04kx3vkxm5lr", symbol: "CORT", intent: "CLOSE", side: "SELL", status: "FILLED", quantity: 43, expiresAt: at("2026-10-20T22:02:23.037Z"), filledPrice: 112.580465, filledAt: at("2026-10-20T13:45:44.474Z"), alpacaConfirmedAt: at("2026-10-20T13:45:44.424Z"), createdAt: at("2026-10-19T22:02:23.037Z"), updatedAt: at("2026-10-20T13:50:11.772Z"), positionId: "cmumrx45e000204kzra9s0ows", position: { avgCost: 116.0313 }, rationale: "Selling Corcept at ~$112." }),
  // NVDA: a sale card left to lapse.
  order({ id: "cmwdntsn8000o08lfc8r6qltx", thesisId: "cmtg9nbdy000204jpc6cwawgg", symbol: "NVDA", intent: "CLOSE", side: "SELL", status: "EXPIRED", quantity: 33, expiresAt: at("2026-11-13T14:45:26.432Z"), createdAt: at("2026-11-12T14:45:26.432Z"), updatedAt: at("2026-11-13T15:00:20.380Z"), positionId: "cmtha1mcg000804kyrns3lpjg", position: { avgCost: 218.2259 }, rationale: "Nvidia is down about 8% again today." }),
  // MSFT: the Auto-sell's card (an Auto-sell is a proposal while approvals are on), approved and filled.
  order({ id: "cmwdp2dva000c08i3gceyzuru", thesisId: "cmoh5nfsg008m04jubqafc6c6", symbol: "MSFT", intent: "CLOSE", side: "SELL", status: "FILLED", quantity: 17, expiresAt: at("2026-11-13T15:20:06.819Z"), filledPrice: 522.361, filledAt: at("2026-11-12T20:49:28.242Z"), alpacaConfirmedAt: at("2026-11-12T20:49:28.265Z"), createdAt: at("2026-11-12T15:20:06.819Z"), updatedAt: at("2026-11-12T20:50:06.466Z"), positionId: "cmuvp2d66000704jx65yspjo4", position: { avgCost: 531.0146 }, rationale: "Microsoft slipped again." }),
  // CEG (paper): your own click, never a proposal.
  order({ id: "cmspjupqq000304jrxqdebi1p", thesisId: "thesis-ceg", symbol: "CEG", intent: "CLOSE", side: "SELL", status: "FILLED", quantity: 44, expiresAt: null, filledPrice: 281.430909, filledAt: at("2026-08-12T13:32:19.304Z"), createdAt: at("2026-08-12T03:48:35.608Z"), updatedAt: at("2026-08-12T13:35:07.261Z"), positionId: "cmsn6ntgy000z04l4pxx0rkqj", position: { avgCost: 271.58 } }),
];

const line = (l: Record<string, unknown>) => ({ priceAtTime: null, tradeId: null, runId: null, rationale: null, ...l });
const LINES = [
  line({ id: "cmv9olbjf000106l828avf3hh", thesisId: "cmu062bge000004jtd1aqp304", thesis: { ticker: "IOT" }, type: "STATUS_CHANGED", timestamp: at("2026-10-15T15:16:03.627Z"), summary: "Promoted IOT LONG WATCHING → HOLDING on approved proposal", fieldChanges: { status: { to: "HOLDING", from: "WATCHING" } }, tradeId: "cmv9m90g0000a06l3zv45o24s" }),
  line({ id: "cmvf7e00r000308i162buthms", thesisId: "cmukjqjf7000304l9a1dnqozl", thesis: { ticker: "SMCI" }, type: "STATUS_CHANGED", timestamp: at("2026-10-19T12:01:05.691Z"), summary: "Updated SMCI: WATCHING → RETIRED", rationale: "Watching Super Micro at $31.63. The CFO appointment filing is not the catalyst I needed.", fieldChanges: { status: { to: "RETIRED", from: "WATCHING" }, retiredReason: { to: "DROPPED", from: null } }, priceAtTime: 31.63 }),
  line({ id: "cmvgqkfvr000108l3662pqom6", thesisId: "cmuhp4n4e000e04kx3vkxm5lr", thesis: { ticker: "CORT" }, type: "CLOSED", timestamp: at("2026-10-20T13:45:45.063Z"), summary: "Closed CORT on approved proposal — MANUAL; belief intact, kept on watch", rationale: "Selling Corcept at ~$112.", fieldChanges: { status: { to: "WATCHING", from: "HOLDING" }, beliefSurvived: { to: true, from: null } } }),
  line({ id: "cmvqn0jdd000r08l09da6m0oa", thesisId: "cmuhp4n4e000e04kx3vkxm5lr", thesis: { ticker: "CORT" }, type: "STATUS_CHANGED", timestamp: at("2026-10-27T12:03:59.377Z"), summary: "Updated CORT: WATCHING → RETIRED", rationale: "Corcept closed at $87.13 on Oct. 26 after reporting positive BELLA ovarian-cancer data.", fieldChanges: { status: { to: "RETIRED", from: "WATCHING" }, retiredReason: { to: "DROPPED", from: null } }, priceAtTime: 87.125 }),
  // SNDK's first line, as the 20261116 migration stamps it.
  line({ id: "cmw1fb4pr000108le31olfmdd", thesisId: "cmw1fb4ot000008le7shta4vi", thesis: { ticker: "SNDK" }, type: "CREATED", timestamp: at("2026-11-04T01:13:44.607Z"), summary: "Passed on SNDK", rationale: "SanDisk reported fiscal Q1 2027 on October 29.", fieldChanges: { status: { from: null, to: "PASSED" } } }),
  line({ id: "cmwe0txx6000108ifn99v1dzr", thesisId: "cmoh5nfsg008m04jubqafc6c6", thesis: { ticker: "MSFT" }, type: "CLOSED", timestamp: at("2026-11-12T20:49:28.314Z"), summary: "Closed MSFT position on approved proposal — STOP", rationale: "Microsoft slipped again.", fieldChanges: { status: { to: "RETIRED", from: "HOLDING" }, retiredReason: { to: "SOLD", from: null } } }),
  line({ id: "cmweznpj6002a07jpaeedvr6w", thesisId: "cmoh5nfsg008m04jubqafc6c6", thesis: { ticker: "MSFT" }, type: "STATUS_CHANGED", timestamp: at("2026-11-13T13:04:24.066Z"), summary: "Updated MSFT: Entry set: $559.15, RETIRED → WATCHING", rationale: "Microsoft is flat since yesterday’s sale.", fieldChanges: { status: { to: "WATCHING", from: "RETIRED" }, retiredReason: { to: null, from: "SOLD" } }, priceAtTime: 523 }),
];

beforeEach(() => {
  orderFind.mockResolvedValue(ORDERS);
  lineFind.mockResolvedValue(LINES);
});

describe("the homepage Activity, from the live account's rows", () => {
  it("lists every trade step and every change of watch status, newest first", async () => {
    const feed = await loadAccountActivity({ accountId: "acct", environment: "LIVE" });
    expect(feed.map((l) => `${l.ticker} ${l.kind}`)).toEqual([
      "NVDA expired", // its deadline, the next morning
      "MSFT watching", // back on watch the morning after the sale
      "MSFT closed",
      "MSFT sold",
      "MSFT proposed",
      "NVDA proposed",
      "SNDK passed",
      "CORT stopped-watching",
      "CORT watching", // sold, kept on watch
      "CORT sold",
      "CORT proposed",
      "SMCI stopped-watching",
      "IOT holding",
      "IOT bought",
      "IOT proposed",
      "CEG sold", // your own click: its fill is its one line
    ]);
  });

  it("gives a sale its price and its gain on the cost it sold from", async () => {
    const feed = await loadAccountActivity({ accountId: "acct", environment: "LIVE" });
    const sale = (t: string) => feed.find((l) => l.ticker === t && l.kind === "sold")!;
    // Position.realizedPnl on these rows: CORT −148.385905, MSFT −147.1112.
    expect(sale("CORT")).toMatchObject({ text: "Sold 43 shares at $112.58", positionId: "cmumrx45e000204kzra9s0ows" });
    expect(sale("CORT").gain!.dollar).toBeCloseTo(-148.39, 2);
    expect(sale("CORT").gain!.pct).toBeCloseTo(-2.97, 2);
    expect(sale("MSFT").gain!.dollar).toBeCloseTo(-147.11, 2);
    expect(sale("CEG")).toMatchObject({ text: "Sold 44 shares at $281.43" });
    expect(sale("CEG").gain!.dollar).toBeCloseTo(433.44, 2);
    expect(feed.find((l) => l.kind === "bought")).toMatchObject({ ticker: "IOT", text: "Bought 300 shares at $42.70", gain: null });
  });

  it("says why a watch ended in the words on the line, and links a status change to its stock", async () => {
    const feed = await loadAccountActivity({ accountId: "acct", environment: "LIVE" });
    expect(feed.find((l) => l.ticker === "SMCI")).toMatchObject({ kind: "stopped-watching", text: "Watching Super Micro at $31.63. The CFO appointment filing is not the catalyst I needed.", positionId: null });
    expect(feed.find((l) => l.kind === "expired")).toMatchObject({ ticker: "NVDA", text: "Expired sell 33 shares — no decision", waiting: false });
  });

  it("loads only the book's orders that carry their stock, and only the lines that changed a status", async () => {
    await loadAccountActivity({ accountId: "acct", environment: "LIVE" });
    expect(orderFind.mock.calls[0][0].where).toEqual({ thesisId: { not: null }, position: { accountId: "acct", environment: "LIVE" } });
    const where = lineFind.mock.calls[0][0].where;
    expect(where.fieldChanges.path).toEqual(["status"]);
    // A watch written on paper and bought live is on the live book.
    expect(where.OR[1].thesisId.in).toContain("cmoh5nfsg008m04jubqafc6c6");
  });
});

describe("the one filter reads stored fields, never words", () => {
  it("a stock the close took off the watchlist (stop-watching.ts's line) is a stopped watch", () => {
    expect(accountActivityKind({ type: "TRIGGER_FIRED", fieldChanges: { status: { from: "WATCHING", to: "RETIRED" }, retiredReason: { from: null, to: "DROPPED" } } })).toBe("stopped-watching");
  });
  it("a fire, a review and a note are not on it, whatever they say", () => {
    expect(accountActivityKind({ type: "TRIGGER_FIRED", fieldChanges: {} })).toBeNull();
    expect(accountActivityKind({ type: "REVIEWED", fieldChanges: {} })).toBeNull();
    expect(accountActivityKind({ type: "UPDATED", fieldChanges: { stopLoss: { from: 40, to: 42 } } })).toBeNull();
  });
});
