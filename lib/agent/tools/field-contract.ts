/**
 * field-contract.ts — every field the model can pass to a write tool, and
 * what kind of thing it is. One row per field. `field-contract.test.ts`
 * holds the tools to it.
 *
 * Why. On 2026-09-25 PLTR's buy died because place_trade offered the model a
 * size field, the model typed a number, the tool refused it, and the run
 * ended. Four theses died because the writer's schema let the model invent
 * a trigger kind and a length cap refused the rest. The same question was
 * behind every one: for this field, who decides — the code or the model —
 * and if the model, from what list, under which rule, stated where?
 *
 * The four answers, and what the test checks for each:
 *
 *   COMPUTED  The app owns the value. The field must NOT be in the schema a
 *             run sees (a run cannot type it wrong); it may exist for the
 *             principal's chat, where the principal's number is honored.
 *   CHOSEN    The model picks from a closed list. The wire schema must be an
 *             enum / const / boolean — never a free string.
 *   JUDGED    The model's number, date or plan under a rule the tools
 *             enforce. The rule is named here, and the prompt of every mode
 *             that offers the tool must state it up front (the marker
 *             text). A refusal names the bound and the next legal move.
 *   IDENTITY  A reference to something that exists (a thesis id, a ticker,
 *             a trigger id). A wrong one is refused by name.
 *   TEXT      Prose the model writes (a rationale, bullets). No rule; no
 *             length cap — a cap refuses research over trivia.
 *   CARRIED   Structured research the writer copies through unchanged.
 *
 * A field that is not in this registry fails the suite: a new field cannot
 * ship without an answer to the question. A COMPUTED field that shows up in
 * a run's schema fails. A CHOSEN field that is a string fails. A JUDGED
 * field whose rule is not stated in a mode's prompt fails.
 */

export type FieldKind = "COMPUTED" | "CHOSEN" | "JUDGED" | "IDENTITY" | "TEXT" | "CARRIED";

/** The prompts a rule can be stated in. */
export type PromptName = "daily" | "tactical" | "discovery" | "chat" | "writer";

/** A rule the tools enforce, and the words each prompt uses to state it. */
export interface Rule {
  /** What the rule is, in product words. */
  says: string;
  /** Where the refusal comes from, and that its message names the fix. */
  refusal: string;
  /** Text that must appear in each prompt that states the rule. */
  markers: Partial<Record<PromptName, string>>;
}

const RULE_DEFS = {
  RISK_REWARD_FLOOR: {
    says: "A plan pays at least 2:1: (target − entry) ÷ (entry − stop). Below it the plan is refused with the arithmetic and the three legal answers (a real level, PASS, or set the plan down).",
    refusal: "invalid_thesis_shape — names the ratio, the three levels, and the fix.",
    markers: { daily: "2:1", tactical: "2:1", discovery: "2:1", chat: "2:1", writer: "2:1" },
  },
  RATCHET: {
    says: "A protective level on a held stock only moves toward more protection. Only the principal lowers one.",
    refusal: "protective_level_locked — names the level, the direction, and that the rest of the update lands.",
    markers: { daily: "NEVER LOWER", tactical: "may only tighten", chat: "only tighten" },
  },
  MIN_CONFIDENCE: {
    says: "A buy needs the analyst's minimum confidence (the composite score).",
    refusal: "place_trade / record_thesis — names the composite and the minimum.",
    markers: { daily: "Min confidence", tactical: "minimum confidence", discovery: "Min confidence", chat: "minConfidence", writer: "minimum confidence" },
  },
  LEVEL_ORDER: {
    says: "Entry, target and stop sit in order against each other and the live price (long: stop < entry < target).",
    refusal: "invalid_thesis_shape — names the three levels and which is out of order.",
    markers: { daily: "target/stop", tactical: "R/R", discovery: "in order", chat: "target/stop", writer: "R/R" },
  },
  EVENT_DATE: {
    says: "The event date is the company's newest statement. A filing fills a missing date; a disagreement is written on the row, never overwritten.",
    refusal: "none — a wrong date is not refused; it is noted.",
    markers: {},
  },
  TRIGGER_SHAPE: {
    says: "A trigger's kind is one of the evaluator's kinds, by name. An unknown kind is coerced or dropped with a note; a plan level without a buy level is refused with the fix.",
    refusal: "missing_enter_trigger — names the missing buy level and the two answers.",
    markers: {},
  },
} as const satisfies Record<string, Rule>;

