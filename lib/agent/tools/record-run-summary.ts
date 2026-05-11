/**
 * record_run_summary — migrated to defineTool().
 *
 * Fires after all execution tools (Stage 5), before complete_run.
 * Writes the run_summary RunEvent that the briefing agent reads.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { getLatestPrices } from "@/lib/alpaca";
import {
  detectNarrationHits,
  findGaps,
  type NarrationHit,
  type ToolCallEvent,
} from "@/lib/agent/narration-gate";

/**
 * Words that signal a deliberate, reasoned rejection of a met entry
 * condition. The promotion gate accepts a thesis as "addressed" if its
 * ticker is named in the rationale AND at least one of these terms
 * appears in the surrounding text. Wide net by design — false positives
 * (the gate lets a borderline rejection through) are preferable to
 * false negatives (the gate fails a thoughtful reject because the agent
 * used a slightly different word than expected). The MRVL anti-pattern
 * — raise target, walk away — leaves NONE of these words in the
 * rationale, so the gate catches it.
 */
const REJECTION_KEYWORDS_RE =
  /\b(volume|regime|fresh\s+(news|negative)|liquid|illiquid|thin|deteriorat|reject|invalidat|setup\s+(broke|broken|gone|failed|invalidated)|conviction\s+(fell|dropped|lower|weakened)|stop|R\/?R|risk[-/\s]?reward|ratio|news|bearish|short[-\s]?term\s+headwind|gap)\b/i;

