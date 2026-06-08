/**
 * GET /api/dev/preview-email
 *
 * Renders the unified trade-email samples directly to the browser instead
 * of sending. Useful for spot-checking the template after a redesign —
 * faster than waiting for Resend and doesn't pollute the inbox.
 *
 *   /api/dev/preview-email              → index page linking to each variant
 *   /api/dev/preview-email?kind=<key>   → that variant's full HTML
 *
 * Auth-gated to a logged-in Supabase session, same as the test-email sender.
 */

import { createClient } from "@/lib/supabase/server";
import { tradeOpenedHtml } from "@/lib/emails/trade-opened";
import { tradeClosedHtml } from "@/lib/emails/trade-closed";
import { proposalPendingHtml } from "@/lib/emails/proposal-pending";
import { dailyRunDigestHtml } from "@/lib/emails/daily-run-digest";

type PreviewKind =
  | "trade-opened"
  | "trade-closed"
  | "proposal-buy"
  | "proposal-sell"
  | "daily-digest";

const KINDS: Array<{ key: PreviewKind; label: string; description: string }> = [
  {
    key: "trade-opened",
    label: "Trade opened",
    description: "Post-fill buy. Bought 10 NVDA on the AI Infrastructure Analyst (Paper).",
  },
  {
    key: "trade-closed",
    label: "Trade closed",
    description: "Post-exit sell with realized gain. Sold 25 AAPL +8.4% (Paper).",
  },
  {
    key: "proposal-buy",
    label: "Proposal — buy",
    description: "LIVE buy proposal awaiting approval. 38 LNTH from Catalyst Event PM.",
  },
  {
    key: "proposal-sell",
    label: "Proposal — sell",
    description: "Paper close proposal with projected gain. 53 MRVL from Momentum Breakout.",
  },
  {
    key: "daily-digest",
    label: "Daily run digest",
    description: "Morning summary across analysts. Only analysts that took actions appear.",
  },
];

function renderSample(kind: PreviewKind): string {
  const now = new Date();
  const twelveDaysAgo = new Date(now.getTime() - 12 * 86_400_000);
  const nineDaysAgo = new Date(now.getTime() - 9 * 86_400_000);
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  switch (kind) {
    case "trade-opened":
      return tradeOpenedHtml({
        ticker: "NVDA",
        tickerName: "NVIDIA Corp.",
        direction: "LONG",
        qty: 10,
        avgCost: 875.4,
        currentPrice: 881.12,
        stopLoss: 840,
        targetPrice: 950,
        analystName: "AI Infrastructure Analyst",
        thesisSummary:
          "AI compute demand remains structural — recent guide-raise reaffirms our long bias through the next earnings cycle.",
        environment: "PAPER",
        positionId: "preview-position-id",
        openedAt: now,
      });
    case "trade-closed":
      return tradeClosedHtml({
        ticker: "AAPL",
        tickerName: "Apple Inc.",
        direction: "LONG",
        qty: 25,
        entryPrice: 178.2,
        closePrice: 193.21,
        currentPrice: 193.21,
        realizedPnl: 375.25,
        realizedPnlPct: 8.4,
        outcome: "WIN",
        closeReason: "TARGET",
        daysHeld: 12,
        tradeId: "preview-position-id",
        analystName: "Catalyst Event PM",
        environment: "PAPER",
        openedAt: twelveDaysAgo,
        closedAt: now,
      });
    case "proposal-buy":
      return proposalPendingHtml({
        analystName: "Catalyst Event PM",
        ticker: "LNTH",
        tickerName: "Lantheus Holdings",
        direction: "LONG",
        intent: "OPEN",
        qty: 38,
        estimatedPrice: 102.84,
        estimatedCost: 38 * 102.84,
        currentPrice: 102.84,
        targetPrice: 118,
        stopLoss: 95.5,
        expiresAt,
        rationale:
          "ENTER trigger validated: live $LNTH quote still holds above the $102.82 breakout level at ~$102.84, trend remains bullish above the 20/50-day SMAs, and there are no contradictory recent headlines in the feed. June 29 FDA PDUFA setup remains intact with the Goldman health thesis confirmed.",
        environment: "LIVE",
        positionId: "preview-proposal-id",
      });
    case "proposal-sell":
      return proposalPendingHtml({
        analystName: "Momentum Breakout",
        ticker: "MRVL",
        tickerName: "Marvell Technology",
        direction: "LONG",
        intent: "CLOSE",
        qty: 53,
        estimatedPrice: 286.07,
        estimatedCost: 53 * 286.07,
        entryPrice: 217.6,
        currentPrice: 286.07,
        openedAt: nineDaysAgo,
        expiresAt,
        rationale:
          "TARGET trigger fired: $MRVL is +31.5% from entry and breached the $285 level on heavy volume. Recommending exit before the upcoming earnings print to lock in the move.",
        environment: "PAPER",
        positionId: "preview-proposal-id",
      });
    case "daily-digest":
      return dailyRunDigestHtml({
        date: now.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
        analysts: [
          {
            analystName: "AI Infrastructure Analyst",
            actions: [
              {
                ticker: "NVDA",
                kind: "BOUGHT",
                description: "10 @ $875.40 · $8,754 · stop $840 · target $950",
              },
              {
                ticker: "AMD",
                kind: "ADDED",
                description: "Scaled in · 30 shares now @ avg $142.50",
              },
            ],
          },
          {
            analystName: "Catalyst Event PM",
            actions: [
              {
                ticker: "AAPL",
                kind: "SOLD",
                description: "WIN · +8.4% · 25 @ $193.21",
              },
              {
                ticker: "LNTH",
                kind: "WATCH",
                description: "Added to watchlist · target $118 · FDA PDUFA Jun 29",
              },
            ],
          },
          // Intentionally empty — proves the renderer filters this out.
          { analystName: "Quiet Analyst", actions: [] },
        ],
      });
  }
}

function indexHtml(): string {
  const items = KINDS.map(
    (k) => `<li style="margin:0 0 12px;">
      <a href="?kind=${k.key}" style="font-size:15px;font-weight:600;color:#0f172a;text-decoration:none;">${k.label}</a>
      <div style="margin-top:2px;font-size:13px;color:#64748b;">${k.description}</div>
    </li>`,
  ).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Email preview — Hindsight</title></head>
<body style="margin:0;padding:48px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;">
  <div style="max-width:520px;margin:0 auto;">
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;letter-spacing:-0.01em;">Trade email preview</h1>
    <p style="margin:0 0 24px;font-size:13px;color:#64748b;">Pick a variant to render in this tab. These don't send.</p>
    <ul style="list-style:none;padding:0;margin:0;">${items}</ul>
  </div>
</body></html>`;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const kindParam = url.searchParams.get("kind");
  if (!kindParam) {
    return new Response(indexHtml(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (!KINDS.some((k) => k.key === kindParam)) {
    return new Response(`Unknown kind: ${kindParam}`, { status: 400 });
  }
  const html = renderSample(kindParam as PreviewKind);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
