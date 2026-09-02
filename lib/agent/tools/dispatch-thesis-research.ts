/**
 * dispatch_thesis_research — orchestrator-side tool. Spawns a thesis-writer
 * sub-agent run for one ticker. Returns immediately with the child run ID;
 * the actual deep-research work happens asynchronously in the
 * `thesis-writer` Inngest function.
 *
 * Pattern: insert a child ResearchRun (mode="THESIS_WRITER",
 * parentRunId=ctx.runId), fire `app/thesis.write.requested`, return the
 * childRunId. Discovery / Daily / Tactical / Principal Chat all call this
 * — per-orchestrator wait semantics live in the caller (fire-and-forget vs
 * waitForEvent vs inline call).
 *
 * See docs/plans/THESIS_RESEARCH_V2.md §6.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { DISPATCH_CAP } from "@/lib/agent/system-prompts/discovery";

export const dispatchThesisResearch = defineTool({
  description:
    "Dispatch a thesis-writer sub-agent to write or refresh a deep-research thesis on one " +
    "ticker. Use this whenever the user (or your orchestration logic) wants a fresh, " +
    "multi-section equity-research note — it spawns a focused child agent that pulls the " +
    "structured data, calls the deep-research model, and persists the thesis. Returns " +
    "immediately with a child run ID; the research itself typically takes ~3-4 minutes and " +
    "runs asynchronously in an Inngest function. The user can watch the child run stream " +
    "live at /runs/<childRunId>.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. NVDA"),
    analyst_id: z
      .string()
      .describe(
        "AgentConfig.id — whose voice to write in. The thesis row is FK'd to this analyst.",
      ),
    mode: z
      .enum(["mint", "refresh"])
      .describe(
        "mint = net-new coverage; refresh = update an existing thesis with new evidence.",
      ),
    existing_thesis_id: z
      .string()
      .optional()
      .describe(
        "Required when mode='refresh' — the Thesis.id whose research should be updated.",
      ),
    reason: z
      .string()
      .min(20)
      .describe(
        "Why this dispatch is happening (e.g. 'User asked for a fresh thesis on $F via " +
          "Principal Chat'). Persisted on the child run's parameters for traceability.",
      ),
    promotion_context: z
      .object({
        paperTenureDays: z.number().nullable(),
        paperRealizedPnl: z.number().nullable(),
        paperReviewCount: z.number().nullable(),
        promotedAt: z.string().nullable(),
      })
      .optional()
      .describe(
        "PAPER→LIVE promotion framing. Usually you don't pass this — when mode='refresh' " +
          "and the existing thesis is in PROMOTED status, this tool auto-populates from the " +
          "Thesis row (paperTenureDays / paperRealizedPnl / paperReviewCount / promotedAt). " +
          "Forwarded to the thesis-writer worker so its research call can frame the " +
          "Decision Fields block around RE-ENTER / DOWNGRADE / INVALIDATE.",
      ),
  }),
  ui: "tool-ui" as const,
  groupId: "thesis-dispatch",

  progressLabel: ({ ticker, mode }) =>
    mode === "refresh"
      ? `Refreshing $${ticker.toUpperCase()} thesis`
      : `Dispatching $${ticker.toUpperCase()} thesis-writer`,

  execute: async (args, ctx) => {
    const T = args.ticker.toUpperCase();

    // Verify the analyst exists + belongs to this account before inserting
    // the child run row. The FK on ResearchRun.agentConfigId is SetNull, so
    // a bogus id wouldn't fail at insert — it'd just orphan the run.
    const analyst = await prisma.agentConfig.findFirst({
      where: { id: args.analyst_id, accountId: ctx.accountId },
      select: {
        id: true,
        name: true,
        userId: true,
        accountId: true,
        tradingEnvironment: true,
      },
    });
    if (!analyst) {
      return {
        summary: `Dispatch failed: analyst ${args.analyst_id} not found on this account.`,
        data: {
          childRunId: null,
          status: "FAILED" as const,
          note:
            `No analyst with id ${args.analyst_id} exists on this account. Use list_analysts ` +
            `to find the right analyst_id before calling dispatch_thesis_research.`,
        },
        sources: [],
      };
    }

    if (args.mode === "refresh" && !args.existing_thesis_id) {
      return {
        summary: `Dispatch failed for $${T}: refresh mode requires existing_thesis_id.`,
        data: {
          childRunId: null,
          status: "FAILED" as const,
          note:
            "When mode='refresh', pass existing_thesis_id — the Thesis.id whose research " +
            "should be updated. For net-new coverage, use mode='mint' instead.",
        },
        sources: [],
      };
    }

    // Auto-populate promotion_context for refreshes on PROMOTED theses. This
    // is the path the promote-analyst action takes when fanning out rewrites
    // for the first live run. The caller doesn't need to know whether the
    // thesis is PROMOTED — we read the four context fields off the row and
    // thread them into the worker so its research prompt
    // gets the RE-ENTER / DOWNGRADE / INVALIDATE framing.
    let effectivePromotionContext = args.promotion_context;
    if (
      args.mode === "refresh" &&
      args.existing_thesis_id &&
      !effectivePromotionContext
    ) {
      const existing = await prisma.thesis.findUnique({
        where: { id: args.existing_thesis_id },
        select: {
          status: true,
          paperTenureDays: true,
          paperRealizedPnl: true,
          paperReviewCount: true,
          promotedAt: true,
        },
      });
      if (existing && existing.status === "PROMOTED") {
        effectivePromotionContext = {
          paperTenureDays: existing.paperTenureDays,
          paperRealizedPnl: existing.paperRealizedPnl,
          paperReviewCount: existing.paperReviewCount,
          promotedAt: existing.promotedAt
            ? existing.promotedAt.toISOString()
            : null,
        };
      }
    }

    // Resolve parentRunId. ctx.runId might be a real ResearchRun id (the
    // scoped principal-chat path creates one and threads it through) or a
    // mode-name sentinel like "principal" (the unscoped path, where the
    // route falls back to `runId || agentMode`). Inserting a sentinel as
    // parentRunId would FK-violate `ResearchRun(parentRunId → ResearchRun.id)`,
    // so verify the row exists and pass `undefined` when it doesn't —
    // Prisma then omits the field and the child run lands as a top-level
    // orphan (which is the right behavior for unscoped dispatches anyway).
    let resolvedParentRunId: string | undefined;
    let parentRunMode: string | null = null;
    if (ctx.runId) {
      const parentRow = await prisma.researchRun.findUnique({
        where: { id: ctx.runId },
        select: { id: true, mode: true },
      });
      if (parentRow) {
        resolvedParentRunId = parentRow.id;
        parentRunMode = parentRow.mode;
      }
    }

    // Layer-1 DISPATCH_CAP enforcement for Discovery (HPQ E2E follow-up
    // #5 — 2026-05-24). The discovery prompt soft-caps dispatches via the
    // DISPATCH_CAP constant; this gate makes it hard so a future model
    // can't quietly burn the API budget by ignoring the prompt. Chat /
    // tactical / one-off dispatches are NOT capped — only Discovery
    // (where the cap is the whole point of the funnel).
    //
    // Counts the number of THESIS_WRITER children already spawned under
    // this same Discovery parent (any status — including FAILED, since a
    // failed dispatch still hit the API budget). At cap → reject with an
    // actionable message that tells the agent to PASS-record instead.
    if (parentRunMode === "DISCOVERY" && resolvedParentRunId) {
      const existingDispatches = await prisma.researchRun.count({
        where: {
          parentRunId: resolvedParentRunId,
          mode: "THESIS_WRITER",
        },
      });
      if (existingDispatches >= DISPATCH_CAP) {
        console.warn(
          `[dispatch-thesis-research] Discovery parent=${resolvedParentRunId} ` +
            `at DISPATCH_CAP (${existingDispatches}/${DISPATCH_CAP}) — rejecting ` +
            `dispatch for $${T}.`,
        );
        return {
          summary:
            `Dispatch refused for $${T}: Discovery cap of ${DISPATCH_CAP} ` +
            `thesis-writer runs already reached this run.`,
          data: {
            childRunId: null,
            status: "FAILED" as const,
            note:
              `Discovery's per-run dispatch cap (${DISPATCH_CAP}) is enforced ` +
              `at the tool layer. You've already dispatched ${existingDispatches} thesis-writer ` +
              `run(s) under this parent. Mint a PASS thesis for $${T} instead ` +
              `via record_thesis(direction:'PASS', ...) with a reasoning_summary explaining ` +
              `why this name was below the cap line + an invalidation_condition naming ` +
              `what would make next week's discovery promote it.`,
          },
          sources: [],
        };
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // Cross-analyst in-flight dispatch dedup (DISCOVERY_OVERHAUL SOON-1c,
    // 2026-05-31). When two analysts in the same account both run discovery
    // simultaneously and both land on the same ticker, they previously
    // spawned two parallel thesis-writer runs — each burning ~$1-3 of
    // Claude tokens on duplicate deep research. Observed today on AVGO
    // (Catalyst Event PM + Momentum Breakout) and CRDO (Momentum Breakout
    // + Secular Compounder).
    //
    // Cardinality allows different analysts to have their own theses on
    // the same ticker (THESIS_ARCHITECTURE.md §3 — the rule is one
    // ACTIVE-or-WATCHING per analyst+ticker+direction, not per account).
    // What this gate prevents is PARALLEL writers running at the same
    // time — once the first writer completes, a second dispatch for a
    // different analyst is fine and will land cleanly.
    //
    // Behavior: if a THESIS_WRITER ResearchRun is currently RUNNING in
    // this account for this ticker, reject with a structured note telling
    // the agent (a) who owns it, (b) what to do instead (PASS-record for
    // this analyst). 30-minute age cap so a stuck writer doesn't block
    // forever; writers normally complete in 3-5 minutes.
    // ────────────────────────────────────────────────────────────────────
    const STUCK_WRITER_AGE_MIN = 30;
    const inFlightWriter = await prisma.researchRun.findFirst({
      where: {
        accountId: analyst.accountId,
        mode: "THESIS_WRITER",
        status: "RUNNING",
        parameters: { path: ["ticker"], equals: T },
        startedAt: {
          gte: new Date(Date.now() - STUCK_WRITER_AGE_MIN * 60 * 1000),
        },
      },
      select: {
        id: true,
        agentConfigId: true,
        startedAt: true,
      },
    });
    if (inFlightWriter) {
      const ownerAnalyst = inFlightWriter.agentConfigId
        ? await prisma.agentConfig.findUnique({
            where: { id: inFlightWriter.agentConfigId },
            select: { name: true },
          })
        : null;
      const ownerLabel = ownerAnalyst?.name ?? "another analyst";
      const sameAnalyst = inFlightWriter.agentConfigId === analyst.id;
      const ageMin = Math.round(
        (Date.now() - inFlightWriter.startedAt.getTime()) / 60000,
      );
      console.warn(
        `[dispatch-thesis-research] In-flight writer for $${T} ` +
          `(run=${inFlightWriter.id}, owner=${ownerLabel}, age=${ageMin}m) — ` +
          `rejecting parallel dispatch from analyst=${analyst.name}.`,
      );
      return {
        summary:
          `Dispatch refused for $${T}: a thesis-writer is already in flight ` +
          `(run ${inFlightWriter.id}, owned by ${ownerLabel}, dispatched ${ageMin}m ago).`,
        data: {
          childRunId: null,
          status: "FAILED" as const,
          note: sameAnalyst
            ? `This analyst already has a thesis-writer running on $${T} ` +
              `(run ${inFlightWriter.id}, dispatched ${ageMin}m ago). Wait ` +
              `for it to complete — don't fan out a second writer for the ` +
              `same analyst on the same ticker.`
            : `Another analyst in this account (${ownerLabel}) is already ` +
              `running a thesis-writer on $${T} (run ${inFlightWriter.id}, ` +
              `dispatched ${ageMin}m ago). To avoid burning duplicate Claude ` +
              `tokens on parallel deep-research, EITHER wait for that writer ` +
              `to complete and then dispatch a fresh one for this analyst, OR ` +
              `mint a PASS thesis for $${T} via record_thesis(direction:'PASS', ` +
              `...) with a note that ${ownerLabel} owns the in-flight research ` +
              `and this analyst should re-evaluate after that thesis lands. ` +
              `(Cardinality allows different analysts to own their own theses ` +
              `on the same ticker — this gate only prevents PARALLEL writers, ` +
              `not separate theses across analysts.)`,
        },
        sources: [],
      };
    }

    // mode is intentionally a String column on ResearchRun (not a Prisma
    // enum) so new values like "THESIS_WRITER" don't need a migration. See
    // docs/plans/THESIS_RESEARCH_V2.md §7.
    const childRun = await prisma.researchRun.create({
      data: {
        userId: analyst.userId,
        accountId: analyst.accountId,
        agentConfigId: analyst.id,
        source: "AGENT",
        status: "RUNNING",
        mode: "THESIS_WRITER",
        // Environment authority order: the orchestrator run's env (when
        // threaded) → the ANALYST's tradingEnvironment → PAPER. The blind
        // `?? "PAPER"` default was wrong: principal-chat dispatches come
        // through with ctx.runEnvironment unset, so a LIVE analyst's
        // thesis-writer children were stamped PAPER and vanished from the
        // Runs page in Live mode (2026-06-03 PEAD SNOW/PACS/CRDO). The
        // analyst's tradingEnvironment is the authoritative book for any
        // work FK'd to that analyst — a LIVE analyst's dispatch is never
        // legitimately PAPER.
        environment:
          ctx.runEnvironment ??
          (analyst.tradingEnvironment as "PAPER" | "LIVE"),
        ...(resolvedParentRunId ? { parentRunId: resolvedParentRunId } : {}),
        parameters: {
          ticker: T,
          mode: args.mode,
          existingThesisId: args.existing_thesis_id ?? null,
          reason: args.reason,
          parentRunId: resolvedParentRunId ?? null,
          dispatchedAt: new Date().toISOString(),
          promotionContext: effectivePromotionContext ?? null,
        } as object,
      },
      select: { id: true },
    });

    // forceWatchingMint = true for chat-dispatched mints (Phase 1).
    //
    // Rationale: chat-dispatched mints are exploratory — the user typed
    // "write me a thesis on $X" to STUDY the name, not to auto-trade it.
    // ACTIVE attaches HELD-template triggers (EXIT on stop_loss, REVIEW on
    // target_hit) but no place_trade fires, so the trigger evaluator
    // later fires orphan tactical EXIT runs that fail silently (same
    // failure mode the discovery cron's hard-clamp was added to fix on
    // 2026-05-13). Default to WATCHING; user can promote via a follow-up
    // "buy this" message which triggers a separate place_trade flow.
    //
    // Future Phase-3 daily-run dispatches (refresh-then-trade) need
    // forceWatchingMint=false — that's a refresh flow, not a mint flow,
    // so the clamp doesn't apply anyway (only LONG/SHORT mints get
    // clamped; refreshes are status-preserving by design). Future
    // tactical dispatches (Phase 4) call runThesisWriterAgent inline,
    // bypassing this dispatch tool entirely.
    //
    // Belt-and-suspenders pattern: the system prompt also tells the
    // agent to default WATCHING (instruction in run-thesis-writer.ts).
    // The flag here is the Layer-1 enforcement in case the agent ignores
    // the prompt — mirrors the discoveryOnly + discovery clamp pattern
    // in record_thesis.ts.
    await inngest.send({
      name: "app/thesis.write.requested",
      data: {
        childRunId: childRun.id,
        ticker: T,
        analystId: analyst.id,
        mode: args.mode,
        existingThesisId: args.existing_thesis_id ?? null,
        reason: args.reason,
        parentRunId: resolvedParentRunId ?? null,
        forceWatchingMint: args.mode === "mint",
        promotionContext: effectivePromotionContext ?? null,
      },
    });

    const tag = effectivePromotionContext
      ? "promotion refresh dispatched"
      : args.mode === "refresh"
        ? "refresh dispatched"
        : "mint dispatched";

    return {
      summary: `Dispatched thesis-writer for $${T} (${args.mode}) — child run ${childRun.id}`,
      data: {
        childRunId: childRun.id,
        ticker: T,
        mode: args.mode,
        analystName: analyst.name,
        // V2 writer typical wall time (~200-250s observed target; see
        // docs/plans/THESIS_WRITER_V2.md). The old 90_000 was copied from
        // the V1 synthesis sub-call's budget and was fiction for the
        // pipeline as a whole.
        estimatedDurationMs: 240_000,
        items: [
          {
            kind: "ticker" as const,
            ticker: T,
            tag,
            text: `Worker spawned for ${analyst.name} · child run ${childRun.id.slice(0, 8)}…`,
          },
          {
            kind: "generic" as const,
            text:
              `Watch progress at /runs/${childRun.id}. ETA ~3-4 min. ` +
              `Result lands as a Thesis with researchData + researchSections populated.`,
          },
        ],
      },
      sources: [],
    };
  },
});