function tickerMentionRegex(ticker: string): RegExp {
  // Match $TICKER, TICKER, or word-bounded ticker. Case-insensitive.
  return new RegExp(`\\$?\\b${ticker.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
}

export const recordRunSummary = defineTool({
  description:
    "STAGE 5. Fires after all execution tools, before complete_run. Pass every ticker you researched (ranked by conviction) with the action that ACTUALLY happened. Your IMMEDIATE next step after this is Stage 6 — call complete_run.",
  schema: z.object({
    // Decision-framework v1 — required field. The agent's overall capital
    // allocation decision for this run. Persisted in ResearchRun.parameters
    // and on the run_summary RunEvent payload. Drives day-over-day analytics:
    // are runs producing HOLD when there's no edge, or busywork-trading
    // because of compliance pressure?
    primary_decision: z
      .enum(["HOLD", "ADJUST", "ROTATE", "ADD", "WATCH"])
      .describe(
        "The run's primary capital allocation decision: HOLD (current portfolio is optimal, no changes), ADJUST (modify existing positions only), ROTATE (close a current position to fund a clearly better entry), ADD (open a new position that beats existing options AND cash), WATCH (log a candidate for later, no trade today). HOLD is a successful run; do not force a trade to fill a quota.",
      ),
    decision_rationale: z
      .string()
      .min(120)
      .describe(
        "STRUCTURED rationale. Required content depends on primary_decision: " +
        "HOLD → must cite (a) weakest holding's composite score with dimension breakdown, (b) best candidate's composite, (c) why each evaluated candidate failed (composite < 7, quality-bar gate, didn't beat weakest by ≥+2, leader extended). " +
        "ADD/ROTATE → must cite (a) candidate's composite breakdown by dimension (3+3+2+2), (b) which holding it beats (or whether it's an addition not rotation), (c) why leader-first isn't blocking, (d) R/R ratio. " +
        "ADJUST → must cite which holding(s) and what changed in the score that triggered the adjustment. " +
        "WATCH → must cite what's promising AND what's missing. " +
        "Vague rationales like 'holdings still working' or 'no good setups today' are INSUFFICIENT — every score and every PASS reason must be explicit and auditable. " +
        "Example HOLD: 'Weakest holding NVDA 8/10 (3+3+1+1, entryQuality dinged for extended intraday). Best candidate INTC 5/10 (2+1+1+1) — fails leader-first (NVDA leads), fails entryQuality (post-earnings gap already faded). ON Semi 6/10 — fails extended-chase gate at +12% intraday. No candidate clears bar; HOLD.'",
      ),
    ranked_picks: z
      .array(
        z.object({
          rank: z.number(),
          ticker: z.string(),
          direction: z.enum(["LONG", "SHORT", "PASS"]),
          confidence: z.number(),
          reasoning: z.string().describe("One-line rationale (<= 80 chars)"),
          action: z.enum(["INITIATE", "ADD", "HOLD", "REDUCE", "EXIT", "WATCH", "REMOVE_WATCH", "PASS", "FAILED"])
            .describe(
              "What ACTUALLY happened to this ticker this run. Choose by what you have, not what you thought:\n" +
              "  INITIATE = opened a new position (place_trade fired success).\n" +
              "  ADD      = added to an existing position.\n" +
              "  HOLD     = you currently HOLD an open position in this ticker and kept it. Do NOT use HOLD for a watched/tracked thesis where you have no position — that is WATCH.\n" +
              "  REDUCE   = trimmed an existing position.\n" +
              "  EXIT     = closed an existing position (close_position fired).\n" +
              "  WATCH    = you do NOT have a position; you maintained or updated the thesis to keep tracking. This is the right verb whenever you edited a thesis on a ticker you don't own.\n" +
              "  REMOVE_WATCH = removed from watchlist / dropped tracking.\n" +
              "  PASS     = researched and rejected; no thesis maintained.\n" +
              "  FAILED   = place_trade returned success: false (rejected by broker, duplicate, etc).",
            ),
          composite_score: z
            .number()
            .min(0)
            .max(10)
            .optional()
            .describe(
              "Composite of the six decision-framework dimensions from record_thesis.scoring (avg, 0-10). Required when scoring was provided to record_thesis.",
            ),
        }),
      )
      .describe(
        "Every ticker you researched in Step 3, ranked by composite_score (or by conviction if composite unavailable), with the action that ACTUALLY happened in Step 5. HOLD is reserved for tickers you currently own. For a thesis edit on a ticker you don't own, use WATCH. Use FAILED for tickers where place_trade returned success: false.",
      ),
    exposure_breakdown: z
      .object({
        long_exposure: z.number().describe("Total $ in long positions"),
        short_exposure: z.number().describe("Total $ in short positions"),
        net_exposure: z.number().describe("Net $ exposure (long - short)"),
      })
      .optional(),
  }),
  ui: "run-summary" as const,

  progressLabel: () => "Recording the run summary",

  execute: async (args, ctx) => {
    try {
      // ── Pre-pass: downgrade misclassified HOLDs to WATCH ─────────────
      // The agent sometimes labels a thesis edit on a non-held ticker as
      // HOLD. Semantically that's WATCH. We resolve the open-position set
      // once here so the corrected actions land in the RunEvent payload,
      // ResearchRun.parameters, the rendered DecisionSummaryCard, AND the
      // TradeDecision rows — keeping every consumer in sync. We also
      // memoize the position lookup so the TradeDecision write loop
      // below doesn't repeat the same query.
      const positionByTicker = new Map<string, string | null>();
      if (ctx.analystId) {
        const trackingTickers = Array.from(
          new Set(
            args.ranked_picks
              .filter((p) => {
                const a = p.action.toUpperCase();
                return a === "HOLD" || a === "WATCH";
              })
              .map((p) => p.ticker.toUpperCase()),
          ),
        );
        if (trackingTickers.length > 0) {
          try {
            const openPositions = await prisma.position.findMany({
              where: {
                analystId: ctx.analystId,
                symbol: { in: trackingTickers },
                status: "OPEN",
              },
              select: { id: true, symbol: true },
            });
            for (const t of trackingTickers) positionByTicker.set(t, null);
            for (const p of openPositions) positionByTicker.set(p.symbol.toUpperCase(), p.id);
          } catch (lookupErr) {
            console.warn(
              `[tool] record_run_summary position lookup failed:`,
              lookupErr instanceof Error ? lookupErr.message : lookupErr,
            );
          }
        }
        for (const pick of args.ranked_picks) {
          if (pick.action.toUpperCase() !== "HOLD") continue;
          const positionId = positionByTicker.get(pick.ticker.toUpperCase());
          if (positionId == null) {
            console.info(
              `[tool] record_run_summary downgrading ${pick.ticker} action HOLD→WATCH (no open position)`,
            );
            pick.action = "WATCH" as typeof pick.action;
          }
        }
      }

      const traded = args.ranked_picks.filter((p) => {
        const a = p.action.toUpperCase();
        return a === "INITIATE" || a === "ADD";
      }).length;

      // Compute actual deployed amount from DB — only INITIATE decisions for this run.
      // The model-provided exposure_breakdown reflects total portfolio exposure (including
      // pre-existing positions), not what was deployed this session, so we ignore it.
      let actualDeployedLong = 0;
      let actualDeployedShort = 0;
      if (ctx.runId) {
        try {
          const initiateDecisions = await prisma.tradeDecision.findMany({
            where: { runId: ctx.runId, decision: "INITIATE" },
            include: { position: { select: { quantity: true, avgCost: true, direction: true } } },
          });
          for (const d of initiateDecisions) {
            if (!d.position) continue;
            const notional = d.position.avgCost * d.position.quantity;
            if (d.position.direction === "LONG") actualDeployedLong += notional;
            else actualDeployedShort += notional;
          }
        } catch (dbErr) {
          console.warn("[tool] record_run_summary: deployed capital DB lookup failed:", dbErr instanceof Error ? dbErr.message : dbErr);
        }
      }

      // Write run_summary RunEvent (shape the briefing agent reads)
      if (ctx.runId) {
        try {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "run_summary",
              title: `Run Summary — ${args.primary_decision}`,
              message: `${args.primary_decision}: ${args.ranked_picks.length} tickers analyzed, ${traded} traded`,
              payload: {
                primary_decision: args.primary_decision,
                decision_rationale: args.decision_rationale,
                ranked_picks: args.ranked_picks,
              } as object,
            },
          });
        } catch (evtErr) {
          console.error(`[tool] record_run_summary RunEvent write failed:`, evtErr instanceof Error ? evtErr.message : evtErr);
        }

        // Persist primary_decision + rationale into ResearchRun.parameters
        // so day-over-day analytics can SQL-query them directly without
        // joining to RunEvent. Merge with existing params (toolStats, etc.).
        try {
          const existing = await prisma.researchRun.findUnique({
            where: { id: ctx.runId },
            select: { parameters: true },
          });
          const existingParams =
            existing?.parameters && typeof existing.parameters === "object"
              ? (existing.parameters as Record<string, unknown>)
              : {};
          await prisma.researchRun.update({
            where: { id: ctx.runId },
            data: {
              parameters: {
                ...existingParams,
                primaryDecision: args.primary_decision,
                decisionRationale: args.decision_rationale,
              } as object,
            },
          });
        } catch (paramErr) {
          console.warn(
            `[tool] record_run_summary parameter write failed:`,
            paramErr instanceof Error ? paramErr.message : paramErr
          );
        }
      }

      // Persist HOLD and WATCH decisions (non-fatal). The pre-pass above
      // already downgraded any HOLD without a matching open position, so
      // pick.action is now authoritative. WATCH picks were previously
      // silently dropped; we persist them too so analytics can answer
      // "what is the analyst tracking without trading?".
      const trackingPicks = args.ranked_picks.filter((p) => {
        const a = p.action.toUpperCase();
        return a === "HOLD" || a === "WATCH";
      });
      if (trackingPicks.length > 0 && ctx.analystId && ctx.runId) {
        for (const pick of trackingPicks) {
          try {
            const decision = pick.action.toUpperCase();
            const positionId = positionByTicker.get(pick.ticker.toUpperCase()) ?? null;
            await prisma.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId: ctx.analystId,
                userId: ctx.userId,
                accountId: ctx.accountId,
                symbol: pick.ticker.toUpperCase(),
                decision,
                reasoning: pick.reasoning?.slice(0, 500) ?? null,
                positionId,
              },
            });
          } catch (writeErr) {
            console.warn(
              `[tool] record_run_summary decision write failed for ${pick.ticker}:`,
              writeErr instanceof Error ? writeErr.message : writeErr,
            );
          }
        }
      }

      // ── Promotion gate (audit Root Cause #3 follow-up) ───────────────
      // For every WATCHING/LONG-or-SHORT thesis owned by this analyst,
      // check whether the entry condition is currently met against the
      // latest quote. When it is, the agent must EITHER:
      //   (a) have placed a trade for that ticker (TradeDecision INITIATE
      //       row written by place_trade), OR
      //   (b) have invalidated the thesis (ThesisUpdate type=INVALIDATED
      //       written by update_thesis with change_status), OR
      //   (c) have explicitly rejected the entry — ticker named in the
      //       rationale + at least one rejection keyword nearby.
      // Otherwise the run is FAILED. Same severity as the narration gate.
      //
      // This is the runtime backstop for the prompt's Step 3 promotion
      // check. The MRVL goalpost-raise is already gated in update_thesis;
      // this gate catches the "did absolutely nothing" case the prompt
      // promised would be enforced but wasn't.
      //
      // Quote-fetch failures skip the gate entirely (the cron-path
      // trigger evaluator will still fire on the next 5-minute tick) —
      // we don't want a transient Alpaca outage to fail an otherwise
      // healthy run.
      if (ctx.runId && ctx.analystId) {
        try {
          // Explicit row shapes — the prisma generated types ride through
          // a few await/try wrappers and the lambda parameters lose
          // inference under noImplicitAny without these annotations.
          type WatchingRow = {
            id: string;
            ticker: string;
            direction: string;
            targetPrice: number | null;
          };
          const watching: WatchingRow[] = await prisma.thesis.findMany({
            where: {
              researchRun: { agentConfigId: ctx.analystId },
              status: "WATCHING",
              direction: { in: ["LONG", "SHORT"] },
              targetPrice: { not: null },
              closedAt: null,
            },
            select: {
              id: true,
              ticker: true,
              direction: true,
              targetPrice: true,
            },
          }) as WatchingRow[];

          if (watching.length > 0) {
            const tickers: string[] = Array.from(
              new Set(watching.map((t: WatchingRow) => t.ticker)),
            );
            let prices: Record<string, number> = {};
            try {
              prices = await getLatestPrices(tickers, ctx.alpacaCreds);
            } catch (priceErr) {
              console.warn(
                `[record_run_summary] promotion gate: price fetch failed (${tickers.length} tickers), skipping gate:`,
                priceErr instanceof Error ? priceErr.message : priceErr,
              );
              prices = {};
            }

            const conditionsMet = watching.filter((t: WatchingRow) => {
              const price = prices[t.ticker];
              if (price == null || t.targetPrice == null) return false;
              const target = Number(t.targetPrice);
              if (t.direction === "LONG") return price >= target;
              if (t.direction === "SHORT") return price <= target;
              return false;
            });

            if (conditionsMet.length > 0) {
              // (a) — INITIATE TradeDecisions this run
              const initiateRows: Array<{ symbol: string }> =
                await prisma.tradeDecision.findMany({
                  where: { runId: ctx.runId, decision: "INITIATE" },
                  select: { symbol: true },
                });
              const initiateTickers = new Set(
                initiateRows.map((r: { symbol: string }) =>
                  r.symbol.toUpperCase(),
                ),
              );

              // (b) — INVALIDATED ThesisUpdates this run
              const invalidationRows: Array<{
                thesis: { ticker: string } | null;
              }> = await prisma.thesisUpdate.findMany({
                where: { runId: ctx.runId, type: "INVALIDATED" },
                select: { thesis: { select: { ticker: true } } },
              });
              const invalidatedTickers = new Set(
                invalidationRows
                  .map((r: { thesis: { ticker: string } | null }) =>
                    r.thesis?.ticker?.toUpperCase(),
                  )
                  .filter((s: string | undefined): s is string => !!s),
              );

              const rationale = args.decision_rationale ?? "";
              const pickByTicker = new Map(
                args.ranked_picks.map((p) => [
                  p.ticker.toUpperCase(),
                  p.reasoning ?? "",
                ]),
              );

              const unaddressed: Array<{
                ticker: string;
                direction: string;
                targetPrice: number;
                currentPrice: number;
                reason: string;
              }> = [];

              for (const t of conditionsMet) {
                const tickerUpper = t.ticker.toUpperCase();
                const target = Number(t.targetPrice);
                const price = prices[t.ticker];

                if (initiateTickers.has(tickerUpper)) continue;
                if (invalidatedTickers.has(tickerUpper)) continue;

                // (c) — explicit rejection. The ticker must be named
                // somewhere in the rationale corpus AND at least one
                // rejection keyword must appear in the same corpus.
                const pickReasoning = pickByTicker.get(tickerUpper) ?? "";
                const corpus = `${rationale}\n${pickReasoning}`;
                const tickerMentioned = tickerMentionRegex(tickerUpper).test(
                  corpus,
                );
                const hasRejectionKeyword = REJECTION_KEYWORDS_RE.test(corpus);

                if (tickerMentioned && hasRejectionKeyword) continue;

                let reason: string;
                if (!tickerMentioned) {
                  reason = `not named in decision_rationale or its ranked-picks reasoning`;
                } else {
                  reason = `named in rationale but no concrete rejection keyword (volume/regime/news/R/R/liquidity/etc.) — looks like goalpost-moving`;
                }

                unaddressed.push({
                  ticker: t.ticker,
                  direction: t.direction,
                  targetPrice: target,
                  currentPrice: price,
                  reason,
                });
              }

              if (unaddressed.length > 0) {
                const summary = unaddressed
                  .map(
                    (u) =>
                      `${u.ticker} ${u.direction} target $${u.targetPrice.toFixed(2)} met @ $${u.currentPrice.toFixed(2)}: ${u.reason}`,
                  )
                  .join("; ");
                const gateMessage = `Promotion gate: ${unaddressed.length} WATCHING thesis${unaddressed.length > 1 ? "es" : ""} had entry conditions met but were not promoted, invalidated, or explicitly rejected. ${summary}. Run marked FAILED.`;

                try {
                  await prisma.runEvent.create({
                    data: {
                      runId: ctx.runId,
                      type: "run_failed",
                      title: "Promotion check failed",
                      message: gateMessage,
                      payload: {
                        gateSource: "record_run_summary.promotion",
                        unaddressed: unaddressed.map((u) => ({
                          ticker: u.ticker,
                          direction: u.direction,
                          targetPrice: u.targetPrice,
                          currentPrice: u.currentPrice,
                          reason: u.reason,
                        })),
                      } as object,
                    },
                  });
                } catch (evtErr) {
                  console.warn(
                    `[tool] record_run_summary promotion run_failed event write failed:`,
                    evtErr instanceof Error ? evtErr.message : evtErr,
                  );
                }
                try {
                  await prisma.researchRun.updateMany({
                    where: { id: ctx.runId, status: "RUNNING" },
                    data: { status: "FAILED", completedAt: new Date() },
                  });
                } catch (updErr) {
                  console.warn(
                    `[tool] record_run_summary promotion FAILED transition write failed:`,
                    updErr instanceof Error ? updErr.message : updErr,
                  );
                }
                console.warn(
                  `[tool] record_run_summary promotion gate FAILED run=${ctx.runId}: ${gateMessage}`,
                );
                return {
                  summary: `Run marked FAILED — promotion gate (${unaddressed.length} unaddressed): ${unaddressed.map((u) => u.ticker).join(", ")}`,
                  data: {
                    success: false,
                    rankedPicks: args.ranked_picks,
                    exposureBreakdown: undefined,
                    traded,
                    analyzed: args.ranked_picks.length,
                    error: gateMessage,
                    promotionUnaddressed: unaddressed,
                  },
                  sources: [],
                };
              }
            }
          }
        } catch (gateErr) {
          // Gate failure must never break the tool — fall through to the
          // narration gate and happy path.
          console.warn(
            `[tool] record_run_summary promotion gate error (non-fatal):`,
            gateErr instanceof Error ? gateErr.message : gateErr,
          );
        }
      }

      // ── Narration → execution gate ─────────────────────────────────
      // Detect action verbs in decision_rationale + each pick.reasoning
      // that imply close_position / manage_position / manage_watchlist
      // calls. If the corresponding tool didn't fire for this run+ticker,
      // mark the run FAILED. Mirrors the trade-execution gap check in
      // morning-research.ts (PR #210/#226) but covers the verbs that
      // gate doesn't — narrated stop-tightenings, trims, exits, and
      // watchlist edits that the agent writes as prose without ever
      // calling the tool. Same recurring failure pattern documented in
      // CLAUDE.md.
      if (ctx.runId) {
        try {
          const knownTickers = new Set(
            args.ranked_picks.map((p) => p.ticker.toUpperCase()),
          );
          const hits: NarrationHit[] = [];
          hits.push(
            ...detectNarrationHits(
              args.decision_rationale ?? "",
              "rationale",
              undefined,
              knownTickers,
            ),
          );
          for (const pick of args.ranked_picks) {
            hits.push(
              ...detectNarrationHits(
                pick.reasoning ?? "",
                "pick_reasoning",
                pick.ticker,
                knownTickers,
              ),
            );
          }
          if (hits.length > 0) {
            const events = await prisma.runEvent.findMany({
              where: {
                runId: ctx.runId,
                type: {
                  in: [
                    "position_closed",
                    "position_modified",
                    "watchlist_add",
                    "watchlist_remove",
                  ],
                },
              },
              select: { type: true, payload: true },
            });
            const toolEvents: ToolCallEvent[] = [];
            for (const e of events) {
              const payload =
                e.payload && typeof e.payload === "object"
                  ? (e.payload as Record<string, unknown>)
                  : {};
              const symbol = String(
                payload.symbol ?? payload.ticker ?? "",
              ).toUpperCase();
              if (symbol) toolEvents.push({ type: e.type, symbol });
            }
            const gaps = findGaps(hits, toolEvents);
            if (gaps.length > 0) {
              const gapList = gaps
                .map(
                  (g) =>
                    `${g.ticker} narrated ${g.expectedTool} ("${g.verb}") with no tool call`,
                )
                .join("; ");
              const gateMessage = `Narration→execution gap: ${gaps.length} ticker${gaps.length > 1 ? "s" : ""} narrated an action with no corresponding tool call (${gapList}). Run marked FAILED.`;
              try {
                await prisma.runEvent.create({
                  data: {
                    runId: ctx.runId,
                    type: "run_failed",
                    title: "Narration without tool call",
                    message: gateMessage,
                    payload: {
                      gateSource: "record_run_summary",
                      gaps: gaps.map((g) => ({
                        ticker: g.ticker,
                        expectedTool: g.expectedTool,
                        verb: g.verb,
                        context: g.context,
                        source: g.source,
                      })),
                    } as object,
                  },
                });
              } catch (evtErr) {
                console.warn(
                  `[tool] record_run_summary run_failed event write failed:`,
                  evtErr instanceof Error ? evtErr.message : evtErr,
                );
              }
              try {
                // Atomic transition only from RUNNING — same shape as the
                // morning-research cron-level gate. complete_run was tightened
                // to RUNNING-only so this status sticks.
                await prisma.researchRun.updateMany({
                  where: { id: ctx.runId, status: "RUNNING" },
                  data: { status: "FAILED", completedAt: new Date() },
                });
              } catch (updErr) {
                console.warn(
                  `[tool] record_run_summary FAILED transition write failed:`,
                  updErr instanceof Error ? updErr.message : updErr,
                );
              }
              console.warn(
                `[tool] record_run_summary narration gate FAILED run=${ctx.runId}: ${gateMessage}`,
              );
              return {
                summary: `Run marked FAILED — narration→execution gap (${gaps.length} ticker${gaps.length > 1 ? "s" : ""}): ${gaps.map((g) => `${g.ticker} ${g.expectedTool}`).join(", ")}`,
                data: {
                  success: false,
                  rankedPicks: args.ranked_picks,
                  exposureBreakdown: undefined,
                  traded,
                  analyzed: args.ranked_picks.length,
                  error: gateMessage,
                  narrationGaps: gaps,
                },
                sources: [],
              };
            }
          }
        } catch (gateErr) {
          // Gate failure must never break the tool — fall through to the
          // happy-path return so the run summary still persists.
          console.warn(
            `[tool] record_run_summary narration gate error (non-fatal):`,
            gateErr instanceof Error ? gateErr.message : gateErr,
          );
        }
      }

      const deployedThisRun = actualDeployedLong + actualDeployedShort;
      return {
        summary: deployedThisRun > 0
          ? `Run summary recorded: ${args.ranked_picks.length} picks, ${traded} traded — $${deployedThisRun.toFixed(0)} deployed.`
          : `Run summary recorded: ${args.ranked_picks.length} picks, ${traded} traded — no new capital deployed.`,
        data: {
          success: true,
          rankedPicks: args.ranked_picks,
          exposureBreakdown: deployedThisRun > 0
            ? { longExposure: actualDeployedLong, shortExposure: actualDeployedShort, netExposure: actualDeployedLong - actualDeployedShort }
            : undefined,
          traded,
          analyzed: args.ranked_picks.length,
        },
        sources: [],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Run summary persistence failed";
      console.error(`[tool] record_run_summary FAILED: ${msg}`);
      return {
        summary: `Run summary failed: ${msg}`,
        data: {
          success: false,
          rankedPicks: args.ranked_picks,
          exposureBreakdown: undefined,
          traded: 0,
          analyzed: args.ranked_picks.length,
          error: msg,
        },
        sources: [],
      };
    }
  },
});