export type RuleId = keyof typeof RULE_DEFS;
export const RULES: Record<RuleId, Rule> = RULE_DEFS;

export interface FieldContract {
  field: string;
  kind: FieldKind;
  /** JUDGED only: the rule the tools enforce on it. */
  rule?: RuleId;
  /** COMPUTED only: the principal's chat may still carry it. */
  principalOnly?: boolean;
  /** Why it is what it is, or what should change. */
  note?: string;
}

const f = (field: string, kind: FieldKind, extra: Omit<FieldContract, "field" | "kind"> = {}): FieldContract => ({ field, kind, ...extra });

/** The thesis body the writer copies through — the same nine on record and update. */
const RESEARCH_BLOCKS: FieldContract[] = [
  "snapshot", "recent_catalysts", "fundamentals", "latest_earnings", "catalysts_and_events",
  "bull_case", "bear_case", "analyst_consensus", "insider_technical",
].map((k) => f(k, "CARRIED", { note: "A research section, copied from the writer's note." }));

const PLAN_LEVELS: FieldContract[] = [
  f("entry_price", "JUDGED", { rule: "LEVEL_ORDER" }),
  f("target_price", "JUDGED", { rule: "RISK_REWARD_FLOOR" }),
  f("stop_loss", "JUDGED", { rule: "RISK_REWARD_FLOOR" }),
];

const BELIEF: FieldContract[] = [
  f("core_belief", "TEXT"),
  f("key_assumptions", "TEXT"),
  f("invalidation_conditions", "TEXT"),
  f("conviction", "CHOSEN"),
  f("conviction_rationale", "TEXT", { note: "No cap: a 401-character rationale once threw away a thesis." }),
  f("variant_view", "TEXT", { note: "STRONG/HIGH without one is stored MEDIUM with the reason, never refused." }),
  f("scoring", "JUDGED", { rule: "MIN_CONFIDENCE", note: "The composite the model rates; the minimum is the analyst's setting." }),
  f("horizon", "CHOSEN"),
  f("setup_id", "CHOSEN"),
  f("stop_basis", "TEXT"),
  f("target_basis", "TEXT"),
  f("entry_on_close", "CHOSEN"),
  f("catalyst_date", "JUDGED", { rule: "EVENT_DATE" }),
];

