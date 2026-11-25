/**
 * Trades lists what we own or owned. On Nov 25 the Live book's /trades showed
 * a buy still waiting for approval (PANW, a Position in PENDING_APPROVAL with
 * an AWAITING_APPROVAL order) under Open, with an entry, a P&L, a quantity and
 * a value, and its Closed tab held 35 buys that never filled (CANCELLED, their
 * orders EXPIRED or WITHDRAWN), counted in "of 58 trades". The rows below are
 * those shapes, run through the page and getDashboardData with the database
 * standing in (stand-in quantities and prices).
 */
type Row = Record<string, unknown> & { status: string; environment: string };
const at = (iso: string) => new Date(iso);
const order = (status: string, intent: string, filledAt: Date | null = null) => ({
  id: `ord_${status}_${intent}`, side: intent === "OPEN" ? "BUY" : "SELL", status, intent, filledAt,
  filledPrice: null, createdAt: at("2026-11-25T15:00:00Z"), alpacaOrderId: null, quantity: 10, expiresAt: null, proposedPrice: 100,
});
const position = (id: string, symbol: string, status: string, over: Record<string, unknown> = {}): Row => ({
  id, symbol, status, environment: "LIVE", accountId: "acct", direction: "LONG", avgCost: 100, quantity: 10,
  targetPrice: null, stopLoss: 90, openedAt: at("2026-11-20T15:00:00Z"), closedAt: null, closePrice: null,
  realizedPnl: null, outcome: null, analystId: "analyst_1", analyst: { name: "PEAD Specialist" }, orders: [], decisions: [],
  ...over,
});
const ROWS: Row[] = [
  // Held, bought last week.
  position("pos_keys", "KEYS", "OPEN", { orders: [order("FILLED", "OPEN", at("2026-11-24T15:00:00Z"))] }),
  // Held, with a sale waiting for approval: a holding, Sell on its row.
  position("pos_iot", "IOT", "OPEN", { orders: [order("AWAITING_APPROVAL", "CLOSE"), order("FILLED", "OPEN", at("2026-11-13T15:00:00Z"))] }),
  // A buy waiting for approval: no shares bought.
  position("pos_panw", "PANW", "PENDING_APPROVAL", { openedAt: at("2026-11-25T15:00:00Z"), orders: [order("AWAITING_APPROVAL", "OPEN")] }),
  // A buy that never filled: withdrawn at the close.
  position("pos_wst", "WST", "CANCELLED", { closedAt: at("2026-11-17T21:20:00Z"), orders: [order("WITHDRAWN", "OPEN")] }),
  // Sold at a gain.
  position("pos_v", "V", "CLOSED", { closedAt: at("2026-11-10T20:00:00Z"), closePrice: 110, realizedPnl: 100, outcome: "WIN", orders: [order("FILLED", "OPEN", at("2026-10-05T15:00:00Z"))] }),
];

/** The where clause's status, as the database reads it. */
function statusMatches(status: string, want: unknown): boolean {
  if (want == null) return true;
  if (typeof want === "string") return status === want;
  const w = want as { in?: string[] };
  return w.in ? w.in.includes(status) : true;
}

jest.mock("@/lib/prisma", () => {
  const empty = (op: string) => (op.startsWith("findMany") || op === "groupBy" ? [] : op === "count" ? 0 : null);
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, op: string) => async (args?: { where?: { status?: unknown; environment?: string } }) =>
        name === "position" && op === "findMany"
          ? ROWS.filter((r) => statusMatches(r.status, args?.where?.status) && (!args?.where?.environment || r.environment === args.where.environment))
          : empty(op),
    });
  return { prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) };
});
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_owner" } } }) } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct", getOwnerUserId: async () => "user_owner" }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
jest.mock("@/lib/actions/environment.actions", () => ({ getCurrentEnvironment: async () => "LIVE" }));
jest.mock("@/lib/actions/finnhub.actions", () => ({ getStockProfile: async () => null, getStockCandles: async () => [] }));
jest.mock("@/lib/market-data/live-quote", () => ({ getLiveQuotes: async () => ({}) }));
jest.mock("@/components/trades/TradesPage", () => ({ __esModule: true, default: function TradesPage() { return null; } }));
jest.mock("@/components/LiveRefresh", () => ({ LiveRefresh: function LiveRefresh() { return null; } }));

import { isValidElement, type ReactElement } from "react";
import TradesPage from "@/components/trades/TradesPage";
import Trades from "./page";
import type { MockTrade } from "@/lib/mock-data/trades";

function pageProps(node: unknown): { initialOpenTrades: MockTrade[]; initialClosedTrades: MockTrade[] } | null {
  if (!isValidElement(node)) return Array.isArray(node) ? node.map(pageProps).find(Boolean) ?? null : null;
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === TradesPage) return el.props as never;
  return pageProps(el.props.children);
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("/trades on the Live book", () => {
  it("lists the stocks we hold, and not a buy waiting for approval", async () => {
    const props = pageProps(await Trades());
    expect(props?.initialOpenTrades.map((t) => t.ticker)).toEqual(["KEYS", "IOT"]);
  });

  it("keeps a held stock with a sale waiting as a holding, its Sell on the row", async () => {
    const iot = pageProps(await Trades())?.initialOpenTrades.find((t) => t.ticker === "IOT");
    expect(iot?.status).toBe("OPEN");
    expect(iot?.pendingProposal?.intent).toBe("CLOSE");
  });

  it("lists what we sold, and not a buy that never filled", async () => {
    const props = pageProps(await Trades());
    expect(props?.initialClosedTrades.map((t) => t.ticker)).toEqual(["V"]);
  });
});
