/**
 * manage_watchlist — migrated to defineTool().
 *
 * Adds, removes, or updates a watchlist item during a run.
 * Syncs the legacy watchlist array on AgentConfig after each mutation.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { prisma } from "@/lib/prisma";
import { isExcluded } from "@/lib/agent/universe";
import { revalidatePath } from "next/cache";

export const manageWatchlist = defineTool({
  description:
    "Explicitly add, remove, or update a watchlist item during a run. " +
    "This tool mutates watchlist state only. It does not research the stock, generate a thesis, or place trades. " +
    "Use when you want to save an idea for later, remove a dead idea, change watch priority, or attach notes/catalysts/targets after research.",
  schema: z.object({
    action: z.enum(["ADD", "REMOVE", "UPDATE"]).describe("What to do with the watchlist item"),
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
    reason: z.string().describe("Why this stock is being added/removed/updated"),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().describe("LOW = background monitoring, MEDIUM = review when relevant, HIGH = review every run"),
    notes: z.string().optional().describe("Additional notes or conditions"),
    thesis_direction: z.enum(["LONG", "SHORT", "PASS"]).optional().describe("Your directional view on this stock"),
    target_price: z.number().optional().describe("Price target you're watching for"),
    stop_price: z.number().optional().describe("Price level that would invalidate the thesis"),
    conviction: z.number().min(0).max(100).optional().describe("Conviction score 0-100"),
    catalyst: z.string().optional().describe("Key catalyst being monitored (e.g. 'Q2 earnings Aug 1')"),
    trigger_condition: z
      .string()
      .optional()
      .describe(
        "What would make this tradeable. STRONGLY ENCOURAGED on ADD. Concrete and machine-readable when possible: 'price < 145', 'RSI < 30', 'earnings beat', 'guidance raised'. If you don't supply one, the tool will derive a default from catalyst/target_price/stop_price.",
      ),
    expires_in_days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe(
        "How many days this watchlist entry stays active before EOD cleanup expires it. Default 30. Use 7-14 for tactical setups (earnings, near-term catalyst), 60-90 for slow-burn structural watches.",
      ),
    review_frequency: z.enum(["DAILY", "WEEKLY", "ON_CATALYST"]).optional().describe("How often to review this item"),
  }),
  ui: "tool-ui" as const,
  groupId: "Executing",

  progressLabel: (args) => {
    const t = args.ticker.toUpperCase();
    if (args.action === "ADD") return `Adding ${t} to the watchlist`;
    if (args.action === "REMOVE") return `Removing ${t} from the watchlist`;
    return `Updating ${t} on the watchlist`;
  },

  execute: async (args, ctx) => {
    const ticker = args.ticker.toUpperCase().trim();

    if (!ctx.analystId) {
      return {
        summary: `Watchlist ${args.action.toLowerCase()} failed: $${ticker}`,
        data: { success: false, action: args.action, ticker, changed: false, message: "Cannot manage watchlist without an analyst ID." },
        sources: [],
      };
    }

    if (args.target_price !== undefined && args.target_price <= 0) {
      return {
        summary: `Watchlist ${args.action.toLowerCase()} failed: $${ticker}`,
        data: { success: false, action: args.action, ticker, changed: false, message: "target_price must be positive." },
        sources: [],
      };
    }
    if (args.stop_price !== undefined && args.stop_price <= 0) {
      return {
        summary: `Watchlist ${args.action.toLowerCase()} failed: $${ticker}`,
        data: { success: false, action: args.action, ticker, changed: false, message: "stop_price must be positive." },
        sources: [],
      };
    }

    // Map MEDIUM → NORMAL for DB compat
    const dbPriority = args.priority === "MEDIUM" ? "NORMAL" : args.priority;

    try {
      if (args.action === "ADD") {
        // Universe hard-reject: don't let the agent add an excluded ticker,
        // even if it bypassed the narrative fence. Exclusion wins everywhere.
        if (isExcluded(ticker, { exclusionList: ctx.exclusionList })) {
          const blockedMsg = `$${ticker} is on this analyst's exclusion list — cannot add to watchlist.`;
          return {
            summary: `Watchlist add blocked: $${ticker} — excluded`,
            data: {
              success: false,
              action: "ADD" as const,
              ticker,
              changed: false,
              message: blockedMsg,
              tickers: [{ ticker, tag: "Failed", summary: blockedMsg, actionIcon: "failed" }],
            },
            sources: [],
          };
        }

        const existing = await prisma.analystWatchlistItem.findFirst({
          where: { analystId: ctx.analystId, symbol: ticker, status: "ACTIVE" },
        });

        if (existing) {
          // Re-affirming an existing watchlist item is a positive signal —
          // the analyst still cares. Bump expiresAt to MAX(existing,
          // now + N days) so an item touched daily never silently expires.
          // Explicit expires_in_days wins; otherwise default extension is 30d.
          const extensionDays = args.expires_in_days ?? 30;
          const candidateExpiry = new Date(
            Date.now() + extensionDays * 24 * 60 * 60 * 1000,
          );
          const reExpiresAt =
            existing.expiresAt && existing.expiresAt > candidateExpiry
              ? existing.expiresAt
              : candidateExpiry;
          const updated = await prisma.analystWatchlistItem.update({
            where: { id: existing.id },
            data: {
              reason: args.reason,
              ...(dbPriority ? { priority: dbPriority } : {}),
              ...(args.notes !== undefined ? { notes: args.notes } : {}),
              ...(args.thesis_direction ? { thesisDirection: args.thesis_direction } : {}),
              ...(args.target_price !== undefined ? { targetPrice: args.target_price } : {}),
              ...(args.stop_price !== undefined ? { stopPrice: args.stop_price } : {}),
              ...(args.conviction !== undefined ? { conviction: args.conviction } : {}),
              ...(args.catalyst !== undefined ? { catalyst: args.catalyst } : {}),
              ...(args.trigger_condition !== undefined ? { triggerCondition: args.trigger_condition } : {}),
              ...(args.review_frequency !== undefined ? { reviewFrequency: args.review_frequency } : {}),
              expiresAt: reExpiresAt,
              lastReviewedAt: new Date(),
            },
          });
          const mergedSummary = args.reason || (updated.catalyst ? `Catalyst: ${updated.catalyst}` : "Updated metadata");
          return {
            summary: `Updated $${ticker} on watchlist`,
            data: {
              success: true,
              action: "ADD" as const,
              ticker,
              changed: true,
              watchlist_item: {
                ticker,
                priority: updated.priority as "LOW" | "NORMAL" | "HIGH",
                notes: updated.notes,
                thesis_direction: updated.thesisDirection as "LONG" | "SHORT" | "PASS" | null,
                target_price: updated.targetPrice,
                stop_price: updated.stopPrice,
                conviction: updated.conviction,
                catalyst: updated.catalyst,
                updated_at: updated.updatedAt.toISOString(),
              },
              message: `$${ticker} already on watchlist — merged updated metadata.`,
              tickers: [{ ticker, tag: "Watch", summary: mergedSummary }],
            },
            sources: [],
          };
        }

        // Phase 3 — watchlist items are the carryover mechanism replacing
        // stale-signal residue. Every new entry gets a triggerCondition (what
        // would make this tradeable) and an expiresAt (so dead ideas age out
        // automatically). If the model omits them, derive sensible defaults
        // rather than rejecting the call — but log so we can see how often
        // the model defaults instead of supplying intentional values.
        const derivedTrigger =
          args.trigger_condition ??
          (args.catalyst
            ? `Watch for: ${args.catalyst}`
            : args.target_price
              ? `Price approaches $${args.target_price}`
              : args.stop_price
                ? `Price drops below $${args.stop_price}`
                : "Monitor for setup or new catalyst");

        const expiresInDays = args.expires_in_days ?? 30;
        const expiresAt = new Date(
          Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
        );

        if (!args.trigger_condition) {
          console.log(
            `[tool] manage_watchlist: derived triggerCondition for $${ticker} (model omitted explicit trigger)`,
          );
        }

        const created = await prisma.analystWatchlistItem.create({
          data: {
            analystId: ctx.analystId,
            userId: ctx.userId,
            symbol: ticker,
            reason: args.reason,
            notes: args.notes ?? null,
            addedBy: "AGENT",
            priority: dbPriority ?? "NORMAL",
            status: "ACTIVE",
            thesisDirection: args.thesis_direction ?? null,
            targetPrice: args.target_price ?? null,
            stopPrice: args.stop_price ?? null,
            conviction: args.conviction ?? null,
            catalyst: args.catalyst ?? null,
            triggerCondition: derivedTrigger,
            reviewFrequency: args.review_frequency ?? null,
            expiresAt,
            addedRunId: ctx.runId ?? null,
            lastReviewedAt: new Date(),
          },
        });

        const activeItems = await prisma.analystWatchlistItem.findMany({
          where: { analystId: ctx.analystId, status: "ACTIVE" },
          select: { symbol: true },
        });
        await prisma.agentConfig.update({
          where: { id: ctx.analystId },
          data: { watchlist: activeItems.map((i) => i.symbol) },
        });

        if (ctx.runId) {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "watchlist_add",
              title: `Added $${ticker} to watchlist`,
              message: args.reason,
              payload: { symbol: ticker, priority: dbPriority ?? "NORMAL", reason: args.reason } as object,
            },
          });
        }

        if (ctx.runId && ctx.analystId) {
          try {
            await prisma.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId: ctx.analystId,
                userId: ctx.userId,
                symbol: ticker,
                decision: "WATCH",
                reasoning: args.reason?.slice(0, 500) ?? null,
              },
            });
          } catch (decisionErr) {
            console.warn("[tool] manage_watchlist WATCH decision write failed:", decisionErr);
          }
        }

        try { revalidatePath(`/analysts/${ctx.analystId}`); } catch { /* non-fatal */ }

        const addSummary = args.reason || (args.catalyst ? `Catalyst: ${args.catalyst}` : "Added to watchlist");
        return {
          summary: `Added $${ticker} to watchlist`,
          data: {
            success: true,
            action: "ADD" as const,
            ticker,
            changed: true,
            watchlist_item: {
              ticker,
              priority: created.priority as "LOW" | "NORMAL" | "HIGH",
              notes: created.notes,
              thesis_direction: args.thesis_direction ?? null,
              target_price: args.target_price ?? null,
              stop_price: args.stop_price ?? null,
              conviction: args.conviction ?? null,
              catalyst: args.catalyst ?? null,
              updated_at: created.updatedAt.toISOString(),
            },
            message: `Added $${ticker} to watchlist.`,
            tickers: [{ ticker, tag: "Watch", summary: addSummary }],
          },
          sources: [],
        };
      }

      if (args.action === "REMOVE") {
        const item = await prisma.analystWatchlistItem.findFirst({
          where: { analystId: ctx.analystId, symbol: ticker, status: "ACTIVE" },
        });

        if (!item) {
          return {
            summary: `Watchlist remove: $${ticker} (not present)`,
            data: {
              success: true,
              action: "REMOVE" as const,
              ticker,
              changed: false,
              message: `$${ticker} is not on the watchlist. No action taken.`,
              tickers: [{ ticker, tag: "N/A", summary: `Not on watchlist — no action taken` }],
            },
            sources: [],
          };
        }

        await prisma.analystWatchlistItem.update({
          where: { id: item.id },
          data: { status: "REMOVED", removedAt: new Date(), removeReason: args.reason },
        });

        const activeItems = await prisma.analystWatchlistItem.findMany({
          where: { analystId: ctx.analystId, status: "ACTIVE" },
          select: { symbol: true },
        });
        await prisma.agentConfig.update({
          where: { id: ctx.analystId },
          data: { watchlist: activeItems.map((i) => i.symbol) },
        });

        if (ctx.runId) {
          await prisma.runEvent.create({
            data: {
              runId: ctx.runId,
              type: "watchlist_remove",
              title: `Removed $${ticker} from watchlist`,
              message: args.reason,
              payload: { symbol: ticker, reason: args.reason } as object,
            },
          });
        }

        if (ctx.runId && ctx.analystId) {
          try {
            await prisma.tradeDecision.create({
              data: {
                runId: ctx.runId,
                analystId: ctx.analystId,
                userId: ctx.userId,
                symbol: ticker,
                decision: "REMOVE_WATCH",
                reasoning: args.reason?.slice(0, 500) ?? null,
              },
            });
          } catch (decisionErr) {
            console.warn("[tool] manage_watchlist REMOVE_WATCH decision write failed:", decisionErr);
          }
        }

        try { revalidatePath(`/analysts/${ctx.analystId}`); } catch { /* non-fatal */ }

        return {
          summary: `Removed $${ticker} from watchlist`,
          data: {
            success: true,
            action: "REMOVE" as const,
            ticker,
            changed: true,
            message: `Removed $${ticker} from watchlist.`,
            tickers: [{ ticker, tag: "Unwatch", summary: args.reason || "Removed from watchlist" }],
          },
          sources: [],
        };
      }

      if (args.action === "UPDATE") {
        const item = await prisma.analystWatchlistItem.findFirst({
          where: { analystId: ctx.analystId, symbol: ticker, status: "ACTIVE" },
        });

        if (!item) {
          return {
            summary: `Watchlist update: $${ticker} (not present)`,
            data: {
              success: true,
              action: "UPDATE" as const,
              ticker,
              changed: false,
              message: `$${ticker} is not on the watchlist. No action taken.`,
              tickers: [{ ticker, tag: "N/A", summary: `Not on watchlist — no action taken` }],
            },
            sources: [],
          };
        }

        const updExpiresAt =
          args.expires_in_days !== undefined
            ? new Date(Date.now() + args.expires_in_days * 24 * 60 * 60 * 1000)
            : undefined;
        const updated = await prisma.analystWatchlistItem.update({
          where: { id: item.id },
          data: {
            ...(args.reason ? { reason: args.reason } : {}),
            ...(dbPriority ? { priority: dbPriority } : {}),
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
            ...(args.thesis_direction ? { thesisDirection: args.thesis_direction } : {}),
            ...(args.target_price !== undefined ? { targetPrice: args.target_price } : {}),
            ...(args.stop_price !== undefined ? { stopPrice: args.stop_price } : {}),
            ...(args.conviction !== undefined ? { conviction: args.conviction } : {}),
            ...(args.catalyst !== undefined ? { catalyst: args.catalyst } : {}),
            ...(args.trigger_condition !== undefined ? { triggerCondition: args.trigger_condition } : {}),
            ...(args.review_frequency !== undefined ? { reviewFrequency: args.review_frequency } : {}),
            ...(updExpiresAt ? { expiresAt: updExpiresAt } : {}),
            lastReviewedAt: new Date(),
          },
        });

        try { revalidatePath(`/analysts/${ctx.analystId}`); } catch { /* non-fatal */ }

        const updateSummary = args.reason || (updated.catalyst ? `Catalyst: ${updated.catalyst}` : "Updated watchlist entry");
        return {
          summary: `Updated $${ticker} on watchlist`,
          data: {
            success: true,
            action: "UPDATE" as const,
            ticker,
            changed: true,
            watchlist_item: {
              ticker,
              priority: updated.priority as "LOW" | "NORMAL" | "HIGH",
              notes: updated.notes,
              thesis_direction: updated.thesisDirection as "LONG" | "SHORT" | "PASS" | null,
              target_price: updated.targetPrice,
              stop_price: updated.stopPrice,
              conviction: updated.conviction,
              catalyst: updated.catalyst,
              updated_at: updated.updatedAt.toISOString(),
            },
            message: `Updated $${ticker} watchlist entry.`,
            tickers: [{ ticker, tag: "Watch", summary: updateSummary }],
          },
          sources: [],
        };
      }

      return {
        summary: `Unknown watchlist action: ${args.action}`,
        data: {
          success: false,
          action: args.action as "ADD" | "REMOVE" | "UPDATE",
          ticker,
          changed: false,
          message: `Unknown action: ${args.action}`,
          tickers: [{ ticker, tag: "Failed", summary: `Unknown action: ${args.action}`, actionIcon: "failed" }],
        },
        sources: [],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Watchlist operation failed";
      console.error(`[tool] manage_watchlist FAILED: ${msg}`);
      return {
        summary: `Watchlist ${args.action.toLowerCase()} failed: $${ticker}`,
        data: {
          success: false,
          action: args.action as "ADD" | "REMOVE" | "UPDATE",
          ticker,
          changed: false,
          message: msg,
          tickers: [{ ticker, tag: "Failed", summary: msg, actionIcon: "failed" }],
        },
        sources: [],
      };
    }
  },
});