export const FIELD_CONTRACT: Record<string, FieldContract[]> = {
  place_trade: [
    f("ticker", "IDENTITY"),
    f("company_name", "CARRIED", { note: "Display only. Candidate for COMPUTED from the profile." }),
    f("exchange", "CARRIED", { note: "Display only. Candidate for COMPUTED from the profile." }),
    f("direction", "CHOSEN"),
    ...PLAN_LEVELS,
    f("thesis_id", "IDENTITY"),
    f("entry_rationale", "TEXT"),
    f("analyst_id", "IDENTITY", { note: "The chat names the analyst; a run is already bound to one." }),
    f("notional", "COMPUTED", { principalOnly: true, note: "Sized by risk inside the analyst's band (DAV-317). The principal's number is honored with a line." }),
    f("shares", "COMPUTED", { principalOnly: true, note: "As notional." }),
  ],
  manage_position: [
    f("symbol", "IDENTITY"),
    f("action", "CHOSEN"),
    f("reason", "TEXT"),
    f("close_pct", "JUDGED", { rule: "LEVEL_ORDER", note: "A percent of the position; clamped to 1–100." }),
    f("new_target_price", "JUDGED", { rule: "LEVEL_ORDER" }),
    f("new_stop_loss", "JUDGED", { rule: "RATCHET" }),
    f("close_reason", "CHOSEN"),
    f("add_notional", "COMPUTED", { principalOnly: true, note: "An add is half the entry's risk, capped (DAV-317)." }),
  ],
  close_position: [
    f("ticker", "IDENTITY"),
    f("reason", "CHOSEN"),
    f("notes", "TEXT"),
    f("belief_survived", "CHOSEN", { note: "A boolean the STOP exit must answer — the name returns to WATCHING or retires." }),
  ],
  record_thesis: [
    f("ticker", "IDENTITY"),
    f("company_name", "CARRIED"),
    f("exchange", "CARRIED"),
    f("direction", "CHOSEN"),
    f("reasoning_summary", "TEXT"),
    f("thesis_bullets", "TEXT"),
    f("risk_flags", "TEXT"),
    ...PLAN_LEVELS,
    ...BELIEF,
    f("current_price", "CARRIED", { note: "The price the research was done at; the writer passes it. Candidate for COMPUTED." }),
    f("stock_fundamentals", "CARRIED"),
    f("parent_thesis_id", "IDENTITY"),
    f("source_kind", "CHOSEN"),
    f("source_signal_ids", "IDENTITY"),
    f("source_rationale", "TEXT"),
    f("triggers", "JUDGED", { rule: "TRIGGER_SHAPE" }),
    f("status", "CHOSEN"),
    f("acknowledge_cross_analyst_overlap", "TEXT", { note: "A phrase that satisfies a gate. Deletion candidate." }),
    f("acknowledge_prior_exit", "TEXT", { note: "A phrase that satisfies a gate. Deletion candidate." }),
    f("research_data", "CARRIED"),
    ...RESEARCH_BLOCKS,
  ],
  update_thesis: [
    f("thesis_id", "IDENTITY"),
    f("rationale", "TEXT"),
    f("structural_unchanged_reason", "TEXT", { note: "Optional line on the row since #712; nothing is refused without it." }),
    f("signal_ids", "IDENTITY"),
    f("trigger_id", "IDENTITY"),
    f("trade_id", "IDENTITY"),
    f("price_at_time", "CARRIED", { note: "Candidate for COMPUTED: the app knows the price." }),
    f("reasoning_summary", "TEXT"),
    f("thesis_bullets", "TEXT"),
    f("risk_flags", "TEXT"),
    ...PLAN_LEVELS,
    ...BELIEF,
    f("direction", "CHOSEN"),
    f("add_triggers", "JUDGED", { rule: "TRIGGER_SHAPE" }),
    f("edit_triggers", "JUDGED", { rule: "TRIGGER_SHAPE" }),
    f("remove_trigger_ids", "IDENTITY", { note: "A wrong id is refused by id; the rest of the call lands." }),
    f("change_status", "CHOSEN"),
    f("research_data", "CARRIED"),
    ...RESEARCH_BLOCKS,
  ],
  record_run_summary: [
    f("primary_decision", "CHOSEN"),
    f("decision_rationale", "TEXT"),
    f("ranked_picks", "CARRIED", { note: "Each pick's one-word action must be backed by a call this run (complete_run's preflight, DAV-309)." }),
    f("exposure_breakdown", "CARRIED", { note: "Candidate for COMPUTED: the app knows the exposure." }),
  ],
  complete_run: [],
  dispatch_thesis_research: [
    f("ticker", "IDENTITY"),
    f("analyst_id", "IDENTITY"),
    f("mode", "CHOSEN"),
    f("existing_thesis_id", "IDENTITY"),
    f("reason", "TEXT"),
    f("setup_id", "CHOSEN"),
    f("screen_row", "TEXT"),
    f("promotion_context", "CARRIED"),
  ],
  /** The writer's own submit tool — the decision, before the save. */
  submit_thesis: [
    f("direction", "CHOSEN"),
    f("rationale", "TEXT"),
    ...PLAN_LEVELS,
    ...BELIEF,
    f("prior_exit_acknowledgment", "TEXT", { note: "A phrase that satisfies a gate. Deletion candidate." }),
    f("triggers", "JUDGED", { rule: "TRIGGER_SHAPE" }),
    f("add_triggers", "JUDGED", { rule: "TRIGGER_SHAPE" }),
    f("edit_triggers", "JUDGED", { rule: "TRIGGER_SHAPE" }),
    f("remove_trigger_ids", "IDENTITY"),
  ],
};

/** The tool factories, by registered name, and the modes' run-mode strings. */
export const WRITE_TOOL_EXPORTS: Record<string, string> = {
  place_trade: "placeTrade",
  manage_position: "managePosition",
  close_position: "closePosition",
  record_thesis: "recordThesis",
  update_thesis: "updateThesis",
  record_run_summary: "recordRunSummary",
  complete_run: "completeRun",
  dispatch_thesis_research: "dispatchThesisResearch",
};

export const MODE_PROMPTS: Array<{ mode: string; runMode: string; prompt: PromptName }> = [
  { mode: "research-run", runMode: "MORNING_PLAN", prompt: "daily" },
  { mode: "tactical", runMode: "INTRADAY_TACTICAL", prompt: "tactical" },
  { mode: "discovery", runMode: "DISCOVERY", prompt: "discovery" },
  { mode: "principal-chat", runMode: "PRINCIPAL_CHAT", prompt: "chat" },
];
