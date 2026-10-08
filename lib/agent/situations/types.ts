/**
 * The situations a stock is in: one definition per situation, one function
 * that returns the list (./index.ts). This file is the shapes.
 *
 * A situation's rule is today's computation, moved: nothing here decides
 * anything the four older systems (needs-action.ts, plan-sanity.ts, the
 * resolver's state label and the loose row fields) did not already decide.
 */
import type { WorkFlag, WorkFlagInput, WorkFlagVerb } from "@/lib/agent/situations/work-flag";
import type { ResolvedEnvelope } from "@/lib/agent/resolved-thesis";
import type { ResearchAge } from "@/lib/agent/thesis-research/staleness";
import type { PrincipalDecision } from "@/lib/agent/stock-context";
import type { SoldReview, soldReview } from "./sold-review";
import type { PlanCheckArgs } from "./plan-checks";
import type { AnalystCapacity } from "@/lib/agent/capacity";
import type { BuyBlockedByFull } from "./buy-blocked-full";
import type { NameTheSetup } from "./no-setup-named";
import type { SetupOverrides } from "@/lib/agent/knowledge/setup-overrides";
import type { FloorRisk } from "@/lib/agent/floor-risk";

export const SITUATION_CODES = [
  "PROMOTED_AWAITING",
  "PROTECTIVE_SALE",
  "BUY_ARRIVES",
  "BUY_BLOCKED_FULL",
  "ADD_OR_WINNER",
  "EARNINGS",
  "FILING",
  "QUIET_WATCH_WOKE",
  "PROTECTION",
  "FIRST_RESEARCH",
  "REVIEW_DUE",
  "STALE_RESEARCH",
  "PLAN_PROBLEM",
  "YOUR_WORD_UNANSWERED",
  "SOLD_ONE_REVIEW",
  "NO_SETUP_NAMED",
] as const;
export type SituationCode = (typeof SITUATION_CODES)[number];

/**
 * How much of the stock a read gives for this situation: one line, a
 * decision row, or the full thesis. Data only for now; a later read
 * consumes it.
 */
export type Entry = "line" | "row" | "full";

/** Which stocks a situation can be on: held = status HOLDING; watched = any other. */
export type AppliesTo = "held" | "watched" | "both";

/** One stock, as the caller has it today. Every field past `work` is optional: absent, the situations that read it never set. */
export interface StockInput {
  ticker: string;
  /** The work-list flag's input, exactly as the caller builds it (./work-flag.ts). */
  work: WorkFlagInput;
  /** The thesis's setup and buy column, for the ask to name a setup. */
  setupId?: string | null;
  entryPrice?: number | null;
  /** The analyst's own setups (AgentConfig.setupIds), as the row carries them. */
  setupChoices?: readonly string[] | null;
  /** The stock's own triggers as stored (the column), for its buy's last fire. */
  ownTriggers?: unknown;
  /** The resolver's state label and progress, which two situations read; absent, neither does. */
  resolved?: Pick<ResolvedEnvelope, "actionability" | "progressToTarget" | "triggerDetail"> | null;
  /** The plan checks' inputs (./plan-checks.ts `planCheckArgs`); absent, PLAN_PROBLEM reads only the resolver's label. */
  plan?: PlanCheckArgs | null;
  /** The research's age, as the row shows it. */
  researchAge?: ResearchAge | null;
  /** A recently sold stock's facts, for its one look (sold-review.ts); `now` comes from the call. */
  sold?: Omit<Parameters<typeof soldReview>[0], "now"> | null;
}

/** The analyst's book, as the caller has it. */
export interface BookInput {
  /** Open positions against the limit; null when the read can't count them (a ticker-filtered read). */
  capacity?: AnalystCapacity | null;
  setupOverrides?: SetupOverrides;
}

/** A trigger that fired since the last answer, or is true on the live price now. */
export interface FireRef {
  source: "TRIGGER_FIRED" | "TRIGGER_MATCHING_NOW";
  triggerId: string;
  action: WorkFlagVerb;
  summary: string;
  /** What the trigger watches ("price", "report", "filing" …). Empty when the trigger is gone. */
  measures: string[];
  /** A fire: how many times since the last answer, and the newest. */
  count?: number;
  lastAt?: string;
  /** A match: the price it is true at. */
  livePrice?: number | null;
}

/**
 * TRANSITION SHIM (QB ruling, 2026-10-07): `flag` is the old needsAction
 * object for the situation's first source, unchanged in shape, when that
 * source is one of today's work-flag kinds. The sheet header and
 * complete_run read situations[0].data.flag; a lead with no flag paints
 * nothing and owes nothing, as today. It goes when those readers read the
 * situation itself.
 */
interface Flagged {
  flag?: WorkFlag;
}

export interface SituationDataMap {
  PROMOTED_AWAITING: Flagged;
  PROTECTIVE_SALE: Flagged & { fires: FireRef[] };
  BUY_ARRIVES: Flagged & { fires: FireRef[]; levelReached?: { triggerDetail: string | null } };
  BUY_BLOCKED_FULL: Flagged & { fires: FireRef[]; blocked: BuyBlockedByFull; levelReached?: { triggerDetail: string | null } };
  ADD_OR_WINNER: Flagged & { fires: FireRef[]; progressToTarget?: number };
  EARNINGS: Flagged & { fires: FireRef[] };
  FILING: Flagged & { fires: FireRef[] };
  QUIET_WATCH_WOKE: Flagged & { fires: FireRef[] };
  PROTECTION: Flagged & { floorTooFar?: WorkFlag; unprotectedGain?: WorkFlag; floorRisk?: FloorRisk };
  FIRST_RESEARCH: Flagged;
  REVIEW_DUE: Flagged & { fires: FireRef[]; clock?: WorkFlag };
  STALE_RESEARCH: Flagged & { researchAge?: ResearchAge };
  /** Each plan check by its code with its text; STALE_PAST_CATALYST (the resolver's label) has no text. */
  PLAN_PROBLEM: Flagged & { codes: Array<{ kind: string; text: string | null }> };
  YOUR_WORD_UNANSWERED: Flagged & { decision: PrincipalDecision };
  SOLD_ONE_REVIEW: Flagged & { review: SoldReview };
  NO_SETUP_NAMED: Flagged & NameTheSetup;
}

export type SituationOf<C extends SituationCode> = {
  code: C;
  order: number;
  entry: Entry;
  data: SituationDataMap[C];
};
export type Situation = { [C in SituationCode]: SituationOf<C> }[SituationCode];

export interface SituationDefinition<C extends SituationCode = SituationCode> {
  code: C;
  /** Where it sits on the list after the lead (./index.ts). */
  order: number;
  appliesTo: AppliesTo;
  /** Today's computation: is the stock in this situation, and what today's flag carried. */
  rule: (stock: StockInput, book: BookInput, now: Date) => { active: boolean; data?: SituationDataMap[C] };
  /** The text an agent gets when the situation is on the stock. Empty until it is written; sent to no agent yet. */
  guidance: string;
  /** Whether being in this situation puts the stock on the morning run's work list, exactly as the read decided it before (get-theses.ts). */
  lists: (data: SituationDataMap[C]) => boolean;
  entry: Entry;
}
