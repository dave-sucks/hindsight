"use client";

/**
 * Principal Chat — operator co-pilot.
 *
 * Thin wrapper over AgentChat. Owns the scope state (which analyst the
 * chat is bound to). The scope chip lives INSIDE the input (Notion /
 * Linear / Claude pattern) — we pass it to AgentChat's topSlot prop,
 * which forwards it to the composer's contextChip feature.
 */

import { useCallback, useState } from "react";
import { AgentChat } from "@/components/agent/AgentChat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bot, ChevronDown, Wallet } from "lucide-react";

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

  const scopedAnalyst = scopedAnalystId
    ? analysts.find((a) => a.id === scopedAnalystId) ?? null
    : null;

  const handlePickScope = useCallback((analystId: string | null) => {
    setScopedAnalystId(analystId);
    storeScope(analystId);
  }, []);

  // Compact chip rendered inside the input's block-start addon.
  const scopeChip = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            {scopedAnalyst ? (
              <>
                <Bot className="h-3 w-3" />
                {scopedAnalyst.name}
              </>
            ) : (
              <>
                <Wallet className="h-3 w-3" />
                Portfolio
              </>
            )}
            <ChevronDown className="h-3 w-3" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuItem onClick={() => handlePickScope(null)}>
          <Wallet className="h-3.5 w-3.5" />
          Portfolio (no analyst pinned)
        </DropdownMenuItem>
        {analysts.length > 0 && <DropdownMenuSeparator />}
        {analysts.map((a) => (
          <DropdownMenuItem
            key={a.id}
            onClick={() => handlePickScope(a.id)}
          >
            <Bot className="h-3.5 w-3.5" />
            {a.name}
            {!a.enabled && (
              <span className="ml-auto text-xs text-muted-foreground">
                disabled
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <AgentChat
        mode="principal"
        analystId={scopedAnalystId ?? undefined}
        analystName={scopedAnalyst?.name}
        topSlot={scopeChip}
      />
    </div>
  );
}
