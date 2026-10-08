/**
 * declined-sale.ts — a sale the principal declined is the next run's job.
 *
 * ── The failure this closes (IOT, 2026-09-16 → 09-25) ────────────────────
 *
 * IOT was bought at $39.83 and the principal set the floor to $41.40 himself.
 * The floor broke on 09-16 and a sale was proposed. He declined it:
 *
 *   (paraphrased) Holding to see whether it recovers. If this sale is
 *   declined, the stop should move up to about $40.50, just below the
 *   gap-day close.
 *
 * The same $41.40 ask came back on 09-17, 09-21, 09-23 and 09-25. Three of
 * the four expired. On 09-25 he took it, at $39.32 — 5.0% below the price at
 * the first ask, about $476 on 230 shares. FIVE is the same shape, 2.7%.
 *
 * The one run that touched IOT in those nine days (PEAD morning, 09-21) had
 * that note in front of it — verbatim, in `heldThroughFloor.rejectMessage`,
 * with `recentLow: 38.985` beside it — and added a 60-day review and an
 * earnings trigger. It never mentioned the floor or the note.
 *
 * ── Why it did nothing, which is three things ────────────────────────────
 *
 * 1. The note arrived on a field the prompt did not hang an obligation on.
 *    The old `principalDirective` field was null (it showed only the newest
 *    line), and the prompt's hardest paragraph was keyed to it. Since
 *    2026-09-30 every full row opens with `context` instead: the
 *    principal's decisions of the last 30 days, whatever came after them.
 * 2. The only sensible answer was forbidden. He asked for the floor to come
 *    DOWN to ~$40.50; the ratchet (DAV-185) says an agent never lowers a
 *    protective level. So the one instruction he gave was the one thing the
 *    agent could not do.
 * 3. Nothing held the run to answering. `heldThroughFloor` is an
 *    informational row field, not a `needsAction` item, so any review row
 *    cleared the thesis and the run completed clean.
 *
 * This module is (3): the same decline, promoted from background colour to a
 * work item. The ratchet exemption is in `triggers/ops.ts`; the field fix is
 * in `situations/work-flag.ts`.
 *
 * ── One source for "a real, protective, recent decline" ──────────────────
 *
 * That filter already existed twice — the batch computation in
 * `tools/get-theses.ts` and its single-position mirror in
 * `proposals/held-through-context.ts`, which carries a comment begging the
 * next person to keep them in sync. This module is now the one place the
 * rule is written; both of those and `complete_run` read it from here. The
 * rule: a CLOSE order the principal actually saw (`expiresAt` set), that
 * ended REJECTED or EXPIRED, tagged `closeReason: "STOP"` (a declined TARGET
 * exit means "let it run" — a different and benign hold), inside the window,
 * excluding systemic tombstones.
 *
 * Fully pure: a type import and nothing else. That matters —
 * `triggers/ops.ts` reads the ratchet policy at the bottom of this file,
 * and ops.ts is imported by trigger tests and client code. An earlier cut
 * pulled `isSystemicRejection` from `proposals/maybe-await-approval`, which
 * imports prisma, the mailer and the push client, and five jest suites
 * stopped loading. No database, no clock of its own — callers pass `now`.
 */


import { levelOf, shapeOf } from "@/lib/agent/triggers/condition";
import type { When } from "@/lib/agent/triggers/condition";

/**
 * Rejection messages the SYSTEM wrote (the retired duplicate-close fold, the
 * exit cooldown), not the principal. A tombstone is not a decline, so it
 * never counts as one.
 */
const SYSTEMIC_REJECTION_PREFIXES = ["Duplicate close", "Suppressed —"] as const;

/** True when this REJECTED order is a systemic tombstone, not a real decline. */
export function isSystemicRejection(rejectionMessage: string | null): boolean {
  if (!rejectionMessage) return false;
  return SYSTEMIC_REJECTION_PREFIXES.some((p) => rejectionMessage.startsWith(p));
}

