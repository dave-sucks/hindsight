/**
 * What a run is about, and the context that comes with it (client-safe: the
 * Agents page names each agent's subject and what it leaves out).
 *
 * Every run has one subject: the account, an analyst, a thesis, or the
 * owner's chat. The subject brings its bundle: the facts read for it, one
 * loader each (./index.ts). An agent's record names its subject and lists
 * the facts it reads, in its order; it may leave any of the bundle out, and
 * may read nothing outside it.
 */
import type { ContextId } from "@/lib/agent/engine/types";

export type SubjectKind = "thesis" | "analyst" | "account" | "chat";

/** The book a run is in: the account and whether it is paper or live. */
export interface InBook {
  userId: string;
  accountId: string;
  environment: "PAPER" | "LIVE";
}

/** What the run is about. */
export type Subject =
  | (InBook & { kind: "account" })
  | (InBook & { kind: "analyst"; analystId: string })
  /** A stock one analyst covers: its thesis, or none yet when the Writer writes a stock for the first time. */
  | (InBook & { kind: "thesis"; analystId: string; ticker: string; thesisId: string | null })
  /** The owner's chat: pinned to one analyst, or at the portfolio level. */
  | (InBook & { kind: "chat"; analystId: string | null });

export type SubjectOf<K extends SubjectKind> = Extract<Subject, { kind: K }>;

/** Each subject's bundle: every fact read for it, in no order (each record gives its own). */
export const BUNDLES: Record<SubjectKind, readonly ContextId[]> = {
  /**
   * A thesis: the row, the stock's numbers and chart, the analyst and its
   * record by playbook, the stock's own playbook, its situations, and the
   * market numbers; and the analyst's playbooks, which the Writer picks the
   * stock's from as it writes.
   */
  thesis: ["the_stock", "stock_data", "the_analyst", "playbook_record", "the_playbook", "holding_triggers", "playbooks", "situations", "market_numbers"],
  /** An analyst: the analyst, its playbooks, its book, the market and the portfolio, this week's earnings and filings, the calls refused, and the earnings calendar outside its book. */
  analyst: ["the_analyst", "playbooks", "the_book", "market_numbers", "market_digest", "portfolio", "portfolio_digest", "earnings_this_week", "filings_this_week", "refused_calls", "earnings_calendar"],
  /** The account: the market, the portfolio and the book, what each thesis rests on, and what the agent wrote on its last run. */
  account: ["market_numbers", "market_digest", "portfolio", "portfolio_digest", "the_book", "the_cases", "last_output"],
  /** The chat: the market and the portfolio, the book and each analyst's room; pinned, the analyst. */
  chat: ["the_analyst", "market_numbers", "market_digest", "portfolio", "portfolio_digest", "the_book", "the_analysts"],
};

export const SUBJECT_NAMES: Record<SubjectKind, string> = {
  thesis: "a thesis",
  analyst: "an analyst",
  account: "the account",
  chat: "the chat",
};
