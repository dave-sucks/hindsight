/**
 * Thesis lifecycle flips at proposal-approval time.
 *
 * When the user clicks Approve on a buy proposal, the thesis should flip
 * WATCHING / PROMOTED → ACTIVE (mirroring place_trade's inline flips at
 * place-trade.ts:802-874). When the user clicks Approve on a close
 * proposal, the thesis should flip ACTIVE → CLOSED (mirroring
 * close-position.ts).
 *
 * Without these, an approved buy leaves the thesis stuck in WATCHING and
 * an approved close leaves it stuck in ACTIVE — confusing the next
 * agent run, which sees an open position with no matching thesis state.
 *
 * Both helpers mirror the existing inline logic from the non-proposal
 * path so the resulting Thesis + ThesisUpdate rows look identical
 * regardless of whether the trade ran through approval or fired direct.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { typedPriceOf } from "@/lib/agent/triggers/price-levels";
import { reviewCadenceTrigger } from "@/lib/agent/triggers/defaults";
import { parseTriggersResilient } from "@/lib/agent/triggers/schema";
import {
  acceptedOps,
  addedTriggerRationale,
  applyTriggerOps,
  type TriggerOp,
} from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";
import { loadPlaybook } from "@/lib/agent/knowledge/load-playbook";
import { fillTemplateOps } from "@/lib/agent/knowledge/playbooks";
import { autoStopOps, loadAutoStop } from "@/lib/trading/auto-stop";

/**
 * Promote the WATCHING / PROMOTED thesis on (analystId, ticker) to HOLDING.
 * The stock keeps its triggers; the buy comes off (armHeldLadderOnFill).
 *
 * Mirrors place_trade.ts:802-874. Idempotent — if no WATCHING / PROMOTED
 * thesis is found (e.g. the agent already flipped it manually), no-op.
 * Failures are logged but never re-thrown — a thesis-flip miss should not
 * block the approval itself.
 */
export async function promoteThesisOnApproval(opts: {
  analystId: string;
  ticker: string;
  positionId: string;
  entryPrice: number;
  /** Null: the order named none (a buy placed by hand) — the thesis keeps its own. */
  targetPrice: number | null;
  stopLoss: number | null;
  /** The stop was typed on the Trade ticket: the floor it writes is the owner's. */
  stopIsOwners?: boolean;
  /** The analyst's reason for the proposal's sell price, when you approved that price. */
  stopReason?: string | null;
  /** The triggers that come with the buy besides its sell price (Position.buyTriggers). */
  buyTriggers?: Trigger[];
  runId?: string | null;
}): Promise<void> {
  // WATCHING or PROMOTED → HOLDING. One shared implementation with place_trade; see armHeldLadderOnFill below.
  await armHeldLadderOnFill({
    analystId: opts.analystId,
    ticker: opts.ticker,
    fillPrice: opts.entryPrice,
    targetPrice: opts.targetPrice,
    stopLoss: opts.stopLoss,
    stopIsOwners: opts.stopIsOwners,
    stopReason: opts.stopReason,
    buyTriggers: opts.buyTriggers,
    positionId: opts.positionId,
    runId: opts.runId ?? null,
    via: "approved proposal",
  });
}

/**
 * Arm the held-side ladder when a buy fills.
 *
 * ONE implementation, two callers: `place_trade` (paper, immediate fill) and
 * `promoteThesisOnApproval` (live, on the principal's approval). They used to
 * be two ~50-line copies, and the copies drifted (DAV-220, collapsed
 * 2026-08-27).
 *
 * What it does — as trigger ops, never a rewrite (DAV-242; DAV-234 is
 * what a rewrite cost: ASML's $2,800 target and four reviews, gone on the
 * fill):
 *   - finds the analyst's newest WATCHING thesis on the ticker
 *   - the playbook's watch triggers come off and its holding triggers go on:
 *     the buy trigger(s) — you can't buy what you already hold (GAPS A2
 *     found 35/36 ENTER tactical runs were on already-held tickers) — the
 *     Stop watching triggers, and every trigger written from the playbook's
 *     watch triggers (`playbook: "WATCH"`). A trigger written by hand stays
 *   - writes "Sell if below $X" at the approved sell price (the order's
 *     stopLoss): the analyst's, with its reason, from the proposal; yours
 *     from the Trade ticket. A watch trigger never becomes the sale
 *   - writes the triggers that come with the buy (Position.buyTriggers) as
 *     the analyst named them, each with its reason. An old order's or the
 *     Trade ticket's upside price (targetPrice) goes on as a price trigger
 *   - with "stop when buying" on, puts the sale floor that % under the buy
 *     price; a tighter analyst floor stays as a review line (lib/trading/auto-stop.ts)
 *   - writes the stock's playbook's fill templates as Settings → Playbook
 *     lists them (lib/agent/knowledge/playbooks.ts); one whose kind the stock
 *     already has is not written, and its Activity line says so. No playbook,
 *     nothing: the analyst's and the account's rules apply by inheritance
 *   - flips WATCHING → HOLDING and writes the STATUS_CHANGED audit row,
 *     one line per op
 *
 * Fail-soft: a throw is logged, never rethrown — a ladder problem must not
 * roll back a filled trade.
 */
