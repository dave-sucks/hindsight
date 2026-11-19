/**
 * watch_stock — the chat's soft watch: a stock the owner wants back at a
 * price or on a day, with no view yet. It goes on watch with no view and no
 * playbook, for the pinned analyst or the one named, stamped as the owner's
 * add (mintWatch, the watchlist's own path), with its one look-again review
 * written by code from a price or a day, as an agent's trigger (the save's
 * op, the source record_thesis gave the chat's wake), so later edits go
 * through edit_triggers. A stock with a live thesis is refused, by name.
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

const LIVE = ["HOLDING", "WATCHING", "PROMOTED"] as const;
const namesAnalyst = (ctx: ToolContext) => !ctx.analystId;
const refused = (summary: string, note: string, extra: Record<string, unknown> = {}) => ({ summary, data: { status: "FAILED" as const, note, ...extra }, sources: [] });

export const watchStock = defineTool({
  description:
    "Puts a stock on watch with no view yet, for one you want back at a price or on a day; code writes its one look-again review. " +
    "A stock you have a view on goes to the Writer (dispatch_thesis_research); one you looked at and won't trade is pass_on_stock.",
  schema: z.object({
    ticker: z.string().describe("The stock, e.g. NVDA."),
    reason: z.string().min(10).describe("Why you want it back, in your own words: the note at the top of its page."),
    look_again_price: z.number().optional().describe("Look again when the stock reaches this price. Give this or look_again_date."),
    look_again_date: z.string().optional().describe("Look again on this day (YYYY-MM-DD), and every as many days after. Give this or look_again_price."),
    why: z.string().min(10).describe("Why look again there, in one sentence, with the price or the day in it."),
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
    const day = args.look_again_date?.trim();
    if ((price == null) === !day) return refused(`Not watched: name one look-again for $${T}.`, "Give exactly one of look_again_price or look_again_date: the price or the day you'd look at it again.");

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

    // The one review: a price, below or above today's by which side it sits on; or a day, as a review every that many days.
    let predicate: Trigger["predicate"];
    if (price != null) {
      const now = (await getLiveQuote(T, { caller: "other", creds: ctx.alpacaCreds })).quote?.c ?? null;
      if (now == null) return refused(`Not watched: no price for $${T}.`, "There is no live price to tell which side of it the stock is: try again, or give look_again_date.");
      predicate = { watch: "price", is: price < now ? "below" : "above", value: price } as Trigger["predicate"];
    } else {
      const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      const days = Math.round((Date.parse(day!) - Date.parse(todayEt)) / 86_400_000);
      if (!(days >= 1 && days <= 365)) return refused(`Not watched: ${day} is out of reach.`, "Give a day 1 to 365 days from today (YYYY-MM-DD).");
      predicate = { watch: "repeat", value: days } as Trigger["predicate"];
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
