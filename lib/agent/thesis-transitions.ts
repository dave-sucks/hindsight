/**
 * thesis-transitions.ts — the status-transition law for update_thesis,
 * as ONE readable table instead of six if-blocks scattered across a
 * 2,000-line execute body (DAV-210 slice 1).
 *
 * What lives here: every rule about whether a status change (or the
 * absence of one) is LEGAL — given the thesis's current status, the
 * change_status verb, and the run's role. What does NOT live here: the
 * patch application itself (the tool still writes status/retiredReason/
 * closedAt), and every non-status gate (conviction, triggers, goalpost,
 * shape — those are different families).
 *
 * Extraction contract, deliberately strict:
 *   - Error codes and message text are BYTE-IDENTICAL to the inline
 *     blocks they replaced. Agents read these messages and correct
 *     their next call from them; the text is part of the interface.
 *   - Call sites in update-thesis.ts sit at the ORIGINAL positions, so
 *     which gate fires first on a multiply-wrong call is unchanged.
 *   - The one rule that needs database facts (the zombie-position rule)
 *     takes them as arguments — this module stays pure and every rule
 *     is testable with a plain function call.
 *
 * The state machine these rules pin (docs/THESIS_ARCHITECTURE.md):
 *
 *   status    = WATCHING | HOLDING | PROMOTED     (updatable)
 *             | PASSED | RETIRED                  (terminal — refuse)
 *   verb      = INVALIDATED (belief broke → RETIRED+INVALIDATED)
 *             | ARCHIVED    (walked away  → RETIRED+DROPPED)
 *             | WATCHING    (PROMOTED opt-out ONLY)
 *             | undefined   (content-only patch)
 *
 *   HOLDING and RETIRED-sold are tool-owned account facts (P1-25/P1-24):
 *   place_trade/approval sets HOLDING on a fill, close paths retire on a
 *   sell. They are not verbs here, by design — the agent expresses
 *   intent through the trade tools and the status follows the money.
 */

// ── Inputs ───────────────────────────────────────────────────────────────

export interface TransitionInput {
  thesisId: string;
  ticker: string;
  /** The thesis's stored status (P1-24 taxonomy). */
  currentStatus: string;
  /** The change_status arg — Zod has already narrowed it to the verb enum. */
  changeStatus: "INVALIDATED" | "ARCHIVED" | "WATCHING" | undefined;
  /** ToolContext.runMode ("THESIS_WRITER", "MORNING_PLAN", ...). */
  runMode: string | undefined;
}

/**
 * A refusal, shaped exactly like the tool's rejection envelope so the
 * call site is a one-line passthrough:
 *   `return { summary, data: { ok: false, ...data }, sources: [] }`.
 */
export interface TransitionViolation {
  summary: string;
  data: Record<string, unknown> & { error: string };
}

// ── The table ────────────────────────────────────────────────────────────
// Ordered. First match wins — same as the if-blocks it replaced.

interface TransitionRule {
  /** The machine code agents see — also the GateRejection gateCode. */
  code: string;
  check(input: TransitionInput): TransitionViolation | null;
}

