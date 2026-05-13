"use client";

/**
 * Principal Chat — operator co-pilot.
 *
 * Owns the scope state (which analyst the chat is bound to) and hands
 * it to AgentChat as `principalScope`. AgentChat renders both the
 * in-input brand-green chip (only when scoped) and the Scope submenu
 * inside the composer's Settings2 dropdown.
 */

import { useCallback, useMemo, useState } from "react";
import { AgentChat } from "@/components/agent/AgentChat";

const SCOPE_PREF_KEY = "hindsight_principal_scope";

function getStoredScope(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SCOPE_PREF_KEY);
}

function storeScope(value: string | null) {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(SCOPE_PREF_KEY, value);
  else localStorage.removeItem(SCOPE_PREF_KEY);
}

interface Props {
  analysts: Array<{ id: string; name: string; enabled: boolean }>;
}

export function ChatPageClient({ analysts }: Props) {
  const [scopedAnalystId, setScopedAnalystId] = useState<string | null>(() => {
    const stored = getStoredScope();
    if (!stored) return null;
    return analysts.some((a) => a.id === stored) ? stored : null;
  });

  const handleChange = useCallback((analystId: string | null) => {
    setScopedAnalystId(analystId);
    storeScope(analystId);
  }, []);

  const principalScope = useMemo(
    () => ({
      current: scopedAnalystId
        ? (() => {
            const a = analysts.find((x) => x.id === scopedAnalystId);
            return a ? { id: a.id, name: a.name } : null;
          })()
        : null,
      options: analysts,
      onChange: handleChange,
    }),
    [scopedAnalystId, analysts, handleChange],
  );

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <AgentChat
        mode="principal"
        analystId={scopedAnalystId ?? undefined}
        principalScope={principalScope}
      />
    </div>
  );
}
