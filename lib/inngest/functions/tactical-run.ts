// ── Tactical Run ──────────────────────────────────────────────────────────
// Consumes `app/thesis.trigger.fired` events emitted by trigger-evaluator.
// One event = one (thesis, trigger, signal?) tuple = one focused agent run.
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
import { prisma } from "@/lib/prisma";
import { generateText, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { createResearchTools } from "@/lib/agent/tools";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { buildTacticalSystemPrompt } from "@/lib/agent/system-prompts/intraday-tactical";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { describeTriggerFire } from "@/lib/agent/triggers/format";
import { MODES } from "@/lib/agent/modes";
import { getWatchlistSymbols } from "@/lib/agent/watchlist-symbols";
import { isDirectEligiblePredicate } from "@/lib/agent/triggers/types";
import type { Trigger } from "@/lib/agent/triggers/types";
import { classifyResearchAge } from "@/lib/agent/thesis-research/staleness";
import type { Horizon } from "@/lib/agent/horizon-policy";
import {
  getThesisBearCaseBullets,
  getThesisBullCaseBullets,
  getThesisSnapshotText,
} from "@/lib/agent/thesis-narrative";

// ── Types ───────────────────────────────────────────────────────────────

interface FiredPayload {
  thesisId: string;
  triggerId: string;
  signalId?: string;
  analystId: string;
  ticker: string;
  action: Trigger["action"];
  predicateKind: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findTriggerById(triggersJson: unknown, id: string): Trigger | null {
  const parsed = triggersArraySchema.safeParse(triggersJson);
  if (!parsed.success) return null;
  const found = parsed.data.find((t) => t.id === id);
  if (!found || typeof found.id !== "string") return null;
  return found as Trigger;
}

/**
 * Close reason for a DIRECT EXIT fire. Always STOP or TARGET (never
 * MANUAL/TIME) so the close counts as a risk-management exit — those always
 * flow through the approval gate and are exempt from the P1-28
 * unapproved-exit cooldown. Trailing + adverse-direction price stops → STOP;
 * the favorable-direction price level → TARGET.
 */
function directExitReason(
  trigger: Trigger,
  direction: string | null,
): "STOP" | "TARGET" {
  const k = trigger.predicate.kind;
  if (k === "TRAILING_STOP") return "STOP";
  const isLong = direction !== "SHORT";
  if (k === "PRICE_BELOW") return isLong ? "STOP" : "TARGET";
  if (k === "PRICE_ABOVE") return isLong ? "TARGET" : "STOP";
  return "STOP";
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

    // ── Load thesis + trigger + signal + position ─────────────────────
    // Note on step.run: Inngest JSON-serializes the return value, so Dates
    // come out as ISO strings on the other side. We pre-compute everything
    // we need in numeric / string form here.
    const ctx = await step.run("load-context", async () => {
      const thesis = await prisma.thesis.findUnique({
        where: { id: fired.thesisId },
        include: {
          researchRun: { select: { agentConfigId: true } },
          updates: {
            orderBy: { timestamp: "desc" },
            take: 5,
            select: {
              type: true,
              summary: true,
              rationale: true,
              timestamp: true,
            },
          },
        },
      });
      if (!thesis) return null;
      if (
        thesis.status !== "HOLDING" &&
        thesis.status !== "WATCHING"
      ) {
        return null;
      }
      const trigger = findTriggerById(thesis.triggers, fired.triggerId);
      if (!trigger) return null;
      const analystId = thesis.researchRun.agentConfigId;
      if (!analystId) return null;

      const [agentConfig, signal, position] = await Promise.all([
        prisma.agentConfig.findUnique({
          where: { id: analystId },
          select: {
            id: true,
            userId: true,
            accountId: true,
            name: true,
            analystPrompt: true,
            sectors: true,
            minConfidence: true,
            maxPositionSize: true,
            maxOpenPositions: true,
            exclusionList: true,
            tradingEnvironment: true,
            realMaxPosition: true,
          },
        }),
        fired.signalId
          ? prisma.signal.findUnique({
              where: { id: fired.signalId },
              select: {
                id: true,
                type: true,
                sentiment: true,
                urgency: true,
                headline: true,
                summary: true,
                sourceUrls: true,
              },
            })
          : Promise.resolve(null),
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
            openedAt: true,
          },
        }),
      ]);
      if (!agentConfig) return null;

      // Pre-compute daysHeld here so the step.run boundary doesn't hand
      // us a string and force runtime parsing.
      const daysHeld = position
        ? Math.max(
            0,
            Math.floor(
              (Date.now() - position.openedAt.getTime()) / 86_400_000,
            ),
          )
        : null;

      // Phase 1: precompute deep-research excerpt + age annotation here
      // so the step.run JSON boundary doesn't strip the Date. Helpers
      // imported below extract bullet arrays + snapshot text from the
      // JSONB section columns (the same columns get_theses reads).
      const thesisResearchAge = classifyResearchAge(
        thesis.researchUpdatedAt,
        thesis.horizon as Horizon | null,
      );
      const thesisSnapshotText = getThesisSnapshotText(thesis);
      const thesisBullBullets = getThesisBullCaseBullets(thesis);
      const thesisBearBullets = getThesisBearCaseBullets(thesis);
      return {
        thesis: {
          id: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          horizon: thesis.horizon,
          coreBelief: thesis.coreBelief,
          keyAssumptions: thesis.keyAssumptions,
          invalidationConds: thesis.invalidationConds,
          entryPrice: thesis.entryPrice != null ? Number(thesis.entryPrice) : null,
          targetPrice:
            thesis.targetPrice != null ? Number(thesis.targetPrice) : null,
          stopLoss: thesis.stopLoss != null ? Number(thesis.stopLoss) : null,
          targetSizePct:
            thesis.targetSizePct != null ? Number(thesis.targetSizePct) : null,
          scalingPlan: thesis.scalingPlan,
          snapshotText: thesisSnapshotText || null,
          bullCaseBullets: thesisBullBullets,
          bearCaseBullets: thesisBearBullets,
          researchAge: thesisResearchAge,
          updates: thesis.updates.map((u) => ({
            type: u.type,
            summary: u.summary,
            rationale: u.rationale,
            timestamp: u.timestamp.toISOString(),
          })),
        },
        trigger,
        agentConfig,
        signal,
        position: position
          ? {
              id: position.id,
              quantity: Number(position.quantity),
              avgCost: Number(position.avgCost),
              daysHeld: daysHeld ?? 0,
            }
          : null,
      };
    });

    if (!ctx) {
      return { skipped: "context-not-loadable", thesisId: fired.thesisId };
    }
    const { thesis, trigger, agentConfig, signal, position } = ctx;

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
              { status: "AWAITING_APPROVAL" },
              // A PENDING close is already submitted to Alpaca and awaiting
              // fill (or reconcile). Re-firing — especially a cooldownDays:0
              // DIRECT exit on an auto-execute book whose fill didn't land in
              // the 5s poll — would submit a SECOND market sell and over-close.
              // closeOpenPosition has no same-position pending guard, so we
              // suppress here; reconcile-orders resolves the PENDING order.
              { status: "PENDING" },
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
        return {
          skipped: "close-already-queued",
          reason: queuedClose.status,
          thesisId: fired.thesisId,
          positionId: position.id,
          orderId: queuedClose.id,
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
            signalId: signal?.id ?? null,
            ticker: thesis.ticker,
            action: trigger.action,
            predicateKind: fired.predicateKind,
            agentMode: true,
            analystName: agentConfig.name,
          } as object,
        },
        select: { id: true },
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
      // unreadable ("REVIEW trigger matched: PRICE_BELOW (price/time)").
      const baseSentence = describeTriggerFire(trigger as Trigger);
      const summary = signal
        ? `${baseSentence} (signal: "${signal.headline.slice(0, 100)}")`
        : baseSentence;
      await prisma.thesisUpdate.create({
        data: {
          thesisId: thesis.id,
          type: "TRIGGER_FIRED",
          summary,
          rationale: trigger.rationale,
          triggerId: trigger.id,
          signalIds: signal ? [signal.id] : [],
          runId: run.id,
        },
      });
    });

    // ── DIRECT fire mode: deterministic EXIT, no agent ────────────────
    // A trigger marked fireMode="DIRECT" on an EXIT has nothing for the agent
    // to decide — close the position directly via closeOpenPosition. That
    // path still runs through maybeAwaitApproval, so the approval gate is
    // unchanged (on require-approval-sells it PROPOSES the close; off, it
    // executes). DIRECT only skips the expensive GPT-5.5 tactical run — the
    // principal's cost driver (TRIGGER_FOLLOWUPS #3). Same trigger pipeline
    // as every other fire (evaluator → event → here); we just don't spawn the
    // model. Non-EXIT / unheld DIRECT can't happen (the add-path coerces those
    // to TACTICAL) but we guard anyway and fall through to the agent.
    // The predicate-kind gate is defensive: applyTriggerAdd /
    // applyTriggerFireModeChange already refuse DIRECT on a non-deterministic
    // EXIT, but a stale/agent-written trigger could still carry it. A
    // judgment-bearing exit (earnings, signal) must fall through to the agent,
    // not be auto-closed by directExitReason's STOP fallback.
    if (
      trigger.fireMode === "DIRECT" &&
      trigger.action === "EXIT" &&
      isDirectEligiblePredicate(trigger.predicate.kind) &&
      position
    ) {
      const direct = await step.run("direct-close", async () => {
        const { closeOpenPosition } = await import(
          "@/lib/actions/closeTrade.actions"
        );
        const reason = directExitReason(trigger as Trigger, thesis.direction);
        try {
          const outcome = await closeOpenPosition(
            position.id,
            reason,
            undefined, // creds resolved inside from the position's environment
            "price_monitor", // autonomous → approval-gated; risk-exit carve-out applies
            trigger.rationale,
            run.id,
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
              title: "Direct exit failed",
              message: `Direct close for ${thesis.ticker} failed: ${(direct as { error: string }).error}`,
              payload: { thesisId: thesis.id, triggerId: trigger.id } as object,
            },
          });
        }
      });

      return {
        runId: run.id,
        thesisId: thesis.id,
        triggerId: trigger.id,
        signalId: signal?.id ?? null,
        ticker: thesis.ticker,
        action: trigger.action,
        fireMode: "DIRECT" as const,
        direct,
      };
    }

    // ── Run the agent ─────────────────────────────────────────────────
    const outcome = await step.run("agent-run", async () => {
      const t0 = Date.now();
      const alpacaCreds =
        (await resolveAlpacaCredentials(agentConfig.userId, runEnvironment)) ??
        undefined;

      const watchlistSymbols = await getWatchlistSymbols(agentConfig.id);
      const allTools = createResearchTools({
        runId: run.id,
        userId: agentConfig.userId,
        accountId: agentConfig.accountId,
        analystId: agentConfig.id,
        runMode: "INTRADAY_TACTICAL",
        watchlist: watchlistSymbols,
        exclusionList: agentConfig.exclusionList ?? [],
        sectors: agentConfig.sectors ?? [],
        maxPositionSize: Number(agentConfig.maxPositionSize),
        realMaxPosition: Number(agentConfig.realMaxPosition),
        maxOpenPositions: agentConfig.maxOpenPositions,
        minConfidence: agentConfig.minConfidence,
        alpacaCreds,
        runEnvironment,
      });

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

      // Latest account-level portfolio digest for cross-run book context
      // (Feature A). Scoped to THIS run's book (runEnvironment) — PAPER and LIVE
      // share an accountId but have separate digests; reading the wrong book's
      // narrative is incoherent context. Non-fatal: a missing digest degrades
      // to "no continuity".
      let latestDigest: { narrative: string; date: string } | null = null;
      try {
        const digestRow = await prisma.portfolioDigest.findFirst({
          where: { accountId: agentConfig.accountId, environment: runEnvironment },
          orderBy: { date: "desc" },
          take: 1,
          select: { narrative: true, date: true },
        });
        if (digestRow?.narrative) {
          latestDigest = {
            narrative: digestRow.narrative,
            date: digestRow.date.toISOString(),
          };
        }
      } catch (digestErr) {
        console.warn(
          `[tactical-run] portfolio digest lookup failed — continuing without continuity context:`,
          digestErr instanceof Error ? digestErr.message : digestErr,
        );
      }

      const systemPrompt = buildTacticalSystemPrompt({
        analyst: { name: agentConfig.name, mandate: agentConfig.analystPrompt },
        thesis: {
          id: thesis.id,
          ticker: thesis.ticker,
          direction: thesis.direction,
          horizon: thesis.horizon,
          coreBelief: thesis.coreBelief,
          keyAssumptions: thesis.keyAssumptions,
          invalidationConds: thesis.invalidationConds,
          entryPrice: thesis.entryPrice,
          targetPrice: thesis.targetPrice,
          stopLoss: thesis.stopLoss,
          targetSizePct: thesis.targetSizePct,
          scalingPlan: thesis.scalingPlan,
          // Phase 1: pre-computed in load-context step.run; passed verbatim.
          snapshotText: thesis.snapshotText,
          bullCaseBullets: thesis.bullCaseBullets,
          bearCaseBullets: thesis.bearCaseBullets,
          researchAge: thesis.researchAge,
        },
        trigger,
        signal,
        position,
        recentUpdates: thesis.updates,
        latestDigest,
      });

      // Build the kickoff message so the chat replay shows WHY this run
      // fired without the user having to dig. Same English sentence the
      // audit row stores so the chat reads naturally.
      // Casts mirror the existing pattern in this file — ctx is loaded
      // via step.run which Inngest types as unknown.
      const triggerTyped = trigger as Trigger;
      const fireSentence = describeTriggerFire(triggerTyped);
      const signalSuffix = signal
        ? ` Signal: "${(signal as { headline: string }).headline.slice(0, 120)}"`
        : "";
      const userPrompt =
        `Tactical run on $${(thesis as { ticker: string }).ticker}. ${fireSentence}.${signalSuffix} ` +
        `Validate, decide, act if warranted, then close out via update_thesis. ` +
        `You are running unattended — no human will respond. Every turn must call a tool; ` +
        `text-only turns terminate the run as FAILED.`;
      try {
        const { steps, response } = await generateText({
          model: openai(MODES["tactical"].model),
          system: systemPrompt,
          prompt: userPrompt,
          tools,
          providerOptions: { openai: { strictJsonSchema: true } },
          stopWhen: stepCountIs(MODES["tactical"].maxSteps),
          abortSignal: AbortSignal.timeout(
            (MODES["tactical"].maxDuration - 30) * 1000,
          ),
        });

        let toolCalls = steps.reduce(
          (sum, s) => sum + (s.toolCalls?.length ?? 0),
          0,
        );
        let elapsed = Date.now() - t0;
        console.log(
          `[tactical-run] thesis=${thesis.id} trigger=${trigger.id} ${steps.length} steps, ${toolCalls} tool calls, ${elapsed}ms`,
        );

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
              providerOptions: { openai: { strictJsonSchema: true } },
              stopWhen: stepCountIs(5),
              abortSignal: AbortSignal.timeout(60_000),
            });
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

        // ── Persist conversation messages ──────────────────────────────────
        // /runs/[id] replays from this row. Includes any retry sequence so
        // the user sees the full recovery, not just the original tail.
        try {
          const userMessage = {
            role: "user",
            content: [{ type: "text", text: userPrompt }],
          };
          const allMessages = [userMessage, ...(responseMessages ?? [])];
          const json = JSON.stringify(allMessages);
          await prisma.$transaction(async (tx) => {
            await tx.runMessage.deleteMany({ where: { runId: run.id } });
            await tx.runMessage.create({
              data: {
                runId: run.id,
                role: "thread",
                content: json,
              },
            });
          });
        } catch (msgErr) {
          console.error(
            `[tactical-run] failed to persist messages for run=${run.id}:`,
            msgErr instanceof Error ? msgErr.message : msgErr,
          );
        }

        await prisma.researchRun.update({
          where: { id: run.id },
          data: {
            status: closedOut ? "COMPLETE" : "FAILED",
            completedAt: new Date(),
          },
        });

        if (!closedOut) {
          await prisma.runEvent.create({
            data: {
              runId: run.id,
              type: "run_failed",
              title: "Tactical run did not close out",
              message:
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

    return {
      runId: run.id,
      thesisId: thesis.id,
      triggerId: trigger.id,
      signalId: signal?.id ?? null,
      ticker: thesis.ticker,
      action: trigger.action,
      ...outcome,
    };
  },
);