/**
 * How far back a declined protective sale stays the run's job.
 *
 * Seven days because the exit stream re-surfaces roughly daily while a
 * breach persists, so the window self-refreshes; a decline with no fresh
 * proposals behind it ages out on its own. `held-through-context.ts`
 * re-exports this so its historic import path keeps working.
 */
export const DECLINED_SALE_WINDOW_DAYS = 7;

/** Order statuses that mean the principal said no, or said nothing. */
export const DECLINED_SALE_STATUSES = ["REJECTED", "EXPIRED"] as const;

/**
 * The Prisma `where` for a real protective decline on one or more positions.
 * Returned as a plain object so each caller can spread it next to its own
 * scoping (`positionId` vs `positionId: { in: [...] }`).
 */
export function declinedSaleWhere(now: Date = new Date(), windowDays = DECLINED_SALE_WINDOW_DAYS) {
  return {
    intent: "CLOSE",
    status: { in: [...DECLINED_SALE_STATUSES] },
    // expiresAt set = a card was actually staged in front of the principal.
    expiresAt: { not: null },
    // Protective only. A declined TARGET exit is "let it run".
    closeReason: "STOP",
    createdAt: { gte: new Date(now.getTime() - windowDays * 86_400_000) },
  };
}

export interface DeclineRow {
  createdAt: Date;
  rejectionMessage: string | null;
}

export interface DeclineSummary {
  declineCount: number;
  lastDeclinedAt: Date;
  /** The most recent note the principal left, if any. */
  rejectMessage: string | null;
}

/**
 * Fold order rows into the summary, dropping systemic tombstones (dedup and
 * cooldown rows the principal never saw). Rows in any order; the newest
 * surviving row supplies the note.
 */
export function foldDeclines(rows: DeclineRow[]): DeclineSummary | null {
  const real = rows
    .filter((r) => !isSystemicRejection(r.rejectionMessage))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (real.length === 0) return null;
  return {
    declineCount: real.length,
    lastDeclinedAt: real[0].createdAt,
    rejectMessage: real.find((r) => r.rejectionMessage)?.rejectionMessage ?? null,
  };
}

export interface DeclinedSaleWork {
  declineCount: number;
  lastDeclinedAt: string;
  rejectMessage: string | null;
  /** The line whose sale was declined, when the caller can see one. */
  floorPrice: number | null;
  /** Lowest low since the plan was last touched — a real level to re-draw to. */
  recentLow: number | null;
}

/**
 * Is there an unanswered declined protective sale on this stock right now?
 *
 * `floorPrice` and `currentPrice` are optional on purpose. When both are
 * known and the price has recovered back onto the safe side of the line, the
 * floor held and the decline stops being live — the next breach is a fresh,
 * meaningful ask, not a repeat. When either is unknown the work item still
 * fires: a caller that cannot see the floor is not evidence that the
 * principal's decline was answered, and going quiet is the bug being fixed
 * here. Erring loud costs one sentence in a review; erring quiet cost $476.
 */
export function declinedSaleWork(input: {
  status: string;
  direction: string | null;
  decline: DeclineSummary | null;
  floorPrice: number | null;
  currentPrice: number | null;
  recentLow: number | null;
  now: Date;
  windowDays?: number;
}): DeclinedSaleWork | null {
  const { status, direction, decline, floorPrice, currentPrice, recentLow, now } = input;
  // A declined sale only means anything while we still own the thing.
  if (status !== "HOLDING") return null;
  if (!decline || decline.declineCount <= 0) return null;

  const windowDays = input.windowDays ?? DECLINED_SALE_WINDOW_DAYS;
  const ageMs = now.getTime() - decline.lastDeclinedAt.getTime();
  if (ageMs > windowDays * 86_400_000) return null;

  if (floorPrice != null && currentPrice != null && currentPrice > 0) {
    const stillPast =
      direction === "SHORT" ? currentPrice >= floorPrice : currentPrice <= floorPrice;
    if (!stillPast) return null;
  }

  return {
    declineCount: decline.declineCount,
    lastDeclinedAt: decline.lastDeclinedAt.toISOString(),
    rejectMessage: decline.rejectMessage,
    floorPrice,
    recentLow,
  };
}

