import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAllPositions } from "@/lib/alpaca";
import { resolveAlpacaCredentials } from "@/lib/actions/api-keys.actions";
import { finnhub, calcRSI, calcSMA } from "@/lib/agent/research-helpers";
import { createResearchTools } from "@/lib/agent/tools";

export const maxDuration = 120;

// ── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Resolve per-user Alpaca credentials
  const alpacaCreds = await resolveAlpacaCredentials(user.id) ?? undefined;

  const { messages, runId } = await req.json();
  console.log(`[followup] POST runId=${runId} messages=${messages?.length ?? 0}`);

  // ── Load run context ──────────────────────────────────────────────────────

  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId: user.id },
    include: {
      agentConfig: true,
      theses: {
        include: {
          decisions: {
            take: 1,
            include: {
              position: {
                select: {
                  id: true, symbol: true, direction: true, status: true,
                  avgCost: true, quantity: true, targetPrice: true, stopLoss: true,
                  realizedPnl: true, closePrice: true, outcome: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!run) return new Response("Run not found", { status: 404 });

  // Real place_trade / close_position from the shared tool registry
  const { place_trade, close_position } = createResearchTools({
    runId,
    userId: user.id,
    analystId: run.agentConfig?.id,
    alpacaCreds,
  });

  // Build context summary for the system prompt
  const thesesSummary = run.theses.map((t) => {
    const pos = t.decisions[0]?.position;
    return `- ${t.direction} ${t.ticker} (confidence: ${t.confidenceScore}%): ${t.reasoningSummary}${
      pos ? ` → Position ${pos.status}: ${pos.quantity} shares @ $${Number(pos.avgCost).toFixed(2)}` : " → No trade placed"
    }`;
  }).join("\n");

  const tradeSummary = run.theses
    .filter((t) => t.decisions[0]?.position)
    .map((t) => {
      const pos = t.decisions[0]!.position!;
      return `${pos.direction} ${pos.quantity} ${pos.symbol} @ $${Number(pos.avgCost).toFixed(2)} (target: $${pos.targetPrice ? Number(pos.targetPrice).toFixed(2) : "—"}, stop: $${pos.stopLoss ? Number(pos.stopLoss).toFixed(2) : "—"}) [${pos.status}]`;
    }).join("\n");

  const analystName = run.agentConfig?.name ?? "Agent";

  const systemPrompt = `You are a trading assistant for the "${analystName}" analyst. The user just completed a research run and may want to:
- Ask follow-up questions about the run's findings
- Place additional trades based on the research
- Close or modify existing positions
- Research new tickers that came up during the run
- Understand why certain decisions were made

## Run Context
${thesesSummary || "No theses generated in this run."}

## Trades Placed
${tradeSummary || "No trades placed in this run."}

## Guidelines
- Be conversational and helpful — this is a discussion, not an autonomous run
- When asked to research a ticker, provide comprehensive data
- When asked to place trades, confirm the details before executing
- When explaining decisions, reference specific data points from the run
- Use tabular-nums formatting for numbers
- Keep responses concise but informative`;

  // ── Followup tools ────────────────────────────────────────────────────────

  const tickerSchema = z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
  });

  const tools = {
    research_ticker: tool({
      description: "Get comprehensive stock data + technical analysis for a ticker. Use when the user asks about a specific stock.",
      inputSchema: tickerSchema,
      execute: async ({ ticker }: { ticker: string }) => {
        console.log(`[followup] research_ticker ${ticker}`);
        const now = Math.floor(Date.now() / 1000);
        const from = now - 90 * 86400;

        const [quoteResult, profileResult, financialsResult, candleResult] = await Promise.all([
          finnhub(`/quote?symbol=${ticker}`),
          finnhub(`/stock/profile2?symbol=${ticker}`),
          finnhub(`/stock/metric?symbol=${ticker}&metric=all`),
          finnhub(`/stock/candle?symbol=${ticker}&resolution=D&from=${from}&to=${now}`),
        ]);

        const quote = quoteResult.data as Record<string, number> | null;
        const profile = profileResult.data as Record<string, unknown> | null;
        const financials = (financialsResult.data as { metric?: Record<string, unknown> })?.metric;
        const candles = candleResult.data as { s?: string; c?: number[]; v?: number[] } | null;

        // Technical analysis
        let technicals: Record<string, unknown> = {};
        if (candles?.s === "ok" && candles.c?.length) {
          const closes = candles.c;
          const volumes = candles.v ?? [];
          technicals = {
            rsi_14: calcRSI(closes),
            sma_20: calcSMA(closes, 20),
            sma_50: calcSMA(closes, 50),
            avg_volume: volumes.length > 0
              ? Math.round(volumes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(10, volumes.length))
              : null,
            price_vs_sma20: closes.length >= 20
              ? ((closes[closes.length - 1] / calcSMA(closes, 20)! - 1) * 100).toFixed(2) + "%"
              : null,
          };
        }

        return {
          ticker,
          quote: quote?.c ? {
            price: quote.c, change: quote.d, change_pct: quote.dp,
            high: quote.h, low: quote.l, prev_close: quote.pc,
          } : null,
          company: profile?.name ? {
            name: profile.name, sector: profile.finnhubIndustry,
            market_cap: profile.marketCapitalization ? (profile.marketCapitalization as number) * 1_000_000 : null,
            exchange: profile.exchange,
          } : null,
          financials: financials ? {
            pe_ratio: financials.peNormalizedAnnual,
            high_52w: financials["52WeekHigh"],
            low_52w: financials["52WeekLow"],
            beta: financials.beta,
          } : null,
          technicals,
          _sources: [
            { provider: "Finnhub", title: `${ticker} Quote`, url: "https://finnhub.io/docs/api/quote" },
            { provider: "Finnhub", title: `${ticker} Profile`, url: "https://finnhub.io/docs/api/company-profile2" },
          ],
        };
      },
    }),

    place_trade,

    close_position,

    portfolio_status: tool({
      description: "Show all open positions with current prices and unrealized P&L.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log(`[followup] portfolio_status`);
        try {
          const positions = await getAllPositions(alpacaCreds);
          return {
            positions: positions.map((p) => ({
              ticker: p.symbol,
              side: p.side,
              shares: Number(p.qty),
              avg_entry: Number(p.avg_entry_price),
              current_price: Number(p.current_price),
              market_value: Number(p.market_value),
              unrealized_pnl: Number(p.unrealized_pl),
              unrealized_pnl_pct: (Number(p.unrealized_plpc) * 100).toFixed(2) + "%",
            })),
            total_positions: positions.length,
            total_unrealized_pnl: positions.reduce((s, p) => s + Number(p.unrealized_pl), 0),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : "Failed to fetch positions" };
        }
      },
    }),

    compare_tickers: tool({
      description: "Compare 2-3 tickers side by side with price, technicals, and fundamentals.",
      inputSchema: z.object({
        tickers: z.array(z.string()).min(2).max(3).describe("Tickers to compare"),
      }),
      execute: async ({ tickers }: { tickers: string[] }) => {
        console.log(`[followup] compare_tickers ${tickers.join(",")}`);
        const comparisons = await Promise.all(
          tickers.map(async (ticker) => {
            const [quoteResult, profileResult, financialsResult] = await Promise.all([
              finnhub(`/quote?symbol=${ticker}`),
              finnhub(`/stock/profile2?symbol=${ticker}`),
              finnhub(`/stock/metric?symbol=${ticker}&metric=all`),
            ]);

            const quote = quoteResult.data as Record<string, number> | null;
            const profile = profileResult.data as Record<string, unknown> | null;
            const financials = (financialsResult.data as { metric?: Record<string, unknown> })?.metric;

            return {
              ticker,
              price: quote?.c ?? null,
              change_pct: quote?.dp ?? null,
              name: (profile?.name as string) ?? null,
              sector: (profile?.finnhubIndustry as string) ?? null,
              market_cap: profile?.marketCapitalization
                ? (profile.marketCapitalization as number) * 1_000_000
                : null,
              pe_ratio: (financials?.peNormalizedAnnual as number) ?? null,
              high_52w: (financials?.["52WeekHigh"] as number) ?? null,
              low_52w: (financials?.["52WeekLow"] as number) ?? null,
              beta: (financials?.beta as number) ?? null,
            };
          })
        );

        return { comparisons, _sources: [{ provider: "Finnhub", title: "Stock Comparison" }] };
      },
    }),

    explain_decision: tool({
      description: "Explain why a specific trade was or wasn't placed during the run. References the run's theses and reasoning.",
      inputSchema: tickerSchema,
      execute: async ({ ticker }: { ticker: string }) => {
        console.log(`[followup] explain_decision ${ticker}`);
        const thesis = run.theses.find(
          (t) => t.ticker.toUpperCase() === ticker.toUpperCase()
        );

        if (!thesis) {
          return {
            ticker,
            explanation: `${ticker} was not researched during this run. It may not have appeared in the scan results, or the analyst chose to focus on other candidates.`,
            researched: false,
          };
        }

        return {
          ticker,
          researched: true,
          direction: thesis.direction,
          confidence: thesis.confidenceScore,
          reasoning: thesis.reasoningSummary,
          bullets: thesis.thesisBullets,
          risk_flags: thesis.riskFlags,
          trade_placed: !!thesis.decisions[0]?.position,
          trade_status: thesis.decisions[0]?.position?.status ?? null,
          explanation: thesis.decisions[0]?.position
            ? `A ${thesis.direction} trade was placed: ${thesis.decisions[0].position.quantity} shares at $${Number(thesis.decisions[0].position.avgCost).toFixed(2)} (confidence: ${thesis.confidenceScore}%). Reasoning: ${thesis.reasoningSummary}`
            : `${ticker} was analyzed (${thesis.direction}, ${thesis.confidenceScore}% confidence) but no trade was placed. Reasoning: ${thesis.reasoningSummary}`,
        };
      },
    }),
  };

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: openai("gpt-4o"),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(10),
  });

  return result.toUIMessageStreamResponse();
}
