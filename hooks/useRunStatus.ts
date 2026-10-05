"use client";

/**
 * Is a dispatched run still going?
 *
 * The chat's dispatch row is written once, when the worker is spawned, and the
 * writer takes three or four minutes. This polls that run so the row can say
 * "Writing" while it is, and become the finished thesis when it lands.
 *
 * Polling, not Realtime: `ResearchRun` is not in the Supabase realtime
 * publication, and adding it is a change to the production database. Polling
 * costs one small query every few seconds for a few minutes and stops dead on
 * the first terminal status — no subscription to leak, nothing to set up.
 */

import { useEffect, useState } from "react";
import type { RunStatusResponse } from "@/app/api/runs/[id]/status/route";

const POLL_MS = 5_000;
/** A writer run is ~3–4 min; past this it is not coming back on this screen. */
const GIVE_UP_MS = 10 * 60_000;

export type RunState = RunStatusResponse & { polling: boolean };

export function useRunStatus(runId: string | null | undefined): RunState | null {
  const [state, setState] = useState<RunState | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

    async function tick() {
      try {
        const res = await fetch(`/api/runs/${runId}/status`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as RunStatusResponse;
        if (cancelled) return;
        const expired = Date.now() - startedAt > GIVE_UP_MS;
        setState({ ...json, polling: !json.done && !expired });
        if (!json.done && !expired) timer = setTimeout(tick, POLL_MS);
      } catch {
        // A failed poll says nothing about the run — keep the last known
        // state and try again, until the give-up window closes.
        if (cancelled) return;
        if (Date.now() - startedAt <= GIVE_UP_MS) timer = setTimeout(tick, POLL_MS);
        else setState((s) => (s ? { ...s, polling: false } : null));
      }
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId]);

  return state;
}
