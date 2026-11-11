/**
 * load-sale-queue.ts — reads the sales waiting for approval on one book and
 * each one's history (lib/portfolio/sale-queue.ts says what a line holds):
 *   - every sale of the same kind proposed on the position, oldest first;
 *   - the price at the first: the priced line on the stock's thesis nearest
 *     to that proposal (the fire that started it, or the run's note seconds
 *     after), within half an hour before it;
 *   - the thesis verdict in the note the run attached to the waiting proposal
 *     (ThesisUpdate.tradeId);
 *   - with `decision`, for the Portfolio Reviewer: the floor that fired (the
 *     EXIT trigger's TRIGGER_FIRED line just before the proposal, in the words
 *     every surface uses), and that note in full.
 */
import { prisma } from "@/lib/prisma";
import { sentenceOf, shapeOf } from "@/lib/agent/triggers/condition";
import type { WaitingSale } from "@/lib/portfolio/sale-queue";
import type { DigestFacts } from "@/lib/portfolio/digest-facts";
import type { PendingProposalFact } from "@/lib/agent/portfolio-reviewer";

const SALE_INTENTS = ["CLOSE", "PARTIAL_CLOSE"];
const BEFORE_MS = 30 * 60_000;
const AFTER_MS = 5 * 60_000;
/** How far back from a proposal its floor's fire is looked for. */
const FIRE_MS = 2 * 60 * 60_000;

/** A floor's level, when it is a price: "Sell if below $930.60" → 930.6. */
function priceLevel(condition: unknown): number | null {
  const w = shapeOf(condition);
  return w && !("conditions" in w) && w.watch === "price" && w.is === "below" && typeof w.value === "number" ? w.value : null;
}

export async function loadSaleQueue(q: {
  accountId: string;
  environment: string;
  /** The price now, for the move since the first proposal. */
  priceOf: (ticker: string) => number | null;
  /** Also load the floor that fired and the note in full (the Portfolio Reviewer's input). */
  decision?: boolean;
}): Promise<WaitingSale[]> {
  const waiting = await prisma.order.findMany({
    where: { status: "AWAITING_APPROVAL", environment: q.environment, side: "SELL", intent: { in: SALE_INTENTS }, position: { accountId: q.accountId } },
    select: { id: true, symbol: true, intent: true, positionId: true, createdAt: true, thesisId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!waiting.length) return [];
  const [history, notes] = await Promise.all([
    prisma.order.findMany({
      where: { positionId: { in: [...new Set(waiting.map((w) => w.positionId))] }, side: "SELL", intent: { in: SALE_INTENTS } },
      select: { positionId: true, intent: true, createdAt: true, thesisId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.thesisUpdate.findMany({
      where: { tradeId: { in: waiting.map((w) => w.id) } },
      select: { tradeId: true, verdict: true, rationale: true },
      orderBy: { timestamp: "desc" },
    }),
  ]);
  return Promise.all(
    waiting.map(async (w): Promise<WaitingSale> => {
      const same = history.filter((h) => h.positionId === w.positionId && h.intent === w.intent);
      const first = same[0] ?? w;
      const thesisId = first.thesisId ?? w.thesisId;
      const at = first.createdAt.getTime();
      const priced = thesisId
        ? await prisma.thesisUpdate.findMany({
            where: { thesisId, priceAtTime: { not: null }, timestamp: { gte: new Date(at - BEFORE_MS), lte: new Date(at + AFTER_MS) } },
            select: { priceAtTime: true, timestamp: true },
          })
        : [];
      const nearest = [...priced].sort((a, b) => Math.abs(a.timestamp.getTime() - at) - Math.abs(b.timestamp.getTime() - at))[0];
      const then = nearest?.priceAtTime ?? null;
      const now = q.priceOf(w.symbol.toUpperCase());
      const note = notes.find((n) => n.tradeId === w.id) ?? null;
      const fire =
        q.decision && w.thesisId
          ? await prisma.thesisUpdate.findFirst({
              where: { thesisId: w.thesisId, type: "TRIGGER_FIRED", triggerAction: "EXIT", timestamp: { gte: new Date(w.createdAt.getTime() - FIRE_MS), lte: w.createdAt } },
              orderBy: { timestamp: "desc" },
              select: { triggerCondition: true, priceAtTime: true, timestamp: true },
            })
          : null;
      return {
        ticker: w.symbol.toUpperCase(),
        kind: w.intent === "PARTIAL_CLOSE" ? "trim" : "sell",
        times: Math.max(1, same.length),
        firstAt: first.createdAt.toISOString(),
        movePct: then && now ? (now / then - 1) * 100 : null,
        verdict: notes.find((n) => n.tradeId === w.id && n.verdict)?.verdict ?? null,
        ...(q.decision
          ? {
              decision: {
                floor: fire ? sentenceOf({ action: "EXIT", predicate: fire.triggerCondition }) : null,
                level: fire ? priceLevel(fire.triggerCondition) : null,
                firedAt: (fire?.timestamp ?? w.createdAt).toISOString(),
                firedPrice: fire?.priceAtTime ?? null,
                note: note?.rationale?.trim() || null,
              },
            }
          : {}),
      };
    }),
  );
}

/**
 * What the Portfolio Reviewer reads as waiting on one book: every proposal
 * awaiting approval, and each sale as the owner's decision, priced at the
 * facts' own prices. The 8 PM job and scripts/portfolio-review-dry-run.ts both read it here.
 */
export async function loadWaitingForReview(q: { accountId: string; environment: string; facts: DigestFacts }): Promise<{ pending: PendingProposalFact[]; sales: WaitingSale[] }> {
  const pending = (
    await prisma.order.findMany({
      where: { status: "AWAITING_APPROVAL", environment: q.environment, position: { accountId: q.accountId } },
      select: { symbol: true, side: true, intent: true, quantity: true, position: { select: { analyst: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    })
  ).map((o) => ({ ticker: o.symbol, side: o.side, intent: o.intent, quantity: o.quantity, analystName: o.position?.analyst?.name ?? null }));
  const held = new Map((q.facts.book?.held ?? []).map((h) => [h.ticker.toUpperCase(), h.currentPrice]));
  const sales = await loadSaleQueue({ accountId: q.accountId, environment: q.environment, priceOf: (t) => held.get(t) ?? null, decision: true }).catch((err) => {
    console.warn(`[portfolio-reviewer] the sale queue couldn't be read for ${q.accountId}::${q.environment}:`, err instanceof Error ? err.message : err);
    return [];
  });
  return { pending, sales };
}
