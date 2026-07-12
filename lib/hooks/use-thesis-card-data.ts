"use client";

/**
 * useThesisCardData — single hook that pulls everything a thesis card or
 * a thesis sheet needs to render, keyed by thesis_id.
 *
 * Both endpoints already exist and are what the open ThesisSheet uses:
 *
 *   • /api/theses/:id/triggers — durable thesis state (status, levels,
 *     coreBelief, snapshot, position metadata, scoring, triggers, etc.)
 *   • /api/theses/:id/quote    — live current price + day change +
 *     position P&L
 *
 * Until this hook existed, the mini-card in the agent chat carousel was
 * reading from PERSISTED tool-call snapshots in RunMessage rows. Those
 * snapshots froze at the moment the agent called the tool and never
 * refreshed — so a thesis edited a week ago showed empty body fields
 * (the V2 schema cutover dropped the legacy fields that older snapshots
 * captured), while the sheet for the SAME thesis_id rendered correctly
 * because it always fetched fresh. The card and the sheet now read from
 * the same well so they can never disagree.
 */
import { useEffect, useState } from "react";
import type {
  TriggersResponse,
  QuoteResponse,
} from "@/lib/types/thesis-sheet";

export interface ThesisCardLiveData {
  state: TriggersResponse | null;
  quote: QuoteResponse | null;
  loading: boolean;
  error: string | null;
}

export function useThesisCardData(
  thesisId: string | null | undefined,
): ThesisCardLiveData {
  const [state, setState] = useState<TriggersResponse | null>(null);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(!!thesisId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!thesisId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const triggersFetch = fetch(`/api/theses/${thesisId}/triggers`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`triggers HTTP ${r.status}`);
        return (await r.json()) as TriggersResponse;
      })
      .then((json) => {
        if (!cancelled) setState(json);
      });

    const quoteFetch = fetch(`/api/theses/${thesisId}/quote`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`quote HTTP ${r.status}`);
        return (await r.json()) as QuoteResponse;
      })
      .then((json) => {
        if (!cancelled) setQuote(json);
      });

    Promise.allSettled([triggersFetch, quoteFetch]).then((results) => {
      if (cancelled) return;
      const firstError = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (firstError) {
        setError(
          firstError.reason instanceof Error
            ? firstError.reason.message
            : String(firstError.reason),
        );
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [thesisId]);

  return { state, quote, loading, error };
}
