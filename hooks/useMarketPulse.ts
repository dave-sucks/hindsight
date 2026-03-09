"use client";

import { useEffect, useState, useRef, useCallback } from "react";

export interface TickerQuote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  flash?: "up" | "down" | null;
}

const BASE_TICKERS = ["SPY", "QQQ", "IWM", "BTC-USD"];
const POLL_INTERVAL_MS = 30_000;
const FLASH_DURATION_MS = 400;

// Finnhub uses different symbol format for crypto
function toFinnhubSymbol(symbol: string): string {
  if (symbol === "BTC-USD") return "BINANCE:BTCUSDT";
  if (symbol === "ETH-USD") return "BINANCE:ETHUSDT";
  return symbol;
}

/**
 * DAV-44: Live market quotes via Finnhub WebSocket.
 * Falls back to polling /api/quotes every 30s when WS unavailable.
 *
 * ⚠️ Requires NEXT_PUBLIC_FINNHUB_API_KEY in .env.local
 *   (same value as your existing FINNHUB_API_KEY)
 */
export function useMarketPulse(openTradeTickers: string[] = []) {
  const [quotes, setQuotes] = useState<Record<string, TickerQuote>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isWsAlive = useRef(false);

  const allTickers = [...new Set([...BASE_TICKERS, ...openTradeTickers])];
  const finnhubSymbols = allTickers.map(toFinnhubSymbol);
  const tickersKey = allTickers.join(",");

  // Update a quote with flash animation
  const updateQuote = useCallback(
    (symbol: string, price: number, changePct: number, change: number) => {
      setQuotes((prev) => {
        const existing = prev[symbol];
        const flash: "up" | "down" | null =
          existing?.price != null
            ? price > existing.price
              ? "up"
              : price < existing.price
                ? "down"
                : null
            : null;

        return {
          ...prev,
          [symbol]: { symbol, price, changePct, change, flash },
        };
      });

      if (flash !== null) {
        setTimeout(() => {
          setQuotes((prev) =>
            prev[symbol] ? { ...prev, [symbol]: { ...prev[symbol], flash: null } } : prev
          );
        }, FLASH_DURATION_MS);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // REST polling fallback
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return; // already polling

    const poll = async () => {
      try {
        const res = await fetch(`/api/quotes?symbols=${allTickers.join(",")}`);
        const data = await res.json();
        if (data.quotes) {
          data.quotes.forEach((q: { symbol: string; price: number; changePct: number; change: number }) => {
            updateQuote(q.symbol, q.price, q.changePct, q.change);
          });
        }
      } catch {
        // silently fail — show stale data
      }
    };

    poll(); // immediate first fetch
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [allTickers, updateQuote]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;

    if (!apiKey) {
      // No WS key available — fall back to polling
      startPolling();
      return () => stopPolling();
    }

    const ws = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);
    wsRef.current = ws;

    ws.onopen = () => {
      isWsAlive.current = true;
      stopPolling(); // stop polling once WS is up
      finnhubSymbols.forEach((symbol) => {
        ws.send(JSON.stringify({ type: "subscribe", symbol }));
      });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === "trade" && Array.isArray(data.data)) {
          // Deduplicate: Finnhub sends multiple trades per tick — take last price per symbol
          const bySymbol: Record<string, number> = {};
          data.data.forEach((trade: { s: string; p: number }) => {
            bySymbol[trade.s] = trade.p;
          });

          Object.entries(bySymbol).forEach(([finnhubSym, price]) => {
            // Map back to our symbol (e.g. BINANCE:BTCUSDT → BTC-USD)
            const ourSymbol =
              allTickers.find((t) => toFinnhubSymbol(t) === finnhubSym) ?? finnhubSym;

            setQuotes((prev) => {
              const existing = prev[ourSymbol];
              const prevPrice = existing?.price ?? price;
              const flash: "up" | "down" | null =
                price > prevPrice ? "up" : price < prevPrice ? "down" : null;
              const changePct = existing
                ? ((price - (existing.price ?? price)) / (existing.price ?? price)) * 100
                : 0;
              return {
                ...prev,
                [ourSymbol]: {
                  symbol: ourSymbol,
                  price,
                  change: price - prevPrice,
                  changePct,
                  flash,
                },
              };
            });

            if (bySymbol[finnhubSym]) {
              setTimeout(() => {
                setQuotes((prev) =>
                  prev[ourSymbol]
                    ? { ...prev, [ourSymbol]: { ...prev[ourSymbol], flash: null } }
                    : prev
                );
              }, FLASH_DURATION_MS);
            }
          });
        }
      } catch {
        // malformed message
      }
    };

    ws.onerror = () => {
      isWsAlive.current = false;
      startPolling(); // fall back to polling
    };

    ws.onclose = () => {
      isWsAlive.current = false;
      // If WS closes unexpectedly, fall back to polling
      if (wsRef.current === ws) {
        startPolling();
      }
    };

    return () => {
      // Unsubscribe then close
      if (ws.readyState === WebSocket.OPEN) {
        finnhubSymbols.forEach((symbol) => {
          ws.send(JSON.stringify({ type: "unsubscribe", symbol }));
        });
        ws.close();
      }
      wsRef.current = null;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickersKey]);

  return { quotes, tickers: allTickers };
}
