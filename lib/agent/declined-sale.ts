/**
 * declined-sale.ts — a sale the principal declined is the next run's job.
 *
 * ── The failure this closes (IOT, 2026-09-16 → 09-25) ────────────────────
 *
 * IOT was bought at $39.83 and the principal set the floor to $41.40 himself.
 * The floor broke on 09-16 and a sale was proposed. He declined it:
 *
 *   "its moving here and there. Im gonna see if theres any chance it picks
 *    back up. ... If you don't approve this, I'd immediately raise the stop
 *    to around $40.50 (just below the gap-day close)."
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
 * 1. The note arrived on a field the prompt does not hang an obligation on.
 *    `principalDirective` was null; the prompt's hardest paragraph says
 *    "whenever `principalDirective` is set, read it and respond."
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
 * in `needs-action.ts`.
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
 * Pure except for `isSystemicRejection`, which is itself pure. No database,
 * no clock of its own — callers pass `now`.
 */

import { isSystemicRejection } from "@/lib/proposals/maybe-await-approval";

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