const EARLY_RULES: TransitionRule[] = [
  {
    // A PASSED/RETIRED row is history. Nothing edits history.
    code: "terminal_status",
    check(i) {
      if (
        i.currentStatus === "HOLDING" ||
        i.currentStatus === "WATCHING" ||
        i.currentStatus === "PROMOTED"
      ) {
        return null;
      }
      return {
        summary: `Thesis ${i.thesisId} is ${i.currentStatus}; can't update a terminal thesis.`,
        data: { error: "terminal_status", current_status: i.currentStatus },
      };
    },
  },
  {
    // THESIS_WRITER role gate (GAPS P0-4). The thesis-writer is
    // research-only. Status decisions on PROMOTED rows belong to the
    // orchestrator (next daily run reads the refreshed research and
    // chooses re-enter / defer / kill). 2026-05-26: 3 writer refreshes
    // (AVGO, MRVL, TSM) flipped PROMOTED → WATCHING and required manual
    // revert. See docs/THESIS_ARCHITECTURE.md §0 (the role split).
    code: "thesis_writer_cannot_change_promoted_status",
    check(i) {
      if (
        i.currentStatus !== "PROMOTED" ||
        i.runMode !== "THESIS_WRITER" ||
        i.changeStatus === undefined
      ) {
        return null;
      }
      return {
        summary: `Refused status flip on PROMOTED $${i.ticker} — writer is research-only.`,
        data: {
          error: "thesis_writer_cannot_change_promoted_status",
          current_status: i.currentStatus,
          attempted: i.changeStatus,
          message:
            `update_thesis(change_status: "${i.changeStatus}") is refused from the thesis-writer on a PROMOTED thesis. ` +
            `The writer's job is research refresh only — refreshed content (target / stop / triggers / belief / sections) lands on the row; the status decision belongs to the next daily run. ` +
            `Drop change_status and retry with refreshed content. The PROMOTED state persists until the orchestrator (daily/tactical run) acts on the refreshed research.`,
        },
      };
    },
  },
  {
    // PROMOTED has exactly two legal exits: place_trade fills → HOLDING,
    // or the WATCHING opt-out. Killing or archiving a name the analyst
    // held with conviction — that the user explicitly promoted — is the
    // wrong shape. Downgrade to WATCHING first; let the next run decide.
    code: "promoted_thesis_illegal_transition",
    check(i) {
      if (
        i.currentStatus !== "PROMOTED" ||
        (i.changeStatus !== "INVALIDATED" && i.changeStatus !== "ARCHIVED")
      ) {
        return null;
      }
      const errorMsg = `Cannot ${i.changeStatus} a PROMOTED thesis. The analyst held this in paper with conviction; the user explicitly promoted it. The only legal opt-out is change_status: "WATCHING" (downgrade and keep tracking). Use that, or place_trade to re-enter.`;
      return {
        summary: `Cannot ${i.changeStatus} a PROMOTED thesis: ${i.ticker}`,
        data: {
          error: "promoted_thesis_illegal_transition",
          current_status: i.currentStatus,
          attempted: i.changeStatus,
          message: errorMsg,
        },
      };
    },
  },
  {
    // Resolution requirement — ORCHESTRATORS ONLY. A THESIS_WRITER
    // reaching this rule necessarily has no change_status (the role gate
    // above refused any defined value); that is the legal research-only
    // refresh. Before 2026-08-13 this guard also fired on the writer's
    // status-less call, which combined with the role gate to make EVERY
    // writer refresh on a PROMOTED row structurally impossible — the
    // CRWD/CEG promotion burn on 2026-08-11. See
    // docs/plans/AGENT_PERF_COST_FIX.md §1.
    code: "promoted_thesis_requires_resolution",
    check(i) {
      if (
        i.currentStatus !== "PROMOTED" ||
        i.runMode === "THESIS_WRITER" ||
        i.changeStatus === "WATCHING"
      ) {
        return null;
      }
      const errorMsg = `PROMOTED thesis ${i.ticker} requires an explicit resolution this run: call place_trade to re-enter live (the trade flips PROMOTED → HOLDING on fill), OR update_thesis(change_status: "WATCHING") to defer. Reasoning-only patches don't count — the thesis stays PROMOTED until you act.`;
      return {
        summary: `PROMOTED thesis needs explicit resolution: ${i.ticker}`,
        data: {
          error: "promoted_thesis_requires_resolution",
          current_status: i.currentStatus,
          message: errorMsg,
        },
      };
    },
  },
];

/**
 * The early status gates — run right after ownership checks, before any
 * content gate, exactly where the inline blocks sat. First match wins.
 */
