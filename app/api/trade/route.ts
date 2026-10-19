/**
 * The Trade button.
 *
 *   GET  /api/trade?ticker=MU   → the ticket: price, environment, and each
 *                                 analyst's side in the stock (what it holds,
 *                                 what a buy would do)
 *   POST /api/trade             → place it. Body: { ticker, analystId, side,
 *                                 shares, reviewedPrice, environment,
 *                                 targetPrice?, stopLoss? }
 *
 * See lib/trading/manual-order.ts — a manual order is a proposal approved on
 * the spot, so it is sent by the same code as every approved proposal.
 */

import { createClient } from "@/lib/supabase/server";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import { getTradeTicket, placeManualOrder } from "@/lib/trading/manual-order";

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: new Response("Unauthorized", { status: 401 }) };
  const accountId = await getAccountId(user.id);
  if (!accountId) return { error: new Response("No account", { status: 403 }) };
  return { userId: user.id, accountId };
}

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export async function GET(req: Request) {
  const who = await caller();
  if ("error" in who) return who.error;
  const ticker = new URL(req.url).searchParams.get("ticker")?.toUpperCase() ?? "";
  if (!TICKER.test(ticker)) return new Response("Bad ticker", { status: 400 });
  const environment = await getCurrentEnvironment();
  return Response.json(await getTradeTicket({ ...who, ticker, environment }));
}

export async function POST(req: Request) {
  const who = await caller();
  if ("error" in who) return who.error;
  const role = await getUserRole(who.userId, who.accountId);
  if (role === "VIEWER") return new Response("Forbidden", { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const ticker = typeof body.ticker === "string" ? body.ticker.toUpperCase() : "";
  const analystId = typeof body.analystId === "string" ? body.analystId : "";
  const side = body.side === "BUY" || body.side === "SELL" ? body.side : null;
  const shares = num(body.shares);
  const reviewedPrice = num(body.reviewedPrice);
  if (!TICKER.test(ticker) || !analystId || !side || shares == null || reviewedPrice == null) {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  // The account the review screen named. Switching Paper/Live in another tab
  // between the review and the click must not send the order to the other one.
  const environment = await getCurrentEnvironment();
  if (body.environment !== environment) {
    return Response.json(
      { ok: false, error: `You reviewed this on ${body.environment === "LIVE" ? "Live" : "Paper"}, but the app is now on ${environment === "LIVE" ? "Live" : "Paper"}. Review it again.` },
      { status: 409 },
    );
  }
  const result = await placeManualOrder({
    ...who,
    environment,
    ticker,
    analystId,
    order: {
      side,
      shares,
      reviewedPrice,
      targetPrice: num(body.targetPrice),
      stopLoss: num(body.stopLoss),
    },
  });
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
