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
 * work item; the field fix is in `needs-action.ts`. (2) stands: only the
 * principal lowers a floor (2026-10-13).
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
 * REJECTED is a decline; EXPIRED is a lapse, and the two are counted apart
 * (the owner's ruling, 2026-10-13). A lapse is a soft pass — "not now, ask me
 * again" — never a decline: he sees every proposal and lets a sale lapse when
 * he wants to see the next day. On 10-13 the count carried NVDA's two lapses
 * in the window as declines, and the morning run lowered its floor $236 →
 * $217 under an after-a-decline exception, since deleted; no sale in the
 * window had been declined.
 *
 * Fully pure: no imports. An earlier cut pulled `isSystemicRejection` from
 * `proposals/maybe-await-approval`, which imports prisma, the mailer and the
 * push client, and five jest suites stopped loading. No database, no clock
 * of its own — callers pass `now`.
 */

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

/** The order status that means the principal said no. Only this is a decline. */
export const DECLINED_SALE_STATUSES = ["REJECTED"] as const;
/** The order status of a sale left to lapse: "not now, ask me again". Never a decline. */
export const LAPSED_SALE_STATUSES = ["EXPIRED"] as const;

/**
 * The Prisma `where` for a protective sale the principal did not take on one
 * or more positions: declined or left to lapse. `foldDeclines` counts the two
 * apart. Returned as a plain object so each caller can spread it next to its
 * own scoping (`positionId` vs `positionId: { in: [...] }`).
 */
export function declinedSaleWhere(now: Date = new Date(), windowDays = DECLINED_SALE_WINDOW_DAYS) {
  return {
    intent: "CLOSE",
    status: { in: [...DECLINED_SALE_STATUSES, ...LAPSED_SALE_STATUSES] },
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
  /** REJECTED (a decline) or EXPIRED (a lapse). Required: a row read without it would count a lapse as a decline. */
  status: string | null;
  /** With these, a decline dates from when it was answered, not when the sale was proposed. */
  expiresAt?: Date | null;
  updatedAt?: Date | null;
}

/**
 * When the proposal was answered: an expiry at its expiry time, a decline
 * when the order last changed (the decline is that change). MU's sale was
 * proposed 2026-10-06 and expired 10-07; the line said "most recently
 * 2026-10-06". A row without these dates falls back to the proposal's time.
 */
const answeredAt = (r: DeclineRow): Date =>
  (r.status === "EXPIRED" ? r.expiresAt : r.status === "REJECTED" ? r.updatedAt : null) ?? r.createdAt;

export interface DeclineSummary {
  /** Sales the principal declined (REJECTED). */
  declineCount: number;
  /** Sales left to lapse (EXPIRED): "not now, ask me again", never a decline. */
  lapseCount: number;
  /** When the newest of either was answered. The window counts from it. */
  lastDeclinedAt: Date;
  /** The most recent note the principal left, if any. */
  rejectMessage: string | null;
}

/** A lapse: the proposal expired. Anything else the where admits is a decline. */
const isLapse = (r: DeclineRow): boolean => (LAPSED_SALE_STATUSES as readonly string[]).includes(r.status ?? "");

/**
 * Fold order rows into the summary, dropping systemic tombstones (dedup and
 * cooldown rows the principal never saw). Rows in any order; the newest
 * surviving row supplies the note.
 */
export function foldDeclines(rows: DeclineRow[]): DeclineSummary | null {
  const real = rows
    .filter((r) => !isSystemicRejection(r.rejectionMessage))
    .sort((a, b) => answeredAt(b).getTime() - answeredAt(a).getTime());
  if (real.length === 0) return null;
  const lapseCount = real.filter(isLapse).length;
  return {
    declineCount: real.length - lapseCount,
    lapseCount,
    lastDeclinedAt: answeredAt(real[0]),
    rejectMessage: real.find((r) => r.rejectionMessage)?.rejectionMessage ?? null,
  };
}

export interface DeclinedSaleWork {
  /** Declined (REJECTED). Zero when the sale was only left to lapse. */
  declineCount: number;
  /** Left to lapse (EXPIRED). Absent on lines saved before 2026-10-13, which counted lapses as declines. */
  lapseCount?: number;
  lastDeclinedAt: string;
  rejectMessage: string | null;
  /** The line whose sale was declined, when the caller can see one. */
  floorPrice: number | null;
  /** Lowest low since the plan was last touched — a real level to name for the line. */
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
  if (!decline || decline.declineCount + decline.lapseCount <= 0) return null;

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
    lapseCount: decline.lapseCount,
    lastDeclinedAt: decline.lastDeclinedAt.toISOString(),
    rejectMessage: decline.rejectMessage,
    floorPrice,
    recentLow,
  };
}

/**
 * The sentence a run reads on a sale the principal did not take: what
 * complete_run says when the stock is unanswered. One sentence per fact — a
 * decline is "You declined", a lapse is "left to lapse: not a decline".
 */
export function declinedSaleLine(w: DeclinedSaleWork): string {
  const when = w.lastDeclinedAt.slice(0, 10);
  const lapses = w.lapseCount ?? 0;
  const line = w.floorPrice != null ? `the $${w.floorPrice.toFixed(2)} line` : "the line";
  const parts: string[] = [];
  if (w.declineCount > 0) {
    const asks = w.declineCount === 1 ? "You declined this sale" : `You declined this sale ${w.declineCount}×`;
    if (lapses === 0) parts.push(`${asks} — most recently ${when} — and the price is still past ${line}, with no new plan since.`);
    else parts.push(`${asks}.`);
  }
  if (lapses > 0) {
    parts.push(`Proposed ${lapses === 1 ? "once" : `${lapses}×`}${w.declineCount > 0 ? " more" : ""} and left to lapse: not a decline.`);
    parts.push(`Most recently ${when}, and the price is still past ${line}, with no new plan since.`);
  }
  if (w.rejectMessage) parts.push(`Your note: "${w.rejectMessage.slice(0, 240)}".`);
  if (w.recentLow != null && w.recentLow > 0) {
    parts.push(`Recent low $${w.recentLow.toFixed(2)}.`);
  }
  parts.push(
    w.declineCount > 0
      ? "Answer it: propose it again with today's reasons; if you think the line is wrong, name the level in your note: only the principal lowers it. A review that changes nothing does not answer it."
      : "While the price is still past the floor, propose it again with today's reasons. A review that changes nothing does not answer it.",
  );
  return parts.join(" ");
}

