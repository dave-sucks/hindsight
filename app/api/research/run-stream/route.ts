import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { placeMarketOrder, getOrder, getLatestPrice } from "@/lib/alpaca";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "";
const PYTHON_SERVICE_SECRET = process.env.PYTHON_SERVICE_SECRET ?? "";

/**
 * Poll Alpaca until the order fills or timeout.
 * Falls back to latest market price when market is closed.
 */
async function waitForFill(
  orderId: string,
  symbol: string,
  fallbackPrice: number,
  maxMs = 10_000
): Promise<number> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const order = await getOrder(orderId);
    if (order.status === "filled" && order.filled_avg_price) {
      return parseFloat(order.filled_avg_price);
    }
    if (["cancelled", "expired", "rejected"].includes(order.status)) {
      throw new Error(`Alpaca order ${order.status}`);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  try {
    return await getLatestPrice(symbol);
  } catch {
    return fallbackPrice;
  }
}

type ThesisPayload = {
  ticker: string;
  direction: "LONG" | "SHORT" | "PASS";
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  hold_duration: "DAY" | "SWING" | "POSITION";
  confidence_score: number;
  reasoning_summary: string;
  thesis_bullets: string[];
  risk_flags: string[];
  signal_types: string[];
  sector: string | null;
  sources_used: { type: string; provider: string; title: string }[];
  model_used: string;
};

