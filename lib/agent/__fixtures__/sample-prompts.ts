/**
 * sample-prompts.ts — the four agent prompts, built from one fixed sample
 * input. Shared by the field-contract test (is each rule stated?) and the
 * prompt-size test (did a prompt get longer?). Each carries the Market and
 * portfolio block of a sample day (SAMPLE_MARKET_AND_PORTFOLIO).
 */
import { buildPrincipalSystemPrompt } from "@/lib/agent/modes";
import { buildDailyRunSystemPromptV2 } from "@/lib/agent/system-prompt";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { buildWriterResearchPrompt } from "@/lib/agent/run-thesis-writer";
import type { RunInput } from "@/lib/agent/run-input";
import type { PromptName } from "@/lib/agent/tools/field-contract";
import { guidanceFor } from "@/lib/agent/situations";
import { rowForModel } from "@/lib/agent/row-for-model";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { marketAndPortfolioBlock, type MarketAndPortfolio } from "@/lib/agent/market-and-portfolio";
import { marketNumbersFrom } from "@/lib/market-data/market-numbers";
import { lastCloses } from "@/lib/market-data/market-gauges";
import { dayChangeAt, priceBook } from "@/lib/portfolio/value-at-quotes";
import nov10 from "./account-2026-11-10.json";
import market from "./market-2026-11-10.json";

/** Wed Nov 11, 8:00 AM ET: the morning run after the sample day. */
export const SAMPLE_NOW = new Date("2026-11-11T13:00:00Z");
const bell = Date.parse(market.bell) / 1000;
const tnx = lastCloses(market.cboe.TNX.join("\n"));
/** The book at the Nov 10 close: the broker's positions, each at the app's quote. */
const book = priceBook(Number(nov10.broker.cash), nov10.positions, Object.fromEntries(Object.entries(nov10.quotes).map(([s, q]) => [s, { quote: { ...q, d: null, dp: null, o: null, h: null, l: null, source: "alpaca" as const } }])), false);

/**
 * The block on a sample day. The numbers are real: the market's at the Nov 10
 * close, and that evening's book at that close with stand-in amounts (the
 * fixtures say where each came from). No reviewer had written a brief yet, so both briefs
 * are stand-ins of a typical length; no notes.
 */
const marketAndPortfolio: MarketAndPortfolio = {
  marketBrief: {
    date: "2026-11-11",
    writtenAt: "2026-11-11T12:34:00Z",
    brief:
      "Sample text. Stocks slipped on Tuesday as chipmakers and software gave back part of last week's gains, while financials and energy rose. The VIX eased under 20 and the 10-year yield rose to near 5%. Nothing on the market calendar lands this week. For this book, the chipmaker holdings carry the most risk if the slide continues, and NVDA reports next Tuesday after the close.",
  },
  marketNumbers: marketNumbersFrom(
    {
      quotes: Object.fromEntries(Object.entries(market.bars).map(([s, b]) => [s, { quote: { dp: (b.c / b.pc - 1) * 100, t: bell } }])),
      spy: { asOf: market.spy.asOf, closes: [market.spy.close], sma: { 50: market.spy.sma50, 200: market.spy.sma200 } },
      gauges: { vix: lastCloses(market.cboe.VIX.join("\n")), tenYear: tnx && { ...tnx, close: tnx.close / 10, prevClose: tnx.prevClose != null ? tnx.prevClose / 10 : null } },
    },
    SAMPLE_NOW,
  ),
  portfolioBrief: {
    date: "2026-11-10",
    writtenAt: "2026-11-11T01:00:40Z",
    brief:
      "Sample text. Four sales wait while the analysts' own notes on two of them, MU and PLTR, call the case unchanged; the floors are selling what the analysts would keep. Most of what we hold rides one story, AI and the power behind it, so a bad day for it moves the account at once.",
  },
  portfolioNumbers: {
    at: SAMPLE_NOW,
    close: book.closeOf,
    open: false,
    equity: book.value,
    today: dayChangeAt(book, { equity: Number(nov10.broker.last_equity), asOf: nov10.broker.balance_asof }, [], "2026-11-11"),
    cash: Number(nov10.broker.cash),
    holdings: book.held.length,
    biggest: [...book.held]
      .sort((a, b) => b.value - a.value)
      .slice(0, 3)
      .map((h) => ({ ticker: h.ticker, share: h.value / book.value })),
    sales: nov10.pending.map((o) => {
      const q = nov10.saleQueue.find((x) => x.symbol === o.symbol)!;
      const at = Date.parse(q.firstAt);
      const then = [...q.priced].sort((a, b) => Math.abs(Date.parse(a.at) - at) - Math.abs(Date.parse(b.at) - at))[0].price;
      const now = book.held.find((h) => h.ticker === o.symbol)!.price;
      return { ticker: o.symbol, kind: "sell" as const, times: q.times, firstAt: q.firstAt, movePct: (now / then - 1) * 100, verdict: q.verdict };
    }),
    pending: [],
    reporting: market.earnings.map((e) => ({ ticker: e.symbol, date: e.date, hour: e.hour })),
  },
  notes: [],
  unread: [],
};
/** The block as the four prompts carry it. */
export const SAMPLE_MARKET_AND_PORTFOLIO = marketAndPortfolioBlock(marketAndPortfolio, SAMPLE_NOW);

