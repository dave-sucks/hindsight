// ── Tactical Run ──────────────────────────────────────────────────────────
// Consumes `app/thesis.trigger.fired` events emitted by trigger-evaluator.
// One event = one (thesis, trigger) pair = one focused agent run.
//
// Scope is deliberately narrow:
//   • Single ticker (thesis.ticker)
//   • Single decision (validate trigger, then act / update / pass)
//   • 15 step budget (vs 65 for the daily run)
//   • update_thesis is the REQUIRED close-out — every tactical run
//     writes one ThesisUpdate row whether or not it traded.
//
// Tool surface comes from MODES["tactical"] in lib/agent/modes.ts.
// record_thesis is intentionally absent — tactical never mints new
// theses; if conviction breaks the agent calls update_thesis with
// change_status="INVALIDATED" and close_position.

import { inngest } from "@/lib/inngest/client";
import { enterAlreadyChecked, rearmBuyAfterPass } from "@/lib/agent/triggers/rearm";
import { prisma } from "@/lib/prisma";
import { writeThesisUpdate } from "@/lib/agent/thesis-updates";
import { generateText, stepCountIs } from "ai";
import { repeatRefusalGuard, repeatRefusalStop } from "@/lib/agent/repeat-refusal";
import { saveRunThread, type RunStep } from "@/lib/agent/run-thread";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { buildTacticalSystemPrompt, stockFromRead } from "@/lib/agent/system-prompts/intraday-tactical";
import { loadSetupOverrides } from "@/lib/agent/knowledge/load-setup-overrides";
import { conditionSentence, sentenceOf } from "@/lib/agent/triggers/condition";
import { MODES } from "@/lib/agent/modes";
import { addTokenUsage, emptyTokenUsage, recordTokenUsage } from "@/lib/agent/token-usage";
import { listOpenRefusalsForAnalyst, listOpenRefusalsForRun, recordOpenRefusalsEvent } from "@/lib/agent/gate-rejections";
import { refusalLinesFor, refusalNudge } from "@/lib/agent/refusal-carryover";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { autoSellCloseReason, protectiveExitCloseReason } from "@/lib/agent/triggers/types";
import type { Trigger } from "@/lib/agent/triggers/types";
import { doItTrade, trimPctOf } from "@/lib/agent/triggers/fire-mode";
import { doItCall } from "@/lib/agent/triggers/do-it";
import { PAUSED_SALE_NOTE } from "@/lib/agent/triggers/paused";
import { saleUnderWay } from "@/lib/proposals/position-lock";
import { useOnce } from "@/lib/agent/triggers/use-once";
import { recordGateRejection } from "@/lib/agent/gate-rejections";
import { getLiveQuote } from "@/lib/market-data/live-quote";
import { freshQuotePrice } from "@/lib/market-data/quote-age";
import {
  loadLevelSources,
  resolveThesisLadder,
} from "@/lib/agent/triggers/load-levels";
import { preCatalystWindowLine } from "@/lib/agent/knowledge/setups";
import { latestBriefs } from "@/lib/research/brief-read";
import { briefKickoffLine } from "@/lib/research/brief-types";

// ── Types ───────────────────────────────────────────────────────────────