// Map Python event types → human-readable titles for RunEvent.title
function eventTitle(type: string, data: Record<string, unknown>): string {
  const ticker = (data.ticker as string | undefined) ?? "";
  const company = (data.company as string | undefined) ?? "";
  switch (type) {
    case "scanning":
      return "Scanning market for candidates";
    case "candidates":
      return `Found ${data.count ?? 0} candidates to research`;
    case "analyzing":
      return `Analyzing ${ticker}${company ? ` — ${company}` : ""}`;
    case "data_ready":
      return `Data collected for ${ticker} (${data.sources_count ?? 0} sources)`;
    case "concept":
      return `${ticker}: ${data.direction} signal — ${data.confidence}% confidence`;
    case "thesis_writing":
      return `Writing ${data.direction} thesis for ${ticker}`;
    case "thesis_complete":
      return `Thesis complete for ${ticker}`;
    case "skip":
      return `Passing on ${ticker}`;
    case "ticker_error":
      return `Error processing ${ticker}`;
    case "run_complete":
      return `Run complete — ${data.analyzed ?? 0} analyzed, ${data.recommended ?? 0} recommended`;
    default:
      return type;
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!PYTHON_SERVICE_URL) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Python service not configured" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const body = await req.json();
  const { tickers = [], source = "MANUAL", agentConfigId } = body as {
    tickers: string[];
    source: "AGENT" | "MANUAL";
    agentConfigId?: string;
  };

  // Load agent config
  const agentConfig = agentConfigId
    ? await prisma.agentConfig
        .findFirst({ where: { id: agentConfigId, userId: user.id } })
        .catch(() => null)
    : await prisma.agentConfig
        .findFirst({ where: { userId: user.id, enabled: true } })
        .catch(() => null);

  const agentConfigPayload = agentConfig ?? {
    minConfidence: 70,
    directionBias: "BOTH",
    holdDurations: ["SWING"],
    maxOpenPositions: 5,
    maxPositionSize: 500,
    analystPrompt: null,
    name: "Default",
  };

  // Create ResearchRun upfront (RUNNING status)
  const run = await prisma.researchRun.create({
    data: {
      userId: user.id,
      source,
      status: "RUNNING",
      parameters: agentConfigPayload as object,
      ...(agentConfig ? { agentConfigId: agentConfig.id } : {}),
    },
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send the runId immediately so the client knows where to navigate
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "run_created", run_id: run.id })}\n\n`
        )
      );

      let upstream: Response;
      try {
        upstream = await fetch(`${PYTHON_SERVICE_URL}/research/run-stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Service-Secret": PYTHON_SERVICE_SECRET,
          },
          body: JSON.stringify({
            tickers,
            source,
            agent_config: agentConfigPayload,
          }),
          signal: AbortSignal.timeout(300_000), // 5 min budget for full run
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: `Network error: ${msg}` })}\n\n`
          )
        );
        await prisma.researchRun.update({
          where: { id: run.id },
          data: { status: "FAILED", completedAt: new Date() },
        });
        controller.close();
        return;
      }

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: `Python error ${upstream.status}: ${text}` })}\n\n`
          )
        );
        await prisma.researchRun.update({
          where: { id: run.id },
          data: { status: "FAILED", completedAt: new Date() },
        });
        controller.close();
        return;
      }

      // Stream events from Python, persist each as RunEvent, fan to client
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const minConfidence = (agentConfig?.minConfidence ?? 70) as number;
      const maxPositionSize = (agentConfig?.maxPositionSize ?? 500) as number;

      // Per-ticker thought trace accumulator — stored on each Thesis.thoughtTrace
      const tickerTrace: Record<
        string,
        { type: string; data: object; timestamp_ms: number }[]
      > = {};

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw);
            } catch {
              continue;
            }

            const type = event.type as string;

            // Accumulate per-ticker events for thoughtTrace
            const evTicker = event.ticker as string | undefined;
            if (evTicker) {
              if (!tickerTrace[evTicker]) tickerTrace[evTicker] = [];
              tickerTrace[evTicker].push({
                type,
                data: event as object,
                timestamp_ms: Date.now(),
              });
            }

            // Persist as RunEvent
            const title = eventTitle(type, event);
            await prisma.runEvent.create({
              data: {
                runId: run.id,
                type,
                title,
                message: (event.message as string | undefined) ?? null,
                payload: event as object,
              },
            });

            // On run_complete: persist theses + trades, update run status
            if (type === "run_complete") {
              const theses = (event.theses as ThesisPayload[] | undefined) ?? [];
              for (const thesis of theses) {
                const row = await prisma.thesis.create({
                  data: {
                    researchRunId: run.id,
                    userId: user.id,
                    ticker: thesis.ticker,
                    source,
                    direction: thesis.direction,
                    entryPrice: thesis.entry_price,
                    targetPrice: thesis.target_price,
                    stopLoss: thesis.stop_loss,
                    holdDuration: thesis.hold_duration,
                    confidenceScore: thesis.confidence_score,
                    reasoningSummary: thesis.reasoning_summary,
                    thesisBullets: thesis.thesis_bullets,
                    riskFlags: thesis.risk_flags,
                    signalTypes: thesis.signal_types,
                    sector: thesis.sector,
                    sourcesUsed: thesis.sources_used as object,
                    modelUsed: thesis.model_used,
                    thoughtTrace: (tickerTrace[thesis.ticker] ?? []) as object,
                  },
                });

                if (
                  thesis.direction !== "PASS" &&
                  thesis.confidence_score >= minConfidence &&
                  thesis.entry_price != null
                ) {
                  const shares = Math.max(1, Math.floor(maxPositionSize / thesis.entry_price));

                  // Actually place Alpaca paper order
                  let alpacaOrderId: string | undefined;
                  let fillPrice = thesis.entry_price;
                  try {
                    const order = await placeMarketOrder({
                      symbol: thesis.ticker,
                      qty: shares,
                      side: thesis.direction === "LONG" ? "buy" : "sell",
                    });
                    alpacaOrderId = order.id;
                    fillPrice = await waitForFill(
                      order.id,
                      thesis.ticker,
                      thesis.entry_price
                    );
                  } catch (alpacaErr) {
                    // Log but don't block — create trade as DB-only if Alpaca fails
                    const errMsg = alpacaErr instanceof Error ? alpacaErr.message : String(alpacaErr);
                    controller.enqueue(
                      encoder.encode(
                        `data: ${JSON.stringify({ type: "trade_warning", ticker: thesis.ticker, message: `Alpaca order failed: ${errMsg}. Trade saved as DB-only.` })}\n\n`
                      )
                    );
                  }

                  const trade = await prisma.trade.create({
                    data: {
                      thesisId: row.id,
                      userId: user.id,
                      ticker: thesis.ticker,
                      direction: thesis.direction as "LONG" | "SHORT",
                      status: "OPEN",
                      entryPrice: fillPrice,
                      shares,
                      targetPrice: thesis.target_price,
                      stopLoss: thesis.stop_loss,
                      exitStrategy: thesis.target_price ? "PRICE_TARGET" : "MANUAL",
                      ...(alpacaOrderId ? { alpacaOrderId } : {}),
                    },
                  });
                  await prisma.tradeEvent.create({
                    data: {
                      tradeId: trade.id,
                      eventType: "PLACED",
                      description: alpacaOrderId
                        ? `${thesis.direction} ${thesis.ticker} at $${fillPrice.toFixed(2)} via ${source.toLowerCase()} run`
                        : `Trade placed via ${source.toLowerCase()} run (DB-only, Alpaca unavailable)`,
                      priceAt: fillPrice,
                    },
                  });

                  // Emit trade_placed event so the frontend can show it
                  await prisma.runEvent.create({
                    data: {
                      runId: run.id,
                      type: "trade_placed",
                      title: `${thesis.direction} ${thesis.ticker} — ${shares} shares at $${fillPrice.toFixed(2)}`,
                      message: alpacaOrderId ? `Alpaca order ${alpacaOrderId}` : "DB-only trade",
                      payload: {
                        tradeId: trade.id,
                        ticker: thesis.ticker,
                        direction: thesis.direction,
                        shares,
                        entryPrice: fillPrice,
                        targetPrice: thesis.target_price,
                        stopLoss: thesis.stop_loss,
                        alpacaOrderId: alpacaOrderId ?? null,
                      } as object,
                    },
                  });

                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "trade_placed",
                        run_id: run.id,
                        ticker: thesis.ticker,
                        direction: thesis.direction,
                        shares,
                        entryPrice: fillPrice,
                        targetPrice: thesis.target_price,
                        stopLoss: thesis.stop_loss,
                        alpacaOrderId: alpacaOrderId ?? null,
                      })}\n\n`
                    )
                  );
                }
              }

              await prisma.researchRun.update({
                where: { id: run.id },
                data: { status: "COMPLETE", completedAt: new Date() },
              });
            }

            // Fan event to client (include run_id for reference)
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ ...event, run_id: run.id })}\n\n`
              )
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`
          )
        );
        // Mark run as FAILED if it's still RUNNING (prevents infinite running state)
        try {
          const currentRun = await prisma.researchRun.findUnique({ where: { id: run.id } });
          if (currentRun && currentRun.status === "RUNNING") {
            await prisma.researchRun.update({
              where: { id: run.id },
              data: { status: "FAILED", completedAt: new Date() },
            });
          }
        } catch {
          // Ignore — best effort cleanup
        }
      } finally {
        // Safety net: if run is still RUNNING after stream ends, mark FAILED
        try {
          const currentRun = await prisma.researchRun.findUnique({ where: { id: run.id } });
          if (currentRun && currentRun.status === "RUNNING") {
            await prisma.researchRun.update({
              where: { id: run.id },
              data: { status: "FAILED", completedAt: new Date() },
            });
          }
        } catch {
          // Ignore
        }
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
