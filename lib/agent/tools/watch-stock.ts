/**
 * watch_stock — the chat's soft watch: a stock the owner wants back at a
 * price, after its next report or after an event, with no view yet. It goes
 * on watch with no view and no playbook, for the pinned analyst or the one
 * named, stamped as the owner's add (mintWatch, the watchlist's own path),
 * with its one look-again review written by code, as an agent's trigger (the
 * save's op, the source record_thesis gave the chat's wake), so later edits
 * go through edit_triggers. An event's date is saved as the stock's event
 * date and the review is the day after it, as the Writer's look-again is
 * (lookAgainTrigger). A stock with a live thesis is refused, by name.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import type { ToolContext } from "@/lib/agent/tool-context";
import { prisma } from "@/lib/prisma";
import { mintWatch } from "@/lib/thesis/mint-watch";
import { getLiveQuote } from "@/lib/market-data/live-quote";
import { applyTriggerOps } from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";
import { LOOK_AFTER_EVENT, LOOK_AFTER_REPORT } from "@/lib/agent/thesis-research/decision";

const LIVE = ["HOLDING", "WATCHING", "PROMOTED"] as const;
const namesAnalyst = (ctx: ToolContext) => !ctx.analystId;
const refused = (summary: string, note: string, extra: Record<string, unknown> = {}) => ({ summary, data: { status: "FAILED" as const, note, ...extra }, sources: [] });

export const watchStock = defineTool({
  description:
    "Puts a stock on watch with no view yet, for one you want back at a price, after its next report or after an event; code writes its one look-again review. " +
    "A stock you have a view on goes to the Writer (dispatch_thesis_research); one you looked at and won't trade is pass_on_stock.",
  schema: z.object({
    ticker: z.string().describe("The stock, e.g. NVDA."),
    reason: z.string().min(10).describe("Why you want it back, in your own words: the note at the top of its page."),
    look_again_price: z.number().optional().describe("Look again when the stock reaches this price."),
    look_again_after_next_report: z.boolean().optional().describe("Look again the day after the stock's next report."),
    look_again_event_date: z
      .string()
      .optional()
      .describe("The date of the event you're waiting for (YYYY-MM-DD: an FDA decision, a lockup, a deal's vote): saved as the stock's event date, and it's looked at again the day after."),
    why: z.string().min(10).describe("Why look again then, in one sentence, with the price, the report or the event in it. Give exactly one look-again: the price, the next report or the event's date."),
    analyst_id: z.string().describe("The analyst whose watch it goes on, by its id (list_analysts)."),
  }),
  // Pinned, it is the pinned analyst's; the chat with no analyst pinned names one.
  schemaFor: (ctx, schema) => (namesAnalyst(ctx) ? schema : schema.omit({ analyst_id: true })),
  ui: "tool-ui" as const,
  groupId: "thesis",
  progressLabel: ({ ticker }) => `Watching $${String(ticker).toUpperCase()}`,

  execute: async (args, ctx) => {
    const T = args.ticker.toUpperCase();
    const price = args.look_again_price;
    const report = args.look_again_after_next_report === true;
    const day = args.look_again_event_date?.trim();
    if ([price != null, report, !!day].filter(Boolean).length !== 1) {
      return refused(
        `Not watched: name one look-again for $${T}.`,
        "Give exactly one of look_again_price, look_again_after_next_report or look_again_event_date. For a plain date with no event, put it on watch at a price, then add a review clock with edit_triggers.",
      );
    }

    const analystId = ctx.analystId ?? args.analyst_id;
    const analyst = await prisma.agentConfig.findFirst({ where: { id: analystId ?? "", accountId: ctx.accountId }, select: { id: true, name: true } });
    if (!analyst) return refused(`Not watched: no analyst ${analystId} on this account.`, "Name the analyst by its id (list_analysts).");
    const live = await prisma.thesis.findFirst({
      where: { ticker: T, status: { in: [...LIVE] }, researchRun: { agentConfigId: analyst.id } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, direction: true },
    });
    if (live) {
      const what = live.status === "HOLDING" ? "holds it" : live.direction ? `has a ${live.direction} view on it (${live.status})` : "watches it already";
      return refused(`Not watched: ${analyst.name} ${what}.`, `${analyst.name} ${what}: thesis ${live.id}. Change that one (edit_triggers for its look-again).`, { thesis_id: live.id });
    }

    // The one review: a price, below or above today's by which side it sits on; the day after the next report; or the day after the event.
    let predicate: Trigger["predicate"];
    let catalystDate: Date | undefined;
    if (price != null) {
      const now = (await getLiveQuote(T, { caller: "other", creds: ctx.alpacaCreds })).quote?.c ?? null;
      if (now == null) return refused(`Not watched: no price for $${T}.`, "There is no live price to tell which side of it the stock is: try again, or give the next report or the event's date.");
      predicate = { watch: "price", is: price < now ? "below" : "above", value: price } as Trigger["predicate"];
    } else if (report) {
      predicate = { ...LOOK_AFTER_REPORT } as Trigger["predicate"];
    } else {
      const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      const days = Math.round((Date.parse(day!) - Date.parse(todayEt)) / 86_400_000);
      if (!(days >= 0 && days <= 365)) return refused(`Not watched: ${day} is out of reach.`, "Give the event's date, today to 365 days from today (YYYY-MM-DD).");
      catalystDate = new Date(`${day}T00:00:00.000Z`);
      predicate = { ...LOOK_AFTER_EVENT } as Trigger["predicate"];
    }
    const review = applyTriggerOps({
      stored: [],
      ops: [{ op: "add", trigger: { id: randomUUID(), action: "REVIEW", predicate, rationale: args.why.trim() } as Trigger }],
      direction: null,
      status: "WATCHING",
      actor: "AGENT",
      mintId: () => randomUUID(),
    });
    const refusedOp = review.results.find((r) => !r.ok);
    if (refusedOp || !review.triggers.length) return refused(`Not watched: the look-again for $${T} was refused.`, refusedOp?.reason ?? "The review couldn't be written.");

    const thesis = await mintWatch({
      analystId: analyst.id,
      userId: ctx.userId,
      accountId: ctx.accountId ?? "",
      ticker: T,
      reason: args.reason.trim(),
      sourceKind: "USER_ADDED",
      triggers: review.triggers as unknown as object[],
      catalystDate,
      summary: `Added ${T} to watchlist (no view yet)`,
    });
    const said = review.results[0]?.text ?? "a review";
    return {
      summary: `Watching $${T} for ${analyst.name}, no view yet: ${said}.`,
      data: {
        status: "WATCHING" as const,
        thesis_id: thesis.id,
        ticker: T,
        items: [{ kind: "ticker" as const, ticker: T, text: `On ${analyst.name}'s watch, no view yet. ${said}.` }],
      },
      sources: [],
    };
  },
});
