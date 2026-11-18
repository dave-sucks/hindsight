/**
 * Each agent's request on one sample day, built by the agent engine from its
 * record, for the Framework page and the agent docs (lib/docs/framework.ts).
 * Server-only.
 *
 * Each agent is built on the case its engine test builds it on
 * (lib/agent/engine/__fixtures__/*-cases.ts), through the code its run calls.
 * Every agent gets the same Market and portfolio block: the stand-in book's
 * market numbers and snapshot (lib/agent/__fixtures__), written by the code
 * that writes them on a run, and a line of each digest, which agents write.
 * A record with no sample here is still drawn from its record, unsized.
 */

import { STANDIN_MARKET_NUMBERS } from "@/lib/agent/__fixtures__/market-numbers-standin";
import { STANDIN_SNAPSHOT } from "@/lib/agent/__fixtures__/portfolio-snapshot-standin";
import { CHAT_CASES } from "@/lib/agent/engine/__fixtures__/chat-cases";
import { MORNING_CASES, asRunInput } from "@/lib/agent/engine/__fixtures__/morning-run-cases";
import { TRIGGER_CASES, TRIGGER_KICKOFF } from "@/lib/agent/engine/__fixtures__/trigger-run-cases";
import { WRITER_CASES, WRITER_MESSAGE } from "@/lib/agent/engine/__fixtures__/writer-cases";
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import type { AgentId, AgentRecord, BuiltNewest, BuiltRequest } from "@/lib/agent/engine/types";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import { writerRequest } from "@/lib/agent/run-thesis-writer";
import { dailyRunRequest } from "@/lib/agent/system-prompt";
import { chatNewest, chatRequest } from "@/lib/agent/system-prompts/chat";
import { triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";
import { marketNumbersText } from "@/lib/market-data/market-numbers";
import { snapshotText, watchingText } from "@/lib/portfolio/snapshot";

/** The sample day: the stand-in book's morning, Thu Nov 12, 8 AM ET. */
export const SAMPLE_NOW = new Date("2026-11-12T13:00:00Z");

/** The Market and portfolio block's parts, under the headings lib/agent/portfolio-block.ts prints. A record gets the ones it lists. */
const PIECES: PortfolioPiece[] = [
  { id: "market_numbers", text: `### Market numbers (as of Thu, Nov 12, 8:00 AM ET)\n${marketNumbersText(STANDIN_MARKET_NUMBERS)}` },
  { id: "market_digest", text: "### Market digest (written Thu, Nov 12, 7:31 AM ET)\n#### Market overview\nStocks slipped." },
  { id: "portfolio_snapshot", text: `### Portfolio snapshot\n${snapshotText(STANDIN_SNAPSHOT)}` },
  { id: "watching", text: `### Watching\n${watchingText(STANDIN_SNAPSHOT)}` },
  { id: "portfolio_digest", text: "### Portfolio digest (written Wed, Nov 11, 8:00 PM ET)\nA quiet day." },
];

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
      request: composeAgentRequest(record, { now: SAMPLE_NOW, environment: "PAPER" }, { pieces: PIECES, blocks: { last_writeup: "Written Tue, Nov 10:\n\n### Where the money is\nTwo stocks, one bet." } }),
    }),
  },
  market_reviewer: {
    from: "the stand-in book, its two holdings and a watch",
    build: (record) => ({
      request: composeAgentRequest(record, { now: SAMPLE_NOW, environment: "PAPER" }, {
        blocks: {
          market_numbers: marketNumbersText(STANDIN_MARKET_NUMBERS),
          portfolio_snapshot: snapshotText(STANDIN_SNAPSHOT),
          held_beliefs: "- AAA: The company sells a product people keep buying.\n- BBB: Its new line takes share.",
          watched_beliefs: "- CCC: A strong quarter, and the base held.",
          reviewer_notes: "- none",
          last_digest: "Written for Wed, Nov 11:\n\n### Market overview\nStocks rose.",
        },
      }),
    }),
  },
  portfolio_digest: {
    from: "the stand-in book's day",
    build: (record) => ({ request: composeAgentRequest(record, { now: SAMPLE_NOW, environment: "PAPER" }, { blocks: { portfolio_snapshot: snapshotText(STANDIN_SNAPSHOT) } }) }),
  },
  writer: {
    from: "a refresh of a watched stock, sent from a chat",
    build: () => ({ request: writerRequest(writerOpts(WRITER_CASES.refresh_watch), WRITER_MESSAGE) }),
  },
  trigger_run: {
    from: "a buy trigger firing on a watched stock",
    build: () => ({ request: triggerRunRequest(triggerArgs(TRIGGER_CASES.buy_on_watch), { facts: `Tactical run on $CASE. Buy if above $120.` }) }),
  },
  post_trade_writeup: {
    from: "an Auto sale on a holding",
    build: () => ({ request: triggerRunRequest(triggerArgs(TRIGGER_CASES.auto_sale), { facts: `Tactical run on $CASE. ${TRIGGER_KICKOFF.fireSentence}. ${TRIGGER_KICKOFF.autoLine}` }) }),
  },
  morning_run: {
    from: "a full morning: reports, a filing, a buy price reached, a refused call",
    build: () => {
      const c = MORNING_CASES.full;
      return { request: dailyRunRequest(c.analyst as never, { ...asRunInput(c.runInput), portfolioPieces: PIECES }) };
    },
  },
  chat: {
    from: "a chat pinned to an analyst, and your next message",
    build: () => ({ request: chatRequest(CHAT_CASES.pinned as never), newest: chatNewest(SAMPLE_NOW, PIECES) }),
  },
};