/** The sentence a run, a row and the thesis sheet all show. */
export function declinedSaleLine(w: DeclinedSaleWork): string {
  const when = w.lastDeclinedAt.slice(0, 10);
  const asks =
    w.declineCount === 1 ? "You declined this sale" : `You declined this sale ${w.declineCount}×`;
  const parts = [
    `${asks} — most recently ${when} — and the price is still past ${
      w.floorPrice != null ? `the $${w.floorPrice.toFixed(2)} line` : "the line"
    }, with no new plan since.`,
  ];
  if (w.rejectMessage) parts.push(`Your note: "${w.rejectMessage.slice(0, 240)}".`);
  if (w.recentLow != null && w.recentLow > 0) {
    parts.push(`Recent low $${w.recentLow.toFixed(2)}.`);
  }
  parts.push(
    "Answer it: re-draw the floor to a level you can name and set when to look again, or propose the sale again with today's reasons. A review that changes nothing does not answer it.",
  );
  return parts.join(" ");
}


// ── What a decline actually unlocks (QB ruling, 2026-09-27) ──────────────
//
// The first cut of this filtered out every LOWERED violation while a
// decline was live, which is far too much rope. Three hostile edits landed
// on the review branch: IOT's floor dropped from $41.40 to $5, an 8% trail
// widened to 30%, and a floor was lowered after the price had already
// recovered above it.
//
// The decline is the principal saying "not at this price, give it room" —
// it is not a week-long licence to loosen anything on the stock. So:
//
//   • the FLOOR only. A trail's give-back percentage is not the line he
//     declined, and widening it is a different decision.
//   • while the price is still past that line. Once it recovers, the floor
//     held and the decline is spent — `declinedSaleWork` already stops
//     reporting it, and the write path now asks the same question.
//   • no more than 15% below the declined line. Past that it isn't
//     re-drawing a floor, it's removing one, and removing one is his.

/** How far below the declined line a re-drawn floor may sit. */
export const REPLAN_FLOOR_MAX_DROP_PCT = 15;

/** The lowest level a re-drawn floor may take, given the line that was declined. */
export function replanFloorBound(declinedFloor: number, direction: string | null): number {
  const isLong = direction !== "SHORT";
  const f = REPLAN_FLOOR_MAX_DROP_PCT / 100;
  return isLong ? declinedFloor * (1 - f) : declinedFloor * (1 + f);
}

/**
 * May the ratchet let this one violation through, because a sale on this
 * stock was declined? Everything not explicitly allowed stays refused.
 */
export function declineReplanAllows(input: {
  /** RatchetViolation.reason */
  reason: string;
  /** The predicate the edit would leave in place. */
  afterPredicate: When | null | undefined;
  /** The line whose sale was declined; null = we cannot bound it, so no. */
  declinedFloor: number | null;
  direction: string | null;
}): boolean {
  // REMOVED and FIREMODE_DEMOTED are not re-planning.
  if (input.reason !== "LOWERED") return false;
  if (input.declinedFloor == null || !(input.declinedFloor > 0)) return false;
  const p = input.afterPredicate;
  if (!p) return false;
  const isLong = input.direction !== "SHORT";
  // An absolute floor, on the side this direction is protected from.
  const w = shapeOf(p);
  const floor = w == null ? null : levelOf(w);
  if (floor == null || floor.above === isLong || !(floor.value > 0)) return false;
  const level = floor.value;
  const bound = replanFloorBound(input.declinedFloor, input.direction);
  return isLong ? level >= bound : level <= bound;
}
