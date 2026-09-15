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
// Every symbol here is a Finnhub call on the same 60/min key the 5-minute
// trigger check needs. At 30 s in every open tab, this strip starved the check
// (2026-09-15: ~29 of ~35 stocks rate-limited on the 10:00 pass). So: every
// two minutes, and never while the tab is hidden.
const POLL_INTERVAL_MS = 120_000;
const FLASH_DURATION_MS = 400;

// Crypto tickers delivered by Finnhub free-plan WebSocket
const CRYPTO_TICKERS = new Set(["BTC-USD", "ETH-USD"]);

function toFinnhubSymbol(symbol: string): string {
  if (symbol === "BTC-USD") return "BINANCE:BTCUSDT";
  if (symbol === "ETH-USD") return "BINANCE:ETHUSDT";
  return symbol;
}

/**
 * Live market quotes.
 *
 * Strategy:
 * - REST polling via /api/quotes for ALL tickers, every two minutes, only while
 *   the tab is visible (SPY/QQQ/IWM data only comes from REST — Finnhub free
 *   WS doesn't stream them)
 * - WebSocket is opened (if NEXT_PUBLIC_FINNHUB_API_KEY is set) but only
 *   supplementsquotes for crypto symbols (BINANCE:BTCUSDT, BINANCE:ETHUSDT)
 *   and any open-trade tickers that happen to stream on the free tier
 * - WS updates flash the price cell; REST polling keeps equity tickers fresh
 */
export function useMarketPulse(openTradeTickers: string[] = []) {
  const [quotes, setQuotes] = useState<Record<string, TickerQuote>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPollRef = useRef(0);
  const onVisibleRef = useRef<(() => void) | null>(null);

  const allTickers = [...new Set([...BASE_TICKERS, ...openTradeTickers])];
  const tickersKey = allTickers.join(",");

  // ── Flash helper ──────────────────────────────────────────────────────────

  const applyFlash = useCallback((symbol: string) => {
    setTimeout(() => {
      setQuotes((prev) =>
        prev[symbol] ? { ...prev, [symbol]: { ...prev[symbol], flash: null } } : prev
      );
    }, FLASH_DURATION_MS);
  }, []);

  // ── REST polling (always on, for all tickers) ──────────────────────────────

  const startPolling = useCallback(
    (tickers: string[]) => {
      if (pollTimerRef.current) return;

      const poll = async () => {
        // A hidden tab spends the trigger check's quote budget for nothing.
        if (document.visibilityState === "hidden") return;
        lastPollRef.current = Date.now();
        try {
          const res = await fetch(`/api/quotes?symbols=${tickers.join(",")}`);
          const data = await res.json();
          if (data.quotes) {
            data.quotes.forEach(
              (q: { symbol: string; price: number; changePct: number; change: number }) => {
                setQuotes((prev) => {
                  const existing = prev[q.symbol];
                  const flash: "up" | "down" | null =
                    existing?.price != null
                      ? q.price > existing.price
                        ? "up"
                        : q.price < existing.price
                          ? "down"
                          : null
                      : null;
                  if (flash) applyFlash(q.symbol);
                  return {
                    ...prev,
                    [q.symbol]: { symbol: q.symbol, price: q.price, changePct: q.changePct, change: q.change, flash },
                  };
                });
              }
            );
          }
        } catch {
          // silently fail — show stale data
        }
      };

      poll(); // immediate first fetch (skipped if the tab opened hidden)
      pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);

      // Coming back to the tab refreshes once, only if the data is due.
      const onVisible = () => {
        if (
          document.visibilityState === "visible" &&
          Date.now() - lastPollRef.current >= POLL_INTERVAL_MS
        ) {
          poll();
        }
      };
      document.addEventListener("visibilitychange", onVisible);
      onVisibleRef.current = onVisible;
    },
    [applyFlash]
  );

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (onVisibleRef.current) {
      document.removeEventListener("visibilitychange", onVisibleRef.current);
      onVisibleRef.current = null;
    }
  }, []);

  // ── Main effect ────────────────────────────────────────────────────────────

  useEffect(() => {
    // Always start REST polling immediately — this is the primary data source
    // for equity tickers (SPY/QQQ/IWM) which don't stream via Finnhub free WS.
    startPolling(allTickers);

    const apiKey = process.env.NEXT_PUBLIC_FINNHUB_API_KEY;
    if (!apiKey) {
      return () => stopPolling();
    }

    // Open WebSocket only for symbols that actually stream on the free plan
    // (crypto). Equity subscriptions are sent but Finnhub ignores them on free.
    const cryptoTickers = allTickers.filter((t) => CRYPTO_TICKERS.has(t));
    const cryptoFinnhubSymbols = cryptoTickers.map(toFinnhubSymbol);

    const ws = new WebSocket(`wss://ws.finnhub.io?token=${apiKey}`);
    wsRef.current = ws;

    ws.onopen = () => {
      // Subscribe to crypto symbols only
      cryptoFinnhubSymbols.forEach((symbol) => {
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
            const ourSymbol =
              allTickers.find((t) => toFinnhubSymbol(t) === finnhubSym) ?? finnhubSym;

            setQuotes((prev) => {
              const existing = prev[ourSymbol];
              const prevPrice = existing?.price ?? price;
              const flash: "up" | "down" | null =
                price > prevPrice ? "up" : price < prevPrice ? "down" : null;
              const change = price - prevPrice;
              const changePct = prevPrice !== 0 ? (change / prevPrice) * 100 : 0;
              if (flash) applyFlash(ourSymbol);
              return {
                ...prev,
                [ourSymbol]: { symbol: ourSymbol, price, change, changePct, flash },
              };
            });
          });
        }
      } catch {
        // malformed message — ignore
      }
    };

    // WS errors/closes don't stop REST polling; polling already running
    ws.onerror = () => {
      // no-op — REST polling covers us
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        cryptoFinnhubSymbols.forEach((symbol) => {
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