export async function armHeldLadderOnFill(opts: {
  analystId: string;
  ticker: string;
  /** The fill, or on an approval the price then (the fill corrects it). Stop when buying measures from it. */
  fillPrice: number;
  /** Null leaves the thesis's own target / floor trigger as it is. */
  targetPrice: number | null;
  stopLoss: number | null;
  /** The stop was typed on the Trade ticket: the floor it writes is the owner's. */
  stopIsOwners?: boolean;
  /** Why the sell price is there: the analyst's words, the note on the "Sell if below" trigger. */
  stopReason?: string | null;
  /** The triggers that come with the buy besides its sell price, written as they are. */
  buyTriggers?: Trigger[];
  positionId: string;
  runId?: string | null;
  /** Where the fill came from — used only in the audit row's wording. */
  via: "place_trade" | "approved proposal";
}): Promise<void> {
  try {
    // A promoted row (re-entered on the first live run) is the one bought, else the newest watch. Either way
    // its buy and Stop watching lines come off below: there is no watch left to end.
    const find = (status: "PROMOTED" | "WATCHING") =>
      prisma.thesis.findFirst({
        where: { ticker: opts.ticker, status, researchRun: { agentConfigId: opts.analystId } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, direction: true, setupId: true, accountId: true, catalystDate: true, triggers: true },
      });
    const watchingThesis = (await find("PROMOTED")) ?? (await find("WATCHING"));
    if (!watchingThesis) return;

    const stored = parseTriggersResilient(watchingThesis.triggers).triggers as Trigger[];
    // At the fill, the playbook's watch triggers come off and its holding triggers go on. A trigger written by hand stays.
    const watchTriggers = (t: Trigger) => t.action === "ENTER" || t.action === "STOP_WATCHING" || t.playbook === "WATCH";
    const buyTriggers = opts.buyTriggers ?? [];
    // The playbook's fill triggers, read against the triggers left and the ones the buy brings.
    // A playbook that can't be read writes none, and the Activity line says so.
    const playbook = fillTemplateOps(
      watchingThesis.setupId ? await loadPlaybook(watchingThesis.accountId, watchingThesis.setupId) : [],
      [...stored.filter((t) => !watchTriggers(t)), ...buyTriggers],
    );
    // The sale is the price the buy came with: yours from the Trade ticket, or the analyst's with its
    // reason. None named (an Auto-buy) writes none — never the entry, which would arm a sale at the buy price.
    const chooser = opts.stopIsOwners ? "PRINCIPAL" : opts.stopReason?.trim() ? "AGENT" : null;
    const floorOp: TriggerOp[] =
      opts.stopLoss != null
        ? [{ op: "level", slot: "FLOOR", price: opts.stopLoss, rationale: chooser === "PRINCIPAL" ? addedTriggerRationale("EXIT", { watch: "price", is: "below", value: opts.stopLoss }) : opts.stopReason?.trim() }]
        : [];
    const add = (t: Trigger): TriggerOp => ({ op: "add", trigger: t });
    // Each trigger is written by whoever chose it, so it reads as theirs.
    const byActor: Array<["SYSTEM" | "AGENT" | "PRINCIPAL", TriggerOp[]]> = [
      [
        "SYSTEM",
        [
          ...stored.filter(watchTriggers).map((t) => ({ op: "remove" as const, id: t.id })),
          ...(chooser ? [] : floorOp),
          ...(opts.targetPrice != null ? [{ op: "level" as const, slot: "TARGET" as const, price: opts.targetPrice }] : []),
          ...playbook.ops,
        ],
      ],
      ["AGENT", [...(chooser === "AGENT" ? floorOp : []), ...buyTriggers.map(add)]],
      ["PRINCIPAL", chooser === "PRINCIPAL" ? floorOp : []],
    ];
    let applied: { triggers: Trigger[]; results: ReturnType<typeof applyTriggerOps>["results"] } = { triggers: stored, results: [] };
    for (const [actor, ops] of byActor) {
      if (!ops.length) continue;
      const r = applyTriggerOps({ stored: applied.triggers, ops, direction: watchingThesis.direction, status: "HOLDING", actor, mintId: () => randomUUID() });
      applied = { triggers: r.triggers, results: [...applied.results, ...r.results] };
    }
    // Stop when buying: read against the floor the buy just set.
    const stopOps = autoStopOps({
      triggers: applied.triggers,
      direction: watchingThesis.direction,
      buyPrice: opts.fillPrice,
      setting: await loadAutoStop(opts.analystId),
    });
    const stopped = stopOps.length
      ? applyTriggerOps({ stored: applied.triggers, ops: stopOps, direction: watchingThesis.direction, status: "HOLDING", actor: "SYSTEM", mintId: () => randomUUID() })
      : null;
    const nextTriggers = stopped?.triggers ?? applied.triggers;
    const results = [...applied.results, ...(stopped?.results ?? [])];
    for (const r of stopped?.results ?? []) if (!r.ok) console.warn(`[armHeldLadderOnFill] ${opts.ticker}: stop when buying not set — ${r.reason}`);

    await prisma.thesis.update({
      where: { id: watchingThesis.id },
      data: {
        status: "HOLDING",
        promotedAt: null,
        triggers: nextTriggers as unknown as object,
      },
    });
    // A floor the setting moved is mirrored onto the position, as an owner's edit is.
    if (stopped?.results.some((r) => r.ok)) {
      // The sale the setting wrote is its first op; its price is the position's sell price.
      const sale = stopOps[0];
      const floor = sale && (sale.op === "add" || sale.op === "replace") ? typedPriceOf(sale.trigger) : null;
      await prisma.position.updateMany({ where: { id: opts.positionId }, data: { stopLoss: floor } });
    }
    await prisma.thesisUpdate.create({
      data: {
        thesisId: watchingThesis.id,
        type: "STATUS_CHANGED",
        summary: `Promoted ${opts.ticker} ${watchingThesis.direction} ${watchingThesis.status} → HOLDING on ${opts.via}`,
        fieldChanges: {
          status: { from: watchingThesis.status, to: "HOLDING" },
          triggerOps: { from: null, to: [...acceptedOps(results), ...playbook.notWritten] },
        },
        runId: opts.runId ?? null,
        tradeId: opts.positionId,
        // The price the buy was made at: stop when buying set its sale under it, and the fill moves it from here.
        priceAtTime: opts.fillPrice,
      },
    });
  } catch (err) {
    console.warn(
      `[armHeldLadderOnFill] ${opts.ticker} → HOLDING flip failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * A take-profit close routes the paired thesis back to WATCHING for re-entry
 * (docs/plans/SCALE_INTO_WINNERS.md PR5) instead of terminal RETIRED. Signal =
 * closeReason "TARGET" — the canonical deliberate profit-take (agent/tactical
 * target-exits carry it, and so does an Auto-sell on a target trigger).
 * Exported for unit testing.
 *
 * NOTE: this is no longer the ONLY road back to WATCHING — see
 * {@link shouldRecycleToWatching}, which adds the belief-attested protective
 * exit (GAPS P1-35).
 */
export function isProfitTakeReentry(closeReason: string): boolean {
  return closeReason.trim().toUpperCase() === "TARGET";
}

/**
 * Does this close route the paired thesis back to WATCHING (re-entry radar)
 * rather than to terminal RETIRED(SOLD)? Two roads back — GAPS P1-35 /
 * docs/plans/SOLD_NAME_CONTINUITY.md §1:
 *
 *   1. **Profit-take** — closeReason "TARGET". Unchanged since PR5.
 *   2. **Belief-attested protective exit** — the closing agent explicitly
 *      attested that the thesis's belief SURVIVED the exit (we exited on
 *      price, not because the story broke). `beliefSurvived === true`.
 *
 * Why (2) exists: the old rule was inverted for the risk that actually
 * matters. A TARGET exit is a sale into strength — low "did we sell the dip?"
 * risk — and it recycled. A STOP/trailing exit is a sale into weakness — the
 * HIGHEST "did we sell the dip?" risk — and it went dark forever. Measured on
 * the live book 2026-08-16: 28 of 29 SOLD theses since June 1 went terminal
 * via a non-TARGET close. ARQT (+$845), VRDN (+$445), XENE (+$966) all
 * vanished off every radar on protective exits where the belief may well have
 * been intact. The Game Plan makes this worse, not better: trail
 * is *designed* to bank a give-back regardless of whether the thesis holds, so
 * a growing share of exits are "belief survived, we just protected the gain."
 *
 * Deliberately NOT a blunt "recycle every stop" rule: a genuinely broken
 * thesis should stay dead rather than clog the watchlist. The agent decides
 * (Layer 3 judgment), this function and the flip below provide the mechanism
 * (Layer 2). No attestation — Auto-sells,
 * manual UI closes, promotion force-closes — degrades to today's terminal
 * behavior, which is the safe default.
 *
 * An INVALIDATED-flavored close can never recycle even if something upstream
 * attested: "the setup broke structurally" and "the belief survived" are
 * contradictory, and the close tools collapse THESIS_INVALIDATED into MANUAL
 * before it reaches here, so we guard on the raw text too.
 */
export function shouldRecycleToWatching(
  closeReason: string,
  beliefSurvived?: boolean | null,
): boolean {
  if (isProfitTakeReentry(closeReason)) return true;
  if (beliefSurvived !== true) return false;
  const normalized = closeReason.trim().toUpperCase();
  return !normalized.includes("INVALID");
}

/**
 * Flip the ACTIVE thesis on (analystId, ticker) to CLOSED and write the
 * status-change audit row. The single shared chokepoint for "a position
 * truly closed → reflect it on the paired thesis," used by:
 *
 *   • closeOpenPosition's FILLED-close branch (lib/actions/closeTrade.actions.ts)
 *     — every direct close that actually fills now (agent close_position,
 *     an Auto-sell, and manual UI closes) routes through there, so they all flip identically.
 *   • closeThesisOnApproval (below) — the approval path, when an
 *     AWAITING_APPROVAL close proposal is later approved.
 *
 * Audit row type stays `CLOSED` (not STATUS_CHANGED): the dashboard activity
 * feed + run-summary bucket the close on `type === "CLOSED"`, and the
 * tactical-run close-out gate accepts any non-TRIGGER_FIRED row. The
 * fieldChanges payload carries the ACTIVE→CLOSED status delta.
 *
 * Idempotent — if no matching ACTIVE thesis is found (already flipped, or
 * the close path's tool already handled it), it no-ops. Failures are logged
 * but never re-thrown: a thesis-flip miss must not roll back a fill that
 * already happened. The next agent run recovers via get_theses.
 *
 * P1-18: before this was wired into closeOpenPosition, a price-monitor
 * trailing-stop close on an approval-OFF book closed the Position but left
 * the paired thesis ACTIVE forever (an ACTIVE thesis with no position).
 */
export async function closeThesisForPosition(opts: {
  analystId: string;
  ticker: string;
  positionId: string;
  /** "TARGET" | "STOP" | "TIME" | "MANUAL" or a richer free-text reason. */
  closeReason: string;
  rationale: string | null;
  /** Fill price, surfaced as priceAtTime on the audit row when known. */
  priceAtTime?: number | null;
  runId?: string | null;
  /** Distinguishes "approved proposal" vs "direct fill" in the summary. */
  summaryContext?: string;
  /**
   * GAPS P1-35 — the closing agent's attestation that the thesis BELIEF
   * survived this exit (we sold on price, not because the story broke). true
   * recycles a protective exit back to WATCHING instead of terminal RETIRED.
   * Undefined/null on every non-agent path (Auto-sells,
   * manual UI closes) → terminal, i.e. unchanged behavior.
   */
  beliefSurvived?: boolean | null;
}): Promise<void> {
  try {
    const activeThesis = await prisma.thesis.findFirst({
      where: {
        ticker: opts.ticker,
        // P1-24 B2: held theses are HOLDING (new) or ACTIVE (legacy, pre-
        // backfill). Match both so an approved close never strands a held row.
        status: { in: ["HOLDING"] },
        // P1-24 PASS-off-direction: explicit ALLOWLIST (LONG/SHORT) replaces
        // the old `{ not: "PASS" }` denylist. A held thesis is always
        // directional; the allowlist is robust to direction=null and the
        // status filter above already excludes passes (PASS → status=PASSED).
        direction: { in: ["LONG", "SHORT"] },
        researchRun: { agentConfigId: opts.analystId },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!activeThesis) return;

    const ctxSuffix = opts.summaryContext ? ` ${opts.summaryContext}` : "";

    // ── Re-entry radar (docs/plans/SCALE_INTO_WINNERS.md PR5) ──────────────
    // A take-profit on a name we still believe in returns to WATCHING rather
    // than terminal RETIRED, so the daily run keeps it on the radar and can
    // re-enter on a pullback. (A RETIRED/SOLD row is DEAD — excluded from
    // get_theses' default book, re-mintable only by Discovery.) Held-only
    // triggers (stop EXIT, scale-in rungs) are cleared since there is no
    // position; a 1-day review cadence flags it so the next run sets a fresh
    // re-entry trigger or archives it. Only profit-takes route here — stops,
    // invalidations, and risk exits stay RETIRED via the branch below.
    if (shouldRecycleToWatching(opts.closeReason, opts.beliefSurvived)) {
      // Two flavors land here: a profit-take (TARGET), and a protective exit
      // the closing agent attested the belief survived (P1-35). They get the
      // same mechanism — held-side rungs cleared (no position, so they are
      // meaningless) and a 1-day review-clock stamped so the next daily
      // run MUST resolve it: arm a reclaim entry trigger, or archive it.
      // The cadence trigger replaces the old due-date write (DAV-221) —
      // a bare `triggers: []` on a WATCHING row would leave it invisible
      // forever, since watch items only come due on their own cadence.
      // Re-entry always runs through an ENTER trigger on a reclaim, never
      // an auto-rebuy at the stop-out price.
      const isProfitTake = isProfitTakeReentry(opts.closeReason);
      await prisma.thesis.update({
        where: { id: activeThesis.id },
        data: {
          status: "WATCHING",
          retiredReason: null,
          closedAt: new Date(),
          closeReason: opts.closeReason,
          triggers: [
            { ...reviewCadenceTrigger(1), source: "DEFAULT" },
          ] as object[],
        },
      });
      await writeThesisUpdate({
        thesisId: activeThesis.id,
        type: "CLOSED",
        summary: isProfitTake
          ? `Took profit on ${opts.ticker}${ctxSuffix} — ${opts.closeReason}; kept on watch for re-entry`
          : `Closed ${opts.ticker}${ctxSuffix} — ${opts.closeReason}; belief intact, kept on watch for a reclaim`,
        // The analyst's words on the sale, or none.
        rationale: opts.rationale ?? undefined,
        fieldChanges: {
          status: { from: activeThesis.status, to: "WATCHING" },
          ...(isProfitTake ? {} : { beliefSurvived: { from: null, to: true } }),
        },
        runId: opts.runId,
        priceAtTime: opts.priceAtTime ?? null,
      });
      return;
    }

    await prisma.thesis.update({
      where: { id: activeThesis.id },
      data: {
        // P1-24 B3: terminal collapse — a sold/closed position retires the
        // thesis with retiredReason=SOLD (was status='CLOSED'). closedAt/
        // closeReason still carry the narrative.
        status: "RETIRED",
        retiredReason: "SOLD",
        closedAt: new Date(),
        closeReason: opts.closeReason,
      },
    });
    await writeThesisUpdate({
      thesisId: activeThesis.id,
      type: "CLOSED",
      summary: `Closed ${opts.ticker} position${ctxSuffix} — ${opts.closeReason}`,
      rationale: opts.rationale ?? undefined,
      fieldChanges: {
        status: { from: activeThesis.status, to: "RETIRED" },
        retiredReason: { from: null, to: "SOLD" },
      },
      runId: opts.runId,
      priceAtTime: opts.priceAtTime ?? null,
    });
  } catch (err) {
    console.warn(
      `[closeThesisForPosition] ACTIVE → CLOSED flip failed for ${opts.ticker}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Flip the ACTIVE thesis on (analystId, ticker) to CLOSED on a successful
 * close proposal. Thin wrapper over {@link closeThesisForPosition} so the
 * approval path and the direct-fill path produce identical Thesis +
 * ThesisUpdate shapes. See docs/plans/TRADE_AS_PROPOSAL.md.
 */
export async function closeThesisOnApproval(opts: {
  analystId: string;
  ticker: string;
  positionId: string;
  closeReason: string;
  rationale: string | null;
  runId?: string | null;
  /**
   * P1-35 — read off `Order.closeBeliefSurvived`, the attestation the agent
   * made when it PROPOSED this close. The approval can land days later, so
   * the Order row is what carries the agent's judgment across the gap.
   */
  beliefSurvived?: boolean | null;
}): Promise<void> {
  await closeThesisForPosition({
    analystId: opts.analystId,
    ticker: opts.ticker,
    positionId: opts.positionId,
    closeReason: opts.closeReason,
    rationale: opts.rationale,
    runId: opts.runId,
    summaryContext: "on approved proposal",
    beliefSurvived: opts.beliefSurvived,
  });
}
