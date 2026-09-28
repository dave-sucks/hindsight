/**
 * A copy of a rule that lives above the stock (DAV-322).
 *
 * TRIGGERS.md §2a: a thesis carries only what is its own — the floor, the
 * target, the catalyst exit, the review clock. A thesis rung beats every
 * rule above it, so a copy stamped on the stock freezes yesterday's number
 * and makes the seat's Triggers tab powerless. ABT carries
 * `TRAILING_FROM_HIGH 25 → EXIT` on the thesis; change the Compounder's 25
 * tomorrow and ABT keeps 25.
 *
 * ── `source` cannot decide this, and it is worth saying why ───────────
 *
 * The obvious test is `source: "DEFAULT"`. It is wrong in both directions
 * on the live book:
 *
 *   BMRN's "a meaningful earnings miss could signal VOXZOGO commercial
 *   erosion" is stamped DEFAULT — bespoke work wearing the template's
 *   stamp. ABT's own earnings reviews are stamped AGENT. CEG's boilerplate
 *   pair is stamped nothing at all.
 *
 * Sweeping on the stamp would have deleted seven rungs of real analyst
 * writing on AGIO, BMRN, DOCU and NVDA. So this module does not read
 * `source` at all. It asks two questions that the rows themselves answer.
 *
 * ── Test A: the same sentence appears on another stock ────────────────
 *
 * A rationale written word-for-word on four different tickers was written
 * for none of them. "Down 7% in a day — evaluate a pullback-add ONLY if…"
 * sits identically on ABT, ASML, NVDA and WST. That is a template's
 * output, and no judgement about any of those companies is lost by
 * removing it.
 *
 * Its blind spot, demonstrated on the live book: a template sentence
 * sitting on exactly ONE stock is invisible to this test. On 2026-09-27
 * NVDA alone carried "Beat — possibly a reason to extend the target." —
 * the TARGET template's own wording — and the sweep kept it. IOT came
 * back onto the watchlist overnight carrying the same line, and the next
 * run removed both. Nothing changed but the sample. So the sweep's output
 * is a reading of the book on a given day, not a fixed list: re-run it
 * before applying it, and read what it says it will do.
 *
 * ── Test B: the same rung at the same number as the rule above it ─────
 *
 * ABT's 25%-off-the-high exit says 25, and the Compounder's says 25. Two
 * rungs, one intent, one number — the lower one is a copy by definition,
 * and it is the copy that wins, which is the bug. A DIFFERENT number is
 * not this: that is an override, and whether a stock may override its
 * seat's gain review is a trading question, not a cleanup.
 *
 * Both tests are restricted to rules about how to trade a position — adds,
 * gain reviews, trails, earnings reviews. The floor, the target, the
 * review line and the review clock are the plan for this stock, and stay.
 *
 * Pure — no prisma, no clock. The sweep and the tests share it.
 */

import { triggerBucket } from "./bucket";
import type { Trigger } from "./types";

/**
 * Is this the kind of rule that belongs to the seat or the account rather
 * than to one stock? Keyed on (kind, action), because the same predicate
 * means different things under different actions — `GAIN_FROM_ENTRY` is
 * seat policy as a REVIEW and this stock's own 2R partial as a TRIM.
 */
export function isPortfolioPolicyRung(t: {
  predicate: { kind: string };
  action: string;
}): boolean {
  switch (t.predicate.kind) {
    case "PRICE_MOVE_PCT":
      return t.action === "ADD";
    case "GAIN_FROM_ENTRY":
      return t.action === "REVIEW";
    case "TRAILING_FROM_HIGH":
      return true;
    case "EARNINGS_BEAT":
    case "EARNINGS_MISS":
      return t.action === "REVIEW";
    default:
      return false;
  }
}

/** The number a rung is set at, for "is this the same rung at the same level". */
export function triggerValue(t: { predicate: Record<string, unknown> }): number | null {
  for (const key of ["pct", "level", "days", "min", "max", "minSurprisePct"]) {
    const v = t.predicate[key];
    if (typeof v === "number") return v;
  }
  return null;
}

export type CopyReason = "SAME_SENTENCE_ELSEWHERE" | "SAME_RUNG_SAME_NUMBER";

