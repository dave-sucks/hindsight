"use client";

/**
 * Principal Chat — operator co-pilot.
 *
 * Page defaults to UNSCOPED. To pin a scope, the user opens the
 * composer's Settings2 dropdown and picks an analyst from the Scope
 * submenu. A muted badge with an X then appears at the top of the
 * input; clicking the X unscopes. No persistence across reloads.
 */

import { useCallback, useMemo, useState } from "react";
import { AgentChat } from "@/components/agent/AgentChat";

interface Props {
  analysts: Array<{ id: string; name: string; enabled: boolean }>;
}

export function ChatPageClient({ analysts }: Props) {
  // Page defaults to unscoped every time. No localStorage restore.
  const [scopedAnalystId, setScopedAnalystId] = useState<string | null>(null);

  const handleChange = useCallback((analystId: string | null) => {
    setScopedAnalystId(analystId);
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
