import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  placeMarketOrder,
  getOrder,
  getLatestPrice,
  getAllPositions,
  closePosition,
} from "@/lib/alpaca";

export const maxDuration = 120;

const FINNHUB_KEY = process.env.FINNHUB_API_KEY!;

// ── API helper ──────────────────────────────────────────────────────────────

async function finnhub(path: string): Promise<{ data: unknown; error?: string }> {
  const url = `https://finnhub.io/api/v1${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return { data: null, error: `Finnhub ${path.split("?")[0]} returned ${res.status}` };
    return { data: await res.json() };
  } catch (err) {
    return { data: null, error: `Finnhub fetch failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

// ── Technical helpers ───────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10;
}

function calcSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return Math.round((slice.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}

// ── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { messages, runId, analystId } = await req.json();
  console.log(`[followup] POST runId=${runId} messages=${messages?.length ?? 0}`);

  // ── Load run context ──────────────────────────────────────────────────────

  const run = await prisma.researchRun.findFirst({
    where: { id: runId, userId: user.id },
    include: {
      agentConfig: true,
      theses: {
        include: {
          trade: {
            select: {
              id: true, ticker: true, direction: true, status: true,
              entryPrice: true, shares: true, targetPrice: true, stopLoss: true,
              realizedPnl: true, closePrice: true, outcome: true,
            },
          },
        },
      },
    },
  });

  if (!run) return new Response("Run not found", { status: 404 });

  // Build context summary for the system prompt
  const thesesSummary = run.theses.map((t) => {
    const trade = t.trade;
    return `- ${t.direction} ${t.ticker} (confidence: ${t.confidenceScore}%): ${t.reasoningSummary}${
      trade ? ` → Trade ${trade.status}: ${trade.shares} shares @ $${Number(trade.entryPrice).toFixed(2)}` : " → No trade placed"
    }`;
  }).join("\n");

  const tradeSummary = run.theses
    .filter((t) => t.trade)
    .map((t) => {
      const tr = t.trade!;
      return `${tr.direction} ${tr.shares} ${tr.ticker} @ $${Number(tr.entryPrice).toFixed(2)} (target: $${tr.targetPrice ? Number(tr.targetPrice).toFixed(2) : "—"}, stop: $${tr.stopLoss ? Number(tr.stopLoss).toFixed(2) : "—"}) [${tr.status}]`;
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

    place_trade: tool({
      description: "Place a paper trade via Alpaca. Confirm details with the user before calling this.",
      inputSchema: z.object({
        ticker: z.string(),
        direction: z.enum(["LONG", "SHORT"]),
        entry_price: z.number(),
        target_price: z.number(),
        stop_loss: z.number(),
        shares: z.number().describe("Number of shares"),
        thesis_id: z.string().optional().describe("Link to an existing thesis if available"),
      }),
      execute: async (args) => {
        console.log(`[followup] place_trade ${args.ticker} ${args.direction} ${args.shares}sh`);
        try {
          const alpacaOrder = await placeMarketOrder({
            symbol: args.ticker,
            qty: args.shares,
            side: args.direction === "LONG" ? "buy" : "sell",
          });

          // Wait for fill
          let fillPrice = args.entry_price;
          const deadline = Date.now() + 10_000;
          while (Date.now() < deadline) {
            const order = await getOrder(alpacaOrder.id);
            if (order.status === "filled" && order.filled_avg_price) {
              fillPrice = parseFloat(order.filled_avg_price);
              break;
            }
            if (["cancelled", "expired", "rejected"].includes(order.status)) {
              throw new Error(`Order ${order.status}`);
            }
            await new Promise((r) => setTimeout(r, 1_000));
          }
          if (fillPrice === args.entry_price) {
            try { fillPrice = await getLatestPrice(args.ticker); } catch { /* keep entry */ }
          }

          // Find or create a thesis to link
          let thesisId = args.thesis_id;
          if (!thesisId) {
            // Create a minimal thesis for the followup trade
            const thesis = await prisma.thesis.create({
              data: {
                researchRunId: runId,
                userId: user.id,
                ticker: args.ticker,
                direction: args.direction,
                confidenceScore: 70,
                reasoningSummary: `Follow-up trade placed during post-run discussion`,
                thesisBullets: ["Placed via followup chat"],
                riskFlags: [],
                entryPrice: fillPrice,
                targetPrice: args.target_price,
                stopLoss: args.stop_loss,
                holdDuration: "SWING",
                signalTypes: ["FOLLOWUP"],
                sourcesUsed: [],
              },
            });
            thesisId = thesis.id;
          }

          const trade = await prisma.trade.create({
            data: {
              thesisId,
              userId: user.id,
              ticker: args.ticker,
              direction: args.direction,
              status: "OPEN",
              entryPrice: fillPrice,
              shares: args.shares,
              targetPrice: args.target_price,
              stopLoss: args.stop_loss,
              exitStrategy: "PRICE_TARGET",
              alpacaOrderId: alpacaOrder.id,
            },
          });

          await prisma.tradeEvent.create({
            data: {
              tradeId: trade.id,
              eventType: "PLACED",
              description: `${args.direction} ${args.shares} shares of ${args.ticker} at $${fillPrice.toFixed(2)} (followup)`,
              priceAt: fillPrice,
            },
          });

          return {
            ...args,
            status: "filled" as const,
            fill_price: fillPrice,
            trade_id: trade.id,
            alpaca_order_id: alpacaOrder.id,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Trade failed";
          console.error(`[followup] place_trade FAILED: ${msg}`);
          return { ...args, status: "failed" as const, error: msg };
        }
      },
    }),

    close_position: tool({
      description: "Close an open position by selling all shares via Alpaca.",
      inputSchema: tickerSchema,
      execute: async ({ ticker }: { ticker: string }) => {
        console.log(`[followup] close_position ${ticker}`);
        try {
          const order = await closePosition(ticker);

          // Update DB trade record
          const trade = await prisma.trade.findFirst({
            where: { userId: user.id, ticker, status: "OPEN" },
            orderBy: { createdAt: "desc" },
          });

          let closePrice: number | null = null;
          try { closePrice = await getLatestPrice(ticker); } catch { /* ok */ }

          if (trade) {
            const pnl = closePrice
              ? (closePrice - Number(trade.entryPrice)) * trade.shares * (trade.direction === "LONG" ? 1 : -1)
              : null;

            await prisma.trade.update({
              where: { id: trade.id },
              data: {
                status: "CLOSED",
                closedAt: new Date(),
                closePrice,
                closeReason: "MANUAL_CLOSE",
                realizedPnl: pnl,
                outcome: pnl != null ? (pnl >= 0 ? "WIN" : "LOSS") : null,
              },
            });

            await prisma.tradeEvent.create({
              data: {
                tradeId: trade.id,
                eventType: "CLOSED",
                description: `Position closed manually via followup chat`,
                priceAt: closePrice ?? Number(trade.entryPrice),
              },
            });

            return {
              ticker,
              status: "closed" as const,
              close_price: closePrice,
              realized_pnl: pnl,
              shares: trade.shares,
              direction: trade.direction,
              alpaca_order_id: order.id,
            };
          }

          return { ticker, status: "closed" as const, alpaca_order_id: order.id, note: "Position closed on Alpaca" };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Close failed";
          return { ticker, status: "failed" as const, error: msg };
        }
      },
    }),

    portfolio_status: tool({
      description: "Show all open positions with current prices and unrealized P&L.",
      inputSchema: z.object({}),
      execute: async () => {
        console.log(`[followup] portfolio_status`);
        try {
          const positions = await getAllPositions();
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
          trade_placed: !!thesis.trade,
          trade_status: thesis.trade?.status ?? null,
          explanation: thesis.trade
            ? `A ${thesis.direction} trade was placed: ${thesis.trade.shares} shares at $${Number(thesis.trade.entryPrice).toFixed(2)} (confidence: ${thesis.confidenceScore}%). Reasoning: ${thesis.reasoningSummary}`
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