export function checkStatusTransition(
  input: TransitionInput,
): TransitionViolation | null {
  for (const rule of EARLY_RULES) {
    const violation = rule.check(input);
    if (violation) return violation;
  }
  return null;
}

// ── The zombie-position rule (needs facts the caller queries) ────────────

/**
 * Does this call even need the position-pairing check? The tool only
 * queries Alpaca-side state when the answer is yes — preserving the
 * original conditional-query behavior (and its cost profile) exactly.
 */
export function needsPairedCloseCheck(input: TransitionInput): boolean {
  return (
    (input.changeStatus === "INVALIDATED" ||
      input.changeStatus === "ARCHIVED") &&
    input.currentStatus === "HOLDING"
  );
}

/**
 * Terminating a HOLDING thesis without closing its position creates a
 * zombie: the position stays OPEN with no live thesis backing it. Three
 * observed cases — 2026-05-13 Secular Theme/GOOGL (INVALIDATED without
 * close), 2026-05-14 Earnings Drift/TSM (same), 2026-05-14 Catalyst
 * Event Raider/AMZN (ARCHIVED without close, the F2 gap). Refuse unless
 * a close_position fired on the same ticker in THIS run.
 *
 * Pure: the caller supplies the two facts (open position, close-in-run).
 * `closedThisRun === true` means the pair is intact — no violation.
 */
export function checkTerminateWithoutClose(
  input: TransitionInput,
  facts: {
    openPosition: { id: string; direction: string; quantity: number } | null;
    closedThisRun: boolean;
  },
): TransitionViolation | null {
  if (!needsPairedCloseCheck(input)) return null;
  if (!facts.openPosition || facts.closedThisRun) return null;

  const action = input.changeStatus; // "INVALIDATED" | "ARCHIVED"
  const pos = facts.openPosition;
  return {
    summary: `Cannot ${action} $${input.ticker} — open position requires close_position first.`,
    data: {
      error: "terminate_active_without_close",
      ticker: input.ticker,
      attempted_status: action,
      position: {
        id: pos.id,
        direction: pos.direction,
        quantity: pos.quantity,
      },
      message:
        `$${input.ticker} has an open ${pos.direction} position (${pos.quantity} sh) backed by this ACTIVE thesis. ` +
        `Terminating the thesis (${action}) without closing the position creates a zombie — open position with no live thesis to manage it. ` +
        `Correct sequence: call \`close_position\` first to exit Alpaca (which also flips the thesis status), then retry \`update_thesis(thesis_id, change_status: "${action}", rationale: "...")\` if you want a separate audit row. ` +
        `If the position should stay open (just refining the thesis), drop change_status and pass the fields you want to change instead.`,
    },
  };
}

// ── The WATCHING opt-out rule ────────────────────────────────────────────

/**
 * change_status: "WATCHING" is reserved for the PROMOTED → WATCHING
 * opt-out on the first live run. From any other status it's a category
 * error — the agent probably meant INVALIDATED, or should be calling
 * close_position.
 *
 * Checked where the verb is APPLIED (inside the change_status switch),
 * not with the early rules — moving it earlier would change which error
 * an agent sees on a multiply-wrong call, and gate ordering is part of
 * the extraction contract.
 */
export function checkWatchingOptOut(
  input: TransitionInput,
): TransitionViolation | null {
  if (input.changeStatus !== "WATCHING") return null;
  if (input.currentStatus === "PROMOTED") return null;
  return {
    summary: `Refused WATCHING transition on $${input.ticker} — current status is ${input.currentStatus}, not PROMOTED.`,
    data: {
      error: "watching_transition_from_non_promoted",
      message:
        `change_status: "WATCHING" is reserved for the PROMOTED → WATCHING opt-out path. This thesis is ${input.currentStatus}. ` +
        `Did you mean change_status: "INVALIDATED" (kill the belief)? To exit an open position, call close_position.`,
    },
  };
}
