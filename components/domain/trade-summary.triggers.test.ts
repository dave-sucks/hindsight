/**
 * A buy proposal's card says its "Sell if below" and each trigger that comes
 * with the buy, as its sentence (lib/proposals/buy-triggers.ts), on both
 * looks: the sheet's banner and the page card. AAPL's proposal, 2026-11-13,
 * as this PR writes it.
 */
// The answer buttons and the trade dialogs are their own components; the card's trigger sentences are what this reads.
jest.mock("@/components/proposals/ProposalActions", () => ({ ProposalActions: () => null }));
jest.mock("@/components/trade/TradeButton", () => ({ TradeButton: () => null }));
jest.mock("@/components/trades/TradeActions", () => ({ CloseTradeDialog: () => null }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TradeSummary, type TradeSummaryProps } from "./trade-summary";

const SENTENCES = ["Sell if below $325.33", "Trim 50% if above $427.42", "Review if above 9.47% from our entry"];
const props = (look: "banner" | "card"): TradeSummaryProps => ({
  look,
  direction: "LONG",
  pnl: null,
  position: { id: "p1", quantity: 12, avgCost: 359.36, peakPrice: null, openedAt: "2026-11-13T14:30:00Z", daysHeld: 0, closed: false, closedAt: null, closePrice: null, realizedPnl: null, realizedPnlPct: null, closeReason: null, outcome: null } as never,
  pendingProposal: { orderId: "o1", intent: "OPEN", quantity: 12, expiresAt: null, rationale: "Apple is breaking out again.", triggerSentences: SENTENCES },
});

describe("a buy proposal's card", () => {
  it.each(["banner", "card"] as const)("the %s says each trigger as its sentence", (look) => {
    const html = renderToStaticMarkup(createElement(TradeSummary, props(look)));
    for (const sentence of SENTENCES) expect(html).toContain(`<li>${sentence}</li>`);
  });
});