interface FiredPayload {
  thesisId: string;
  triggerId: string;
  analystId: string;
  ticker: string;
  action: Trigger["action"];
  /** Quote that fired the predicate (see evaluator). */
  firedPrice?: number | null;
  /**
   * The facts behind the fire, when the predicate had any beyond price —
   * today, the reported earnings figures ("Reported 2026-08-26 (after
   * close): EPS $2.22 vs $2.14 est — beat by 3.8%…"). Set by the evaluator.
   * Goes into the kickoff message so the agent starts with the numbers
   * instead of spending a step fetching what fired it.
   */
  firedContext?: string | null;
  /** Other protective triggers that fired with this one on the same pass (DAV-254). */
  coFired?: Array<{ triggerId: string; sentence: string }>;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Find the fired rung in an already-resolved ladder. Takes the resolved
 * array rather than the raw JSONB column so inherited rungs are findable
 * — see the call site.
 */
function findTriggerById(ladder: Trigger[], id: string): Trigger | null {
  const found = ladder.find((t) => t.id === id);
  if (!found || typeof found.id !== "string") return null;
  return found;
}

/**
 * Close reason for an Auto-sell. Always STOP or TARGET (never MANUAL/TIME):
 * a declined STOP counts as a declined sale, a TARGET sale sends the stock
 * back to watching.
 */
function directExitReason(
  trigger: Trigger,
  direction: string | null,
): "STOP" | "TARGET" {
  return autoSellCloseReason(trigger.predicate, direction);
}

// How long after a REJECTED close proposal to keep suppressing re-fires of
// the same EXIT/TRIM trigger. A reject means "I've seen the stop, I'm
// holding" — re-proposing on the next 5-min tick would just spawn a
// reject-loop. After this window the trigger can re-surface if the position
// is still in breach. Tunable.
const EXIT_RECHECK_SNOOZE_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Inngest function ───────────────────────────────────────────────────

export const tacticalRun = inngest.createFunction(
  {
    id: "tactical-run",
    name: "Tactical Run (event-driven)",
    // Concurrency cap — multiple triggers can fire in the same minute. We
    // serialize per-thesis to avoid two tactical runs racing on the same
    // book entry (e.g. EXIT trigger + ADD trigger firing back-to-back).
    concurrency: { limit: 4, key: "event.data.thesisId" },
    retries: 1,
  },
  { event: "app/thesis.trigger.fired" },
  async ({ event, step }) => {
    const payload = event.data as Partial<FiredPayload>;
    if (
      !payload.thesisId ||
      !payload.triggerId ||
      !payload.analystId ||
      !payload.ticker
    ) {
      return { skipped: "missing-payload" };
    }
    const fired = payload as FiredPayload;

    // ── Load thesis + trigger + position ──────────────────────────────
    // Note on step.run: Inngest JSON-serializes the return value, so Dates
    // come out as ISO strings on the other side. We pre-compute everything
    // we need in numeric / string form here.
    const ctx = await step.run("load-context", async () => {
      const thesis = await prisma.thesis.findUnique({
        where: { id: fired.thesisId },
        include: {
          researchRun: { select: { agentConfigId: true } },
        },
      });
      if (!thesis) return null;
      if (
        thesis.status !== "HOLDING" &&
        thesis.status !== "WATCHING"
      ) {
        return null;
      }
      const analystId = thesis.researchRun.agentConfigId;
      if (!analystId) return null;

      // Look the fired rung up in the RESOLVED ladder, not the stored
      // column. An inherited rung (analyst / account) is
      // not in `thesis.triggers` at all, so a raw-column lookup returns
      // null and this run bails — the fire event would be consumed and
      // silently do nothing. That is precisely the decorative-rung
      // failure the cascade exists to prevent, and it would disable an
      // inherited trail stop without a single error in the logs.
      const ladder = resolveThesisLadder(
        thesis,
        (await loadLevelSources([analystId])).get(analystId),
        `thesis=${thesis.id}`,
      );
      const trigger = findTriggerById(ladder, fired.triggerId);
      if (!trigger) return null;

      const [agentConfig, position] = await Promise.all([
        prisma.agentConfig.findUnique({
          where: { id: analystId },
          select: {
            id: true,
            userId: true,
            accountId: true,
            name: true,
            analystPrompt: true,
            directionBias: true,
            holdDurations: true,
            setupIds: true,
            sectors: true,
            minConfidence: true,
            minPositionSize: true,
            maxPositionSize: true,
            maxOpenPositions: true,
            exclusionList: true,
            tradingEnvironment: true,
            maxPositionTotal: true,
            enabled: true,
          },
        }),
        prisma.position.findFirst({
          where: {
            analystId: fired.analystId,
            symbol: thesis.ticker,
            status: "OPEN",
          },
          select: {
            id: true,
            quantity: true,
            avgCost: true,
            // The five-minute pass's watermark (high for LONG, low for
            // SHORT). Handed to the tactical prompt as the AUTHORITATIVE
            // reference for trail validation — DAV-186: the HPE
            // agent re-derived a "peak" from a short chart window and
            // declined a genuine trail fire.
            peakPrice: true,
          },
        }),
      ]);
      if (!agentConfig) return null;

      // How full the analyst is, for a buy fire (DAV-292). ETN 2026-09-18:
      // the run confirmed the buy by its setup, called place_trade and only
      // then learned the analyst held 4 of 4. Counted the way place_trade
      // counts. Fail-soft: no line is better than no run.
      const capacity = await (async () => {
        if (trigger.action !== "ENTER" && trigger.action !== "ADD") return null;
        if (agentConfig.maxOpenPositions == null) return null;
        // Only a fire that would OPEN a position is capped. Adding to a
        // stock we already own takes no new slot, so a full analyst must
        // still be able to press a winner or buy a pullback in a name it
        // holds — the rules the seats were just given (DAV-279).
        if (position) return null;
        try {
          const rows = await prisma.position.findMany({
            where: { analystId: fired.analystId, status: { in: ["OPEN", "PENDING_APPROVAL"] } },
            select: { symbol: true },
          });
          return { open: rows.length, max: agentConfig.maxOpenPositions, held: rows.map((r) => r.symbol) };
        } catch {
          return null;
        }
      })();

      return {
        // What this run's own lines use; the stock itself is read below
        // through get_theses, the same row every door reads.
        thesis: {
          id: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          horizon: thesis.horizon,
          setupId: thesis.setupId ?? null,
          // The event date, for the buying-window line (DAV-338). ISO here:
          // the step boundary would turn a Date into a string anyway.
          catalystDate: thesis.catalystDate ? thesis.catalystDate.toISOString() : null,
        },
        // Each trigger that fired with this one on the same pass, with the
        // reason it was set (its own audit row says both fired).
        coFired: (fired.coFired ?? []).map((co) => ({ ...co, rationale: findTriggerById(ladder, co.triggerId)?.rationale ?? null })),
        trigger,
        agentConfig,
        capacity,
        position: position
          ? {
              id: position.id,
              quantity: Number(position.quantity),
              avgCost: Number(position.avgCost),
              peakPrice:
                position.peakPrice != null ? Number(position.peakPrice) : null,
            }
          : null,
      };
    });

    if (!ctx) {
      return { skipped: "context-not-loadable", thesisId: fired.thesisId };
    }
    const { thesis, trigger, agentConfig, position, coFired } = ctx;

    // A paused analyst runs nothing. A stock it still holds keeps its sales
    // (the five-minute check reads nothing else for it); each goes to the
    // owner below, never to the agent. Anything else is dropped here.
    const paused = agentConfig.enabled === false;
    if (paused && !(trigger.action === "EXIT" && position)) {
      return { skipped: "analyst-paused", thesisId: fired.thesisId, triggerId: trigger.id };
    }

    // ── Suppress redundant close runs while an exit is already queued ────────
    // EXIT/TRIM triggers carry cooldownDays:0 ("fire every tick") because the
    // original design closed the position immediately, dropping it from the
    // evaluator's ACTIVE-only scan before the next 5-min tick ever arrived.
    // Trade-as-proposal broke that assumption: the close now sits in
    // AWAITING_APPROVAL while the human decides, so the position stays OPEN and
    // the stop re-fires every tick — each fire a full GPT-5.5 tactical run
    // (NVDA 12x / IREN 8x / NVTS 5x on 2026-06-04, ~25 runs / ~$25 in an hour).
    //
    // If a close for this position is already awaiting approval — or was
    // rejected within the snooze window (the human explicitly chose to hold) —
    // a fresh tactical run has nothing to do. Bail BEFORE create-run and the
    // agent call so zero GPT-5.5 cost is incurred. Only matters when approval
    // toggles are ON; with auto-execute the position closes on the first fire
    // and never reaches a second tick, so this is a no-op there.
    if ((trigger.action === "EXIT" || trigger.action === "TRIM") && position) {
      const queuedClose = await step.run("check-queued-close", async () =>
        prisma.order.findFirst({
          where: {
            positionId: position.id,
            intent: { in: ["CLOSE", "PARTIAL_CLOSE"] },
            OR: [
              // A sale proposed and not expired, or sent to Alpaca (PENDING) and
              // awaiting fill. The five-minute check already skips these unstamped; this is the backstop.
              ...saleUnderWay(new Date()),
              {
                status: "REJECTED",
                updatedAt: {
                  gte: new Date(Date.now() - EXIT_RECHECK_SNOOZE_MS),
                },
              },
            ],
          },
          select: { id: true, status: true },
        }),
      );
      if (queuedClose) {
        // A protective trigger's whole job is to have a sell proposal open on
        // this position. Proposal open = job done = SILENT: no run, no
        // activity row, no DB write. The pending proposal is the record that
        // the condition is true — re-announcing it every 5-minute tick buried
        // the EME/MU activity feeds under hundreds of identical rows
        // (2026-08-26).
        //
        // Visibility is guaranteed by the proposal lifecycle, not by logging:
        // an unactioned proposal expires after 24h, and the next tick lands
        // here with NO queued close and raises a fresh one — the daily nag
        // the standing-order ruling requires, until the human sells or edits
        // the level. (The 8/20→8/24 silent-breach failure was the re-propose
        // path not doing that; it does now.)
        return {
          skipped: "close-already-queued",
          reason: queuedClose.status,
          thesisId: fired.thesisId,
          positionId: position.id,
          orderId: queuedClose.id,
        };
      }
    }

    // A buy (or an add) already waiting for approval on this stock: the fire has nothing to add.
    // MU 2026-10-15: the 11:01 run found the chat's 10:59 buy waiting and still moved its level.
    if (trigger.action === "ENTER" || trigger.action === "ADD") {
      const queuedBuy = await step.run("check-queued-buy", async () =>
        prisma.order.findFirst({
          where: { status: "AWAITING_APPROVAL", intent: { in: ["OPEN", "ADD"] }, position: { analystId: fired.analystId, symbol: thesis.ticker } },
          select: { id: true },
        }),
      );
      if (queuedBuy) return { skipped: "buy-already-queued", thesisId: fired.thesisId, orderId: queuedBuy.id };
    }

    // ── Suppress duplicate buy-checks on the same trigger (GAPS P1-37) ──────
    // When a stock crosses its buy price and the analyst examines it and
    // decides NOT to buy, the trigger stays armed — and every subsequent fire
    // (5-min evaluator tick, a second overlapping trigger)
    // wakes ANOTHER full GPT-5.5 session that re-reads the same thesis and
    // reaches the same "no" (CAPR ~5×, CEG 4× over 2026-07-20→21 — ~9 wasted
    // runs in two days, every one blocked by the same below-bar conviction
    // score). If a tactical run for THIS SAME trigger already completed
    // within the snooze window, bail before create-run — zero cost.
    //
    // This does NOT touch the standing-order ruling ("a trigger fires every
    // day its condition is true — never engineer repeats away"). That ruling
    // protects ALERTS the principal sees. A declined buy-check produced no
    // proposal and nothing on the principal's screen — this suppresses only
    // the duplicate MACHINE dispatch. The trigger keeps firing and recording,
    // the daily run still sees it as fired work the next morning, and a run
    // that decides TO buy still produces the approval card. A FAILED prior
    // run does not snooze (a crash deserves a retry); post-#525 an agent that
    // declines durably is taught to move the trigger to the level it would
    // actually accept, which ends the refires at the source — this snooze
    // catches the same-day multi-path duplicates in the meantime.
    if (trigger.action === "ENTER") {
      const recentEnterCheck = await step.run("check-recent-enter-run", async () =>
        prisma.researchRun.findFirst({
          where: {
            agentConfigId: agentConfig.id,
            mode: "INTRADAY_TACTICAL",
            status: "COMPLETE",
            createdAt: { gte: new Date(Date.now() - EXIT_RECHECK_SNOOZE_MS) },
            parameters: { path: ["triggerId"], equals: trigger.id },
          },
          select: { id: true, createdAt: true },
        }),
      );
      // A buy the last run passed on because the price had slipped back
      // under its level was left armed (DAV-343); its re-fire is checked.
      if (recentEnterCheck && enterAlreadyChecked(recentEnterCheck, trigger)) {
        return {
          skipped: "enter-already-checked",
          thesisId: fired.thesisId,
          triggerId: trigger.id,
          priorRunId: recentEnterCheck.id,
          priorRunAt: recentEnterCheck.createdAt,
        };
      }
    }

    // Snapshot the analyst's env onto the run.
    const runEnvironment =
      (agentConfig.tradingEnvironment as "PAPER" | "LIVE") ?? "PAPER";

    // ── Create ResearchRun row ────────────────────────────────────────
    const run = await step.run("create-run", async () => {
      return prisma.researchRun.create({
        data: {
          userId: agentConfig.userId,
          accountId: agentConfig.accountId,
          agentConfigId: agentConfig.id,
          source: "AGENT",
          status: "RUNNING",
          mode: "INTRADAY_TACTICAL",
          environment: runEnvironment,
          parameters: {
            triggeredBy: "trigger-fired",
            thesisId: thesis.id,
            triggerId: trigger.id,
            ticker: thesis.ticker,
            action: trigger.action,
            agentMode: true,
            analystName: agentConfig.name,
          } as object,
        },
        select: { id: true, createdAt: true },
      });
    });

    // ── Write TRIGGER_FIRED audit row ─────────────────────────────────
    // Marks the moment the predicate matched, regardless of what the
    // agent decides next. The agent's update_thesis at the end writes
    // a separate UPDATED/REVIEWED row for the response. Two rows per
    // tactical fire — one for "predicate matched," one for "agent
    // responded." Without this, RunInput.triggersFiredSinceLastRun
    // returns empty even when triggers genuinely fired.
    await step.run("write-trigger-fired", async () => {
      // Persist a human-readable sentence — same format the sheet's
      // banner renders. Old SCREAMING_SNAKE_CASE summaries were
      // unreadable ("REVIEW trigger matched: price-below (price/time)").
      const summary = sentenceOf(trigger as Trigger);
      // A co-fired protective trigger gets its own audit row — the record
      // says both fired — but shares this one run.
      for (const co of coFired) {
        await prisma.thesisUpdate.create({
          data: {
            thesisId: thesis.id,
            type: "TRIGGER_FIRED",
            summary: `${co.sentence} — folded into the same run`,
            rationale: co.rationale ?? co.sentence,
            triggerId: co.triggerId,
            signalIds: [],
            runId: run.id,
            priceAtTime: fired.firedPrice ?? null,
          },
        });
      }
      await prisma.thesisUpdate.create({
        data: {
          thesisId: thesis.id,
          type: "TRIGGER_FIRED",
          summary,
          // Same reasoning as the evaluator's deferred-REVIEW row: an
          // earnings fire carries its figures so the record says what
          // happened, not just that something did.
          rationale: fired.firedContext
            ? `${trigger.rationale} ${fired.firedContext}`
            : trigger.rationale,
          triggerId: trigger.id,
          signalIds: [],
          runId: run.id,
          // The quote that fired the predicate — rides in on the event so
          // the Activity tab's price stamps aren't cron-fires-only.
          priceAtTime: fired.firedPrice ?? null,
        },
      });
    });

    // The analyst's limits and keys, as every tool reads them: the same for the agent's run and an Auto trade.
    const toolsFor = async (extra: { protectiveExitReason?: "STOP" | "TARGET"; protectiveExitTriggerLabel?: string; firedTrim?: { ticker: string; pct: number }; payFromCash?: number | null } = {}) =>
      createResearchTools({
        runId: run.id,
        userId: agentConfig.userId,
        accountId: agentConfig.accountId,
        analystId: agentConfig.id,
        runMode: "INTRADAY_TACTICAL",
        ...extra,
        watchlist: await getWatchlistSymbols(agentConfig.id),
        exclusionList: agentConfig.exclusionList ?? [],
        sectors: agentConfig.sectors ?? [],
        minPositionSize: Number(agentConfig.minPositionSize),
        maxPositionSize: Number(agentConfig.maxPositionSize),
        maxPositionTotal: Number(agentConfig.maxPositionTotal),
        maxOpenPositions: agentConfig.maxOpenPositions,
        minConfidence: agentConfig.minConfidence,
        alpacaCreds: (await resolveAlpacaCredentials(agentConfig.userId, runEnvironment)) ?? undefined,
        runEnvironment,
      });

    // ── On fire "Auto": the trade with no agent ──────────────────────
    // Still through maybeAwaitApproval: with the account's approval switch on
    // it PROPOSES the trade; off, it executes. Nothing to sell, or a stock
    // already held for a buy, falls through to the agent.
    const doIt = doItTrade(trigger as Trigger, position != null);
    // A paused analyst's sale takes this path whatever On fire says. Auto goes
    // through the approval switch as always; a sale that asked for the agent
    // or the morning run asked for judgment, so it always waits for the owner.
    const ownerSale = paused && trigger.action === "EXIT";
    if ((doIt === "SELL" || ownerSale) && position) {
      const direct = await step.run("direct-close", async () => {
        const { closeOpenPosition } = await import(
          "@/lib/actions/closeTrade.actions"
        );
        const reason = directExitReason(trigger as Trigger, thesis.direction);
        // DAV-194: on a held-through name, the daily card must be worth
        // reading — which ask this is, the principal's own reject note, the
        // recent low with a suggested place for the line. The agent path
        // gets this via get_theses.heldThroughFloor + the prompt; this
        // no-agent path appends the same context to the rationale so the
        // card is never verbatim-identical day over day. Best-effort: a
        // context failure returns null and never blocks the close.
        const { heldThroughNoteForPosition } = await import(
          "@/lib/proposals/held-through-context"
        );
        const heldThroughNote = await heldThroughNoteForPosition({
          positionId: position.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
        });
        const rationale = [heldThroughNote, paused ? PAUSED_SALE_NOTE : null]
          .filter(Boolean)
          .join(" ");
        try {
          const outcome = await closeOpenPosition(
            position.id,
            reason,
            undefined, // creds resolved inside from the position's environment
            "price_monitor", // the stored name for an automatic trigger sale; approval-gated
            `Your "${sentenceOf(trigger as Trigger)}" came true. It's set to Auto-sell, so this came straight to you with no analyst review.${rationale ? ` ${rationale}` : ""}`,
            run.id,
            undefined,
            { propose: ownerSale && doIt !== "SELL" },
          );
          return { kind: outcome.kind, reason };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[tactical-run] direct close failed thesis=${thesis.id} trigger=${trigger.id}: ${msg}`,
          );
          return { error: msg };
        }
      });

      await step.run("finalize-direct", async () => {
        const failed = direct != null && "error" in direct;
        await prisma.researchRun.update({
          where: { id: run.id },
          data: {
            status: failed ? "FAILED" : "COMPLETE",
            completedAt: new Date(),
          },
        });
        if (failed) {
          await prisma.runEvent.create({
            data: {
              runId: run.id,
              type: "run_failed",
              title: "Auto-sell failed",
              message: `The Auto-sell of ${thesis.ticker} failed: ${(direct as { error: string }).error}`,
              payload: { thesisId: thesis.id, triggerId: trigger.id } as object,
            },
          });
        }
      });

      return {
        runId: run.id,
        thesisId: thesis.id,
        triggerId: trigger.id,
        ticker: thesis.ticker,
        action: trigger.action,
        fireMode: "DO_IT" as const,
        direct,
      };
    }

    // An Auto-trim of its %, an Auto-buy or an Auto-add: the tool the agent would have called, with the
    // trigger's own arguments. The tool sizes and gates it; a buy is paid from cash, as the Trade button's is.
    // A one-time order: once tried (proposed, sent or refused) the trigger comes off the stock.
    if (doIt === "TRIM" || doIt === "BUY" || doIt === "ADD") {
      const done = await step.run("do-it", async () => {
        try {
          const buys = doIt !== "TRIM";
          const payFromCash = buys ? await (await import("@/lib/trading/manual-order")).accountCash(agentConfig.userId, runEnvironment) : undefined;
          const tools = await toolsFor(buys ? { payFromCash } : {});
          // The buy fired on a live price (a buy never fires on a stale one); without one, read it now.
          const price =
            doIt === "BUY"
              ? (fired.firedPrice ?? freshQuotePrice((await getLiveQuote(thesis.ticker, { caller: "other" })).quote, new Date()))
              : 0;
          let tried: { tool: string; summary: string | null };
          if (price == null) {
            const args = { ticker: thesis.ticker, thesis_id: thesis.id };
            const summary = `Trade blocked: $${thesis.ticker} — no live price`;
            const detail = `There's no live price for ${thesis.ticker}, so the buy wasn't placed.`;
            await recordGateRejection({ tool: "place_trade", gateCode: "no_price", summary, detail, args, ctx: { runId: run.id, userId: agentConfig.userId, accountId: agentConfig.accountId, analystId: agentConfig.id, runMode: "INTRADAY_TACTICAL", groupId: (p: string) => p } });
            tried = { tool: "place_trade", summary };
          } else {
            const call = doItCall({ trade: doIt, trigger: trigger as Trigger, thesis, price });
            const tool = tools[call.tool] as unknown as { execute: (a: unknown, o: unknown) => Promise<{ ok: boolean; summary?: string; error?: string }> };
            const out = await tool.execute(call.args, { toolCallId: `do-it-${trigger.id}`, messages: [] });
            // The tool crashed: nothing was tried, so the trigger stays for its next fire.
            if (!out.ok) return { tool: call.tool, error: out.error ?? "the trade tool failed" };
            tried = { tool: call.tool, summary: out.summary ?? null };
          }
          const usedOnce = await useOnce({ thesisId: thesis.id, triggerId: trigger.id, runId: run.id, priceAtTime: fired.firedPrice ?? null }).catch((err) => {
            console.error(`[tactical-run] could not take used-once trigger ${trigger.id} off ${thesis.ticker}:`, err instanceof Error ? err.message : err);
            return false;
          });
          return { ...tried, usedOnce };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[tactical-run] do-it ${doIt} failed thesis=${thesis.id} trigger=${trigger.id}: ${msg}`);
          return { error: msg };
        }
      });

      await step.run("finalize-do-it", async () => {
        const error = "error" in done ? done.error : null;
        const fresh = error ? await prisma.researchRun.findUnique({ where: { id: run.id }, select: { parameters: true } }) : null;
        await prisma.researchRun.update({
          where: { id: run.id },
          data: {
            status: error ? "FAILED" : "COMPLETE",
            completedAt: new Date(),
            ...(error ? { parameters: { ...((fresh?.parameters as object) ?? {}), error } as object } : {}),
          },
        });
      });

      return { runId: run.id, thesisId: thesis.id, triggerId: trigger.id, ticker: thesis.ticker, action: trigger.action, fireMode: "DO_IT" as const, doIt, done };
    }

    // ── Run the agent ─────────────────────────────────────────────────
    const outcome = await step.run("agent-run", async () => {
      const t0 = Date.now();
      // ── The sale label of a protective exit ───────────────────────────
      // This tactical run was woken BY a specific trigger. When that trigger
      // is a protective/price EXIT (trail-from-high, gain-from-entry, stop /
      // target price level, daily-% move), the close is labelled STOP or
      // TARGET from the fired predicate, not by the model: a declined STOP is a declined sale the next run must answer, and a TARGET sale sends the stock back to watching.
      // close_position uses it in place of the model-chosen reason.
      // Non-protective EXIT triggers (earnings, filings, etc.) leave this
      // undefined, so the agent's own label stands.
      const protectiveExitReason =
        (trigger as Trigger).action === "EXIT"
          ? protectiveExitCloseReason(
              (trigger as Trigger).predicate,
              thesis.direction,
            ) ?? undefined
          : undefined;
      // Human phrase for the fired trigger ("Trailing 8% from high"),
      // threaded alongside the tag so the close tools can name WHY the label
      // was corrected in the audit note they write (DAV-192).
      const protectiveExitTriggerLabel = protectiveExitReason
        ? conditionSentence((trigger as Trigger).predicate)
        : undefined;
      // A trim that woke the run sells its own size unless the run names another.
      const firedTrim = trigger.action === "TRIM" ? { ticker: thesis.ticker, pct: trimPctOf(trigger as Trigger) } : undefined;
      const allTools = await toolsFor({ protectiveExitReason, protectiveExitTriggerLabel, firedTrim });

      const allowlist = MODES["tactical"].toolAllowlist;
      const tools = allowlist
        ? Object.fromEntries(
            allowlist
              .map(
                (name) => [name, allTools[name as keyof typeof allTools]] as const,
              )
              .filter(([, v]) => v != null),
          )
        : allTools;

      // The stock, read the way every door reads it (step 10): get_theses on
      // this ticker, after the fire's own line is written, so the fire and
      // anything else true on the stock are its situations. The model reads
      // the full row (lib/agent/row-for-model.ts). Fail-soft: a run that
      // cannot read the row decides on the fire.
      const read = await (async () => {
        try {
          const out = (await allTools.get_theses.execute!({ tickers: [thesis.ticker] } as never, { toolCallId: "read-the-stock", messages: [] })) as { ok?: boolean; data?: unknown };
          return stockFromRead(out, thesis.id);
        } catch (err) {
          console.warn(`[tactical-run] the read of ${thesis.ticker} failed:`, err);
          return null;
        }
      })();

      const setupOverrides = await loadSetupOverrides(agentConfig.accountId);
      const systemPrompt = buildTacticalSystemPrompt({
        analyst: { ...agentConfig, setupOverrides },
        stock: { ticker: thesis.ticker, direction: thesis.direction, row: read?.row ?? null },
        trigger,
        position,
        fired: { price: fired.firedPrice ?? null },
        capacity: ctx.capacity ?? null,
        situations: read?.situations ?? null,
      });

      // Build the kickoff message so the chat replay shows WHY this run
      // fired without the user having to dig. Same English sentence the
      // audit row stores so the chat reads naturally.
      // Casts mirror the existing pattern in this file — ctx is loaded
      // via step.run which Inngest types as unknown.
      const triggerTyped = trigger as Trigger;
      const fireSentence = sentenceOf(triggerTyped);
      // The numbers behind an earnings fire, when the evaluator sent them.
      const contextSuffix = fired.firedContext ? ` ${fired.firedContext}` : "";
      const coFiredSuffix = fired.coFired?.length
        ? ` Also fired on the same pass: ${fired.coFired.map((c) => c.sentence).join("; ")} — one decision covers both.`
        : "";
      // A pre-catalyst buy is told where the event date sits against the
      // setup's buying window (DAV-338). Information for the decision,
      // never a gate; the proposal carries the same line.
      const windowLine = triggerTyped.action === "ENTER" ? preCatalystWindowLine(thesis) : null;
      const windowSuffix = windowLine ? ` ${windowLine}` : "";
      // A refused call on this stock from a recent run that was never redone
      // rides the kickoff, so the wake that fires today also settles it.
      const openOnStock = refusalLinesFor(
        await listOpenRefusalsForAnalyst(agentConfig.id, 7),
        thesis.id,
        (thesis as { ticker: string }).ticker,
      );
      // The stock's research brief from the last day, when one is on file (lib/research/brief.ts).
      const brief = (await latestBriefs([(thesis as { ticker: string }).ticker], 24 * 60 * 60 * 1000)).values().next().value;
      const briefLine = brief ? briefKickoffLine(brief) : null;
      const briefSuffix = briefLine ? ` ${briefLine}` : "";
      const userPrompt =
        `Tactical run on $${(thesis as { ticker: string }).ticker}. ${fireSentence}.${contextSuffix}${windowSuffix}${coFiredSuffix}${openOnStock}${briefSuffix} ` +
        `Find out what is going on with the company and the stock, decide, act if warranted, then write your review with update_thesis. ` +
        `You are running unattended — no human will respond. Every turn must call a tool; ` +
        `text-only turns terminate the run as FAILED.`;
      // What this run read and wrote, every request counted, recorded on
      // the run row at the end (also on the failure path below).
      const tokenUsage = emptyTokenUsage();
      // Pins the run's requests to one cache route, as the morning run
      // does. The tool definitions are byte-identical from step to step
      // since 2026-10-02 (triggers/schema.ts, triggerInputSchema), so the
      // growing conversation is read from the cache rather than re-billed.
      const openaiOptions = { strictJsonSchema: true, promptCacheKey: run.id };
      try {
        const { steps, response } = await generateText({
          model: openai(MODES["tactical"].model),
          system: systemPrompt,
          prompt: userPrompt,
          tools,
          providerOptions: { openai: openaiOptions },
          // The same refused call three times ends the loop (repeat-refusal.ts).
          stopWhen: [stepCountIs(MODES["tactical"].maxSteps), repeatRefusalGuard.stopWhen],
          prepareStep: repeatRefusalGuard.prepareStep,
          abortSignal: AbortSignal.timeout(
            (MODES["tactical"].maxDuration - 30) * 1000,
          ),
          onStepFinish({ usage }) {
            addTokenUsage(tokenUsage, usage);
          },
        });

        let toolCalls = steps.reduce(
          (sum, s) => sum + (s.toolCalls?.length ?? 0),
          0,
        );
        let elapsed = Date.now() - t0;
        console.log(
          `[tactical-run] thesis=${thesis.id} trigger=${trigger.id} ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms`,
        );

        // Every step whose messages are saved, for the thread's tool results.
        const threadSteps: RunStep[] = [...steps];
        // Stopped for sending a refused call a third time: the run closes
        // with what it has, FAILED with that reason, and no retry asks again.
        const stopped = repeatRefusalStop(steps);

        // ── Compute responseMessages with step-flatten fallback ────────────
        // AI SDK v6 sometimes returns response.messages empty on a text-only
        // tail (the same shape morning-research's prematureExitViolation
        // path saw on 2026-05-07). The persistence block + the retry below
        // both need a usable conversation, so resolve once up here.
        let responseMessages = response?.messages;
        if (
          !responseMessages ||
          !Array.isArray(responseMessages) ||
          responseMessages.length === 0
        ) {
          responseMessages = steps.flatMap((s) => {
            const stepMsgs = (
              s as unknown as { response?: { messages?: unknown[] } }
            ).response?.messages;
            return Array.isArray(stepMsgs) ? stepMsgs : [];
          }) as typeof responseMessages;
        }

        // ── Closeout retry ─────────────────────────────────────────────────
        // Mirrors morning-research's prematureExitViolation gate. Tactical
        // runs require update_thesis as the closeout contract. If the agent
        // skipped it (typically because the assistant turn ended with text
        // like "Now I'll decide..." and AI SDK terminated the loop), give
        // the model one focused chance to write the closeout row before
        // marking the run FAILED. 2026-05-07 captured 1 of 18 tactical
        // runs (Earnings Drift Trader) hitting this exact contract miss.
        const initialUpdate = await prisma.thesisUpdate.findFirst({
          where: {
            runId: run.id,
            thesisId: thesis.id,
            type: { not: "TRIGGER_FIRED" },
          },
          select: { id: true },
        });
        let closedOut = initialUpdate !== null;
        if (
          !closedOut &&
          !stopped &&
          responseMessages &&
          responseMessages.length > 0
        ) {
          console.warn(
            `[tactical-run] thesis=${thesis.id} trigger=${trigger.id} did not close out (${steps.length} steps, ${toolCalls} tool calls) — attempting retry`,
          );
          try {
            const retryResp = await generateText({
              model: openai(MODES["tactical"].model),
              system: systemPrompt,
              messages: [
                {
                  role: "user",
                  content: [{ type: "text", text: userPrompt }],
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(responseMessages as any[]),
                {
                  role: "user",
                  content:
                    `You did not close out via update_thesis. The tactical contract requires exactly one update_thesis(thesis_id="${thesis.id}", triggerId="${trigger.id}", rationale="<one line>") call before complete_run. ` +
                    `Call update_thesis NOW with whatever rationale matches what you decided (or "Trigger fired but no action taken — <reason>" if validation failed). Then complete_run. ` +
                    `TOOL CALLS only — no narration, no markdown, no transition prose.`,
                },
              ],
              tools,
              providerOptions: { openai: openaiOptions },
              stopWhen: stepCountIs(5),
              abortSignal: AbortSignal.timeout(60_000),
            });
            addTokenUsage(tokenUsage, retryResp.totalUsage, retryResp.steps.length);
            const retrySteps = retryResp.steps.length;
            const retryToolCalls = retryResp.steps.reduce(
              (s, x) => s + (x.toolCalls?.length ?? 0),
              0,
            );
            console.log(
              `[tactical-run] thesis=${thesis.id} retry: ${retrySteps} steps, ${retryToolCalls} tool calls`,
            );
            toolCalls += retryToolCalls;
            elapsed = Date.now() - t0;

            // Append retry messages so the persisted thread shows the
            // full recovery sequence on /runs/[id].
            let retryMessages = retryResp.response?.messages;
            if (
              !retryMessages ||
              !Array.isArray(retryMessages) ||
              retryMessages.length === 0
            ) {
              retryMessages = retryResp.steps.flatMap((s) => {
                const stepMsgs = (
                  s as unknown as { response?: { messages?: unknown[] } }
                ).response?.messages;
                return Array.isArray(stepMsgs) ? stepMsgs : [];
              }) as typeof retryMessages;
            }
            if (retryMessages && retryMessages.length > 0) {
              threadSteps.push(...retryResp.steps);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              responseMessages = [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(responseMessages as any[]),
                {
                  role: "user",
                  content:
                    "(retry nudge: you did not close out via update_thesis — call it now)",
                },
                ...retryMessages,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ] as any[];
            }

            const retryUpdate = await prisma.thesisUpdate.findFirst({
              where: {
                runId: run.id,
                thesisId: thesis.id,
                type: { not: "TRIGGER_FIRED" },
              },
              select: { id: true },
            });
            closedOut = retryUpdate !== null;
          } catch (retryErr) {
            console.error(
              `[tactical-run] retry failed for thesis=${thesis.id}:`,
              retryErr instanceof Error ? retryErr.message : retryErr,
            );
          }
        }

        // ── Refusal retry (2026-09-25) ─────────────────────────────────────
        // PLTR, 09-25 09:40: place_trade refused the buy, the agent closed
        // out and the run ended COMPLETE — the buy vanished. A refused call
        // the run never redid goes back to the model once, with its reason.
        // What is still open afterwards is written on the run and carried
        // to the next run on this stock.
        const openRefusals = await listOpenRefusalsForRun(run.id);
        if (!stopped && openRefusals.length > 0 && responseMessages && responseMessages.length > 0) {
          console.warn(
            `[tactical-run] thesis=${thesis.id} ${openRefusals.length} refused call(s) never redone — attempting refusal retry`,
          );
          try {
            const refusalResp = await generateText({
              model: openai(MODES["tactical"].model),
              system: systemPrompt,
              messages: [
                { role: "user", content: [{ type: "text", text: userPrompt }] },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(responseMessages as any[]),
                { role: "user", content: refusalNudge(openRefusals) },
              ],
              tools,
              providerOptions: { openai: openaiOptions },
              stopWhen: stepCountIs(5),
              abortSignal: AbortSignal.timeout(60_000),
            });
            addTokenUsage(tokenUsage, refusalResp.totalUsage, refusalResp.steps.length);
            const refusalToolCalls = refusalResp.steps.reduce((s, x) => s + (x.toolCalls?.length ?? 0), 0);
            toolCalls += refusalToolCalls;
            elapsed = Date.now() - t0;
            let refusalMessages = refusalResp.response?.messages;
            if (!refusalMessages || !Array.isArray(refusalMessages) || refusalMessages.length === 0) {
              refusalMessages = refusalResp.steps.flatMap((s) => {
                const stepMsgs = (s as unknown as { response?: { messages?: unknown[] } }).response?.messages;
                return Array.isArray(stepMsgs) ? stepMsgs : [];
              }) as typeof refusalMessages;
            }
            if (refusalMessages && refusalMessages.length > 0) {
              threadSteps.push(...refusalResp.steps);
              responseMessages = [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(responseMessages as any[]),
                { role: "user", content: `(refusal retry: ${openRefusals.length} refused call(s) were never redone)` },
                ...refusalMessages,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ] as any[];
            }
            console.log(`[tactical-run] thesis=${thesis.id} refusal retry: ${refusalToolCalls} tool calls`);
          } catch (refusalErr) {
            console.error(
              `[tactical-run] refusal retry failed for thesis=${thesis.id}:`,
              refusalErr instanceof Error ? refusalErr.message : refusalErr,
            );
          }
        }
        await recordOpenRefusalsEvent(run.id, await listOpenRefusalsForRun(run.id));

        // ── Persist conversation messages ──────────────────────────────────
        // /runs/[id] replays from this row (run-thread.ts). Includes any
        // retry sequence so the user sees the full recovery, not just the
        // original tail.
        await saveRunThread(
          run.id,
          { opening: [{ role: "user", content: [{ type: "text", text: userPrompt }] }], messages: responseMessages, steps: threadSteps },
          "tactical-run",
        );

        await recordTokenUsage(run.id, tokenUsage, MODES["tactical"].model);
        await prisma.researchRun.update({
          where: { id: run.id },
          data: {
            status: closedOut && !stopped ? "COMPLETE" : "FAILED",
            completedAt: new Date(),
          },
        });

        if (!closedOut || stopped) {
          await prisma.runEvent.create({
            data: {
              runId: run.id,
              type: "run_failed",
              title: stopped ? "Tactical run stopped: the same refused call three times" : "Tactical run did not close out",
              message:
                stopped ??
                "Tactical contract: update_thesis MUST be called once. Agent finished without writing a ThesisUpdate row for this thesis.",
              payload: {
                thesisId: thesis.id,
                triggerId: trigger.id,
                steps: steps.length,
                toolCalls,
              } as object,
            },
          });
        }

        return {
          steps: steps.length,
          toolCalls,
          elapsed,
          closedOut,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        console.error(
          `[tactical-run] thesis=${thesis.id} trigger=${trigger.id} agent error: ${msg}`,
        );
        // Persist the error text into ResearchRun.parameters so SQL queries
        // can surface it without needing the Inngest dashboard. Mirrors the
        // pattern in morning-research.ts. Best-effort — wrapped in try so a
        // parameters-merge failure doesn't mask the original error.
        try {
          await recordTokenUsage(run.id, tokenUsage, MODES["tactical"].model);
          const fresh = await prisma.researchRun.findUnique({
            where: { id: run.id },
            select: { parameters: true },
          });
          await prisma.researchRun.update({
            where: { id: run.id },
            data: {
              status: "FAILED",
              completedAt: new Date(),
              parameters: {
                ...((fresh?.parameters as object) ?? {}),
                error: msg,
                failedAt: new Date().toISOString(),
              } as object,
            },
          });
        } catch {
          await prisma.researchRun.update({
            where: { id: run.id },
            data: { status: "FAILED", completedAt: new Date() },
          });
        }
        return { error: msg, closedOut: false };
      }
    });

    // ── A pass on a wobble doesn't spend the buy (DAV-343) ─────────────
    // AAPL 09-30: fired at $331.47, the run read $330.83 and passed, and the
    // buy was used up for the day. When the pass was because the price was
    // back under the level, the next check past it fires the buy again.
    const rearm =
      trigger.action === "ENTER" && outcome.closedOut
        ? await step.run("rearm-buy-after-pass", async () => {
            try {
              return await rearmBuyAfterPass({
                runId: run.id,
                runStartedAt: new Date(run.createdAt),
                thesisId: thesis.id,
                trigger,
              });
            } catch (err) {
              console.error(
                `[tactical-run] thesis=${thesis.id} re-arm check failed:`,
                err instanceof Error ? err.message : err,
              );
              return null;
            }
          })
        : null;

    return {
      runId: run.id,
      thesisId: thesis.id,
      triggerId: trigger.id,
      ticker: thesis.ticker,
      action: trigger.action,
      ...outcome,
      ...(rearm ? { rearm } : {}),
    };
  },
);