export interface FrozenCopy {
  trigger: Trigger;
  bucket: string;
  reason: CopyReason;
  /** Where the rule that governs instead lives; null = nothing does. */
  governedBy: "ANALYST" | "ACCOUNT" | null;
}

export interface FrozenCopyInput {
  /** The stock's own rungs, as stored on the thesis. */
  own: Trigger[];
  /** The rules of THIS stock's analyst. Not any analyst — its own seat. */
  analyst: Trigger[];
  /** The account's standing rules. */
  account: Trigger[];
  /**
   * Rationales that appear word-for-word on at least one OTHER stock.
   * The caller computes this across the whole book — a sentence is only
   * evidence of a template when there is somewhere else to compare it to.
   */
  sharedRationales: ReadonlySet<string>;
}

/** The rungs to take off this stock, in the order they sit on the thesis. */
export function frozenCopies({
  own,
  analyst,
  account,
  sharedRationales,
}: FrozenCopyInput): FrozenCopy[] {
  const above = new Map<string, { level: "ANALYST" | "ACCOUNT"; value: number | null }>();
  for (const t of account) above.set(triggerBucket(t), { level: "ACCOUNT", value: triggerValue(t) });
  // Analyst last: the nearer rule is the one that governs once the copy goes.
  for (const t of analyst) above.set(triggerBucket(t), { level: "ANALYST", value: triggerValue(t) });

  const out: FrozenCopy[] = [];
  for (const t of own) {
    if (!isPortfolioPolicyRung(t)) continue;
    const bucket = triggerBucket(t);
    const governing = above.get(bucket);
    const rationale = (t.rationale ?? "").trim();
    const templateWrote = rationale.length > 0 && sharedRationales.has(rationale);

    // Nothing above it means nothing takes over when it goes, so removing
    // it deletes the rule outright. That is a decision, not a cleanup —
    // with ONE exception. A template-written ADD is a leftover: NVDA
    // carries "down 7% in a day → add" with nothing above it, because the
    // account's was removed on 09-18 and the copy stayed. Averaging down
    // is never a per-stock choice — the PEAD seat does not do it at all —
    // so deleting it outright is the right outcome, not a loss.
    if (!governing) {
      if (templateWrote && t.action === "ADD") {
        out.push({ trigger: t, bucket, reason: "SAME_SENTENCE_ELSEWHERE", governedBy: null });
      }
      continue;
    }

    const reason: CopyReason | null = templateWrote
      ? "SAME_SENTENCE_ELSEWHERE"
      : governing.value != null && triggerValue(t) === governing.value
        ? "SAME_RUNG_SAME_NUMBER"
        : null;
    if (reason == null) continue;

    out.push({ trigger: t, bucket, reason, governedBy: governing.level });
  }
  return out;
}

/**
 * Rationales used verbatim on more than one stock. Give it every live
 * ladder on the account.
 */
export function sharedRationalesAcross(
  ladders: Array<{ ticker: string; triggers: Trigger[] }>,
): Set<string> {
  const tickersBySentence = new Map<string, Set<string>>();
  for (const { ticker, triggers } of ladders) {
    for (const t of triggers) {
      const r = (t.rationale ?? "").trim();
      if (!r) continue;
      const seen = tickersBySentence.get(r);
      if (seen) seen.add(ticker);
      else tickersBySentence.set(r, new Set([ticker]));
    }
  }
  const shared = new Set<string>();
  for (const [sentence, tickers] of tickersBySentence) {
    if (tickers.size > 1) shared.add(sentence);
  }
  return shared;
}

/** One line per removal, for the Activity feed and the sweep's output. */
export function frozenCopyLine(c: FrozenCopy): string {
  const why =
    c.reason === "SAME_SENTENCE_ELSEWHERE"
      ? "the same sentence sits on other stocks — a template wrote it"
      : "same rung, same number as the rule above it";
  const who =
    c.governedBy === "ANALYST"
      ? "the analyst's rule governs from here"
      : c.governedBy === "ACCOUNT"
        ? "the account's rule governs from here"
        : "nothing above it — the rule goes away, which is the point";
  return `${why}; ${who}`;
}
