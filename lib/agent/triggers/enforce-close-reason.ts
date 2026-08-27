/**
 * enforce-close-reason.ts — the single rule for "what label does this sale
 * carry", shared by `close_position` and `manage_position(full_close)`.
 *
 * ── Why this exists (DAV-192, ex-GAPS P2 "closeReason mis-tag") ────────────
 * A sale executed because a protective trigger fired is a MATERIAL risk
 * event. Several July closes that came out of a protective fire were tagged
 * `MANUAL` by the model anyway, and a MANUAL tag is invisible to the rules
 * that key off the label:
 *
 *   • `get_theses`' held-through-floor context (lib/agent/tools/get-theses.ts)
 *     only counts declined exits whose `Order.closeReason === "STOP"`. EWTX's
 *     floor breach was mislabeled MANUAL, so the next run never saw that the
 *     principal had held through it.
 *   • `shouldRecycleToWatching` (lib/proposals/thesis-flips.ts) reads the
 *     label to decide whether a sold name stays on the re-entry radar.
 *   • The trade-closed email, the trade evaluator's prompt, and the trade
 *     detail page all render it as the reason the position ended.
 *
 * So: when the run was woken by a protective/price EXIT trigger, the stored
 * label is forced to that trigger's STOP/TARGET tag. The sale is never
 * refused over a label — a wrong tag is a bookkeeping error, and refusing a
 * protective exit is strictly worse than recording it under a corrected name.
 * Every correction writes a plain-English note into the close's audit trail
 * so the agent's original wording is still readable after the fact.
 *
 * ── "Thesis invalidated" stays distinct ───────────────────────────────────
 * THESIS_INVALIDATED is an honest, different claim: it is about the BELIEF,
 * not about why the sale executed. Those are two axes, so the correction
 * never silently eats it. The stored label becomes STOP/TARGET (the safety
 * rules above need it there), and the invalidation is preserved on its own
 * axis instead:
 *   • `declared` is quoted verbatim in the audit note and in the RunEvent /
 *     TradeDecision rows.
 *   • `beliefSurvived` is forced to `false`, keyed off what the agent
 *     DECLARED rather than the corrected label — so an invalidated name
 *     retires permanently instead of recycling to WATCHING. Before this
 *     helper, the correction overwrote the intent BEFORE that guard ran, so a
 *     protective fire plus an over-optimistic `belief_survived: true` could
 *     resurrect a thesis the agent had just called structurally broken.
 */

/** What the close tools let the model declare. */
export type DeclaredCloseReason =
  | "TARGET"
  | "STOP"
  | "THESIS_INVALIDATED"
  | "RISK_MANAGEMENT"
  | "MANUAL";

/** What `Position.closeReason` / `Order.closeReason` actually store. */
export type StoredCloseReason = "TARGET" | "STOP" | "MANUAL";

export interface EnforceCloseReasonArgs {
  /** The model's own `reason` / `close_reason` arg. */
  declared: DeclaredCloseReason;
  /**
   * The STOP/TARGET tag precomputed from the protective trigger that woke
   * this run (ToolContext.protectiveExitReason). Undefined on daily runs and
   * on tactical runs woken by judgment triggers (earnings, signals) — those
   * keep the model's own tag.
   */
  protective?: "STOP" | "TARGET";
  /**
   * Human phrase for the fired trigger, e.g. "Trailing 8% from high"
   * (ToolContext.protectiveExitTriggerLabel). Named in the audit note so the
   * correction is self-explaining; falls back to generic wording if absent.
   */
  triggerLabel?: string;
  /** The model's `belief_survived` attestation, when the tool collects one. */
  beliefSurvived?: boolean | null;
}

export interface EnforcedCloseReason {
  /** Goes on Position.closeReason / Order.closeReason. Always storable. */
  stored: StoredCloseReason;
  /** What the model asked for, kept for the audit trail. */
  declared: DeclaredCloseReason;
  /** True when a protective fire overrode a different declared label. */
  corrected: boolean;
  /** One sentence for the audit trail. Null when nothing was corrected. */
  auditNote: string | null;
  /**
   * Belief attestation after the invalidation guard — `false` whenever the
   * agent DECLARED THESIS_INVALIDATED, otherwise the attestation as given.
   */
  beliefSurvived: boolean | null | undefined;
}

/**
 * Collapse a declared reason to the three values the DB stores. The two
 * judgment codes (THESIS_INVALIDATED, RISK_MANAGEMENT) have no column of
 * their own and land as MANUAL — unchanged from before this helper; both
 * close tools already did exactly this.
 */
function collapse(declared: DeclaredCloseReason): StoredCloseReason {
  return declared === "TARGET" || declared === "STOP" ? declared : "MANUAL";
}

/**
 * Decide the stored sale label, plus the audit note and belief attestation
 * that go with it. Pure — no DB, no clock.
 */
export function enforceCloseReason(
  args: EnforceCloseReasonArgs,
): EnforcedCloseReason {
  const { declared, protective, triggerLabel } = args;

  // The invalidation guard keys off what the agent DECLARED, deliberately
  // before any correction — "the setup broke structurally" and "the belief
  // survived" are contradictory no matter what label the sale ends up with.
  const beliefSurvived =
    declared === "THESIS_INVALIDATED" ? false : args.beliefSurvived;

  if (!protective) {
    return {
      stored: collapse(declared),
      declared,
      corrected: false,
      auditNote: null,
      beliefSurvived,
    };
  }

  if (declared === protective) {
    // Agent got it right on its own — nothing to correct, nothing to note.
    return {
      stored: protective,
      declared,
      corrected: false,
      auditNote: null,
      beliefSurvived,
    };
  }

  const because = triggerLabel
    ? `a protective trigger fired (${triggerLabel})`
    : "a protective trigger fired";
  let auditNote =
    `Sale label auto-corrected ${declared} → ${protective}: this sale executed because ` +
    `${because}, so it is recorded as a ${protective.toLowerCase()} rather than a ` +
    `discretionary exit.`;
  if (declared === "THESIS_INVALIDATED") {
    auditNote +=
      ` The agent's separate call that the thesis broke still stands — the thesis retires` +
      ` permanently rather than returning to the watchlist.`;
  }

  return {
    stored: protective,
    declared,
    corrected: true,
    auditNote,
    beliefSurvived,
  };
}

/**
 * Append the audit note to the agent's own close rationale. Returns the
 * rationale unchanged when nothing was corrected. This string becomes
 * `Order.rationale` (what the principal reads on the approval card) and the
 * close's `PositionEvent` / `ThesisUpdate` text, so the correction is visible
 * exactly where someone would go looking for why the position ended.
 */
export function withCloseAuditNote(
  rationale: string,
  enforced: EnforcedCloseReason,
): string {
  if (!enforced.auditNote) return rationale;
  const base = rationale.trim();
  return base ? `${base} ${enforced.auditNote}` : enforced.auditNote;
}
