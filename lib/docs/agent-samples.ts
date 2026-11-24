/**
 * Each agent's request on one sample day, built by the agent engine from its
 * record, for the Framework page and the agent docs (lib/docs/framework.ts).
 * Server-only.
 *
 * Each agent is built on the case its engine test builds it on
 * (lib/agent/engine/__fixtures__/*-cases.ts), through the code its run calls.
 * Every agent gets the same Market and portfolio reads: the stand-in book's
 * market numbers and snapshot (lib/agent/__fixtures__), written by the code
 * that writes them on a run, and a line of each digest, which agents write;
 * and the same book.
 * A record with no sample here is still drawn from its record, unsized.
 */

import { stockTableText } from "@/lib/agent/context/stock-table";
import { STANDIN_MARKET_NUMBERS } from "@/lib/agent/__fixtures__/market-numbers-standin";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import { CHAT_CASES } from "@/lib/agent/engine/__fixtures__/chat-cases";
import { MORNING_CASES, asRunInput } from "@/lib/agent/engine/__fixtures__/morning-run-cases";
import { TRIGGER_CASES, TRIGGER_KICKOFF } from "@/lib/agent/engine/__fixtures__/trigger-run-cases";
import { WRITER_CASES, WRITER_MESSAGE } from "@/lib/agent/engine/__fixtures__/writer-cases";
import { bookText } from "@/lib/agent/book";
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import type { AgentId, AgentRecord, BuiltNewest, BuiltRequest } from "@/lib/agent/engine/types";
import { portfolioPieceText, type PortfolioPiece } from "@/lib/agent/portfolio-block";
import { writerRequest } from "@/lib/agent/run-thesis-writer";
import { dailyRunRequest } from "@/lib/agent/system-prompt";
import { chatNewest, chatRequest } from "@/lib/agent/system-prompts/chat";
import { stockRowText, triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";
import { AFTER_BUY_ASK } from "@/lib/agent/engine/agents/after-buy";
import { afterBuyMessage } from "@/lib/proposals/after-buy";
import { stockDataText } from "@/lib/agent/context/stock-data";
import { holdingTriggersText } from "@/lib/agent/knowledge/playbooks";
import { PLAYBOOK_TEMPLATES } from "@/lib/agent/knowledge/playbook-templates";
import { marketNumbersText } from "@/lib/market-data/market-numbers";
import { analystBrief } from "@/lib/agent/analyst-brief";
import { SCHEDULE } from "@/lib/agent/engine/schedule";


/** The sample day: the stand-in book's morning, Thu Nov 12, 8 AM ET. */
export const SAMPLE_NOW = new Date("2026-11-12T13:00:00Z");

/** The Market and portfolio reads, under the headings lib/agent/portfolio-block.ts prints. A record gets the ones it lists. */
const PIECES: PortfolioPiece[] = [
  { id: "market_numbers", text: `### Market numbers (as of Thu, Nov 12, 8:00 AM ET)\n${marketNumbersText(STANDIN_MARKET_NUMBERS)}` },
  { id: "market_digest", text: "### Market digest (written Thu, Nov 12, 7:31 AM ET)\n#### Market overview\nStocks slipped." },
  { id: "portfolio_snapshot", text: portfolioPieceText(STANDIN_SNAPSHOT) },
  { id: "portfolio_digest", text: "### Portfolio digest (written Wed, Nov 11, 8:00 PM ET)\nA quiet day." },
];

/** The stand-in book: its two holdings and a watch, a line each. */
const BOOK = bookText([
  { ticker: "AAA", status: "HOLDING", analyst: "Case Analyst", belief: "The company sells a product people keep buying." },
  { ticker: "BBB", status: "HOLDING", analyst: "Case Analyst", belief: "Its new line takes share." },
  { ticker: "CCC", status: "WATCHING", analyst: "Case Analyst", belief: "A strong quarter, and the base held.", buyIf: ["Buy if above $120"] },
]);

/** The stand-in stock table: the same three stocks, as the Portfolio Manager is given them. */
const STOCKS = stockTableText({
  asOf: "2026-11-11T21:00:00.000Z",
  rows: [
    { ticker: "AAA", status: "held", analyst: "Case Analyst", situations: ["sale signal"], price: 98.4, dayPct: -3.1, volume: 1.4, move5dPct: -6.2, move20dPct: -9.8, vsSpy1M: -7.5, vs50dPct: -8.1, offHighPct: -19.4, sinceBuyPct: -8.9, outlook: "BULLISH", conviction: "MEDIUM", nextReport: null, waiting: null },
    { ticker: "BBB", status: "held", analyst: "Case Analyst", situations: [], price: 51.2, dayPct: 0.6, volume: 0.9, move5dPct: 1.8, move20dPct: 4.4, vsSpy1M: 3.1, vs50dPct: 2.7, offHighPct: -4.0, sinceBuyPct: 6.3, outlook: "BULLISH", conviction: "HIGH", nextReport: "2026-11-19", waiting: null },
    { ticker: "CCC", status: "watch", analyst: "Case Analyst", situations: [], price: 118.9, dayPct: 1.2, volume: 1.1, move5dPct: 2.9, move20dPct: 7.6, vsSpy1M: 5.0, vs50dPct: 4.3, offHighPct: -2.2, sinceBuyPct: null, outlook: "BULLISH", conviction: "MEDIUM", nextReport: null, waiting: null },
  ],
});

export interface AgentSample {
  /** The case it is built on, in a few words. */
  from: string;
  build: (record: AgentRecord) => { request: BuiltRequest; newest?: BuiltNewest };
}

const triggerArgs = (c: object) => ({ ...(c as never as Parameters<typeof triggerRunRequest>[0]), portfolioPieces: PIECES });
const writerOpts = (c: object) => ({ ...(c as never as Parameters<typeof writerRequest>[0]), portfolioPieces: PIECES });

export const AGENT_SAMPLES: Partial<Record<AgentId, AgentSample>> = {
  portfolio_manager: {
    from: "the stand-in book, with its last write-up",
    build: (record) => ({
      request: composeAgentRequest(record, { now: SAMPLE_NOW, environment: "PAPER" }, {
        pieces: PIECES,
        context: { stock_table: STOCKS, last_output: "## Your last write-up\nWritten Tue, Nov 10:\n\n### Where the money is\nTwo stocks, one bet." },
      }),
    }),
  },
  market_reviewer: {
    from: "the stand-in book, its two holdings and a watch",
    build: (record) => ({
      request: composeAgentRequest(record, { now: SAMPLE_NOW, environment: "PAPER" }, {
        pieces: PIECES,
        context: {
          the_book: BOOK,
          the_cases: "## What each thesis rests on\n- MU\n  - Must stay true: memory prices rise each quarter, checked at each report\n  - Would prove it wrong: a guidance cut at the next report",
          last_output: "## Your notes in the last 5 days\n- none\n\n## Your last digest\nWritten for Wed, Nov 11:\n\n### Market overview\nStocks rose.",
        },
      }),
    }),
  },
  portfolio_digest: {
    from: "the stand-in book's day, one the Portfolio Manager ran on",
    build: (record) => ({
      request: composeAgentRequest(record, { now: SAMPLE_NOW, environment: "PAPER" }, {
        pieces: PIECES,
        context: { manager_writeup: "## The Portfolio Manager's write-up today\n### The ranking\nAAA first, BBB last.\n\n### What I did\nNothing." },
      }),
    }),
  },
  writer: {
    from: "a refresh of a watched stock, sent from a chat",
    build: () => ({ request: writerRequest(writerOpts(WRITER_CASES.refresh_watch), WRITER_MESSAGE, SAMPLE_NOW) }),
  },
  holding_refresh: {
    from: "a refresh of a stock we hold",
    build: () => ({ request: writerRequest(writerOpts(WRITER_CASES.refresh_held), WRITER_MESSAGE, SAMPLE_NOW) }),
  },
  trigger_run: {
    from: "a buy trigger firing on a watched stock",
    build: () => ({ request: triggerRunRequest(triggerArgs(TRIGGER_CASES.buy_on_watch), { more: "" }, SAMPLE_NOW) }),
  },
  post_trade_writeup: {
    from: "an Auto sale on a holding",
    build: () => ({ request: triggerRunRequest(triggerArgs(TRIGGER_CASES.auto_sale), { more: TRIGGER_KICKOFF.coFiredSuffix }, SAMPLE_NOW) }),
  },
  after_buy: {
    from: "a buy approved and filled on a stock on the base-breakout playbook",
    build: (record) => {
      const held = TRIGGER_CASES.auto_sale.stock;
      const fill = { orderId: "o", ticker: held.ticker, thesisId: "t", analystId: "a", userId: "u", accountId: "a", environment: "PAPER" as const, added: false, fillPrice: 101.2, shares: 40, floor: { sentence: "Sell if below $94.80", reason: "Under the base's low." }, trigger: null, note: "Orders are back above plan and the stock cleared its base on volume; buying 40 shares here.", holding: null };
      return {
        request: composeAgentRequest(record, { now: SAMPLE_NOW, environment: "PAPER", message: afterBuyMessage(fill, AFTER_BUY_ASK) }, {
          pieces: PIECES,
          context: {
            the_analyst: analystBrief(MORNING_CASES.full.analyst as never),
            the_stock: stockRowText(held),
            stock_data: stockDataText(WRITER_MESSAGE.dataBlock),
            holding_triggers: holdingTriggersText({ ticker: held.ticker, playbook: "Base breakout", templates: PLAYBOOK_TEMPLATES.BASE_BREAKOUT, floor: fill.floor.sentence }),
          },
        }),
      };
    },
  },
  morning_run: {
    from: "a full morning: reports, a filing, a buy price reached",
    build: () => {
      const c = MORNING_CASES.full;
      return { request: dailyRunRequest(c.analyst as never, { ...asRunInput(c.runInput), portfolioPieces: PIECES }, SAMPLE_NOW) };
    },
  },
  chat: {
    from: "a chat pinned to an analyst, and your next message",
    build: () => ({ request: chatRequest(CHAT_CASES.pinned as never), newest: chatNewest(SAMPLE_NOW, PIECES, "PAPER", { book: BOOK }) }),
  },
  discovery: {
    from: "the morning case's analyst and the stand-in book, on its schedule's kickoff",
    build: (record) => ({
      request: composeAgentRequest(record, { now: SAMPLE_NOW, environment: "PAPER", message: SCHEDULE.find((l) => l.agent === "discovery")?.message }, {
        context: {
          the_analyst: analystBrief(MORNING_CASES.full.analyst as never),
          the_book: BOOK,
          earnings_calendar: "## The earnings calendar\n\nReported, last 7 days:\n- $DDD 2026-11-10: EPS $1.20 vs $1.00 est — beat by 20.0%\n\nReporting, next 14 days:\n- $EEE 2026-11-19: EPS est $0.85 after close",
        },
      }),
    }),
  },
};