const runInput = {
  portfolio: { cash: 31000, buyingPower: 62000, portfolioValue: 100000, positions: [], exposure: { long: 0, short: 0, net: 0, utilizationPct: 0 } },
  watchlist: [], activeTheses: [],
  triggersFiredSinceLastRun: [], triggersMatchingNow: [],
  earnings: { reportingSoon: [], justReported: [] }, filings: { recent: [] }, openRefusals: [],
  marketAndPortfolio,
} as unknown as RunInput;

const trailTrigger = { id: "trig_trail", predicate: { watch: "move", is: "below", value: 12, variable: "peak" }, action: "EXIT", rationale: "Protect the gain." };

export const SAMPLE_PROMPTS: Record<PromptName, () => string> = {
  daily: () => buildDailyRunSystemPromptV2({ name: "Secular Compounder", maxPositionSize: 10000, minPositionSize: 3000, maxOpenPositions: 6 }, runInput),
  tactical: () =>
    buildTacticalSystemPrompt({
      analyst: { name: "PEAD Specialist", analystPrompt: null },
      // The same stock as before step 10, as the trigger run reads it: get_theses's short row with the setup's lines.
      stock: {
        ticker: "HPE",
        direction: "LONG",
        row: rowForModel(
          { id: "thesis_1", ticker: "HPE", status: "HOLDING", direction: "LONG", horizon: "TARGET", coreBelief: "Belief.", keyAssumptions: ["a"], invalidationConds: ["b"], entryPrice: 53, targetPrice: 70, stopLoss: 50, position: { quantity: 60, avgCost: 53.1, peakPrice: 62.7 }, triggers: [{ id: trailTrigger.id, says: sentenceOf(trailTrigger), rationale: trailTrigger.rationale }], situations: ["PROTECTIVE_SALE"] },
          { named: true, size: "short", setupLines: true },
        ),
      },
      trigger: trailTrigger, position: { peakPrice: 62.7 },
      // A trail sale on a holding: the one situation it puts the stock in.
      situations: { codes: ["PROTECTIVE_SALE"], guidance: guidanceFor(["PROTECTIVE_SALE"]) },
      marketAndPortfolio: SAMPLE_MARKET_AND_PORTFOLIO,
    } as never),
  chat: () =>
    buildPrincipalSystemPrompt({
      scopedAnalyst: { id: "an", name: "Secular Compounder", analystPrompt: null, directionBias: "LONG_ONLY", holdDurations: ["SWING"], sectors: [], marketCapMin: null, marketCapMax: null, watchlist: [], exclusionList: [], maxPositionSize: 10000, maxOpenPositions: 8 },
      // Its room on 2026-10-15: full (the holdings themselves are in the book block).
      room: { open: 8, max: 8, held: [], awaitingApproval: 0 },
      marketAndPortfolio: SAMPLE_MARKET_AND_PORTFOLIO,
    }),
  writer: () =>
    buildWriterResearchPrompt({ analyst: { analystPrompt: null }, ticker: "TEST", mode: "mint", existingThesis: null, reason: "a screen", runDate: "2026-09-25", marketAndPortfolio: SAMPLE_MARKET_AND_PORTFOLIO } as never),
};
