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
import { describeFilingEvent } from "@/lib/market-data/sec-events";
import { defineTool } from "@/lib/agent/define-tool";
import { chatFindings } from "@/lib/agent/thesis-research/chat-findings";
import type { ToolContext } from "@/lib/agent/tool-context";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { findInFlightWriter } from "@/lib/agent/thesis-writer-dispatch";


/** The longest screen row the writer's prompt carries. */
/** The brief: what the old reason, research notes (2,000) and pasted idea (3,000) carried, together. */
export const BRIEF_MAX = 5_000;

/** A long text is cut at the last whole word that fits, with "…". */
export function trimTo(text: string, max: number): string {
  const s = text.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

const namesAnalyst = (ctx: ToolContext) => ctx.runMode === "PRINCIPAL_CHAT" && !ctx.analystId;

export const dispatchThesisResearch = defineTool({
  description:
    "Send a stock to the Writer, which researches it and writes its thesis, or refreshes the one it has. " +
    "It returns at once with the Writer's run id; the write-up takes a few minutes, and wait_for_thesis_refresh waits for it.",
  schema: z.object({
    ticker: z.string().describe("The stock, e.g. NVDA."),
    analyst_id: z.string().describe("The analyst the stock is for, by its id (list_analysts)."),
    brief: z
      .string()
      .min(20)
      .transform((s) => trimTo(s, BRIEF_MAX))
      .describe("What the Writer reads first: why this stock, what you found (the numbers, the links), whose idea it is, and your own view."),
    source_link: z.string().optional().describe("The link to the post or article the idea came from, when there is one."),
  }),
  // Only the chat with no analyst pinned names one; any other run writes for its own (ETN 10-15: a made-up slug).
  // A trigger run sends its own stock (fromRun).
  schemaFor: (ctx, schema) => {
    const mine = namesAnalyst(ctx) ? schema : schema.omit({ analyst_id: true });
    return ctx.runMode === "INTRADAY_TACTICAL" ? mine.omit({ ticker: true }) : mine;
  },
  fromRun: (ctx) => (ctx.runStock ? { ticker: ctx.runStock.ticker } : null),
  ui: "thesis-card" as const,
  groupId: "thesis-dispatch",

  progressLabel: ({ ticker }) => `Sending $${ticker.toUpperCase()} to the Writer`,

  execute: async (args, ctx, call) => {
    const T = args.ticker.toUpperCase();
    // What the chat found on the stock that code can't pull again, carried by code (chat-findings.ts).
    const chatFound = ctx.runMode === "PRINCIPAL_CHAT" ? chatFindings(T, call?.messages) : null;

    // Verify the analyst exists + belongs to this account before inserting
    // the child run row. The FK on ResearchRun.agentConfigId is SetNull, so
    // a bogus id wouldn't fail at insert — it'd just orphan the run.
    // The Portfolio Manager has no analyst: the stock goes to the analyst whose live thesis it is.
    const thesisAnalyst = async () =>
      (await prisma.thesis.findFirst({ where: { ticker: T, userId: ctx.userId, status: { in: ["HOLDING", "WATCHING", "PROMOTED"] } }, orderBy: { createdAt: "desc" }, select: { researchRun: { select: { agentConfigId: true } } } }))?.researchRun?.agentConfigId;
    const analystId = namesAnalyst(ctx) ? args.analyst_id : (ctx.analystId ?? (ctx.runMode === "PORTFOLIO_MANAGER" ? await thesisAnalyst() : undefined));
    const analyst = await prisma.agentConfig.findFirst({
      where: { id: analystId ?? "", accountId: ctx.accountId },
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
        summary: `Dispatch failed: analyst ${analystId} not found on this account.`,
        data: {
          childRunId: null,
          status: "FAILED" as const,
          note:
            `No analyst with id ${analystId} exists on this account. Use list_analysts ` +
            `to find the right analyst_id before calling dispatch_thesis_research.`,
        },
        sources: [],
      };
    }

    // Promotion context for refreshes on PROMOTED theses, read off the row.
    // The model is never shown a field for it: no stock has ever been
    // promoted, and the row is the only source of these numbers. We read the
    // four context fields and thread them into the worker so its research
    // prompt gets the RE-ENTER / DOWNGRADE / INVALIDATE framing.
    let effectivePromotionContext:
      | { paperTenureDays: number | null; paperRealizedPnl: number | null; paperReviewCount: number | null; promotedAt: string | null }
      | undefined;
    // Code finds the thesis by the stock: the analyst's live thesis is
    // refreshed. With none, it is new research, linked to its last passed or
    // retired thesis on the stock (a terminal thesis takes no refresh:
    // update_thesis refuses it, and HTFL 11-13 spent 248K tokens on one
    // passed in August).
    const live = await prisma.thesis.findFirst({
      where: { ticker: T, status: { in: ["HOLDING", "WATCHING", "PROMOTED"] }, researchRun: { agentConfigId: analyst.id } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const last = live
      ? null
      : await prisma.thesis.findFirst({
          where: { ticker: T, status: { in: ["PASSED", "RETIRED"] }, researchRun: { agentConfigId: analyst.id } },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, createdAt: true },
        });
    const mode: "mint" | "refresh" = live ? "refresh" : "mint";
    const existingThesisId = live?.id;
    const parentThesisId = last?.id ?? null;
    const sentAs = last
      ? `Its thesis from ${last.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })} is ${last.status === "PASSED" ? "passed" : "retired"}, so this is new research on the stock, linked to it.`
      : null;
    if (mode === "refresh" && existingThesisId) {
      const existing = await prisma.thesis.findUnique({
        where: { id: existingThesisId },
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
    if (ctx.runId) {
      const parentRow = await prisma.researchRun.findUnique({
        where: { id: ctx.runId },
        select: { id: true },
      });
      if (parentRow) resolvedParentRunId = parentRow.id;
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
    const inFlightWriter = await findInFlightWriter(analyst.accountId, T);
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
              `tokens on parallel deep-research, wait for that writer to ` +
              `complete, then send the stock again for this analyst. ` +
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
    // The brief is the writer's "Why you were dispatched" block.
    // The red-flag check before a writer is sent (DAV-269, SEC plan §6): a
    // serious filing in the last 90 days — restatement, bankruptcy,
    // delisting notice, auditor change, late report — is shown, in the
    // reason and on the row. A line, never a refusal. Fail-open: a failed
    // EDGAR read says so.
    const redFlag = await (async () => {
      try {
        const { fetchBookFilings } = await import("@/lib/market-data/sec-filings");
        const read = await fetchBookFilings({ tickers: [T], now: new Date(), lookbackDays: 90 });
        if (read.error) return `Red-flag check: EDGAR couldn't be read (${read.error}).`;
        return redFlagLine(read.byTicker.get(T) ?? []);
      } catch (err) {
        return `Red-flag check: EDGAR couldn't be read (${err instanceof Error ? err.message : String(err)}).`;
      }
    })();
    const reason = [args.brief, sentAs, redFlag]
      .filter(Boolean)
      .join("\n");

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
        // legitimately PAPER. The chat's own book is the screen's, so it never decides.
        environment:
          (ctx.runMode === "PRINCIPAL_CHAT" ? null : ctx.runEnvironment) ??
          (analyst.tradingEnvironment as "PAPER" | "LIVE"),
        ...(resolvedParentRunId ? { parentRunId: resolvedParentRunId } : {}),
        parameters: {
          ticker: T,
          mode,
          existingThesisId: existingThesisId ?? null,
          parentThesisId,
          reason,
          chatFound,
          ideaSource: args.source_link?.trim() ? { url: args.source_link.trim() } : null,
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
    // ACTIVE attaches held-side triggers (a sale, an upside review) but
    // no place_trade fires, so the trigger evaluator
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
    // the prompt.
    await inngest.send({
      name: "app/thesis.write.requested",
      data: {
        childRunId: childRun.id,
        ticker: T,
        analystId: analyst.id,
        mode,
        existingThesisId: existingThesisId ?? null,
        parentThesisId,
        reason,
        chatFound,
        ideaSource: args.source_link?.trim() ? { url: args.source_link.trim() } : null,
        parentRunId: resolvedParentRunId ?? null,
        forceWatchingMint: mode === "mint",
        promotionContext: effectivePromotionContext ?? null,
      },
    });

    return {
      summary: `Dispatched thesis-writer for $${T} (${mode}) — child run ${childRun.id}${sentAs ? `. ${sentAs}` : ""}`,
      data: {
        childRunId: childRun.id,
        ticker: T,
        mode,
        ...(sentAs ? { sentAs } : {}),
        // V2 writer typical wall time (~200-250s observed target; see
        // docs/plans/THESIS_WRITER_V2.md). The old 90_000 was copied from
        // the V1 synthesis sub-call's budget and was fiction for the
        // pipeline as a whole.
        estimatedDurationMs: 240_000,
        // No `items`: this renders as a row in the Writing-theses table (the
        // same table the read-theses list uses), not as prose. It used to
        // print the raw child run id, an ETA and two internal field names,
        // and never changed while the writer worked.
        analystName: analyst.name,
        ...(redFlag ? { redFlag } : {}),
      },
      sources: [],
    };
  },
});

/**
 * The serious filings on a candidate in the last 90 days, in one line —
 * shown before a writer is dispatched so discovery can't mint a thesis on a
 * company that just told the SEC its books are wrong. Null when clean.
 * Pure; exported for the test (PRAX's 2026-07-02 auditor change).
 */
export function redFlagLine(
  filings: Array<{ tier: string; filedDate: string; form: string; rootForm: string; items: string[]; url: string }>,
): string | null {
  const red = filings.filter((f) => f.tier === "RED").sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  if (red.length === 0) return null;
  const lines = red.slice(0, 3).map((f) => `${describeFilingEvent(f)} filed ${f.filedDate} (${f.url})`);
  return `RED FLAG — a serious filing in the last 90 days: ${lines.join("; ")}. Read it before trusting the numbers; say in the thesis what it means.`;
}
