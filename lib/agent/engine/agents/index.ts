/**
 * Every agent, as the Agents page lists it (docs/plans/AGENT_ENGINE.md): each
 * one's record, which the engine builds its request from.
 */
import type { AgentRecord } from "../types";
import { PORTFOLIO_MANAGER } from "./portfolio-manager";
import { PORTFOLIO_DIGEST } from "./portfolio-digest";
import { MARKET_REVIEWER } from "./market-reviewer";
import { WRITER } from "./writer";
import { HOLDING_REFRESH } from "./holding-refresh";
import { TRIGGER_RUN } from "./trigger-run";
import { POST_TRADE_WRITEUP } from "./post-trade-writeup";
import { MORNING_RUN } from "./morning-run";
import { CHAT } from "./chat";

/** In the order they moved onto the engine. */
export const AGENTS: readonly AgentRecord[] = [PORTFOLIO_MANAGER, MARKET_REVIEWER, PORTFOLIO_DIGEST, WRITER, HOLDING_REFRESH, TRIGGER_RUN, POST_TRADE_WRITEUP, MORNING_RUN, CHAT];
